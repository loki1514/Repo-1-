"use client";

import { Split } from "lucide-react";
import { inrShort } from "@/lib/bill";
import type { LiveSnapshot } from "@/lib/ops";

type Slice = LiveSnapshot["byChannel"][number];

/**
 * Channel → accent, keyed by the channel *name*.
 *
 * The obvious implementation is `PALETTE[index]`, and it is wrong here:
 * liveSnapshot sorts channels by volume, so the moment Zomato overtakes
 * Swiggy every colour on the bar shifts one seat left. An owner who learned
 * "amber is Swiggy" at 7pm would be reading a different chart at 9pm, on a
 * screen whose whole job is glanceability. Pinning colour to the name costs a
 * lookup table and buys a legend that is true on every refresh, in every org,
 * on every day.
 *
 * Two schemas name channels: orders.channel (0006) and channel_integrations
 * (0010). Both sets are covered, and `online`/`website` deliberately share a
 * colour because they are the same surface under two names.
 */
const CHANNEL_TOKEN: Record<string, string> = {
  dine_in: "var(--lime)",
  qr: "var(--lime-deep)",
  website: "var(--info)",
  online: "var(--info)",
  ondc: "var(--ok)",
  swiggy: "var(--warn)",
  zomato: "var(--danger)",
  delivery: "var(--lime-bright)",
  pickup: "var(--ink-2)",
  whatsapp: "var(--muted)",
  other: "var(--muted)",
};

const CHANNEL_LABEL: Record<string, string> = {
  dine_in: "Dine In",
  qr: "QR / Table",
  website: "Website",
  online: "Online",
  ondc: "ONDC",
  swiggy: "Swiggy",
  zomato: "Zomato",
  delivery: "Delivery",
  pickup: "Pick Up",
  whatsapp: "WhatsApp",
  other: "Other",
};

/** Same five state tokens, reached by name hash so an unknown channel is stable too. */
const FALLBACK = [
  "var(--info)",
  "var(--warn)",
  "var(--ok)",
  "var(--danger)",
  "var(--lime-deep)",
];

function channelColor(channel: string): string {
  const fixed = CHANNEL_TOKEN[channel];
  if (fixed) return fixed;

  let hash = 0;
  for (let i = 0; i < channel.length; i += 1) {
    hash = (hash * 31 + channel.charCodeAt(i)) >>> 0;
  }
  return FALLBACK[hash % FALLBACK.length];
}

function channelLabel(channel: string): string {
  return (
    CHANNEL_LABEL[channel] ??
    channel.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

export function ChannelSplit({ slices }: { slices: Slice[] }) {
  const totalOrders = slices.reduce((sum, s) => sum + s.orders, 0);

  return (
    <section className="dim rounded-[var(--r-xl)] p-4 sm:p-5" aria-labelledby="channel-split-h">
      <div className="flex items-center gap-2.5">
        <Split size={16} strokeWidth={2.4} className="text-[var(--lime-deep)]" />
        <h2 id="channel-split-h" className="t-h3">
          Where it came from
        </h2>
        <span className="tnum ml-auto text-[13px] font-extrabold text-muted">
          {totalOrders} order{totalOrders === 1 ? "" : "s"}
        </span>
      </div>

      {totalOrders === 0 ? (
        <p className="t-small mt-4 rounded-[var(--r-md)] border border-dashed border-[var(--line-strong)] px-4 py-6 text-center text-muted">
          No orders on any channel yet today.
        </p>
      ) : (
        <>
          {/* The bar restates the table below it, so it is hidden from screen
              readers rather than read out as a row of empty divs. */}
          <div
            aria-hidden="true"
            className="glass-inset mt-4 flex h-3.5 w-full gap-[2px] overflow-hidden rounded-full"
          >
            {slices.map((s) => (
              <div
                key={s.channel}
                // flex-basis 0 makes grow the whole story; the floor keeps a
                // one-order channel from collapsing into an invisible sliver,
                // which matters more here than perfect proportionality.
                style={{
                  flexGrow: s.orders,
                  flexBasis: 0,
                  minWidth: "10px",
                  background: channelColor(s.channel),
                }}
              />
            ))}
          </div>

          <table className="mt-4 w-full">
            <caption className="sr-only">
              Orders placed and sales settled today, by channel
            </caption>
            <thead>
              <tr className="t-label text-muted">
                <th scope="col" className="pb-2 text-left font-bold">
                  Channel
                </th>
                <th scope="col" className="pb-2 text-right font-bold">
                  Orders
                </th>
                <th scope="col" className="pb-2 text-right font-bold">
                  Sales
                </th>
              </tr>
            </thead>
            <tbody>
              {slices.map((s) => (
                <tr key={s.channel} className="border-t border-[var(--line)]">
                  <th scope="row" className="py-2 text-left">
                    <span className="flex items-center gap-2 text-[13.5px] font-bold">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: channelColor(s.channel) }}
                      />
                      {channelLabel(s.channel)}
                    </span>
                  </th>
                  <td className="tnum py-2 text-right text-[13.5px] font-extrabold">
                    {s.orders}
                  </td>
                  <td className="tnum py-2 text-right text-[13.5px] font-extrabold">
                    {inrShort(s.sales)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="t-small mt-3 text-muted">
            Sales count settled bills only — an open table shows an order but no money.
          </p>
        </>
      )}
    </section>
  );
}
