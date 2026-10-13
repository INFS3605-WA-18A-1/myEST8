# Free channel providers: Gmail by OAuth and Meta's WhatsApp Cloud API

For running myEST8 for real on a course budget, email goes through the Agency's own Gmail, connected by OAuth, and WhatsApp goes through Meta's WhatsApp Cloud API directly. SMS stays on the phone simulator. This supersedes ADR 0003 for the running system. The Twilio and SendGrid adapters stay in the code for when there's money for them, behind the same `Messenger` port.

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
  - Until such a phone exists, SMS runs on the simulator.
