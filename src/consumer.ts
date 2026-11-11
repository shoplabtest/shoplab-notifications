import amqp from 'amqplib';
import { EXCHANGE } from './events.ts';
import { handleOrderPlaced, handlePaymentFailed, handleProductUpdated, handleStockLow, handleUserRegistered, type Deps } from './notify.ts';

export const QUEUE = 'notifications.events';

const HANDLERS: Record<string, (deps: Deps, body: never) => Promise<void>> = {
  'user.registered': handleUserRegistered,
  'order.placed': handleOrderPlaced,
  'payment.failed': handlePaymentFailed,
  'stock.low': handleStockLow,
  'product.updated': handleProductUpdated,
};
export const BINDINGS = Object.keys(HANDLERS);

/** Routes one message to its handler. Throws on malformed JSON so the caller can reject it. */
export async function handleMessage(deps: Deps, routingKey: string, raw: string): Promise<void> {
  const body = JSON.parse(raw) as never;
  await HANDLERS[routingKey]?.(deps, body);
}

export async function startConsumer(url: string, deps: Deps) {
  const conn = await amqp.connect(url);
  const ch = await conn.createChannel();
  await ch.assertExchange(EXCHANGE, 'topic', { durable: true });
  await ch.assertQueue(QUEUE, { durable: true });
  // One message at a time, in queue order: payment.failed must not run before the order.placed it refers to has been recorded.
  await ch.prefetch(1);
  for (const key of BINDINGS) await ch.bindQueue(QUEUE, EXCHANGE, key);
  await ch.consume(QUEUE, async (msg) => {
    if (!msg) return;
    try {
      await handleMessage(deps, msg.fields.routingKey, msg.content.toString());
      ch.ack(msg);
    } catch (e) {
      console.error(`notifications: rejected ${msg.fields.routingKey}: ${(e as Error).message}`);
      ch.nack(msg, false, false);
    }
  });
  return async () => { await ch.close(); await conn.close(); };
}
