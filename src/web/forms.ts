// Form handling shared by every page: read the posted fields, run one action,
// and redirect back with a flash message. A refused action (ActionError) shows
// its message, and so does a message that can't be delivered (the person can't
// be reached); anything else is a real error and propagates.

import type { Context } from 'hono';
import { ProviderRefusedError, UndeliverableError } from '../ports.ts';
import { ActionError } from '../shared.ts';
import { zonedInstant } from '../zoned-time.ts';
import { withFlash } from './ui.ts';

export type FormValues = Record<string, string | File | (string | File)[]>;

/** The most any amount typed into a form may be: far past any real repair, and well inside what the database holds. */
const MAX_TYPED_DOLLARS = 10_000_000;

/**
 * Runs `action` with the posted form. On success redirects to the returned path
 * (or `back`) with `ok`; when the action is refused, back to `back` with the reason.
 */
export async function formAction(
  c: Context,
  back: string,
  action: (form: FormValues) => Promise<{ ok: string; redirect?: string }> | { ok: string; redirect?: string },
) {
  const form = (await c.req.parseBody({ all: true })) as FormValues;
  try {
    const { ok, redirect } = await action(form);
    return c.redirect(withFlash(redirect ?? back, 'ok', ok), 303);
  } catch (error) {
    if (error instanceof ActionError) return c.redirect(withFlash(back, 'error', error.message), 303);
    if (error instanceof UndeliverableError || error instanceof ProviderRefusedError) {
      return c.redirect(withFlash(back, 'error', `Couldn't send the message: ${error.userReason}.`), 303);
    }
    throw error;
  }
}

/** A posted text field, trimmed; '' when missing. */
export function text(form: FormValues, name: string): string {
  const value = form[name];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' ? first.trim() : '';
}

/** A posted text field, or undefined when empty. */
export function optional(form: FormValues, name: string): string | undefined {
  return text(form, name) || undefined;
}

/** A posted whole number. Throws an ActionError naming the field when it isn't one. */
export function int(form: FormValues, name: string, label = name): number {
  const value = Number(text(form, name));
  if (!Number.isInteger(value)) throw new ActionError('invalid', `Enter a whole number for ${label}`);
  return value;
}

/** Dollars typed by a person ("1,250.50") as cents. */
export function cents(form: FormValues, name: string, label = name): number {
  const value = Number(text(form, name).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(value) || value < 0) throw new ActionError('invalid', `Enter an amount in dollars for ${label}`);
  if (value > MAX_TYPED_DOLLARS) throw tooBig(label, name);
  return Math.round(value * 100);
}

/** The refusal for an amount over MAX_TYPED_DOLLARS, against `field` when the form names one. */
function tooBig(label: string, field?: string) {
  const message = `Check the amount for ${label}: it is over $${MAX_TYPED_DOLLARS.toLocaleString('en-AU')}`;
  return new ActionError('invalid', message, field ? { [field]: message } : {});
}

/** Every value posted under `name` (checkbox groups, multi-selects). */
export function list(form: FormValues, name: string): string[] {
  const value = form[name] ?? form[`${name}[]`];
  return (Array.isArray(value) ? value : value === undefined ? [] : [value]).filter((v): v is string => typeof v === 'string' && v !== '');
}

/** Every file posted under `name`. */
export function files(form: FormValues, name: string): File[] {
  const value = form[name] ?? form[`${name}[]`];
  return (Array.isArray(value) ? value : value === undefined ? [] : [value]).filter((v): v is File => typeof v !== 'string' && v.size > 0);
}

/** A datetime-local value ("2026-10-13T09:00") read as the Agency's wall-clock time, as an ISO instant. */
export function localToIso(value: string, timeZone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) throw new ActionError('invalid', 'Enter a date and time');
  const [, y, mo, d, h, mi] = match.map(Number) as number[];
  return zonedInstant(timeZone, y!, mo!, d!, h!, mi!).toISOString();
}

/** An ISO instant as a datetime-local value in the Agency's time zone, for a form's default. */
export function isoToLocal(iso: string, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/**
 * An optional amount in dollars, typed by a person ("$450", "1,250.50"), as cents:
 * null when blank. Throws an ActionError naming `label` when it isn't an amount.
 */
export function optionalCents(value: unknown, label: string): number | null {
  const typed = typeof value === 'string' ? value.trim() : '';
  if (!typed) return null;
  const dollars = Number(typed.replace(/[$,\s]/g, ''));
  if (!Number.isFinite(dollars) || dollars < 0) throw new ActionError('invalid', `Enter an amount in dollars for ${label}`);
  if (dollars > MAX_TYPED_DOLLARS) throw tooBig(label);
  return Math.round(dollars * 100);
}
