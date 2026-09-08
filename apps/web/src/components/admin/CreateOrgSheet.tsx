"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  ArrowRight,
  Building2,
  Check,
  Copy,
  Handshake,
  KeyRound,
  LoaderCircle,
  Plus,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import { createOrganizationAction, type CreateOrgState } from "@/app/admin/organizations/actions";
import { Button } from "@/components/ui/Button";
import { slugify } from "@/lib/slug";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/cn";

const FIELD =
  "glass-inset h-11 w-full rounded-[13px] px-3.5 text-[14.5px] font-medium " +
  "outline-none transition-shadow placeholder:text-muted/70 " +
  "focus:shadow-[inset_0_0_0_2px_var(--lime-deep)]";

const LABEL = "t-label mb-1.5 block text-muted";

const INITIAL_STATE: CreateOrgState = { ok: false, error: null, created: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="lime"
      size="md"
      disabled={pending}
      feedback="medium"
      className="w-full sm:w-auto"
    >
      {pending ? (
        <>
          <LoaderCircle size={16} className="animate-spin" />
          Creating…
        </>
      ) : (
        <>
          <Plus size={15} strokeWidth={3} />
          Create organization
        </>
      )}
    </Button>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(value);
    haptic("light");
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div>
      <span className={LABEL}>{label}</span>
      <button
        type="button"
        onClick={copy}
        className="press glass-inset flex w-full items-center justify-between gap-3 rounded-[13px] px-3.5 py-3 text-left"
      >
        <span className="tnum truncate text-[14.5px] font-bold">{value}</span>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 text-[12px] font-bold",
            copied ? "text-[var(--ok)]" : "text-muted",
          )}
        >
          {copied ? (
            <>
              <Check size={13} strokeWidth={3} /> Copied
            </>
          ) : (
            <>
              <Copy size={13} /> Copy
            </>
          )}
        </span>
      </button>
    </div>
  );
}

