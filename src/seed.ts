import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { loadConfig } from './config.ts';
import { migrate } from './migrate.ts';
import { SEED_PEOPLE } from './seedPeople.ts';
import { PgStore, type Store } from './store.ts';

/** Same shopper ids as shoplab-iam's, orders', payments' and invoices' seeds. */
export const seedUserId = (i: number) => {
  const h = createHash('sha1').update(`shoplab-seed-user-${i}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

/** 50 shoppers, with the names and emails iam seeds them with. Every 5th has push on; every 17th has email off. */
export function seedShoppers(count = 50) {
  return Array.from({ length: count }, (_, i) => ({
    userId: seedUserId(i),
    email: SEED_PEOPLE[i % SEED_PEOPLE.length][0],
    fullName: SEED_PEOPLE[i % SEED_PEOPLE.length][1],
    push: i % 5 === 0,
    email_on: i % 17 !== 0,
  }));
}

export async function seed(store: Store) {
  const shoppers = seedShoppers();
  for (const s of shoppers) {
    await store.upsertContact(s.userId, s.email, s.fullName);
    if (s.push) await store.setPreference(s.userId, 'push', true);
    if (!s.email_on) await store.setPreference(s.userId, 'email', false);
  }
  return shoppers.length;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pool = new Pool({ connectionString: loadConfig().databaseUrl });
  await migrate(pool, resolve(import.meta.dirname, '../migrations'));
  console.log(`seeded ${await seed(new PgStore(pool))} shoppers`);
  await pool.end();
}
