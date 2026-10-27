# Outlook Actionable Message cards whose buttons change in place

Status: needs-info
Blocked by: 02
Spec: ../spec.md

Outlook can draw an Adaptive Card carried in an email. When a button is pressed, Outlook itself POSTs to our server, and the server's reply replaces the card, so the email shows "✓ Approved" in green. Other clients show the HTML version from issues 01–02.

## Needs before building
- **A registered sender.** Register the Agency's sending address in Microsoft's Actionable Email Developer Dashboard. "Test users" scope covers our own inboxes for the demo. Sending to any Tenant or Property Owner needs a wider scope, which Microsoft reviews.
- **Confirm against Microsoft's current docs:** whether Outlook.com personal accounts still render these cards, and what the review requires.
- **SPF and DKIM** for the sending domain.

## Sketch
- `renderEmail` adds `<script type="application/adaptivecard+json">` with an Adaptive Card for the button emails from issue 02, and for visit confirm and pick.
- Each `Action.Http` POSTs to a new endpoint. The endpoint verifies Microsoft's bearer token (a JWT signed by Microsoft, with `aud` set to our URL and the sender we registered), then does exactly what the page's POST does. It replies with a refreshed card through the `CARD-UPDATE-IN-BODY` header.
- The no-login pages stay the fallback, and the source of truth.
