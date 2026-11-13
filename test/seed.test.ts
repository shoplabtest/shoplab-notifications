import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seed, seedShoppers, seedUserId } from '../src/seed.ts';
import { MemoryStore } from '../src/store.ts';

test('seed shoppers are the people iam seeds, with the same ids', () => {
  const [first, second] = seedShoppers();
  assert.deepEqual([first.userId, first.email, first.fullName], ['78db596d-05c1-4f55-a5ff-eb4939d742a0', 'grace.rossi.0@shoplab.test', 'Grace Rossi']);
  assert.deepEqual([second.email, second.fullName], ['ines.novak.1@shoplab.test', 'Ines Novak']);
  assert.equal(seedUserId(7), 'a2f57e0a-5abb-42de-a3dc-73fe9597de72');
  assert.equal(new Set(seedShoppers().map((s) => s.email)).size, 50);
});

test('seeding stores contacts and the push and email preferences', async () => {
  const store = new MemoryStore();
  assert.equal(await seed(store), 50);
  const grace = seedShoppers()[0];
  assert.equal((await store.getContact(grace.userId))?.email, 'grace.rossi.0@shoplab.test');
  assert.equal(await store.isEnabled(grace.userId, 'push'), true); // every 5th, starting at 0
  assert.equal(await store.isEnabled(grace.userId, 'email'), false); // every 17th, starting at 0
  assert.equal(await store.isEnabled(seedShoppers()[1].userId, 'email'), true);
});
