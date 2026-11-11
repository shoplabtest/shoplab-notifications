export interface Config {
  port: number;
  databaseUrl: string;
  rabbitUrl: string | undefined;
  /** Where staff alerts such as stock.low go. */
  opsEmail: string;
  /** A price drop only counts for purchases newer than this many days. */
  priceProtectionDays: number;
  /** ...and only when the price fell by at least this many percent of what the customer paid. */
  priceDropMinPercent: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 3007),
    databaseUrl: env.DATABASE_URL ?? 'postgres://notifications:notifications@localhost:5432/notifications',
    rabbitUrl: env.RABBITMQ_URL,
    opsEmail: env.OPS_ALERT_EMAIL ?? 'ops@shoplab.test',
    priceProtectionDays: Number(env.PRICE_PROTECTION_DAYS ?? 14),
    priceDropMinPercent: Number(env.PRICE_DROP_MIN_PERCENT ?? 5),
  };
}
