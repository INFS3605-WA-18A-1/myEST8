import { describe, expect, test } from 'vitest';
import {
  buildingManagerRead,
  ownerRead,
  tenantRead,
  tradieRead,
  type OwnerApproval,
  type TenantRequest,
  type TradieSignals,
} from '../src/profile-reads.ts';

const request = (over: Partial<TenantRequest> = {}): TenantRequest => ({
  issueId: 1,
  propertyId: 10,
  trade: 'plumbing',
  summary: 'Kitchen tap',
  description: 'The kitchen tap is dripping',
  urgency: 'routine',
  status: 'confirmed',
  ...over,
});

const quiet: TradieSignals = { jobsDone: 0, openJobs: 0, quotesSent: 0, quotesChosen: 0, turnaroundDays: [], visits: 0, rescheduledVisits: 0 };

describe('a Tenant read', () => {
  test('no requests is no history', () => {
    expect(tenantRead([], new Map())).toBeNull();
  });

  test('frequent and mostly minor', () => {
    const requests = [1, 2, 3, 4, 5, 6].map((issueId) => request({ issueId, summary: `Issue ${issueId}` }));
    const judgments = new Map(requests.map((item) => [item.issueId, { minor: item.issueId <= 4 ? 0.9 : 0.2, tenantCaused: 0.1 }]));
    const read = tenantRead(requests, judgments);
    expect(read).toMatchObject({
      sentence: 'Reports often, mostly small things',
      ai: true,
      chips: [{ text: '4 of 6 requests in the last year were minor', tone: 'concern' }],
    });
  });

  test('two possibly caused repairs are named as may, never as a finding', () => {
    const requests = [1, 2].map((issueId) => request({ issueId, summary: issueId === 1 ? 'Broken door' : 'Cracked tile' }));
    const judgments = new Map([
      [1, { minor: 0.2, tenantCaused: 0.9 }],
      [2, { minor: 0.2, tenantCaused: 0.7 }],
    ]);
    const read = tenantRead(requests, judgments)!;
    expect(read.sentence).toBe('Several repairs may have been caused by the Tenant');
    expect(read.chips.map((chip) => chip.text).join(' ')).toContain('2 repairs possibly caused by the Tenant');
    expect(read.sentence).not.toMatch(/caused the|is at fault|negligent/);
  });

  test('few genuine requests', () => {
    const read = tenantRead([request({ status: 'confirmed' })], new Map([[1, { minor: 0.2, tenantCaused: 0.1 }]]))!;
    expect(read.sentence).toBe("Reports rarely, and it's usually real");
    expect(read.chips).toContainEqual({ text: '0 of 1 request in the last year were minor', tone: 'good' });
  });

  test('few, none rejected, but mostly minor is a reliable reporter', () => {
    const read = tenantRead([request()], new Map([[1, { minor: 0.9, tenantCaused: 0.05 }]]))!;
    expect(read.sentence).toBe('Reliable reporter, few requests');
  });

  test('a rejected request and an urgent repair are chips, and a repeat names the issue', () => {
    const requests = [
      request({ issueId: 1, status: 'rejected' }),
      request({ issueId: 2, status: 'confirmed' }),
      request({ issueId: 3, status: 'urgent', urgency: 'urgent' }),
    ];
    const read = tenantRead(requests, new Map())!;
    expect(read.ai).toBe(false);
    expect(read.sentence).toBe('A steady run of requests');
    expect(read.chips).toEqual([
      { text: '1 request rejected', tone: 'concern' },
      { text: 'Same issue reported 3 times (Kitchen tap)', tone: 'concern' },
      { text: '1 urgent repair', tone: 'concern' },
    ]);
  });

  test('without judgments the read stays on the counts', () => {
    const read = tenantRead([request(), request({ issueId: 2, summary: 'Other tap' })], new Map())!;
    expect(read).toMatchObject({ sentence: "Reports rarely, and it's usually real", ai: false, chips: [] });
  });
});

describe('a Property Owner read', () => {
  const approval = (over: Partial<OwnerApproval>): OwnerApproval => ({ status: 'approved', requestedAt: '2026-10-01T00:00:00.000Z', answeredAt: '2026-10-01T05:00:00.000Z', ...over });

  test('nothing decided and nothing waiting is no history', () => {
    expect(ownerRead([])).toBeNull();
    expect(ownerRead([approval({ status: 'cancelled', answeredAt: null })])).toBeNull();
  });

  test('a reply inside two days, and no declines, is quick to approve', () => {
    const read = ownerRead([approval({}), approval({ status: 'requested', answeredAt: null })])!;
    expect(read).toMatchObject({
      sentence: 'Quick to approve',
      ai: false,
      chips: [
        { text: '1 approval waiting', tone: 'concern' },
        { text: 'Typical reply in 5 hours', tone: 'good' },
        { text: 'No Quotes declined', tone: 'good' },
      ],
    });
  });

  test('two declines become the sentence', () => {
    const read = ownerRead([
      approval({ status: 'declined', answeredAt: '2026-10-10T00:00:00.000Z' }),
      approval({ status: 'declined', answeredAt: '2026-10-20T00:00:00.000Z' }),
    ])!;
    expect(read.sentence).toBe('Often declines a Quote');
    expect(read.chips).toContainEqual({ text: '2 Quotes declined', tone: 'concern' });
  });
});

describe('a Building Manager read', () => {
  test('no Common Area issues is no history, and response time is not invented', () => {
    expect(buildingManagerRead({ commonAreaIssues: 0 })).toBeNull();
  });

  test('issues passed on are the whole read', () => {
    expect(buildingManagerRead({ commonAreaIssues: 2 })).toEqual({
      sentence: 'Looks after the Common Areas',
      chips: [{ text: '2 Common Area issues passed on', tone: 'neutral' }],
      ai: false,
    });
    expect(buildingManagerRead({ commonAreaIssues: 5 })!.sentence).toBe('Often told about Common Area issues');
  });
});

describe('a Tradie read', () => {
  test('no work is no history', () => {
    expect(tradieRead(quiet)).toBeNull();
  });

  test('a high win rate and no rescheduled visit', () => {
    const read = tradieRead({ ...quiet, quotesSent: 5, quotesChosen: 4, visits: 3, jobsDone: 2, turnaroundDays: [1] })!;
    expect(read.sentence).toBe('Wins most quotes, rarely misses a visit');
    expect(read.ai).toBe(false);
    expect(read.chips).toContainEqual({ text: 'Chosen for 4 of 5 Quotes', tone: 'good' });
    expect(read.chips).toContainEqual({ text: 'No visits rescheduled', tone: 'good' });
    expect(read.chips).toContainEqual({ text: 'Typical quote in 1 day', tone: 'good' });
  });

  test('a reschedule is said as a reschedule, and a low win rate is its own sentence', () => {
    const read = tradieRead({ ...quiet, quotesSent: 5, quotesChosen: 1, visits: 2, rescheduledVisits: 1, jobsDone: 1 })!;
    expect(read.sentence).toBe('Quotes often, and is chosen less often');
    expect(read.chips).toContainEqual({ text: '1 visit rescheduled', tone: 'concern' });
    expect(read.chips).toContainEqual({ text: '1 Job done', tone: 'good' });
  });
});
