import { describe, expect, test } from 'vitest';
import { createDemo } from '../src/demo/runtime.ts';
import { closeAfter, demoEnv } from './support/db.ts';

const csv = (text: string) => ({ filename: 'from-our-old-system.csv', contentType: 'text/csv', content: new TextEncoder().encode(text) });

describe('the demo import, with the mock classifier', () => {
  test('a messy Tradie sheet gets its columns and Trades filled in, and unclear ones flagged', async () => {
    const d = await createDemo({ now: new Date('2026-10-08T09:00:00+11:00'), env: demoEnv() });
    closeAfter(d);
    const alice = await d.app.asPropertyManager(d.seed.ids.aliceId);

    const { token } = await alice.importSheet(
      'tradies',
      csv(
        [
          'Supplier,Who,Contact No.,Remarks,Ref',
          'Bright Sparks,Ben Bright,0412 600 001,Switchboards and lights,T-101',
          'Kool Air Co,Kim,0412 600 002,,T-102',
          'Acme Group,Al,0412 600 003,Ask for Al,T-103',
        ].join('\n'),
      ),
    );

    const preview = await alice.importPreview(token);
    expect(preview.columns.map((c) => [c.header, c.field, c.by])).toEqual([
      ['Supplier', 'businessName', 'header'],
      ['Who', null, 'unsure'],
      ['Contact No.', 'mobile', 'ai'],
      ['Remarks', 'notes', 'ai'],
      ['Ref', null, 'ai'],
    ]);
    const [bright, kool, acme] = preview.rows;
    expect(bright).toMatchObject({ status: 'ready', values: { trades: 'electrical', mobile: '+61412600001' }, filled: { trades: { by: 'ai' } } });
    expect(kool).toMatchObject({ status: 'ready', values: { trades: 'appliances' } });
    expect(acme).toMatchObject({ status: 'needs_fix' });
    expect(acme!.problems.trades).toBe("The AI isn't sure. Its guess: General handyman.");
  });
});
