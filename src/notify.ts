import type { Config } from './config.ts';
import type { Channel, OrderPlaced, PaymentFailed, ProductUpdated, StockLow, UserRegistered } from './events.ts';
import { toMinorUnits } from './money.ts';
import type { Sender } from './senders.ts';
import type { Store } from './store.ts';
import { render, type Kind } from './templates.ts';

export interface Deps {
  store: Store;
  sender: Sender;
  cfg: Pick<Config, 'opsEmail' | 'priceProtectionDays' | 'priceDropMinPercent'>;
  now?: () => Date;
}

/** Thrown for events that can never succeed as sent, so the consumer rejects them instead of retrying. */
export class InvalidEvent extends Error {}

const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const CHANNELS: Channel[] = ['email', 'push'];

type Data = Record<string, string | number | undefined>;

/**
 * Sends one notification to every channel the user has switched on. Each (dedupeKey, channel) is recorded
 * before sending and only the first claim sends, so a redelivered event never notifies twice. A provider
 * failure is recorded on the row and does not stop the other channels or fail the event.
 */
async function toUser({ store, sender }: Deps, userId: string, kind: Kind, dedupeKey: string, data: Data) {
  const contact = await store.getContact(userId);
  const { subject, body } = render(kind, data);
  for (const channel of CHANNELS) {
    if (!(await store.isEnabled(userId, channel))) continue;
    const recipient = channel === 'email' ? contact?.email : userId;
    const base = { userId, kind, channel, dedupeKey, subject, body };
    if (!recipient) {
      await store.claim({ ...base, recipient: '', status: 'skipped', error: 'no_contact' });
      continue;
    }
    const id = await store.claim({ ...base, recipient, status: 'pending' });
    if (id === null) continue;
    try {
      await sender.send(channel, recipient, subject, body);
      await store.markSent(id);
    } catch (e) {
      await store.markFailed(id, (e as Error).message);
    }
  }
}

async function toOps({ store, sender, cfg }: Deps, kind: Kind, dedupeKey: string, data: Data) {
  const { subject, body } = render(kind, data);
  const id = await store.claim({ userId: null, kind, channel: 'email', recipient: cfg.opsEmail, dedupeKey, subject, body, status: 'pending' });
  if (id === null) return;
  try {
    await sender.send('email', cfg.opsEmail, subject, body);
    await store.markSent(id);
  } catch (e) {
    await store.markFailed(id, (e as Error).message);
  }
}

export async function handleUserRegistered(deps: Deps, ev: UserRegistered) {
  if (!isUuid(ev?.userId) || typeof ev.email !== 'string' || !ev.email.includes('@') || typeof ev.fullName !== 'string') throw new InvalidEvent('malformed user.registered');
  await deps.store.upsertContact(ev.userId, ev.email, ev.fullName);
  await toUser(deps, ev.userId, 'welcome', `welcome:${ev.userId}`, { name: ev.fullName });
}

export async function handleOrderPlaced(deps: Deps, ev: OrderPlaced) {
  if (!isUuid(ev?.orderId) || !isUuid(ev.userId) || !Number.isInteger(ev.total) || typeof ev.currency !== 'string' || !Array.isArray(ev.lines)) throw new InvalidEvent('malformed order.placed');
  await deps.store.recordPurchases(
    ev.orderId,
    ev.userId,
    ev.lines.map((l) => ({ productId: String(l.productId), unitPrice: Number.isInteger(l.unitPrice) ? (l.unitPrice as number) : null })),
    new Date(ev.placedAt),
  );
  const items = ev.lines.reduce((n, l) => n + Number(l.quantity), 0);
  await toUser(deps, ev.userId, 'order_confirmation', `order_confirmation:${ev.orderId}`, { orderId: ev.orderId, total: ev.total, currency: ev.currency, items });
}

/** payment.failed carries only the order id, so the user is found through the purchases recorded from order.placed. */
export async function handlePaymentFailed(deps: Deps, ev: PaymentFailed) {
  if (!isUuid(ev?.paymentId) || !isUuid(ev.orderId)) throw new InvalidEvent('malformed payment.failed');
  const userId = await deps.store.userForOrder(ev.orderId);
  if (!userId) {
    // Nobody to tell. Keep a trace so the gap is visible instead of the event vanishing.
    const { subject, body } = render('payment_failed', { orderId: ev.orderId, reason: ev.reason });
    await deps.store.claim({ userId: null, kind: 'payment_failed', channel: 'email', recipient: '', dedupeKey: `payment_failed:${ev.paymentId}`, subject, body, status: 'skipped', error: 'unknown_order' });
    return;
  }
  await toUser(deps, userId, 'payment_failed', `payment_failed:${ev.paymentId}`, { orderId: ev.orderId, reason: ev.reason });
}

export async function handleStockLow(deps: Deps, ev: StockLow) {
  if (typeof ev?.productId !== 'string' || !Number.isInteger(ev.available) || !Number.isInteger(ev.threshold) || typeof ev.at !== 'string') throw new InvalidEvent('malformed stock.low');
  await toOps(deps, 'low_stock', `low_stock:${ev.productId}:${ev.at.slice(0, 10)}`, { productId: ev.productId, available: ev.available, threshold: ev.threshold });
}

/**
 * Price protection: tells customers who bought `productId` recently that it is now cheaper.
 * Events whose price is not a whole number of minor units are ignored.
 */
export async function handleProductUpdated(deps: Deps, ev: ProductUpdated) {
  if (typeof ev?.productId !== 'string') throw new InvalidEvent('malformed product.updated');
  const price = toMinorUnits(ev.price);
  if (price === null) return;
  const now = (deps.now ?? (() => new Date()))();
  const since = new Date(now.getTime() - deps.cfg.priceProtectionDays * 86_400_000);
  for (const t of await deps.store.priceDropTargets(ev.productId, price, since, deps.cfg.priceDropMinPercent)) {
    await toUser(deps, t.user_id, 'price_drop', `price_drop:${t.user_id}:${ev.productId}:${price}`, { productId: ev.productId, price, paid: t.paid, currency: ev.currency });
  }
}
