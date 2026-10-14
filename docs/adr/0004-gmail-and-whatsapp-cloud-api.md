# Gmail and the WhatsApp Cloud API for messaging channels

Supersedes [ADR 0003](0003-twilio-for-messaging-channels.md).

myEST8 connects to email through the Gmail API, to WhatsApp through Meta's WhatsApp Cloud API, and keeps SMS simulated. Tenants, Tradies and Property Owners still reach the Agency on channels they already use, and myEST8 both receives and sends on them.

**Email: Gmail, connected by OAuth per Agency.** The Agency signs in with Google once from Settings. Tenants keep writing to the Agency's real address, so there is no domain, MX record or forwarding rule to set up, which was the part of the Twilio SendGrid setup an Agency could not do alone. myEST8 asks for `gmail.readonly` and `gmail.send` only, and not `gmail.modify`. It polls the mailbox's history from a stored cursor every minute, so it needs no public push endpoint. The refresh token is stored encrypted (AES-256-GCM) in `channel_credentials`, never in `agency_channels`. `gmail.readonly` is a Restricted scope, so the app stays in Google's Testing mode (at most 100 named test users, and refresh tokens lapse after about 7 days; the Agency then sees "Reconnect Gmail") until it is verified. Gmail over IMAP with an app password avoids the expiry and is the fallback if it keeps breaking demos.

**WhatsApp: Meta's Cloud API directly.** Twilio was only ever a paid layer over the same API, so one fewer provider. Webhooks are verified with the app secret (`X-Hub-Signature-256`) and the GET handshake. Media is downloaded when the webhook arrives, because Meta's media links expire quickly. The WhatsApp 24-hour reply window still applies: free-form messages go out only within 24 hours of the person's last message, which is the rule `notifications.ts` already follows (anything outside it goes by SMS or email). A Meta number belongs to one Agency, so real WhatsApp covers one Agency until each Agency can register its own number.

**SMS: simulated** (amended by [ADR 0005](0005-twilio-sms-number-per-agency.md): a Twilio number per Agency once the server has a paid account and a bundle). Real Australian SMS needs a paid number per message, and trial accounts cannot buy one. The phone simulator stays the SMS channel. An Android phone running an SMS gateway app is the only free real option and is not part of this decision.

**Why not keep Twilio and SendGrid.** SendGrid Inbound Parse needs a domain you control, an MX record and a forwarding rule from the Agency's inbox. The Twilio WhatsApp sandbox only allows three pre-set templates and each recipient must join with a code. Both make an Agency do provider setup by hand, which the product should do for them.

**Consequences.**
- Credentials are per Agency for email and global for WhatsApp, so `OutboundMessage` carries the Agency (`agencyId`) and inbound ids are namespaced by provider, because idempotency in `inbound_messages` is global.
- Redirect URIs and webhook URLs are fixed HTTPS addresses, so real channels need a stable public hostname, not a quick tunnel.
- Email replies arrive as new messages: threading (`threadId`, `In-Reply-To`) is not part of this decision.
- The Twilio and SendGrid adapters stay until Gmail and WhatsApp pass their tests and removal is approved, then they and `FileLinks` (`/media`) are deleted.
