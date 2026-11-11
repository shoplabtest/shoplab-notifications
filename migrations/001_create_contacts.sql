-- Where to reach a user. Filled from user.registered; notifications never reads iam's database.
CREATE TABLE contacts (
  user_id    uuid PRIMARY KEY,
  email      text NOT NULL,
  full_name  text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
