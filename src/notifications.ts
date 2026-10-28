import { mustIncludeIn, NEVER_COMPOSED, problemWith, PURPOSES, untrustedFieldsOf } from './composing.ts';
import type { Context } from './context.ts';
import { renderEmail } from './email-layout.ts';
import { UndeliverableError, type ChannelType, type RecipientRole } from './ports.ts';
import type { Person } from './profiles.ts';
import { HOUR_MS, invalid, type Role } from './shared.ts';
import { templates, type TemplateData, type TemplateName } from './templates.ts';

/** WhatsApp only allows free-form messages inside this window after the person's last message. */
const REPLY_WINDOW_MS = 24 * HOUR_MS;

/** Who a message is for, in the composer's words: the app's `owner` is the Property Owner. */
const RECIPIENT_ROLES: Record<Role, RecipientRole> = {
  tenant: 'tenant',
  tradie: 'tradie',
  owner: 'property_owner',
  building_manager: 'building_manager',
};

export interface SendOptions {
  /** The issue (and so the Ticket) to log the message against. */
  issueId?: number | null;
  attachmentFileIds?: number[];
  /** Send by email when the person has an email address. */
  preferEmail?: boolean;
  /** Copy a Property Manager in: by cc on email, otherwise by a separate email. */
  copyPropertyManagerId?: number;
}

