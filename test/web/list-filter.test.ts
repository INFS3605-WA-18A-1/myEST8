import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { listFilterOf, listFilterQuery } from '../../src/web/list-filter.ts';

const read = async (query: string) => {
  const app = new Hono();
  app.get('/', (c) => c.json(listFilterOf(c)));
  return (await app.request(`/${query}`)).json();
};

describe('list filter', () => {
  it('reads Mine/All, Urgency, Trade and Property from the query', async () => {
    expect(await read('')).toEqual({ scope: 'mine' });
    expect(await read('?filter=all&urgency=high&trade=plumbing&property=12')).toEqual({ scope: 'all', urgency: 'high', trade: 'plumbing', propertyId: 12 });
  });

  it('drops values it does not know, so a stale link shows the whole list', async () => {
    expect(await read('?urgency=soon&trade=welding&property=0&filter=yes')).toEqual({ scope: 'mine' });
  });

  it('writes the same filter back as a query string', () => {
    expect(listFilterQuery({ scope: 'mine' })).toBe('');
    expect(listFilterQuery({ scope: 'all', urgency: 'routine', propertyId: 3 })).toBe('?filter=all&urgency=routine&property=3');
  });
});
