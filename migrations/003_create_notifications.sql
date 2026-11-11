CREATE TABLE notifications (
  id         bigserial PRIMARY KEY,
  user_id    uuid,                       -- null for staff alerts
  kind       text NOT NULL,
  channel    text NOT NULL CHECK (channel IN ('email', 'push')),
  recipient  text NOT NULL,
  dedupe_key text NOT NULL,
  subject    text NOT NULL,
  body       text NOT NULL,
  status     text NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  error      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at    timestamptz,
  UNIQUE (dedupe_key, channel)           -- the same fact is never announced twice on a channel
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
