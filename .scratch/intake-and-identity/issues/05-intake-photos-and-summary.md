# Photos on arrival and the AI Summary

Status: ready-for-agent
Owner: backend-engineer
Spec: ../spec.md, Part 2 "Summariser port", "Intake changes", "Templates"

## Acceptance criteria

- [x] Images on the first message become the issue's photos (EXIF-checked) and `photos_on_arrival` is set.
- [x] An issue with photos skips `awaiting_photos` and goes to `checking` then `maintenance_request`; the upload link says photos were received.
- [x] `Summariser` port with Claude Haiku and mock implementations; `intake.summarise` stores a Summary and never overwrites a Property Manager's edit.
- [x] `confirmMaintenanceRequest` accepts an edited Summary; `editSummary` exists on `asPropertyManager`.
