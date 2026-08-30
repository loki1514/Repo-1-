import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Order at your table",
  // A guest's phone is held in one hand next to a plate of food. Zoom stays
  // available (never disable it), but the viewport must not shift under a
  // keyboard, and the coloured header should reach into the notch.
  other: { "apple-mobile-web-app-capable": "yes" },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
};

/**
 * The guest app deliberately renders none of the product chrome — no aurora,
 * no sidebar, no Vini branding above the restaurant's own. To the person at
 * the table this is the restaurant's app, not a SaaS tenant screen.
 */
export default function GuestLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-[var(--canvas)]">{children}</div>;
}
