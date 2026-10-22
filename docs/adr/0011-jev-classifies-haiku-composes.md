# Jev classifies what comes in; Claude Haiku composes what goes out

**Not built yet.** The code still works the old way, in three places:

- Classification uses Claude Haiku whenever `ANTHROPIC_API_KEY` is set. Jev runs only without that key, when `JEV_API_URL` is set (`src/demo/runtime.ts`).
- `src/adapters/jev.ts` speaks a contract guessed before TypeSafe published its API: `POST /v1/classify`, an `options` list per question, and a list of answers. The real API (checked 2026-10-21, https://docs.typesafe.ai/api.md) is `POST https://api.typesafe.ai/v1/systemone`. It takes a `model` such as `jev-latest` and a `questions` map. A `choice` question takes a `criteria` map, and answers come back keyed by question name with `choice`, `confidence` and `probabilities`. The demo's mock Jev speaks the guessed contract too.
- No model writes outbound messages. Everything sent to a Tenant, Tradie or Property Owner is a fixed template ([ADR 0008](0008-ai-summary-templates-own-prose.md)).

The decision below is what the code should do.

Amends [ADR 0006](0006-resend-email-and-claude-haiku.md) (classification) and [ADR 0008](0008-ai-summary-templates-own-prose.md) (outbound prose).

**Amended by [ADR 0014](0014-haiku-extracts-guided-answers.md):** reading the guided details out of a Tenant's text is not a typed judgment, so Claude Haiku extracts them, and `ANTHROPIC_API_KEY` configures that too. Everything else here stands.

**Jev classifies every inbound message**, by email, SMS or WhatsApp. That covers the kind of message, what it relates to, the Urgency, the Trade, the update or reply type, and a Property Owner's yes or no. These are typed judgments with a fixed set of answers, which is what Jev (TypeSafe's System One model) is built for. Its per-answer probabilities let intake send uncertain messages to the inbox instead of acting on them. `JEV_API_URL` and `JEV_API_KEY` configure it. Haiku no longer classifies.

**Claude Haiku composes the messages myEST8 sends.** When a Property Manager acts in the interface, Haiku writes the email or text from the facts of that action: forwarding a Ticket or a Reimbursement Request to the Property Owner, asking Tradies for Quotes, or sending a Work Order. It also keeps writing the Summary (ADR 0008). `ANTHROPIC_API_KEY` configures it.

The guardrails from ADR 0008 carry over to every composed message. Haiku gets the facts as structured data and writes only from them. It never adds names, prices, causes, advice or promises, and a Tenant's own words are untrusted data inside its input. Code supplies the facts a message can't get wrong: amounts, dates and times, addresses, links and approval instructions. Code also checks that each one appears in the composed text. If Haiku is unavailable, or its draft fails that check, the message goes out from its template, so sending never depends on the model. The templates stay as that fallback and as the mock in tests and the demo.

Each model does the job it suits. Jev answers fixed questions quickly and cheaply, with calibrated probabilities, on every incoming message. Haiku writes natural prose where a person reads it, but only from facts code gives it.
