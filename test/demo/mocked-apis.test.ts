import { describe, expect, test } from 'vitest';
import { MOCKED_APIS } from '../e2e/support/server.ts';

describe('browser-test API env', () => {
  test('blanks every env var that would call a real provider', () => {
    expect(MOCKED_APIS).toEqual({
      JEV_API_URL: '',
      ANTHROPIC_API_KEY: '',
      VISION_API_URL: '',
      QUOTES_API_URL: '',
      GOOGLE_MAPS_API_KEY: '',
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
      META_WHATSAPP_PHONE_NUMBER_ID: '',
      META_WHATSAPP_ACCESS_TOKEN: '',
      META_WHATSAPP_NUMBER: '',
      META_APP_SECRET: '',
      META_WEBHOOK_VERIFY_TOKEN: '',
      TWILIO_ACCOUNT_SID: '',
      TWILIO_AUTH_TOKEN: '',
      TWILIO_SMS_FROM: '',
      TWILIO_WHATSAPP_FROM: '',
      SENDGRID_API_KEY: '',
      RESEND_API_KEY: '',
    });
  });
});
