# Channel guide in plain words

Status: needs-triage
Priority: P1
DesignDoc: Story 6

## What's wrong now

`channelGuide` (`src/web/onboarding-forms.ts:173-207`) is Twilio Console steps, webhook URLs and MX records. The hosted path has no help for an Agency without a Google inbox, and doesn't explain how to create a missing channel.

## Acceptance criteria

- [ ] Each channel leads with what the Property Manager does in their own inbox or phone.
- [ ] Each channel explains how to create it if the Agency doesn't have it.
- [ ] Technical steps fold away under 'For whoever sets up your systems'.
