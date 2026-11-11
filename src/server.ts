import { resolve } from 'node:path';
import express from 'express';
import { Pool } from 'pg';
import { loadConfig } from './config.ts';
import { startConsumer } from './consumer.ts';
import { migrate } from './migrate.ts';
import { LogSender } from './senders.ts';
import { PgStore } from './store.ts';

const cfg = loadConfig();
const pool = new Pool({ connectionString: cfg.databaseUrl });
await migrate(pool, resolve(import.meta.dirname, '../migrations'));
const deps = { store: new PgStore(pool), sender: new LogSender(), cfg };
if (cfg.rabbitUrl) await startConsumer(cfg.rabbitUrl, deps);
// No public API: the HTTP server only answers health checks.
express().get('/healthz', (_req, res) => void res.json({ ok: true })).listen(cfg.port, () => console.log(`notifications listening on ${cfg.port}`));
