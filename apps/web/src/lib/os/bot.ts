import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * The Sales → Customer Success handoff bot (Day 1 pack §12).
 *
 * The pack is specific about the operating model, and this follows it:
 *
 *   §8   "Bots read approved context, reason over it, propose actions and —
 *         only where explicitly permitted — invoke controlled application
 *         operations. The source of truth remains the modular monolith."
 *   §10.3 the output schema is defined before the prompt
 *   §10.4 the bot may not change lead stage, create a customer, assign
 *         ownership or send anything
 *   §10.5 a human review step
 *   §10.6 the approved result is persisted as a first-class OS artifact
 *   §10.10 every run is attributable: bot, model, initiating user, context,
 *          timestamp, outcome
 *
 * So: this file reads, calls Groq, and writes a DRAFT. Nothing else. Approval
 * is a separate, human action, and only approval writes to the timeline.
 */

const MODEL = "openai/gpt-oss-120b";
const BOT = "sales-to-cs-handoff";

/** §10.3 — the output schema, defined before the prompt. */
export type HandoffBrief = {
  summary: string;
  business_context: string;
  requirements: string[];
  promises_made: string[];
  open_questions: string[];
  risks: string[];
  first_actions: string[];
  missing_information: string[];
};

export type BotRun = {
  id: string;
  bot: string;
  model: string;
  organization_id: string | null;
  output: HandoffBrief | null;
  status: "draft" | "approved" | "rejected";
  error: string | null;
  created_at: string;
  approved_at: string | null;
};

const EMPTY: HandoffBrief = {
  summary: "",
  business_context: "",
  requirements: [],
  promises_made: [],
  open_questions: [],
  risks: [],
  first_actions: [],
  missing_information: [],
};

/** §10.2 — the allowed input context, deliberately narrow. */
async function gatherContext(orgId: string) {
  const { data: org } = await supabaseAdmin
    .from("organizations")
    .select("id, name, type, contact_phone, source_lead_id, onboarding_stage")
    .eq("id", orgId)
    .single();

  const leadId = org?.source_lead_id as string | undefined;

  const [lead, deal, reqs, handoffs, interactions] = await Promise.all([
    leadId
      ? supabaseAdmin.from("leads").select("business_name, contact_name, contact_phone, source, referrer_name").eq("id", leadId).maybeSingle()
      : Promise.resolve({ data: null }),
    leadId
      ? supabaseAdmin.from("deals").select("brief, quote_amount, plan, status").eq("lead_id", leadId).maybeSingle()
      : Promise.resolve({ data: null }),
    supabaseAdmin.from("requirements").select("title, status, disposition, source").eq("organization_id", orgId),
    supabaseAdmin.from("handoffs").select("from_team, to_team, context").eq("organization_id", orgId),
    leadId
      ? supabaseAdmin.from("interactions").select("kind, summary, detail, occurred_at").eq("lead_id", leadId).order("occurred_at")
      : Promise.resolve({ data: [] }),
  ]);

  return {
    organization: org ?? null,
    lead: lead.data ?? null,
    deal: deal.data ?? null,
    requirements: reqs.data ?? [],
    handoffs: handoffs.data ?? [],
    interactions: interactions.data ?? [],
  };
}

const SYSTEM = `You prepare onboarding handoff briefs for Proviyaa, a merchant operating system.

You are given the sales context for one customer: the lead, the scoping brief, the commercial status, the requirements captured so far, and any recorded interactions.

Write the brief the receiving Customer Success manager needs in order to talk to this customer without asking them to repeat themselves.

Rules:
- Use ONLY the supplied context. Never invent a fact, a name, a number or a promise.
- If something important is absent, say so in missing_information rather than guessing.
- promises_made must contain only things the context shows were actually said or agreed.
- risks are things that could go wrong for THIS customer, drawn from the context.
- first_actions are concrete next steps for Customer Success, not generic advice.
- Keep every string plain, specific and short. No marketing language.
- All money is Indian rupees. Write amounts as ₹2,40,000 in the Indian digit grouping. Never use $ or "k".
- Use the names exactly as they appear in the context.

Reply with JSON only, matching exactly this shape:
{"summary":string,"business_context":string,"requirements":string[],"promises_made":string[],"open_questions":string[],"risks":string[],"first_actions":string[],"missing_information":string[]}`;

