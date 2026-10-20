# An AI Summary of each request; templates still own outbound prose

Each Maintenance Request carries a Summary: one line, at most 160 characters, written by Claude Haiku from the Tenant's words and their answers to the guided questions. It is what the Property Manager reads first, what goes to Tradies in a Quote Request, and what the docket shows once the request is a Ticket. The Tenant's original text stays as the description underneath.

The Summary is the one place a model writes sentences in myEST8. Its prompt forbids new facts, names, prices and advice, and the Property Manager can edit it; an edit is never overwritten by a later run. Everything myEST8 sends to a Tenant, Tradie or Property Owner is still a fixed template ([ADR 0006](0006-resend-email-and-claude-haiku.md)), with the Summary dropped into a placeholder like any other field. If the summariser fails, the request is still confirmable and pages fall back to the description.

The summariser is a port (`Summariser`) beside the classifier: Claude Haiku when `ANTHROPIC_API_KEY` is set, otherwise a deterministic mock that trims the first sentence. Jev cannot write prose, so there is no Jev implementation.
