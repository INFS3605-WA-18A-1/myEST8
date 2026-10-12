-- The demo runtime's own records (src/demo/runtime.ts): what the seed created,
-- how far the demo clock has been moved, and the phone simulator's history.
-- Only the demo writes them; in any other environment they stay empty.
CREATE TABLE demo_state (
  key text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE demo_messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  message text NOT NULL
);
