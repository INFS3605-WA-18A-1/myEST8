# A Twilio SMS number bought for each Agency

Amends the SMS part of [ADR 0004](0004-gmail-and-whatsapp-cloud-api.md).

An Agency gets real SMS with one button, "Get an SMS number". myEST8 buys an Australian mobile number on the server's Twilio account, points its incoming texts at `/webhooks/twilio`, and connects it as the Agency's SMS channel. The Agency types nothing. An Agency can't connect a mobile it already has, because something has to send and receive the texts for that number. Porting or hosting the Agency's own number on Twilio is possible later, but it means paperwork for the Agency.

Each number is named `myEST8 Agency <id>` on Twilio, so asking again returns the number already bought instead of buying another. Messages from a number the account owns go out through Twilio to anyone. Other SMS stays simulated, and the older DEMO_SEND_TO rule still applies to it.

Australian numbers need an approved regulatory bundle, which a Twilio trial account cannot have. So `TWILIO_BUNDLE_SID` is what turns this on. Without it SMS stays simulated, exactly as in ADR 0004. Each number costs a monthly fee plus a charge per message, which the server's Twilio account pays.
