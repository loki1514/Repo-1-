"use client";

import { useState, useTransition } from "react";
import { UtensilsCrossed, Users, ArrowRight } from "lucide-react";
import { startSessionAction } from "@/app/t/[token]/actions";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/cn";

/**
 * The first screen after a scan on an empty table.
 *
 * It asks exactly one question — how many are eating — because that number is
 * the only thing the restaurant cannot infer later, and asking it here saves
 * the captain a walk. Everything else waits until there is food to talk about.
 */
export function WelcomeGate({
  token,
  orgName,
  tableLabel,
  areaName,
}: {
  token: string;
  orgName: string;
  tableLabel: string;
  areaName: string | null;
}) {
  const [guests, setGuests] = useState(2);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-40 h-[420px] opacity-90"
        style={{
          background:
            "radial-gradient(60% 60% at 50% 40%, var(--lime) 0%, transparent 70%)",
          filter: "blur(60px)",
        }}
      />

      <div className="relative z-10 flex flex-1 flex-col justify-center px-6 py-10">
        <span
          className="raise-accent mx-auto flex h-16 w-16 items-center justify-center rounded-[20px]"
          style={{
            background: "linear-gradient(180deg, var(--lime-bright), var(--lime-deep))",
          }}
        >
          <UtensilsCrossed size={26} style={{ color: "var(--lime-ink)" }} strokeWidth={2.2} />
        </span>

        <h1 className="t-h1 mt-6 text-center">{orgName}</h1>
        <p className="mt-2 text-center text-[15px] font-semibold text-muted">
          {areaName ? `${areaName} · ` : ""}Table {tableLabel}
        </p>

        <div className="dim mx-auto mt-9 w-full max-w-sm rounded-[var(--r-xl)] p-5">
          <div className="flex items-center gap-2 text-muted">
            <Users size={15} strokeWidth={2.4} />
            <span className="t-label">How many are eating?</span>
          </div>

          <div className="mt-3 grid grid-cols-6 gap-2">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => {
                  haptic("light");
                  setGuests(n);
                }}
                aria-pressed={guests === n}
                className={cn(
                  "press tnum h-11 rounded-[12px] text-[15px] font-extrabold transition-colors",
                  guests === n
                    ? "raise-accent"
                    : "border border-[var(--line-strong)] text-ink-2",
                )}
                style={
                  guests === n
                    ? { background: "var(--lime)", color: "var(--lime-ink)" }
                    : undefined
                }
              >
                {n}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={pending}
            onClick={() => {
              haptic("medium");
              setError(null);
              start(async () => {
                const res = await startSessionAction(token, guests);
                if (!res.ok) setError(res.error);
              });
            }}
            className="press raise-accent mt-5 flex h-[54px] w-full items-center justify-center gap-2 rounded-[16px] text-[16px] font-extrabold disabled:opacity-60"
            style={{
              background: "linear-gradient(180deg, var(--lime-bright), var(--lime-deep))",
              color: "var(--lime-ink)",
            }}
          >
            {pending ? "Opening your table…" : "Start ordering"}
            {!pending && <ArrowRight size={18} strokeWidth={2.8} />}
          </button>

          {error && (
            <p className="mt-3 text-center text-[13px] font-bold text-[var(--danger)]">
              {error}
            </p>
          )}
        </div>

        <p className="mx-auto mt-6 max-w-xs text-center text-[12.5px] leading-relaxed text-muted">
          No app, no sign-up. Order from your phone and pay when you&rsquo;re done.
        </p>
      </div>
    </main>
  );
}
