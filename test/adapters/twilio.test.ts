import { describe, expect, test } from 'vitest';
import { twilioToInbound, verifyTwilioSignature } from '../../src/adapters/twilio.ts';

const receivedAt = new Date('2026-10-08T09:00:00+11:00');

describe('Twilio messaging webhook', () => {
  test('an SMS becomes an inbound message', () => {
    const message = twilioToInbound(
      {
        ToCountry: 'AU',
        SmsMessageSid: 'SM0a1b2c3d4e5f60718293a4b5c6d7e8f9',
        NumMedia: '0',
        SmsSid: 'SM0a1b2c3d4e5f60718293a4b5c6d7e8f9',
        SmsStatus: 'received',
        Body: 'The kitchen tap is dripping',
        To: '+61290000000',
        NumSegments: '1',
        MessageSid: 'SM0a1b2c3d4e5f60718293a4b5c6d7e8f9',
        AccountSid: 'AC00000000000000000000000000000000',
        From: '+61400000001',
        ApiVersion: '2010-04-01',
      },
      receivedAt,
    );

    expect(message).toEqual({
      providerMessageId: 'SM0a1b2c3d4e5f60718293a4b5c6d7e8f9',
      agencyChannel: '+61290000000',
      channelType: 'sms',
      from: '+61400000001',
      text: 'The kitchen tap is dripping',
      attachments: [],
      receivedAt,
    });
  });

  test('a WhatsApp message with two photos becomes an inbound message with attachments to download', () => {
    const message = twilioToInbound(
      {
        SmsMessageSid: 'MM11112222333344445555666677778888',
        NumMedia: '2',
        ProfileName: 'Tom',
        MessageType: 'image',
        WaId: '61400000001',
        Body: '',
        To: 'whatsapp:+61290000000',
        From: 'whatsapp:+61400000001',
        MediaContentType0: 'image/jpeg',
        MediaUrl0: 'https://api.twilio.com/2010-04-01/Accounts/AC0/Messages/MM1/Media/ME0',
        MediaContentType1: 'application/pdf',
        MediaUrl1: 'https://api.twilio.com/2010-04-01/Accounts/AC0/Messages/MM1/Media/ME1',
        AccountSid: 'AC00000000000000000000000000000000',
        ApiVersion: '2010-04-01',
      },
      receivedAt,
    );

    expect(message).toEqual({
      providerMessageId: 'MM11112222333344445555666677778888',
      agencyChannel: '+61290000000',
      channelType: 'whatsapp',
      from: '+61400000001',
      text: '',
      attachments: [
        { filename: 'media-0.jpg', contentType: 'image/jpeg', url: 'https://api.twilio.com/2010-04-01/Accounts/AC0/Messages/MM1/Media/ME0' },
        { filename: 'media-1.pdf', contentType: 'application/pdf', url: 'https://api.twilio.com/2010-04-01/Accounts/AC0/Messages/MM1/Media/ME1' },
      ],
      receivedAt,
    });
  });
});

describe('Twilio request signature', () => {
  // Twilio's documented example.
  const url = 'https://mycompany.com/myapp.php?foo=1&bar=2';
  const params = { CallSid: 'CA1234567890ABCDE', Caller: '+12349013030', Digits: '1234', From: '+12349013030', To: '+18005551212' };

  test('a request signed with the auth token is accepted', () => {
    expect(verifyTwilioSignature('12345', url, params, '0/KCTR6DLpKmkAf8muzZqo1nDgQ=')).toBe(true);
  });

  test('a tampered, missing or wrongly signed request is refused', () => {
    expect(verifyTwilioSignature('12345', url, { ...params, Digits: '9999' }, '0/KCTR6DLpKmkAf8muzZqo1nDgQ=')).toBe(false);
    expect(verifyTwilioSignature('54321', url, params, '0/KCTR6DLpKmkAf8muzZqo1nDgQ=')).toBe(false);
    expect(verifyTwilioSignature('12345', url, params, '')).toBe(false);
  });
});
