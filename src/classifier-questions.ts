// What the classifier is told about its questions, in the words of CONTEXT.md.
// Jev answers from plain-English instructions and from a description of when
// each option applies, so every question says what to judge and what to look
// at: `message` is the text, and the other backticked names are keys of the
// state sent with it. The helpers and the option sets that more than one call
// site shares live here; the questions themselves sit beside the code that
// reads their answers (intake.ts, imports.ts).

import type { ClassifierOption, ClassifierQuestion } from './ports.ts';
import { TRADES, type Trade } from './shared.ts';

export const option = (name: string, when: string): ClassifierOption => ({ name, when });

export const question = (id: string, instructions: string, options: readonly ClassifierOption[]): ClassifierQuestion => ({ id, instructions, options });

/** The kind of work each Trade covers. The fixed list of Trades, in order. */
const TRADE_WORK: Record<Trade, string> = {
  plumbing: 'Taps, pipes, toilets, drains, showers, leaks, blocked drains, hot water systems and gas fittings',
  electrical: 'Power points, lights, switches, wiring, fuses, circuit breakers and smoke alarms',
  carpentry: 'Doors, cupboards, drawers, floorboards, decks, fences, stairs, handrails and wardrobes',
  roofing: 'Roofs, gutters, downpipes and skylights',
  appliances: 'Ovens, cooktops, dishwashers, washing machines, dryers, fridges, rangehoods, air conditioners and heaters',
  locksmith: 'Locks, keys, deadbolts and being locked out',
  pest_control: 'Pests such as cockroaches, rats, mice, termites, ants, wasps, bed bugs, possums and spiders',
  general_handyman: 'Small jobs that suit none of the other Trades, such as painting, patching holes, curtains, blinds, flyscreens and windows',
};

export const TRADE_OPTIONS: ClassifierOption[] = TRADES.map((trade) => option(trade, TRADE_WORK[trade]));
