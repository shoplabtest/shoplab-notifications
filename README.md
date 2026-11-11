# shoplab-notifications

Email and push notifications sent in reaction to events. Node, RabbitMQ consumer, Postgres. It has no public API: the only HTTP endpoint is `GET /healthz`.

| Event | Notification | Goes to |
| --- | --- | --- |
| `user.registered` | welcome (and the contact is stored) | the user |
| `order.placed` | order confirmation (and the purchases are recorded) | the user |
| `payment.failed` | payment failed, with the reason | the user behind the order |
| `stock.low` | low-stock alert, once per product per day | `OPS_ALERT_EMAIL` |
| `product.updated` | price protection: a product the user bought in the last `PRICE_PROTECTION_DAYS` (14) got at least `PRICE_DROP_MIN_PERCENT` (5 %) cheaper | the user |

**Channels.** Every user notification goes to each channel the user has switched on: email is on by default, push is off (`channel_preferences`). Email uses the address from `user.registered`; this service never reads iam's database. A user with no known address is recorded as `skipped`.

**De-duplication.** Each notification is claimed in the `notifications` table under a key such as `order_confirmation:<orderId>` or `price_drop:<user>:<product>:<price>` before it is sent, and only the first claim sends. A redelivered event, or eight at once, notifies once. A provider failure is stored on the row (`status = failed`) and does not stop the other channel or reject the event.

**Ordering.** Messages are handled one at a time in queue order (`prefetch(1)`), because `payment.failed` only carries the order id and needs the purchases that `order.placed` recorded. A `payment.failed` for an order it has not seen is stored as `skipped` with `unknown_order`.

**Price protection** reads the new price from `product.updated` as text holding whole minor units, and ignores any other format.

**Delivery.** `LogSender` prints each message. The real email and push providers plug in behind the `Sender` interface in `src/senders.ts`.

Env: `DATABASE_URL`, `RABBITMQ_URL` (optional; without it nothing is consumed), `OPS_ALERT_EMAIL`, `PRICE_PROTECTION_DAYS`, `PRICE_DROP_MIN_PERCENT`, `PORT` (3007).

```
npm test                          # in-memory store
TEST_DATABASE_URL=postgres://postgres:pw@localhost:5432/test npm test   # also migrations, seed and concurrency
npm run seed                      # 50 shoppers (same ids as the orders seed); every 5th has push on, every 17th has email off
```