/** The only module that sends messages. Chooses the channel, sends, and logs against the issue or Ticket. */
export function createNotifications({ clock, ports, files, modules }: Context) {
  /** Whether the person's Agency has this channel connected: a message can only go out on one it has. */
  async function connected(person: Person, channelType: ChannelType) {
    return (await modules.profiles.channelAddress(person.agencyId, channelType)) !== null;
  }

  async function route(person: Person, preferEmail = false): Promise<{ channelType: ChannelType; to: string }> {
    if (preferEmail && person.email && (await connected(person, 'email'))) return { channelType: 'email', to: person.email };
    const last = person.lastInbound;
    if (last && clock.now().getTime() - new Date(last.at).getTime() < REPLY_WINDOW_MS && (await connected(person, last.channelType))) {
      return { channelType: last.channelType, to: last.address };
    }
    if (person.mobile && (await connected(person, 'sms'))) return { channelType: 'sms', to: person.mobile };
    if (person.email && (await connected(person, 'email'))) return { channelType: 'email', to: person.email };
    if (!person.mobile && !person.email) throw new Error(`${person.name} has no mobile number or email address`);
    // A mobile or email address here is one whose channel the Agency hasn't connected.
    const why = [
      person.mobile ? 'no SMS channel is connected' : 'they have no mobile number',
      person.email ? 'no email channel is connected' : 'they have no email address',
    ].join(' and ');
    throw new UndeliverableError(
      person.mobile ? 'sms' : 'email',
      (person.mobile ?? person.email)!,
      `can't reach ${person.businessName ?? person.name}: ${why}`,
      why,
    );
  }

  /**
   * The email body to send: the composer's text when it keeps every button line, link, amount,
   * time, phone number and reply instruction of the template's text and adds none, otherwise
   * the template's text. A text turned down, or a composer that fails, is logged in one line
   * that quotes neither text.
   */
  async function emailText<K extends TemplateName>(name: K, data: TemplateData<K>, draft: string, agencyName: string, recipientRole: RecipientRole) {
    const { emailComposer } = ports;
    if (!emailComposer || NEVER_COMPOSED.has(name)) return { text: draft, composed: false };
    const mustInclude = mustIncludeIn(draft, data);
    let problem: string | null;
    let text = '';
    try {
      text = (
        await emailComposer.compose({
          template: name,
          purpose: PURPOSES[name],
          recipientRole,
          channel: 'email',
          agencyName,
          facts: data,
          untrustedFields: untrustedFieldsOf(data),
          draft,
          mustInclude,
        })
      ).text.trim();
      problem = problemWith(text, draft, mustInclude);
    } catch {
      problem = 'the composer failed';
    }
    if (!problem) return { text, composed: true };
    console.error(`Sent ${name} as its template's text: ${problem}`);
    return { text: draft, composed: false };
  }

  /** Sends one message and returns the text sent, and whether the composer wrote it. Only an email is composed. */
  async function deliver<K extends TemplateName>(
    agencyId: number,
    channelType: ChannelType,
    recipientRole: RecipientRole,
    to: string,
    cc: string[],
    name: K,
    data: TemplateData<K>,
    attachmentFileIds: number[],
  ) {
    const { profiles } = modules;
    const agency = await profiles.agency(agencyId);
    const from = await profiles.channelAddress(agencyId, channelType);
    if (!from) throw new Error(`${agency.name} has no ${channelType} channel connected`);
    const template = templates[name] as { subject: string; text: (d: TemplateData<K>, a: typeof agency) => string };
    const draft = template.text(data, agency);
    const { text, composed } = channelType === 'email' ? await emailText(name, data, draft, agency.name, recipientRole) : { text: draft, composed: false };
    await ports.messenger.send({
      channelType,
      from,
      to,
      cc,
      subject: template.subject,
      text,
      ...(channelType === 'email' ? { html: renderEmail({ agencyName: agency.name, subject: template.subject, text }) } : {}),
      template: name,
      data,
      attachments: await Promise.all(attachmentFileIds.map((id) => files.get(id))),
    });
    return { text, composed };
  }

  async function sendToPropertyManager<K extends TemplateName>(
    propertyManagerId: number,
    name: K,
    data: TemplateData<K>,
    options: SendOptions = {},
  ) {
    const pm = await modules.profiles.propertyManager(propertyManagerId);
    const { text, composed } = await deliver(pm.agencyId, 'email', 'property_manager', pm.email, [], name, data, options.attachmentFileIds ?? []);
    await modules.tickets.logMessage({
      agencyId: pm.agencyId,
      direction: 'out',
      personId: null,
      channelType: 'email',
      address: pm.email,
      template: name,
      text,
      composed,
      issueId: options.issueId ?? null,
      fileIds: options.attachmentFileIds ?? [],
    });
  }

  return {
    /** The channel the next message to this person would use. Throws an `UndeliverableError` when none of the Agency's channels reaches them. */
    async channelFor(personId: number): Promise<ChannelType> {
      return (await route(await modules.profiles.person(personId))).channelType;
    },

    async send<K extends TemplateName>(personId: number, name: K, data: TemplateData<K>, options: SendOptions = {}) {
      const person = await modules.profiles.person(personId);
      const { channelType, to } = await route(person, options.preferEmail);
      const pm = options.copyPropertyManagerId ? await modules.profiles.propertyManager(options.copyPropertyManagerId) : null;
      const cc = pm && channelType === 'email' ? [pm.email] : [];
      const fileIds = options.attachmentFileIds ?? [];
      const { text, composed } = await deliver(person.agencyId, channelType, RECIPIENT_ROLES[person.role], to, cc, name, data, fileIds);
      await modules.tickets.logMessage({
        agencyId: person.agencyId,
        direction: 'out',
        personId,
        channelType,
        address: to,
        template: name,
        text,
        composed,
        issueId: options.issueId ?? null,
        fileIds,
      });
      if (pm && !cc.length) await sendToPropertyManager(pm.id, name, data, options);
    },

    sendToPropertyManager,

    /** Sends the onboarding test message on one of the Agency's channels. */
    async sendTest(agencyId: number, channelType: ChannelType, to: string) {
      if (!(await modules.profiles.channelAddress(agencyId, channelType))) invalid(`Connect the ${channelType} channel first`);
      await deliver(agencyId, channelType, 'property_manager', to, [], 'onboarding.test_message', {}, []);
    },

    /**
     * Texts or emails a one-time code. Unlike every other send, the Agency need
     * not have this channel connected yet: the code is how they prove the address.
     * The code is not written to the message log.
     */
    async sendVerificationCode(agencyId: number, channelType: ChannelType, to: string, code: string) {
      const { profiles } = modules;
      const agency = await profiles.agency(agencyId);
      const from = (await profiles.channelAddress(agencyId, channelType)) ?? 'myEST8';
      const template = templates['onboarding.verification_code'];
      const text = template.text({ code }, agency);
      await ports.messenger.send({
        channelType,
        from,
        to,
        cc: [],
        subject: template.subject,
        text,
        ...(channelType === 'email' ? { html: renderEmail({ agencyName: agency.name, subject: template.subject, text }) } : {}),
        template: 'onboarding.verification_code',
        data: { code },
        attachments: [],
      });
    },
  };
}

export type Notifications = ReturnType<typeof createNotifications>;
