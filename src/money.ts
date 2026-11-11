export const formatMoney = (minor: number, currency: string) => `${currency} ${(minor / 100).toFixed(2)}`;

/** Reads a price sent as text: whole minor units only. Anything else is not a price we understand. */
export function toMinorUnits(price: string): number | null {
  if (!/^\d{1,9}$/.test(price)) return null;
  return Number.parseInt(price, 10);
}
