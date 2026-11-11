import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { loadConfig } from '../src/config.ts';
import { handleOrderPlaced, handleProductUpdated, handleUserRegistered } from '../src/notify.ts';
import { migrate } from '../src/migrate.ts';
import { MemorySender } from '../src/senders.ts';
import { seed, seedShoppers } from '../src/seed.ts';
import { PgStore } from '../src/store.ts';

// Runs against a real, empty Postgres. CI provides TEST_DATABASE_URL; locally the tests are skipped.
const url = process.env.TEST_DATABASE_URL;
const ADA = '11111111-1111-4111-a111-111111111111';

test('migrations, seed, de-duplication under concurrency and the price-drop query', { skip: !url }, async () => {
  const pool = new Pool({ connectionString: url });
  try {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    const dir = resolve(import.meta.dirname, '../migrations');
    assert.equal((await migrate(pool, dir)).length, 4);
    assert.deepEqual(await migrate(pool, dir), []);

    const store = new PgStore(pool);
    assert.equal(await seed(store), 50);
    assert.equal(await seed(store), 50); // idempotent: same rows, nothing duplicated
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM contacts')).rows[0].n, 50);
    const [s0, s1, s5] = [seedShoppers()[0], seedShoppers()[1], seedShoppers()[5]];
    assert.equal(await store.isEnabled(s0.userId, 'push'), true);
    assert.equal(await store.isEnabled(s0.userId, 'email'), false); // 0 % 17 === 0
    assert.equal(await store.isEnabled(s1.userId, 'push'), false);
    assert.equal(await store.isEnabled(s5.userId, 'push'), true);

    const sender = new MemorySender();
    const deps = { store, sender, cfg: loadConfig({} as NodeJS.ProcessEnv), now: () => new Date('2026-11-10T12:00:00Z') };

    // eight identical deliveries at once send exactly one welcome
    await Promise.all(Array.from({ length: 8 }, () => handleUserRegistered(deps, { userId: ADA, email: 'ada@shoplab.test', fullName: 'Ada Lovelace' })));
    assert.equal(sender.sent.length, 1);
    assert.equal((await store.list()).length, 1);

    const ev = { orderId: 'aaaaaaaa-aaaa-4aaa-aaaa-000000000001', userId: ADA, total: 10000, currency: 'USD', placedAt: '2026-11-08T10:00:00Z', lines: [{ productId: 'p-1', quantity: 1, unitPrice: 10000 }] };
    await Promise.all([handleOrderPlaced(deps, ev), handleOrderPlaced(deps, ev), handleOrderPlaced(deps, ev)]);
    assert.equal(sender.sent.filter((s) => s.subject.startsWith('Your order')).length, 1);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM purchases')).rows[0].n, 1);

    sender.sent.length = 0;
    await handleProductUpdated(deps, { productId: 'p-1', price: '9000', currency: 'USD', updatedAt: 'x' });
    await handleProductUpdated(deps, { productId: 'p-1', price: '9000', currency: 'USD', updatedAt: 'x' });
    await handleProductUpdated(deps, { productId: 'p-1', price: '9600', currency: 'USD', updatedAt: 'x' }); // under 5 %
    assert.equal(sender.sent.length, 1);
    assert.deepEqual(await store.priceDropTargets('p-1', 9000, new Date('2026-11-09T00:00:00Z'), 5), []); // purchase older than `since`
    assert.deepEqual((await store.priceDropTargets('p-1', 9000, new Date('2026-11-01T00:00:00Z'), 5)).map((t) => t.paid), [10000]);
    assert.equal(await store.userForOrder(ev.orderId), ADA);
  } finally {
    await pool.end();
  }
});
