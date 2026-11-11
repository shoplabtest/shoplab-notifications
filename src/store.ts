import type { Pool } from 'pg';
import type { Channel } from './events.ts';

export interface Contact { user_id: string; email: string; full_name: string }
export interface PurchaseLine { productId: string; unitPrice: number | null }
export interface PriceDropTarget { user_id: string; order_id: string; paid: number }

export interface NewNotification {
  userId: string | null;
  kind: string;
  channel: Channel;
  recipient: string;
  dedupeKey: string;
  subject: string;
  body: string;
  /** `skipped` records that nothing could be sent, so the same fact is not retried on every redelivery. */
  status: 'pending' | 'skipped';
  error?: string;
}

export interface NotificationRow extends Omit<NewNotification, 'status'> {
  id: number;
  status: 'pending' | 'sent' | 'failed' | 'skipped';
  sentAt: Date | null;
}

export interface Store {
  upsertContact(userId: string, email: string, fullName: string): Promise<void>;
  getContact(userId: string): Promise<Contact | null>;
  isEnabled(userId: string, channel: Channel): Promise<boolean>;
  setPreference(userId: string, channel: Channel, enabled: boolean): Promise<void>;
  recordPurchases(orderId: string, userId: string, lines: PurchaseLine[], placedAt: Date): Promise<void>;
  userForOrder(orderId: string): Promise<string | null>;
  /** Users who bought `productId` since `since` for more than `newPrice`, by at least `minPercent` of what they paid. */
  priceDropTargets(productId: string, newPrice: number, since: Date, minPercent: number): Promise<PriceDropTarget[]>;
  /** Returns the new row id, or null when this (dedupeKey, channel) was already recorded. */
  claim(n: NewNotification): Promise<number | null>;
  markSent(id: number): Promise<void>;
  markFailed(id: number, error: string): Promise<void>;
  list(): Promise<NotificationRow[]>;
}

const DEFAULTS: Record<Channel, boolean> = { email: true, push: false };

export class PgStore implements Store {
  constructor(private pool: Pool) {}

  async upsertContact(userId: string, email: string, fullName: string) {
    await this.pool.query(
      `INSERT INTO contacts (user_id, email, full_name) VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, full_name = EXCLUDED.full_name`,
      [userId, email, fullName],
    );
  }
  async getContact(userId: string) {
    return (await this.pool.query<Contact>('SELECT user_id, email, full_name FROM contacts WHERE user_id = $1', [userId])).rows[0] ?? null;
  }
  async isEnabled(userId: string, channel: Channel) {
    const r = await this.pool.query<{ enabled: boolean }>('SELECT enabled FROM channel_preferences WHERE user_id = $1 AND channel = $2', [userId, channel]);
    return r.rows[0]?.enabled ?? DEFAULTS[channel];
  }
  async setPreference(userId: string, channel: Channel, enabled: boolean) {
    await this.pool.query(
      `INSERT INTO channel_preferences (user_id, channel, enabled) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, channel) DO UPDATE SET enabled = EXCLUDED.enabled`,
      [userId, channel, enabled],
    );
  }
  async recordPurchases(orderId: string, userId: string, lines: PurchaseLine[], placedAt: Date) {
    for (const l of lines) {
      await this.pool.query(
        'INSERT INTO purchases (order_id, user_id, product_id, unit_price, placed_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
        [orderId, userId, l.productId, l.unitPrice, placedAt],
      );
    }
  }
  async userForOrder(orderId: string) {
    return (await this.pool.query<{ user_id: string }>('SELECT user_id FROM purchases WHERE order_id = $1 LIMIT 1', [orderId])).rows[0]?.user_id ?? null;
  }
  async priceDropTargets(productId: string, newPrice: number, since: Date, minPercent: number) {
    const r = await this.pool.query<PriceDropTarget>(
      `SELECT DISTINCT ON (user_id) user_id, order_id, unit_price AS paid
       FROM purchases
       WHERE product_id = $1 AND placed_at >= $2 AND unit_price > $3 AND (unit_price - $3) * 100 >= unit_price * $4
       ORDER BY user_id, unit_price DESC`,
      [productId, since, newPrice, minPercent],
    );
    return r.rows;
  }
  async claim(n: NewNotification) {
    const r = await this.pool.query<{ id: string }>(
      `INSERT INTO notifications (user_id, kind, channel, recipient, dedupe_key, subject, body, status, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (dedupe_key, channel) DO NOTHING RETURNING id`,
      [n.userId, n.kind, n.channel, n.recipient, n.dedupeKey, n.subject, n.body, n.status, n.error ?? null],
    );
    return r.rows[0] ? Number(r.rows[0].id) : null;
  }
  async markSent(id: number) {
    await this.pool.query("UPDATE notifications SET status = 'sent', sent_at = now() WHERE id = $1", [id]);
  }
  async markFailed(id: number, error: string) {
    await this.pool.query("UPDATE notifications SET status = 'failed', error = $2 WHERE id = $1", [id, error]);
  }
  async list() {
    const r = await this.pool.query('SELECT * FROM notifications ORDER BY id');
    return r.rows.map((x) => ({
      id: Number(x.id), userId: x.user_id, kind: x.kind, channel: x.channel, recipient: x.recipient, dedupeKey: x.dedupe_key,
      subject: x.subject, body: x.body, status: x.status, error: x.error ?? undefined, sentAt: x.sent_at,
    })) as NotificationRow[];
  }
}

