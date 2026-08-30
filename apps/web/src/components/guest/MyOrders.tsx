"use client";

import { useState } from "react";
import { CheckCircle2, ChefHat, CircleDashed, Clock, TriangleAlert } from "lucide-react";
import type { GuestOrder, GuestOrderItem } from "@/lib/guest";
import { inr } from "@/lib/bill";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/cn";

/**
 * What the table has ordered, and where each dish has got to.
 *
 * Status lives per dish rather than per order because that is the question
 * actually being asked at the table: not "is my order ready" but "where is the
 * biryani". Three starters delivered and one main still in the pan is the
 * normal case, and an order-level badge cannot say that.
 */

const LINE_STATE: Record<
  GuestOrderItem["status"],
  { label: string; icon: typeof Clock; tone: string }
> = {
  pending: { label: "Placed", icon: CircleDashed, tone: "var(--muted)" },
  preparing: { label: "Cooking", icon: ChefHat, tone: "var(--warn)" },
  ready: { label: "On its way", icon: Clock, tone: "var(--info)" },
  delivered: { label: "Served", icon: CheckCircle2, tone: "var(--ok)" },
  cancelled: { label: "Cancelled", icon: TriangleAlert, tone: "var(--danger)" },
};

export function MyOrders({ orders }: { orders: GuestOrder[] }) {
  const [tab, setTab] = useState<"pending" | "completed">("pending");

  const withPending = orders.filter((o) =>
    o.items.some((i) => i.status !== "delivered" && i.status !== "cancelled"),
  );
  const completed = orders.filter(
    (o) =>
      o.items.length > 0 &&
      o.items.every((i) => i.status === "delivered" || i.status === "cancelled"),
  );
  const list = tab === "pending" ? withPending : completed;

  return (
    <div className="pb-4">
      <div className="sticky top-[var(--guest-header-h,64px)] z-20 -mx-4 grid grid-cols-2 border-b border-[var(--line)] bg-[var(--canvas)]/95 px-4 backdrop-blur-md">
        {(
          [
            ["pending", "Pending", withPending.length],
            ["completed", "Completed", completed.length],
          ] as const
        ).map(([id, label, count]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              haptic("light");
              setTab(id);
            }}
            aria-pressed={tab === id}
            className={cn(
              "press relative py-3 text-[14px] font-bold transition-colors",
              tab === id ? "text-ink" : "text-muted",
            )}
          >
            {label}
            {count > 0 && <span className="tnum ml-1.5 text-[12px]">({count})</span>}
            {tab === id && (
              <span
                aria-hidden
                className="absolute inset-x-4 bottom-0 h-[3px] rounded-t-full"
                style={{ background: "var(--lime-deep)" }}
              />
            )}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <div className="flex flex-col items-center px-6 py-24 text-center">
          <TriangleAlert size={30} className="text-[var(--lime-deep)]" strokeWidth={1.8} />
          <p className="mt-4 text-[15px] font-bold">
            {tab === "pending" ? "Nothing cooking right now" : "Nothing served yet"}
          </p>
          <p className="mt-1 text-[13px] text-muted">
            {tab === "pending"
              ? "Head to the menu and place your first order."
              : "Dishes move here once they reach your table."}
          </p>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {list.map((order, i) => (
            <article key={order.id} className="dim overflow-hidden rounded-[var(--r-lg)]">
              <header className="flex items-center gap-2 px-4 py-3">
                <h2 className="text-[15px] font-extrabold">
                  Order #{String(i + 1).padStart(2, "0")}
                </h2>
                <span className="tnum text-[12px] text-muted">{order.display_no}</span>
                <span className="ml-auto text-[12px] font-semibold text-muted">
                  {new Date(order.created_at).toLocaleTimeString("en-IN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </header>

              <ul className="border-t border-[var(--line)]">
                {order.items.map((it) => {
                  const s = LINE_STATE[it.status];
                  const Icon = s.icon;
                  return (
                    <li
                      key={it.id}
                      className="flex items-center gap-3 border-t border-[var(--line)] px-4 py-3 first:border-t-0"
                    >
                      <Icon size={18} strokeWidth={2.3} style={{ color: s.tone }} className="shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14.5px] font-bold leading-tight">
                          {it.name}
                          {it.variant_name && (
                            <span className="ml-1 text-[12px] font-bold uppercase text-muted">
                              ({it.variant_name})
                            </span>
                          )}
                        </p>
                        <p className="text-[11.5px] font-bold uppercase tracking-wide" style={{ color: s.tone }}>
                          {s.label}
                        </p>
                      </div>
                      <span className="tnum shrink-0 text-[13px] font-bold text-muted">{it.qty}</span>
                      <span className="tnum shrink-0 text-[14px] font-extrabold">
                        {inr(it.qty * it.unit_price)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
