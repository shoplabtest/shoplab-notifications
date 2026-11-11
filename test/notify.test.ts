import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { handleMessage } from '../src/consumer.ts';
import { loadConfig } from '../src/config.ts';
import { toMinorUnits } from '../src/money.ts';
import { MemorySender } from '../src/senders.ts';
import { MemoryStore } from '../src/store.ts';
import { render } from '../src/templates.ts';

const ADA = '11111111-1111-4111-a111-111111111111';
const BOB = '22222222-2222-4222-a222-222222222222';
const order = (n: number) => `aaaaaaaa-aaaa-4aaa-aaaa-${String(n).padStart(12, '0')}`;
const pay = (n: number) => `bbbbbbbb-bbbb-4bbb-bbbb-${String(n).padStart(12, '0')}`;
const NOW = new Date('2026-11-10T12:00:00Z');

let store: MemoryStore;
let sender: MemorySender;
const cfg = loadConfig({} as NodeJS.ProcessEnv);
const send = (key: string, body: unknown) => handleMessage({ store, sender, cfg, now: () => NOW }, key, JSON.stringify(body));
const placed = (n: number, userId = ADA, over: object = {}) => ({
  orderId: order(n), userId, total: 21650, currency: 'USD', placedAt: '2026-11-08T10:00:00Z',
  lines: [{ productId: 'p-1', quantity: 2, unitPrice: 5000 }, { productId: 'p-2', quantity: 1, unitPrice: 11650 }, { productId: 'p-3', quantity: 1, unitPrice: null }], ...over,
});

beforeEach(async () => {
  store = new MemoryStore();
  sender = new MemorySender();
  await store.upsertContact(ADA, 'ada@shoplab.test', 'Ada Lovelace');
  await store.upsertContact(BOB, 'bob@shoplab.test', 'Bob Stone');
});

test('welcome email on registration, once, to the registered address', async () => {
  const fresh = '33333333-3333-4333-a333-333333333333';
  await send('user.registered', { userId: fresh, email: 'new@shoplab.test', fullName: 'Nia Park' });
  await send('user.registered', { userId: fresh, email: 'new@shoplab.test', fullName: 'Nia Park' });
  assert.deepEqual(sender.sent.map((s) => [s.channel, s.to, s.subject]), [['email', 'new@shoplab.test', 'Welcome to ShopLab']]);
  assert.match(sender.sent[0].body, /^Hi Nia,/);
  assert.equal((await store.getContact(fresh))?.email, 'new@shoplab.test');
  await send('user.registered', { userId: fresh, email: 'moved@shoplab.test', fullName: 'Nia Park' }); // later mail goes to the new address
  assert.equal((await store.getContact(fresh))?.email, 'moved@shoplab.test');
  assert.equal(sender.sent.length, 1);
});

test('channel preferences: push is off by default, email can be switched off', async () => {
  await store.setPreference(ADA, 'push', true);
  await store.setPreference(BOB, 'email', false);
  await send('order.placed', placed(1, ADA));
  await send('order.placed', placed(2, BOB));
  assert.deepEqual(sender.sent.map((s) => `${s.channel}:${s.to}`), [`email:ada@shoplab.test`, `push:${ADA}`]);
});

test('order confirmation: formatted total and item count, once per order', async () => {
  await send('order.placed', placed(1));
  await send('order.placed', placed(1));
  assert.equal(sender.sent.length, 1);
  assert.equal(sender.sent[0].subject, 'Your order aaaaaaaa is confirmed');
  assert.match(sender.sent[0].body, /Total: USD 216\.50 for 4 items\./);
  assert.equal(store.purchases.length, 3);
  assert.equal(store.purchases.find((p) => p.product_id === 'p-3')!.unit_price, null);
});

