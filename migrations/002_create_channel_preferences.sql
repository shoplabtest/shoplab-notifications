-- No row means the default: email on, push off.
CREATE TABLE channel_preferences (
  user_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email', 'push')),
  enabled boolean NOT NULL,
  PRIMARY KEY (user_id, channel)
);