function CreatedPanel({
  created,
  onDone,
}: {
  created: NonNullable<CreateOrgState["created"]>;
  onDone: () => void;
}) {
  return (
    <div className="relative z-10">
      <div className="flex items-center gap-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px]"
          style={{ background: "rgb(79 191 106 / 0.16)" }}
        >
          <KeyRound size={17} className="text-[var(--ok)]" />
        </span>
        <div>
          <h2 className="t-h3">{created.orgName} is live</h2>
          <p className="t-small text-muted">Send these to the client now.</p>
        </div>
      </div>

      <div
        className="mt-5 flex items-start gap-2.5 rounded-[13px] px-3.5 py-3 text-[13px] font-medium"
        style={{
          background: "rgb(242 169 59 / 0.12)",
          color: "var(--warn)",
          border: "1px solid rgb(242 169 59 / 0.28)",
        }}
      >
        <TriangleAlert size={15} className="mt-0.5 shrink-0" />
        This password is shown once and cannot be retrieved again. Copy it
        before closing this panel.
      </div>

      <div className="mt-5 space-y-3">
        <CopyField label="Admin email" value={created.adminEmail} />
        <CopyField label="Admin password" value={created.adminPassword} />
      </div>

      {created.cascade.length > 0 && (
        <div
          className="mt-5 rounded-[13px] px-4 py-3"
          style={{
            background: "rgb(180 238 42 / 0.12)",
            border: "1px solid rgb(180 238 42 / 0.3)",
          }}
        >
          <p className="flex items-center gap-1.5 text-[11.5px] font-extrabold uppercase tracking-wide text-[var(--lime-deep)]">
            <Sparkles size={12} /> And the OS did this on its own
          </p>
          <ul className="mt-2 space-y-1">
            {created.cascade.map((c, i) => (
              <li key={i} className="flex gap-2 text-[13px] text-ink-2">
                <ArrowRight size={13} className="mt-1 shrink-0 text-[var(--lime-deep)]" />
                {c}
              </li>
            ))}
          </ul>
          {created.organizationId && (
            <a
              href={`/admin/organizations/${created.organizationId}`}
              className="press mt-3 inline-flex items-center gap-1.5 text-[13px] font-bold text-[var(--lime-deep)]"
            >
              Open the onboarding chain <ArrowRight size={13} />
            </a>
          )}
        </div>
      )}

      <div className="mt-6 flex justify-end">
        <Button variant="lime" size="md" feedback="medium" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

export function CreateOrgSheet({
  initialName,
  sourceLeadId,
  autoOpen,
}: {
  /** Prefilled when arriving from a won deal — docs/os claude .txt:479. */
  initialName?: string;
  sourceLeadId?: string;
  autoOpen?: boolean;
} = {}) {
  const [open, setOpen] = useState(autoOpen ?? false);
  const [name, setName] = useState(initialName ?? "");
  const [type, setType] = useState<"franchise" | "investor" | "">("");
  const [state, formAction] = useActionState(createOrganizationAction, INITIAL_STATE);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) haptic("success");
    else if (state.error) haptic("warn");
  }, [state]);

  function reset() {
    formRef.current?.reset();
    setName("");
    setType("");
    setOpen(false);
  }

  return (
    <>
      <Button
        variant="lime"
        size="md"
        feedback="medium"
        onClick={() => setOpen(true)}
        className="w-full sm:w-auto"
      >
        <Plus size={15} strokeWidth={3} />
        Create organization
      </Button>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-5">
          <button
            aria-label="Close"
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => (state.ok ? reset() : setOpen(false))}
          />

          <div className="glass rise relative z-10 w-full max-w-[480px] rounded-t-[var(--r-2xl)] p-6 sm:rounded-[var(--r-2xl)] sm:p-7">
            {state.ok && state.created ? (
              <CreatedPanel created={state.created} onDone={reset} />
            ) : (
              <div className="relative z-10">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px]"
                      style={{ background: "#14170f" }}
                    >
                      <Building2 size={17} className="text-[var(--lime)]" />
                    </span>
                    <div>
                      <h2 className="t-h3">Create organization</h2>
                      <p className="t-small text-muted">
                        Everything else grows from here.
                      </p>
                    </div>
                  </div>
                  <button
                    aria-label="Close"
                    onClick={() => setOpen(false)}
                    className="press inline-flex h-9 w-9 items-center justify-center rounded-[11px] text-muted hover:bg-[rgb(18_21_15_/_0.06)] hover:text-ink"
                  >
                    <X size={16} />
                  </button>
                </div>

                <form ref={formRef} action={formAction} className="mt-6 space-y-4">
                  {sourceLeadId && (
                    <>
                      <input type="hidden" name="sourceLeadId" value={sourceLeadId} />
                      <div
                        className="flex items-center gap-2.5 rounded-[13px] px-3.5 py-3 text-[13px] font-medium"
                        style={{
                          background: "rgb(180 238 42 / 0.12)",
                          color: "var(--lime-deep)",
                          border: "1px solid rgb(180 238 42 / 0.28)",
                        }}
                      >
                        <Handshake size={15} className="shrink-0" />
                        Built from a won deal — the Growth queue will show this
                        organization once it&rsquo;s created.
                      </div>
                    </>
                  )}
                  <div>
                    <label htmlFor="name" className={LABEL}>
                      Organization name
                    </label>
                    <input
                      id="name"
                      name="name"
                      required
                      autoFocus
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Spice Route Hospitality"
                      className={FIELD}
                    />
                    {name.trim() && (
                      <p className="mt-1.5 t-small text-muted">
                        URL:{" "}
                        <span className="tnum font-semibold text-ink-2">
                          vinipos.com/{slugify(name) || "…"}
                        </span>
                      </p>
                    )}
                  </div>

                  <div>
                    <span className={LABEL}>Organization type</span>
                    <input type="hidden" name="type" value={type} />
                    <div className="grid grid-cols-2 gap-2.5">
                      {(["franchise", "investor"] as const).map((t) => (
                        <button
                          key={t}
                          type="button"
                          onPointerDown={() => haptic("light")}
                          onClick={() => setType(t)}
                          className={cn(
                            "press rounded-[13px] px-4 py-3 text-left text-[14px] font-bold capitalize transition-colors",
                            type === t
                              ? "btn-lime"
                              : "glass-inset text-ink-2 hover:text-ink",
                          )}
                        >
                          <span className="relative z-10">{t}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-[16px] border border-[var(--line)] p-3.5">
                    <div className="mb-3 flex items-center gap-2">
                      <KeyRound size={13} className="text-[var(--lime-deep)]" />
                      <span className="t-label text-ink-2">
                        Organization admin login
                      </span>
                    </div>
                    <label htmlFor="adminEmail" className={LABEL}>
                      Admin email
                    </label>
                    <input
                      id="adminEmail"
                      name="adminEmail"
                      type="email"
                      required
                      placeholder="owner@theirrestaurant.com"
                      className={FIELD}
                    />
                    <p className="mt-2 t-small text-muted">
                      A login is created automatically. The password is
                      generated and shown once — you send it to the client.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="contactEmail" className={LABEL}>
                        Contact email
                      </label>
                      <input
                        id="contactEmail"
                        name="contactEmail"
                        type="email"
                        placeholder="admin@org.com"
                        className={FIELD}
                      />
                    </div>
                    <div>
                      <label htmlFor="contactPhone" className={LABEL}>
                        Contact phone
                      </label>
                      <input
                        id="contactPhone"
                        name="contactPhone"
                        type="tel"
                        placeholder="+91 98765 43210"
                        className={FIELD}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="legalName" className={LABEL}>
                        Legal name
                      </label>
                      <input
                        id="legalName"
                        name="legalName"
                        placeholder="Optional"
                        className={FIELD}
                      />
                    </div>
                    <div>
                      <label htmlFor="gstin" className={LABEL}>
                        GSTIN
                      </label>
                      <input
                        id="gstin"
                        name="gstin"
                        placeholder="Optional"
                        className={cn(FIELD, "uppercase")}
                      />
                    </div>
                  </div>

                  {state.error && (
                    <div
                      role="alert"
                      className="flex items-start gap-2.5 rounded-[13px] px-3.5 py-3 text-[13.5px] font-medium"
                      style={{
                        background: "rgb(226 86 75 / 0.1)",
                        color: "var(--danger)",
                        border: "1px solid rgb(226 86 75 / 0.24)",
                      }}
                    >
                      <TriangleAlert size={15} className="mt-0.5 shrink-0" />
                      {state.error}
                    </div>
                  )}

                  <div className="flex flex-col-reverse gap-2.5 pt-1 sm:flex-row sm:justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="md"
                      onClick={() => setOpen(false)}
                    >
                      Cancel
                    </Button>
                    <SubmitButton />
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
