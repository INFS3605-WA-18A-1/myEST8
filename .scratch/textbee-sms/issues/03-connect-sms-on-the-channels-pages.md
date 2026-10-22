# Connect SMS on the Channels screens, and the setup docs

Status: ready-for-agent
Blocked by: 01
Spec: ../spec.md

## What to build

- **Connect SMS and Disconnect** on the welcome wizard's Channels step, Setup and Settings, as the spec's "Connecting the number" section says. It is one shared component, like `smsNumberPanel` in `src/web/pages/sms-number.ts`. Pass what the pages need through `ChannelConnectors` (`src/web/connectors.ts`), not by reading the environment in a page.
- **The wizard's "still to do" line** (`channelsStillToDo` in `welcome.ts`) says "connect the Agency's SMS number" while textbee is set and SMS isn't connected.
- **Follow `docs/design-system.md`** and add the component to it. If Tailwind classes change, run `npm run css` and commit `src/web/static/tw.css`.
- **`docs/channels-setup.md` section 3** becomes "SMS (simulated, or textbee)":
  - install textbee on an Android phone with a SIM, sign in, and enable receiving SMS
  - in the dashboard, generate an API key and note the device id
  - add a webhook at `${PUBLIC_URL}/webhooks/textbee` with a signing secret of 20+ characters, subscribed to `MESSAGE_RECEIVED`
  - set the four variables in Vercel (Production) and redeploy
  - press Connect SMS
  - the limits in ADR 0013

  The Twilio part moves under a short "Twilio (switched off, see ADR 0013)" note.
- **Env examples:** `.env.example` and `deploy/live.env.example` list the four `TEXTBEE_*` variables and `TEXTBEE_API_URL`.
- **`docs/vercel.md`'s** provider list mentions `TEXTBEE_*`.

## Acceptance criteria

- [ ] Page tests (`test/web/`):
  - with textbee set and SMS not connected, each of the three screens shows "Tenants text …" and Connect SMS, and not the code form or the Twilio panel
  - pressing it connects the number and shows it with Disconnect
  - Disconnect removes it
  - with another Agency already holding the number, Connect SMS is refused with the spec's message
  - with textbee unset, the screens are as they were (the existing tests pass unchanged)
- [ ] The docs and env examples above are updated.
- [ ] `npm run check` passes.
