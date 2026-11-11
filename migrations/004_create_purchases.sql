-- What each user paid per product, from order.placed. Drives price-drop notices and finds the user behind a failed payment.
CREATE TABLE purchases (
  order_id   uuid NOT NULL,
  user_id    uuid NOT NULL,
  product_id text NOT NULL,
  unit_price integer,
  placed_at  timestamptz NOT NULL,
  PRIMARY KEY (order_id, product_id)
);
CREATE INDEX purchases_product_idx ON purchases (product_id, placed_at DESC);