test('payment.failed reaches the user behind the order, once per payment', async () => {
  await send('order.placed', placed(1));
  sender.sent.length = 0;
  await send('payment.failed', { paymentId: pay(1), orderId: order(1), reason: 'card_declined', failedAt: '2026-11-08T10:01:00Z' });
  await send('payment.failed', { paymentId: pay(1), orderId: order(1), reason: 'card_declined', failedAt: '2026-11-08T10:01:00Z' });
  await send('payment.failed', { paymentId: pay(2), orderId: order(1), failedAt: '2026-11-08T10:05:00Z' }); // a second attempt is news again
  assert.equal(sender.sent.length, 2);
  assert.match(sender.sent[0].body, /\(card_declined\)/);
  assert.doesNotMatch(sender.sent[1].body, /\(/);
  await send('payment.failed', { paymentId: pay(3), orderId: order(77), failedAt: '2026-11-08T10:05:00Z' }); // unknown order: nobody to tell
  assert.equal(sender.sent.length, 2);
  assert.deepEqual(store.rows.filter((r) => r.status === 'skipped').map((r) => [r.dedupeKey, r.error]), [[`payment_failed:${pay(3)}`, 'unknown_order']]);
});

test('stock.low alerts ops once per product per day', async () => {
  const ev = { productId: 'p-9', available: 3, threshold: 5, at: '2026-11-10T08:00:00Z' };
  await send('stock.low', ev);
  await send('stock.low', { ...ev, available: 2, at: '2026-11-10T17:00:00Z' });
  await send('stock.low', { ...ev, at: '2026-11-11T08:00:00Z' });
  await send('stock.low', { ...ev, productId: 'p-10' });
  assert.deepEqual(sender.sent.map((s) => [s.to, s.subject]), [['ops@shoplab.test', 'Low stock: p-9'], ['ops@shoplab.test', 'Low stock: p-9'], ['ops@shoplab.test', 'Low stock: p-10']]);
});

test('a user we have no address for is recorded as skipped, not retried or crashed', async () => {
  const stranger = '44444444-4444-4444-a444-444444444444';
  await send('order.placed', placed(5, stranger));
  await send('order.placed', placed(5, stranger));
  assert.equal(sender.sent.length, 0);
  assert.deepEqual(store.rows.map((r) => [r.status, r.error]), [['skipped', 'no_contact']]);
});

test('a provider outage is recorded on the row and does not fail the event or the other channel', async () => {
  await store.setPreference(ADA, 'push', true);
  sender.failOn = 'email';
  await send('order.placed', placed(1));
  assert.deepEqual(store.rows.map((r) => [r.channel, r.status]), [['email', 'failed'], ['push', 'sent']]);
  assert.equal(store.rows[0].error, 'email provider down');
  await send('order.placed', placed(1)); // redelivery does not resend the failed one either
  assert.equal(store.rows.length, 2);
});

test('malformed events are rejected and send nothing', async () => {
  await assert.rejects(handleMessage({ store, sender, cfg }, 'user.registered', 'not json'));
  await assert.rejects(send('user.registered', { userId: 'x', email: 'a@b.c', fullName: 'A' }), /malformed/);
  await assert.rejects(send('user.registered', { userId: ADA, email: 'nope', fullName: 'A' }), /malformed/);
  await assert.rejects(send('order.placed', placed(1, ADA, { total: 1.5 })), /malformed/);
  await assert.rejects(send('payment.failed', { paymentId: 'p', orderId: order(1) }), /malformed/);
  await assert.rejects(send('stock.low', { productId: 'p', available: 'many', threshold: 1, at: 'x' }), /malformed/);
  await assert.rejects(send('product.updated', { price: '100' }), /malformed/);
  await send('cart.checked_out', {}); // not ours: ignored
  assert.equal(sender.sent.length, 0);
});

test('templates: stable subjects, singular item, optional reason', () => {
  assert.equal(render('order_confirmation', { orderId: order(1), total: 100, currency: 'EUR', items: 1 }).body, 'Thanks for your order.\n\nTotal: EUR 1.00 for 1 item.');
  assert.equal(render('welcome', { name: 'Cher' }).body.split('\n')[0], 'Hi Cher,');
});

// --- price protection (product.updated) ---------------------------------------------------------

const boughtLast = async () => {
  await send('order.placed', placed(1, ADA, { placedAt: '2026-11-08T10:00:00Z' })); // p-1 @ 5000, p-2 @ 11650
  await send('order.placed', placed(2, BOB, { placedAt: '2026-10-01T10:00:00Z' })); // too old
  sender.sent.length = 0;
};
const updated = (productId: string, price: string | number) => send('product.updated', { productId, price, currency: 'USD', updatedAt: '2026-11-10T11:00:00Z' });

test('toMinorUnits reads whole minor units written as text and nothing else', () => {
  assert.equal(toMinorUnits('4500'), 4500);
  assert.equal(toMinorUnits('0'), 0);
  for (const bad of ['', '45.00', '-1', '1e3', ' 45', '45 ', 'abc', '12345678901', 'undefined']) assert.equal(toMinorUnits(bad), null, bad);
});

test('price drop: tells recent buyers when the price fell far enough, once per price', async () => {
  await boughtLast();
  await updated('p-1', '4000'); // 20% under the 5000 Ada paid
  await updated('p-1', '4000');
  assert.equal(sender.sent.length, 1);
  assert.equal(sender.sent[0].to, 'ada@shoplab.test');
  assert.match(sender.sent[0].body, /p-1 now costs USD 40\.00; you paid USD 50\.00/);
  await updated('p-1', '3900'); // a further drop is news again
  assert.equal(sender.sent.length, 2);
});

test('price drop: ignores small drops, rises, old purchases and other products', async () => {
  await boughtLast();
  await updated('p-1', '4800'); // 4% < 5%
  await updated('p-1', '4750'); // exactly 5% counts
  assert.equal(sender.sent.length, 1);
  sender.sent.length = 0;
  await updated('p-2', '12000'); // went up
  await updated('p-3', '1'); // bought without a known price
  await updated('p-404', '1');
  assert.equal(sender.sent.length, 0);
  // Bob's order is outside the 14-day window
  assert.ok(!store.rows.some((r) => r.userId === BOB && r.kind === 'price_drop'));
});

test('price drop: the price arrives as text; a JSON number works the same today', async () => {
  await boughtLast();
  await updated('p-1', '4000');
  assert.equal(sender.sent.length, 1);
  await updated('p-2', 9000); // the number form is what is on the wire today
  assert.equal(sender.sent.length, 2);
  assert.match(sender.sent[1].body, /p-2 now costs USD 90\.00/);
});

test('price drop: a price that is not whole minor units is ignored silently', async () => {
  await boughtLast();
  await updated('p-1', '40.00');
  await updated('p-1', 'free');
  await updated('p-1', 39.5);
  assert.equal(sender.sent.length, 0);
});
