import type { Clock } from '../ports.ts';

/** Real time plus an offset the demo can move forward, so reminders and deadlines can be shown without waiting. */
export class OffsetClock implements Clock {
  #offsetMs: number;

  /** Starts at `start` (and runs on from there in real time), or at the real time. */
  constructor(start?: Date) {
    this.#offsetMs = start ? start.getTime() - Date.now() : 0;
  }

  now() {
    return new Date(Date.now() + this.#offsetMs);
  }

  /** Moves the clock forward by `ms`. */
  advance(ms: number) {
    if (!Number.isFinite(ms) || ms < 0) throw new Error('The demo clock only moves forward');
    this.#offsetMs += ms;
  }
}
