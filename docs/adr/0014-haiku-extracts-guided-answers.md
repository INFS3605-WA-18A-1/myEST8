# Claude Haiku extracts the guided answers from the Tenant's words

Amends [ADR 0011](0011-jev-classifies-haiku-composes.md): that decision gave Jev every typed judgment on inbound messages. Reading the guided details out of a Tenant's text is a different job, so Haiku does it.

When a Tenant reports a new issue, intake used to ask four guided questions one message at a time, even when the first message already answered some of them ("Last night the kitchen sink broke…" says where and when). Now an **extractor** reads the Tenant's message and returns any of the four details it states: `location` and `started` as short text in the Tenant's words, `worsening` as yes or no, and `availability` as one of the fixed options. Intake saves what it finds and sends one message, `tenant.missing_details`, listing only what's still missing. It reads the reply the same way, and asks **at most twice** per issue, the first ask and one re-ask for what is still missing. A reply that adds nothing, or the reply to the second ask, lets intake go on with the blanks, so the Tenant is never nagged. The count lives in the `guided` awaiting row (`asks`), so it needs no new table.

**Why Haiku and not Jev.** Jev answers questions with a fixed set of options and a probability for each. Two of these four answers are free text in the Tenant's own words, which Jev can't return, and the other two are easiest to read from the same pass. Production has an Anthropic key and no Jev. The classifier still decides whether a reply is an answer at all (`answer:guided`), as before.

**Guardrails.** The extractor is a port (`DetailExtractor`, `src/adapters/claude-extractor.ts`) with the same rules as the other Haiku adapters:

- The Tenant's text is untrusted data in its own object, never instructions.
- The prompt asks for JSON only and for nothing the Tenant didn't clearly say.
- The adapter validates every value: unknown keys dropped, only the questions asked for, enums checked, strings trimmed to 120 characters, empty strings dropped.
- It times out quickly, and its errors never carry the API key or a URL.

**When it's unavailable.** If the extractor throws, or there is no key outside the demo, intake treats that as finding nothing and asks all four questions in one message. Intake never stops because of it. The demo and tests use a small keyword mock.

Issues already waiting on one guided question when this shipped take their reply through the new logic: it is read for whatever is still missing, and the Tenant is asked once more for the rest.
