"use client";

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  ArrowRight,
  Building2,
  Check,
  Handshake,
  History,
  IndianRupee,
  PhoneCall,
  LoaderCircle,
  Plus,
  TriangleAlert,
  X,
} from "lucide-react";
import type { Interaction, Lead, LeadEvent, LeadSource, LeadStatus } from "@/lib/leads";
import type { Deal, DealEvent, DealStatus } from "@/lib/deals";
import {
  advanceDealAction,
  advanceLeadAction,
  createLeadAction,
  recordInteractionAction,
  recordPaymentAction,
  startScopingAction,
  updateDealBriefAction,
  type ActionResult,
} from "@/app/admin/growth/actions";
import { Button } from "@/components/ui/Button";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/cn";

const FIELD =
  "glass-inset h-11 w-full rounded-[13px] px-3.5 text-[14.5px] font-medium " +
  "outline-none transition-shadow placeholder:text-muted/70 " +
  "focus:shadow-[inset_0_0_0_2px_var(--lime-deep)]";
const LABEL = "t-label mb-1.5 block text-muted";

const SOURCE_LABEL: Record<LeadSource, string> = {
  cold: "Cold",
  referral: "Referral",
  affiliate: "Affiliate",
  reseller: "Reseller",
  inbound: "Inbound",
};
const NEEDS_REFERRER = new Set<LeadSource>(["referral", "affiliate", "reseller"]);

// Three working columns. The middle of the funnel (qualified through payment
// pending) is one column because it is one conversation — the row itself
// shows exactly which stage it is at.
const COLUMNS: { key: string; label: string; statuses: LeadStatus[] }[] = [
  { key: "new", label: "New", statuses: ["new"] },
  { key: "contacted", label: "Contacted", statuses: ["contacted"] },
  {
    key: "in_play",
    label: "Qualified → payment",
    statuses: ["qualified", "requirement", "demo", "proposal", "payment_pending"],
  },
];

function age(iso: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

// ---------------------------------------------------------------------------
// New lead
// ---------------------------------------------------------------------------

const INITIAL: ActionResult = { ok: true };

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="lime" size="md" disabled={pending} feedback="medium" className="w-full sm:w-auto">
      {pending ? <LoaderCircle size={16} className="animate-spin" /> : <Plus size={15} strokeWidth={3} />}
      {pending ? "Saving…" : label}
    </Button>
  );
}

function NewLeadSheet({
  assignees,
  onClose,
}: {
  assignees: { id: string; email: string; name: string | null; role: string | null }[];
  onClose: () => void;
}) {
  const [source, setSource] = useState<LeadSource>("cold");
  const [state, formAction] = useActionState(
    async (_prev: ActionResult, formData: FormData) => {
      const res = await createLeadAction(formData);
      if (res.ok) {
        haptic("success");
        onClose();
      }
      return res;
    },
    INITIAL,
  );

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-label="New lead">
      <button aria-label="Close" className="absolute inset-0 bg-[rgb(18_21_15_/_0.45)] backdrop-blur-sm" onClick={onClose} />
      <aside className="glass relative ml-auto flex h-full w-full max-w-md flex-col overflow-y-auto p-5 sm:p-6">
        <div className="relative z-10 flex min-h-full flex-col">
          <div className="flex items-start gap-3">
            <div>
              <h2 className="t-h2">New lead</h2>
              <p className="mt-1 text-[13px] text-muted">Attributed the instant it&rsquo;s saved.</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="press glass-inset ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] text-muted hover:text-ink"
            >
              <X size={16} strokeWidth={2.6} />
            </button>
          </div>

          <form action={formAction} className="mt-6 flex flex-1 flex-col gap-4">
            <label>
              <span className={LABEL}>Business name</span>
              <input name="businessName" required className={FIELD} placeholder="e.g. More Supermart" />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label>
                <span className={LABEL}>Contact name</span>
                <input name="contactName" className={FIELD} placeholder="Optional" />
              </label>
              <label>
                <span className={LABEL}>Contact phone</span>
                <input name="contactPhone" className={FIELD} placeholder="Optional" />
              </label>
            </div>

            <label>
              <span className={LABEL}>Source</span>
              <select
                name="source"
                value={source}
                onChange={(e) => setSource(e.target.value as LeadSource)}
                className={FIELD}
              >
                {Object.entries(SOURCE_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </label>

            {NEEDS_REFERRER.has(source) && (
              <label>
                <span className={LABEL}>Who referred it</span>
                <input name="referrerName" required className={FIELD} placeholder="A name — attribution matters here" />
              </label>
            )}

            <label>
              <span className={LABEL}>Assign to</span>
              <select name="assignedTo" className={FIELD} defaultValue="">
                <option value="">Unassigned</option>
                {assignees.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name ?? a.email}
                    {a.role ? ` — ${a.role.replace(/_/g, " ")}` : ""}
                  </option>
                ))}
              </select>
            </label>

            {!state.ok && (
              <p className="flex items-center gap-2 text-[13px] font-bold text-[var(--danger)]">
                <TriangleAlert size={14} /> {state.error}
              </p>
            )}

            <div className="mt-auto pt-4">
              <SubmitButton label="Create lead" />
            </div>
          </form>
        </div>
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Advancing a lead + its history
// ---------------------------------------------------------------------------

