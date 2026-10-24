# A safety check on every new report

Status: ready-for-agent
Blocked by: 01
Spec: ../spec.md

## What to build

When a Tenant reports a new issue, intake also asks whether the message describes a **risk to people's safety**: gas smell or leak, sparking or exposed wiring, flooding near electrics, structural collapse, no lock on an entry door, or carbon monoxide.

- **The question:** a separate yes/no question, sent in the **same classifier request** as the others. Jev answers independent questions together, so this costs no extra round trip. Use a `choice` with `risk` / `no_risk` and clear criteria. It goes through the Classifier port, so Claude and the mock answer it too.
- **The threshold:** when the answer is `risk` with confidence **≥ 0.9**, the issue takes the Urgent path whatever the Urgency question said (`startUrgentRepair` in `src/intake.ts`). The Property Manager also gets an alert naming the risk. Below 0.9, Urgency decides as today. Keep the threshold a named constant with a comment saying it's tuned for missing a real risk being the worst outcome.
- **The record:** the safety answer and its confidence are recorded on the issue's timeline (the existing event log), so the Property Manager can see why it went Urgent.

## Acceptance criteria

- [ ] Intake scenarios with a fake classifier:
  - "I can smell gas in the kitchen" with `risk` at 0.95 goes Urgent, with the alert, even when Urgency says routine
  - `risk` at 0.6 doesn't override
  - `no_risk` changes nothing
  - the question is sent in the same request as the others (one classify call)
- [ ] The mock classifier answers `risk` for the gas, sparks and flooding keywords.
- [ ] `npm run check` passes.