/**
 * Runs the bot and stores a DRAFT. Never changes business state — that is
 * §10.4, and it is enforced here by simply not doing it.
 */
export async function runHandoffBot(orgId: string, actor: string): Promise<BotRun> {
  const apiKey = process.env.GROQ_API_KEY;
  const context = await gatherContext(orgId);

  const insertDraft = async (output: HandoffBrief | null, error: string | null) => {
    const { data, error: dbErr } = await supabaseAdmin
      .from("bot_runs")
      .insert({
        bot: BOT,
        model: MODEL,
        organization_id: orgId,
        lead_id: (context.organization?.source_lead_id as string | null) ?? null,
        input_context: context as unknown as Record<string, unknown>,
        output,
        error,
        initiated_by: actor,
      })
      .select("id, bot, model, organization_id, output, status, error, created_at, approved_at")
      .single();
    if (dbErr) throw new Error(`runHandoffBot: ${dbErr.message}`);
    return data as BotRun;
  };

  if (!apiKey) {
    return insertDraft(null, "GROQ_API_KEY is not set — no brief was generated.");
  }

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: JSON.stringify(context) },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      return insertDraft(null, `Groq returned ${res.status}: ${body.slice(0, 300)}`);
    }

    const json = await res.json();
    const raw = json?.choices?.[0]?.message?.content;
    if (!raw) return insertDraft(null, "Groq returned no content.");

    let parsed: Partial<HandoffBrief>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return insertDraft(null, "Groq returned text that was not valid JSON.");
    }

    const asList = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).map((x) => (x as string).trim()) : [];

    const output: HandoffBrief = {
      ...EMPTY,
      summary: typeof parsed.summary === "string" ? parsed.summary.trim() : "",
      business_context: typeof parsed.business_context === "string" ? parsed.business_context.trim() : "",
      requirements: asList(parsed.requirements),
      promises_made: asList(parsed.promises_made),
      open_questions: asList(parsed.open_questions),
      risks: asList(parsed.risks),
      first_actions: asList(parsed.first_actions),
      missing_information: asList(parsed.missing_information),
    };

    return insertDraft(output, null);
  } catch (err) {
    return insertDraft(null, err instanceof Error ? err.message : "The bot could not be reached.");
  }
}

export async function listBotRuns(orgId: string): Promise<BotRun[]> {
  const { data, error } = await supabaseAdmin
    .from("bot_runs")
    .select("id, bot, model, organization_id, output, status, error, created_at, approved_at")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw new Error(`listBotRuns: ${error.message}`);
  return (data ?? []) as BotRun[];
}

/**
 * §10.5 + §10.6 — a human approves, and only then does the brief become an OS
 * artifact: it lands on the organization's timeline where the receiving team
 * reads it, instead of staying inside a chat transcript.
 */
export async function decideBotRun(
  runId: string,
  approve: boolean,
  actor: string,
): Promise<string[]> {
  const { data: run, error } = await supabaseAdmin
    .from("bot_runs")
    .select("id, organization_id, output, status, model, bot")
    .eq("id", runId)
    .single();
  if (error) throw new Error(`decideBotRun: ${error.message}`);
  if (run.status !== "draft") throw new Error("decideBotRun: this draft has already been decided.");
  // A run that produced nothing cannot be approved into the record — there is
  // nothing to approve, and an empty "approved brief" is worse than none.
  if (approve && !run.output) {
    throw new Error("decideBotRun: this run produced no brief. Reject it and run the bot again.");
  }

  const { error: updErr } = await supabaseAdmin
    .from("bot_runs")
    .update({
      status: approve ? "approved" : "rejected",
      approved_by: actor,
      approved_at: new Date().toISOString(),
    })
    .eq("id", runId);
  if (updErr) throw new Error(`decideBotRun: ${updErr.message}`);

  if (!approve) return ["Draft rejected — nothing was written to the customer's record"];

  const brief = run.output as HandoffBrief | null;
  const { error: actErr } = await supabaseAdmin.from("activities").insert({
    kind: "note",
    summary: "Handoff brief approved and attached to this customer",
    detail: { bot: run.bot, model: run.model, brief },
    organization_id: run.organization_id,
    actor,
    actor_label: "user",
  });
  if (actErr) throw new Error(`decideBotRun (activity): ${actErr.message}`);

  return [
    "Brief approved and written to the organization's timeline",
    "Attributed to the bot, the model and you — every run is on the record",
  ];
}
