# Resend for email, Claude Haiku for classification

Resend replaces Gmail as the email path. Inbound mail arrives on a subdomain we control (for example `mail.kevinhe.pro`): its MX points at Resend, and the SPF and DKIM records are the ones Resend shows for that subdomain. An Agency forwards or CCs mail to an address on `RESEND_INBOUND_DOMAIN`. Outbound email is sent through Resend. The webhook is `https://<PUBLIC_URL>/webhooks/resend`, subscribed to `email.received`.

The Gmail adapter, mailbox polling and `/oauth/google` stay in the tree. They still read `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `TOKEN_ENCRYPTION_KEY` when those are set, and they are dormant: new setup uses Resend. SendGrid stays for the same reason. Gmail was the path in [ADR 0004](0004-gmail-and-whatsapp-cloud-api.md) because it needed no domain; that cost an OAuth client in Testing mode, restricted scopes and refresh tokens that lapse. One inbound subdomain is a single DNS setup for the server.

Classification uses Claude Haiku when `ANTHROPIC_API_KEY` is set, otherwise Jev when `JEV_API_URL` is set, otherwise the in-process mock. The maintenance templates stay deterministic. Haiku may compose a free-text email body, and only when that key is set.

**Amended by [ADR 0011](0011-jev-classifies-haiku-composes.md):** Jev classifies every inbound message, and Claude Haiku composes outbound messages instead of classifying. The paragraph above describes the code until ADR 0011 is built.

`RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` and `RESEND_INBOUND_DOMAIN` are set together or not at all. `ANTHROPIC_API_KEY` is separate. Examples use placeholders (`re_xxx`); real values live only in `~/.config/myest8/live.env`.
