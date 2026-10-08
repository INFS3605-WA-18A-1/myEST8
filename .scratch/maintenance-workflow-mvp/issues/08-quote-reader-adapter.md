# Quote reader adapter

Status: needs-info

## Goal

A real `QuoteReader` (`src/ports.ts`): read a price and a proposed time from a Tradie's reply text and any PDF quote. Either may be missing.

## What exists

- `src/quotes.ts` `recordTradieReply` calls the reader and stores an unconfirmed Quote with the PDF; the Property Manager confirms or corrects it before it counts toward the two-Quote minimum.
- Tests use `FakeQuoteReader`.

## Open question

- Which model reads quotes: Jev or the vision-capable LLM (spec Out of Scope: not chosen yet).

## Acceptance criteria

- [ ] Price returned in cents; proposed time as an instant, read in the Agency's time zone when the reply gives only a local time ("Tuesday 9am").
- [ ] Anything it can't read is left missing, never guessed.
- [ ] PDFs over the model's limit are skipped with only the text read.
- [ ] Errors are thrown so the worker retries.

## Testing

- Adapter tests with recorded replies and PDFs; manual demo checklist.
