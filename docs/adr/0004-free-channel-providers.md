# Free channel providers: Gmail by OAuth and Meta's WhatsApp Cloud API

For running myEST8 for real on a course budget, email goes through the Agency's own Gmail, connected by OAuth, and WhatsApp goes through Meta's WhatsApp Cloud API directly. SMS stays on the phone simulator unless `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` are set. This supersedes ADR 0003 for the running system. The email half is superseded by [ADR 0006](0006-resend-email-and-claude-haiku.md) (Resend; Gmail stays in the code, dormant). [ADR 0005](0005-twilio-sms-number-per-agency.md) is not built: the code does not read `TWILIO_BUNDLE_SID` or `TWILIO_ADDRESS_SID`. The Twilio and SendGrid adapters stay in the code, behind the same `Messenger` port.

WhatsApp reads `META_WHATSAPP_PHONE_NUMBER_ID` and `META_WHATSAPP_ACCESS_TOKEN` together or not at all, `META_APP_SECRET` and `META_WEBHOOK_VERIFY_TOKEN` for the webhook, and `META_WHATSAPP_NUMBER` as the number shown on the channels page. It does not read `WHATSAPP_TOKEN` or the other `WHATSAPP_*` names. Gmail, while dormant, reads `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `TOKEN_ENCRYPTION_KEY`, not `GOOGLE_OAUTH_*` or `CHANNEL_SECRET_KEY`.

We dropped Twilio because its trial can't buy Australian numbers (they need a paid regulatory bundle) or register WhatsApp senders. We dropped SendGrid because its free plan was retired in May 2025.

- **Email:** Gmail by OAuth reads the inbox and sends as the Agency's address, so Tenants keep writing to the address they already know, and replies come from it.
  - It needs no forwarding rule and no inbound domain.
  - The OAuth client stays in Google's Testing mode: up to 100 test users, an "unverified app" screen, and refresh tokens that can lapse after about 7 days. That's why the channels page offers "Reconnect Gmail".
  - Before any public launch, the restricted Gmail scopes need Google's verification and a yearly CASA assessment.
  - Microsoft Graph can be a second mailbox provider behind the same connector.
- **WhatsApp:** Meta's free test number reaches up to 5 phones added in the Meta dashboard, and is shared by every Agency on the server.
  - Messages myEST8 starts more than 24 hours after the person last wrote fail at Meta. That failure arrives later, on the status webhook, and is logged.
  - A real launch needs Meta business verification and approved templates.
- **SMS:** a phone's texts can't be read by any web service. iOS gives apps no access to them, and providers only see numbers they host.
  - The free route is an Android phone running SMS Gateway for Android (sms-gate.app), which forwards its texts to a webhook. That phone's plan then carries the Agency's texts, and consumer SIM terms forbid bulk sending.
  - Until such a phone exists, SMS runs on the simulator, or on one shared Twilio number when `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` are set. A number purchased per Agency is not built.