// Day 1 §5.3, in full. 'disqualified' is the pre-qualification exit; 'lost'
// is losing a deal that had already been quoted.
const NEXT: Partial<Record<LeadStatus, { to: LeadStatus; label: string }[]>> = {
  new: [{ to: "contacted", label: "Mark contacted" }, { to: "disqualified", label: "Disqualify" }],
  contacted: [{ to: "qualified", label: "Mark qualified" }, { to: "disqualified", label: "Disqualify" }],
  qualified: [{ to: "requirement", label: "Requirements gathered" }, { to: "lost", label: "Mark lost" }],
  requirement: [{ to: "demo", label: "Demo given" }, { to: "lost", label: "Mark lost" }],
  demo: [{ to: "proposal", label: "Proposal sent" }, { to: "lost", label: "Mark lost" }],
  proposal: [{ to: "payment_pending", label: "Awaiting payment" }, { to: "lost", label: "Mark lost" }],
  payment_pending: [{ to: "lost", label: "Mark lost" }],
};

const STATUS_LABEL: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  requirement: "Requirement",
  demo: "Demo",
  proposal: "Proposal",
  payment_pending: "Payment pending",
  converted: "Converted",
  lost: "Lost",
  disqualified: "Disqualified",
};

const INTERACTION_KINDS = ["call", "meeting", "message", "email", "demo", "note"] as const;

// ---------------------------------------------------------------------------
// Scoping & the deal — touchpoint 3, only once a lead is qualified
// ---------------------------------------------------------------------------

const DEAL_NEXT: Partial<Record<DealStatus, { to: DealStatus; label: string }[]>> = {
  drafting: [{ to: "quoted", label: "Approve quote" }, { to: "lost", label: "Mark lost" }],
  quoted: [{ to: "won", label: "Mark won (paid)" }, { to: "lost", label: "Mark lost" }],
};

function money(amount: string | null): string {
  if (!amount) return "No quote yet";
  return `₹${Number(amount).toLocaleString("en-IN")}`;
}

