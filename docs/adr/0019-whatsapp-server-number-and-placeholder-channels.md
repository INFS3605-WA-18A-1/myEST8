# WhatsApp on the shared server number, and placeholder channels

WhatsApp was taken off the channel pages. The button that used the platform number posted that number into the same form as a typed address. Since commit 2347f3c, that form sends a 6-digit code to the address before saving it. The address was the server's own WhatsApp number, so Meta was asked to message the number it sends from. Meta refuses that (error 131021). The button could not succeed. The Cloud API and the webhook stayed in the server, dormant.

**Decision.** WhatsApp is offered again, on the one number the server holds (`META_WHATSAPP_NUMBER`, with the sending pair `META_WHATSAPP_PHONE_NUMBER_ID` and `META_WHATSAPP_ACCESS_TOKEN`). Connect WhatsApp stores that number as the Agency's WhatsApp channel, already verified, the same way Connect SMS stores the server's textbee phone. No code is sent. One Agency holds the number. A second Agency is told it is connected to another Agency. Disconnect unlinks it. The number stays the server's.

When those settings are missing, Connect WhatsApp stays on the welcome wizard's Channels step, on Setup, and in Settings → Channels. The button is disabled, with one line that WhatsApp isn't set up on this server yet. It is not hidden.

The pages say, in one line, that Tenants message first, replies are free for 24 hours, and after that myEST8 uses SMS or email. That is the rule notifications already follow.

Messenger, Telegram, WeChat and LINE appear in those same three places, from one list (`src/web/pages/channel-options.ts`). Each is a disabled button with "Coming later". There is no form and no backend. They are quieter than SMS, WhatsApp and email.

**Consequences.**

- A verification code is never sent to the server's own WhatsApp number.
- A number for every Agency (Embedded Signup) is still not built.
- The four later channels are not Channels until a later change adds them. Adding one means a real control in that list, not a second copy of the pages.
