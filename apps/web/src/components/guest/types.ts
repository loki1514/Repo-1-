import type { GuestMenuItem, GuestVariant } from "@/lib/guest";

/**
 * A cart line is keyed by item *and* variant: a half biryani and a full one
 * are two lines, not one line with a confused price.
 */
export type CartLine = {
  key: string;
  item: GuestMenuItem;
  variant: GuestVariant | null;
  qty: number;
};

export const lineKey = (itemId: string, variantId?: string | null) =>
  variantId ? `${itemId}:${variantId}` : itemId;

export const linePrice = (l: CartLine) => l.variant?.price ?? l.item.price;

/** The lowest price a dish can be ordered at — what "starts at" means. */
export function fromPrice(item: GuestMenuItem): number {
  if (item.variants.length === 0) return item.price;
  return Math.min(...item.variants.map((v) => v.price));
}