function DealPanel({
  lead,
  deal,
  events,
  convertedOrg,
  paid,
  commission,
}: {
  lead: Lead;
  deal: Deal | undefined;
  events: DealEvent[];
  convertedOrg: { id: string; name: string; slug: string } | undefined;
  paid: number;
  commission: { partner: string; amount: string | null; status: string } | undefined;
}) {
  const [starting, setStarting] = useState(false);
  const [brief, setBrief] = useState(deal?.brief ?? "");
  const [quoteAmount, setQuoteAmount] = useState(deal?.quote_amount ?? "");
  const [plan, setPlan] = useState(deal?.plan ?? "");
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [advancing, setAdvancing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("upi");
  const [payRef, setPayRef] = useState("");
  const [paying, setPaying] = useState(false);

  async function takePayment() {
    if (!deal) return;
    haptic("medium");
    setPaying(true);
    setError(null);
    const res = await recordPaymentAction(deal.id, {
      amount: payAmount,
      method: payMethod,
      reference: payRef,
    });
    setPaying(false);
    if (!res.ok) { setError(res.error); return; }
    setPayAmount(""); setPayRef("");
  }

  async function start() {
    haptic("medium");
    setStarting(true);
    setError(null);
    const res = await startScopingAction(lead.id);
    setStarting(false);
    if (!res.ok) setError(res.error);
  }

  async function saveBrief() {
    if (!deal) return;
    haptic("light");
    setSaving(true);
    setError(null);
    const res = await updateDealBriefAction(deal.id, { brief, quoteAmount, plan });
    setSaving(false);
    if (!res.ok) setError(res.error);
  }

  async function advance(to: DealStatus) {
    if (!deal) return;
    haptic("medium");
    setAdvancing(true);
    setError(null);
    const res = await advanceDealAction(deal.id, to, note);
    setAdvancing(false);
    if (!res.ok) { setError(res.error); return; }
    setNote("");
  }

  if (!deal) {
    return (
      <div>
        <Button variant="glass" size="sm" disabled={starting} onClick={start}>
          {starting ? <LoaderCircle size={13} className="animate-spin" /> : <Handshake size={13} strokeWidth={2.6} />}
          Start scoping
        </Button>
        {error && (
          <p className="mt-2 flex items-center gap-1.5 text-[12.5px] font-bold text-[var(--danger)]">
            <TriangleAlert size={13} /> {error}
          </p>
        )}
      </div>
    );
  }

  const nextSteps = DEAL_NEXT[deal.status] ?? [];
  const editable = deal.status === "drafting" || deal.status === "quoted";

  return (
    <div className="space-y-3">
      <p className="t-label flex items-center gap-1.5 text-muted">
        <Handshake size={11} /> Scoping &amp; deal <span className="capitalize">· {deal.status}</span>
      </p>

      {editable ? (
        <div className="space-y-2">
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            rows={3}
            placeholder="What does the business actually need — modules, per-outlet notes, customs?"
            className={cn(FIELD, "h-auto py-2.5 resize-none")}
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              value={quoteAmount ?? ""}
              onChange={(e) => setQuoteAmount(e.target.value)}
              placeholder="Quote amount (₹)"
              className={FIELD}
            />
            <input
              value={plan ?? ""}
              onChange={(e) => setPlan(e.target.value)}
              placeholder="Plan — e.g. Annual"
              className={FIELD}
            />
          </div>
          <Button variant="glass" size="sm" disabled={saving} onClick={saveBrief}>
            {saving ? <LoaderCircle size={13} className="animate-spin" /> : <Check size={13} strokeWidth={2.8} />}
            Save brief
          </Button>
        </div>
      ) : (
        <div className="glass-inset space-y-1 rounded-[13px] px-3.5 py-3 text-[12.5px] text-ink-2">
          {deal.brief && <p>&ldquo;{deal.brief}&rdquo;</p>}
          <p className="tnum text-muted">{money(deal.quote_amount)}{deal.plan ? ` · ${deal.plan}` : ""}</p>
        </div>
      )}

      {(deal.status === "quoted" || paid > 0 || commission) && (
        <div className="glass-inset space-y-2 rounded-[13px] px-3.5 py-3">
          <p className="t-label flex items-center gap-1.5 text-muted">
            <IndianRupee size={11} /> Payment
            {paid > 0 && (
              <span className="tnum font-bold text-[var(--ok)]">
                ₹{paid.toLocaleString("en-IN")} received
              </span>
            )}
          </p>
          {deal.status === "quoted" && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <input
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  placeholder="Amount (₹)"
                  className={FIELD}
                />
                <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} className={FIELD}>
                  <option value="upi">UPI</option>
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="card">Card</option>
                  <option value="cheque">Cheque</option>
                  <option value="cash">Cash</option>
                </select>
                <input
                  value={payRef}
                  onChange={(e) => setPayRef(e.target.value)}
                  placeholder="Reference"
                  className={FIELD}
                />
              </div>
              <Button variant="glass" size="sm" disabled={paying} onClick={takePayment}>
                {paying ? <LoaderCircle size={13} className="animate-spin" /> : <Check size={13} strokeWidth={2.8} />}
                Record payment
              </Button>
            </>
          )}
          {commission && (
            <p className="text-[12.5px] text-ink-2">
              Commission · {commission.partner} ·{" "}
              {commission.amount ? `₹${Number(commission.amount).toLocaleString("en-IN")}` : "—"}{" "}
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide",
                  commission.status === "approved"
                    ? "bg-[rgb(79_191_106_/_0.18)] text-[var(--ok)]"
                    : "bg-[rgb(18_21_15_/_0.08)] text-muted",
                )}
              >
                {commission.status}
              </span>
            </p>
          )}
        </div>
      )}

      {nextSteps.length > 0 && (
        <div className="space-y-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="A note for the record"
            className={cn(FIELD, "h-auto py-2.5 resize-none")}
          />
          <div className="flex flex-wrap gap-2">
            {nextSteps.map((s) => (
              <Button
                key={s.to}
                variant={s.to === "lost" ? "ghost" : "glass"}
                size="sm"
                disabled={advancing}
                onClick={() => advance(s.to)}
              >
                <Check size={13} strokeWidth={2.8} /> {s.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {deal.status === "won" && (
        convertedOrg ? (
          <a
            href={`/admin/organizations/${convertedOrg.id}`}
            className="press flex w-fit items-center gap-1.5 text-[13px] font-bold text-[var(--lime-deep)]"
          >
            <Building2 size={13} /> Converted to {convertedOrg.name} <ArrowRight size={13} />
          </a>
        ) : (
          <a
            href={`/admin/organizations?fromLead=${lead.id}&name=${encodeURIComponent(lead.business_name)}`}
            className="press flex w-fit items-center gap-1.5 text-[13px] font-bold text-[var(--lime-deep)]"
          >
            <Building2 size={13} /> Create organization <ArrowRight size={13} />
          </a>
        )
      )}

      {error && (
        <p className="flex items-center gap-1.5 text-[12.5px] font-bold text-[var(--danger)]">
          <TriangleAlert size={13} /> {error}
        </p>
      )}

      {events.length > 0 && (
        <div>
          <p className="t-label flex items-center gap-1.5 text-muted">
            <History size={11} /> Deal history
          </p>
          <ol className="mt-1.5 space-y-1.5">
            {events.map((e) => (
              <li key={e.id} className="text-[12.5px] leading-snug text-ink-2">
                <span className="tnum text-muted">
                  {new Date(e.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                </span>
                {" · "}
                <span className="font-bold capitalize">{e.from_status ?? "opened"} → {e.to_status}</span>
                {e.actor_email && <span className="text-muted"> · {e.actor_email}</span>}
                {e.note && <span className="block text-ink-2">&ldquo;{e.note}&rdquo;</span>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function LeadRow({
  lead,
  events,
  deal,
  dealEvents,
  convertedOrg,
  paid,
  commission,
  interactions,
}: {
  lead: Lead;
  events: LeadEvent[];
  interactions: Interaction[];
  deal: Deal | undefined;
  dealEvents: DealEvent[];
  convertedOrg: { id: string; name: string; slug: string } | undefined;
  paid: number;
  commission: { partner: string; amount: string | null; status: string } | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [intKind, setIntKind] = useState<string>("call");
  const [intSummary, setIntSummary] = useState("");
  const [intWho, setIntWho] = useState("");
  const [logging, setLogging] = useState(false);
  const nextSteps = NEXT[lead.status] ?? [];

  async function logInteraction() {
    haptic("medium");
    setLogging(true);
    setError(null);
    const res = await recordInteractionAction(lead.id, intKind, intSummary, intWho);
    setLogging(false);
    if (!res.ok) { setError(res.error); return; }
    setIntSummary(""); setIntWho(""); setLogOpen(false);
  }

  async function advance(to: LeadStatus) {
    haptic("medium");
    setPending(true);
    setError(null);
    const res = await advanceLeadAction(lead.id, to, note);
    setPending(false);
    if (!res.ok) { setError(res.error); return; }
    setNote("");
  }

  return (
    <div className="glass-inset rounded-[var(--r-lg)] p-3.5">
      <button
        type="button"
        onClick={() => { haptic("light"); setOpen((v) => !v); }}
        className="press flex w-full items-center gap-2.5 text-left"
      >
        <Building2 size={15} className="shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate text-[14px] font-bold">{lead.business_name}</span>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide",
            lead.source === "cold" ? "bg-[rgb(18_21_15_/_0.08)] text-muted" : "bg-[rgb(180_238_42_/_0.18)] text-[var(--lime-deep)]",
          )}
        >
          {SOURCE_LABEL[lead.source]}
        </span>
        <span className="shrink-0 rounded-full bg-[rgb(18_21_15_/_0.07)] px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-muted">
          {STATUS_LABEL[lead.status]}
        </span>
        <span className="tnum shrink-0 text-[12px] text-muted">{age(lead.created_at)}</span>
      </button>

      <p className="mt-1.5 pl-[23px] text-[12.5px] text-muted">
        {lead.referrer_name ? `via ${lead.referrer_name} · ` : ""}
        {lead.assigned_to_email ? lead.assigned_to_email : "Unassigned"}
      </p>

      {open && (
        <div className="mt-3 space-y-3 border-t border-[var(--line)] pt-3">
          {nextSteps.length > 0 && (
            <div className="space-y-2">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="What did the business actually say?"
                className={cn(FIELD, "h-auto py-2.5 resize-none")}
              />
              <div className="flex flex-wrap gap-2">
                {nextSteps.map((s) => (
                  <Button
                    key={s.to}
                    variant={s.to === "disqualified" ? "ghost" : "glass"}
                    size="sm"
                    disabled={pending}
                    onClick={() => advance(s.to)}
                  >
                    <Check size={13} strokeWidth={2.8} /> {s.label}
                  </Button>
                ))}
              </div>
              {error && (
                <p className="flex items-center gap-1.5 text-[12.5px] font-bold text-[var(--danger)]">
                  <TriangleAlert size={13} /> {error}
                </p>
              )}
            </div>
          )}

          {events.length > 0 && (
            <div>
              <p className="t-label flex items-center gap-1.5 text-muted">
                <History size={11} /> History
              </p>
              <ol className="mt-1.5 space-y-1.5">
                {events.map((e) => (
                  <li key={e.id} className="text-[12.5px] leading-snug text-ink-2">
                    <span className="tnum text-muted">
                      {new Date(e.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </span>
                    {" · "}
                    <span className="font-bold capitalize">{e.from_status ?? "created"} → {e.to_status}</span>
                    {e.actor_email && <span className="text-muted"> · {e.actor_email}</span>}
                    {e.note && <span className="block text-ink-2">&ldquo;{e.note}&rdquo;</span>}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Day 1 §5.4 — interactions, as records */}
          <div className="border-t border-[var(--line)] pt-3">
            <p className="t-label flex items-center gap-1.5 text-muted">
              <PhoneCall size={11} /> Interactions
            </p>
            {interactions.length > 0 ? (
              <ol className="mt-1.5 space-y-1.5">
                {interactions.map((it) => (
                  <li key={it.id} className="text-[12.5px] leading-snug text-ink-2">
                    <span className="tnum text-muted">
                      {new Date(it.occurred_at).toLocaleDateString("en-IN", {
                        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                      })}
                    </span>
                    {" · "}
                    <span className="font-bold capitalize">{it.kind}</span>
                    {" — "}{it.summary}
                    {it.participants && <span className="text-muted"> · {it.participants}</span>}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-1 text-[12.5px] text-muted">Nothing logged yet.</p>
            )}

            {logOpen ? (
              <div className="mt-2 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <select value={intKind} onChange={(e) => setIntKind(e.target.value)} className={FIELD}>
                    {INTERACTION_KINDS.map((k) => (
                      <option key={k} value={k} className="capitalize">{k}</option>
                    ))}
                  </select>
                  <input value={intWho} onChange={(e) => setIntWho(e.target.value)} placeholder="Who was there" className={FIELD} />
                </div>
                <input value={intSummary} onChange={(e) => setIntSummary(e.target.value)} placeholder="What happened?" className={FIELD} />
                <Button variant="glass" size="sm" disabled={logging || !intSummary.trim()} onClick={logInteraction}>
                  {logging ? <LoaderCircle size={13} className="animate-spin" /> : <Check size={13} strokeWidth={2.8} />}
                  Log it
                </Button>
              </div>
            ) : (
              <Button variant="ghost" size="sm" className="mt-1.5" onClick={() => setLogOpen(true)}>
                <Plus size={13} strokeWidth={2.8} /> Log a call or meeting
              </Button>
            )}
          </div>

          {["qualified", "requirement", "demo", "proposal", "payment_pending", "converted"].includes(lead.status) && (
            <div className="border-t border-[var(--line)] pt-3">
              <DealPanel
                lead={lead}
                deal={deal}
                events={dealEvents}
                convertedOrg={convertedOrg}
                paid={paid}
                commission={commission}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function GrowthBoard({
  leads,
  assignees,
  events,
  deals,
  dealEvents,
  convertedOrgs,
  paidByDeal,
  commissionByDeal,
  interactions,
}: {
  leads: Lead[];
  assignees: { id: string; email: string; name: string | null; role: string | null }[];
  events: Record<string, LeadEvent[]>;
  deals: Deal[];
  dealEvents: Record<string, DealEvent[]>;
  convertedOrgs: Record<string, { id: string; name: string; slug: string }>;
  paidByDeal: Record<string, number>;
  commissionByDeal: Record<string, { partner: string; amount: string | null; status: string }>;
  interactions: Record<string, Interaction[]>;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);

  const byStatus = useMemo(() => {
    const m = new Map<LeadStatus, Lead[]>();
    for (const l of leads) m.set(l.status, [...(m.get(l.status) ?? []), l]);
    return m;
  }, [leads]);

  // One deal per lead (unique lead_id) — a plain lookup, not a list.
  const dealByLead = useMemo(() => {
    const m = new Map<string, Deal>();
    for (const d of deals) m.set(d.lead_id, d);
    return m;
  }, [deals]);

  const closed = [...(byStatus.get("disqualified") ?? []), ...(byStatus.get("lost") ?? []), ...(byStatus.get("converted") ?? [])];

  function renderLead(lead: Lead) {
    const deal = dealByLead.get(lead.id);
    return (
      <LeadRow
        key={lead.id}
        lead={lead}
        events={events[lead.id] ?? []}
        deal={deal}
        dealEvents={deal ? (dealEvents[deal.id] ?? []) : []}
        convertedOrg={convertedOrgs[lead.id]}
        paid={deal ? (paidByDeal[deal.id] ?? 0) : 0}
        commission={deal ? commissionByDeal[deal.id] : undefined}
        interactions={interactions[lead.id] ?? []}
      />
    );
  }

  return (
    <>
      <div className="flex justify-end">
        <Button variant="lime" size="md" feedback="medium" onClick={() => { haptic("medium"); setSheetOpen(true); }}>
          <Plus size={15} strokeWidth={3} /> New lead
        </Button>
      </div>

      {leads.length === 0 ? (
        <div className="glass flex flex-col items-center rounded-[var(--r-2xl)] px-6 py-16 text-center">
          <div className="relative z-10 flex flex-col items-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-[20px]" style={{ background: "#14170f" }}>
              <Handshake size={26} className="text-[var(--lime)]" />
            </span>
            <h2 className="t-h2 mt-6">No leads yet</h2>
            <p className="mt-2 max-w-sm text-[15px] text-muted">
              A referral, a cold call, an inbound enquiry — the first one attributed here starts
              the chain the rest of Proviyaa runs on.
            </p>
            <div className="mt-7">
              <Button variant="lime" size="md" onClick={() => setSheetOpen(true)}>
                <Plus size={15} strokeWidth={3} /> New lead
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {COLUMNS.map((col) => {
            const rows = col.statuses.flatMap((st) => byStatus.get(st) ?? []);
            return (
              <div key={col.key} className="glass rounded-[var(--r-xl)] p-4">
                <div className="relative z-10">
                  <div className="flex items-center gap-2">
                    <h2 className="text-[14px] font-extrabold">{col.label}</h2>
                    <span className="tnum rounded-full bg-[rgb(18_21_15_/_0.08)] px-1.5 py-0.5 text-[10.5px] font-extrabold">
                      {rows.length}
                    </span>
                  </div>
                  <div className="mt-3 space-y-2.5">
                    {rows.length === 0 ? (
                      <p className="t-small py-6 text-center text-muted">Nothing here.</p>
                    ) : (
                      rows.map(renderLead)
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {closed.length > 0 && (
        <details className="glass rounded-[var(--r-lg)] p-4">
          <summary className="press cursor-pointer text-[13px] font-bold text-muted">
            Closed — converted, lost or disqualified ({closed.length})
          </summary>
          <div className="relative z-10 mt-3 space-y-2.5">
            {closed.map(renderLead)}
          </div>
        </details>
      )}

      {sheetOpen && <NewLeadSheet assignees={assignees} onClose={() => setSheetOpen(false)} />}
    </>
  );
}