/** In-memory store for unit tests. */
export class MemoryStore implements Store {
  contacts = new Map<string, Contact>();
  prefs = new Map<string, boolean>();
  purchases: { order_id: string; user_id: string; product_id: string; unit_price: number | null; placed_at: Date }[] = [];
  rows: NotificationRow[] = [];

  async upsertContact(userId: string, email: string, fullName: string) {
    this.contacts.set(userId, { user_id: userId, email, full_name: fullName });
  }
  async getContact(userId: string) {
    return this.contacts.get(userId) ?? null;
  }
  async isEnabled(userId: string, channel: Channel) {
    return this.prefs.get(`${userId}:${channel}`) ?? DEFAULTS[channel];
  }
  async setPreference(userId: string, channel: Channel, enabled: boolean) {
    this.prefs.set(`${userId}:${channel}`, enabled);
  }
  async recordPurchases(orderId: string, userId: string, lines: PurchaseLine[], placedAt: Date) {
    for (const l of lines) {
      if (!this.purchases.some((p) => p.order_id === orderId && p.product_id === l.productId)) {
        this.purchases.push({ order_id: orderId, user_id: userId, product_id: l.productId, unit_price: l.unitPrice, placed_at: placedAt });
      }
    }
  }
  async userForOrder(orderId: string) {
    return this.purchases.find((p) => p.order_id === orderId)?.user_id ?? null;
  }
  async priceDropTargets(productId: string, newPrice: number, since: Date, minPercent: number) {
    const best = new Map<string, PriceDropTarget>();
    for (const p of this.purchases) {
      if (p.product_id !== productId || p.placed_at < since || p.unit_price === null || p.unit_price <= newPrice) continue;
      if ((p.unit_price - newPrice) * 100 < p.unit_price * minPercent) continue;
      if ((best.get(p.user_id)?.paid ?? 0) < p.unit_price) best.set(p.user_id, { user_id: p.user_id, order_id: p.order_id, paid: p.unit_price });
    }
    return [...best.values()].sort((a, b) => a.user_id.localeCompare(b.user_id));
  }
  async claim(n: NewNotification) {
    if (this.rows.some((r) => r.dedupeKey === n.dedupeKey && r.channel === n.channel)) return null;
    const id = this.rows.length + 1;
    this.rows.push({ ...n, id, sentAt: null });
    return id;
  }
  async markSent(id: number) {
    Object.assign(this.rows[id - 1], { status: 'sent', sentAt: new Date() });
  }
  async markFailed(id: number, error: string) {
    Object.assign(this.rows[id - 1], { status: 'failed', error });
  }
  async list() {
    return this.rows.map((r) => ({ ...r }));
  }
}
