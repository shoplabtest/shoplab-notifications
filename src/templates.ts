import { formatMoney } from './money.ts';

export type Kind = 'welcome' | 'order_confirmation' | 'payment_failed' | 'low_stock' | 'price_drop';

export interface Rendered { subject: string; body: string }

type Data = Record<string, string | number | undefined>;

const first = (name: string) => name.split(' ')[0] || name;

const TEMPLATES: Record<Kind, (d: Data) => Rendered> = {
  welcome: (d) => ({
    subject: 'Welcome to ShopLab',
    body: `Hi ${first(String(d.name))},\n\nYour account is ready. Happy shopping!`,
  }),
  order_confirmation: (d) => ({
    subject: `Your order ${String(d.orderId).slice(0, 8)} is confirmed`,
    body: `Thanks for your order.\n\nTotal: ${formatMoney(Number(d.total), String(d.currency))} for ${d.items} item${d.items === 1 ? '' : 's'}.`,
  }),
  payment_failed: (d) => ({
    subject: `Payment for order ${String(d.orderId).slice(0, 8)} did not go through`,
    body: `We could not take your payment${d.reason ? ` (${d.reason})` : ''}.\n\nYour order is still open: try again or use another method.`,
  }),
  low_stock: (d) => ({
    subject: `Low stock: ${d.productId}`,
    body: `${d.productId} is down to ${d.available} (threshold ${d.threshold}).`,
  }),
  price_drop: (d) => ({
    subject: 'Good news: a price you paid just dropped',
    body: `${d.productId} now costs ${formatMoney(Number(d.price), String(d.currency))}; you paid ${formatMoney(Number(d.paid), String(d.currency))}. Contact support within the price protection window for the difference.`,
  }),
};

export const render = (kind: Kind, data: Data): Rendered => TEMPLATES[kind](data);
