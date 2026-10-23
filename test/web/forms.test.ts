import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { ProviderRefusedError, UndeliverableError } from '../../src/ports.ts';
import { formAction } from '../../src/web/forms.ts';

/** A one-route app whose only action throws `error`. */
function appThrowing(error: Error) {
  const app = new Hono();
  app.post('/go', (c) =>
    formAction(c, '/back', () => {
      throw error;
    }),
  );
  return app;
}

const post = (app: Hono) => app.request('/go', { method: 'POST', body: new URLSearchParams({}) });

describe('formAction: messages that cannot be delivered', () => {
  test('an UndeliverableError is a refusal: back with an error flash giving the reason', async () => {
    const res = await post(appThrowing(new UndeliverableError('sms', '+61400', 'no such number', "that number isn't a mobile")));

    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location')!, 'https://x.test');
    expect(location.pathname).toBe('/back');
    expect(location.searchParams.get('error')).toBe("Couldn't send the message: that number isn't a mobile.");
  });

  test('a ProviderRefusedError is a refusal too', async () => {
    const res = await post(appThrowing(new ProviderRefusedError('403 from provider', 'the SMS service refused it')));

    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location')!, 'https://x.test');
    expect(location.searchParams.get('error')).toBe("Couldn't send the message: the SMS service refused it.");
  });

  test('any other error still throws', async () => {
    const res = await post(appThrowing(new Error('boom')));

    expect(res.status).toBe(500);
  });
});
