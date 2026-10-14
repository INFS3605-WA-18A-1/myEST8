import type { Context } from './context.ts';
import type { ChannelType } from './ports.ts';
import type { Person } from './profiles.ts';
import { HOUR_MS, invalid } from './shared.ts';
import { templates, type TemplateData, type TemplateName } from './templates.ts';

/** WhatsApp only allows free-form messages inside this window after the person's last message. */
const REPLY_WINDOW_MS = 24 * HOUR_MS;

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
  function route(person: Person, preferEmail = false): { channelType: ChannelType; to: string } {
    if (preferEmail && person.email) return { channelType: 'email', to: person.email };
    const last = person.lastInbound;
    if (last && clock.now().getTime() - new Date(last.at).getTime() < REPLY_WINDOW_MS) {
      return { channelType: last.channelType, to: last.address };
    }
    if (person.mobile) return { channelType: 'sms', to: person.mobile };
    if (person.email) return { channelType: 'email', to: person.email };
    throw new Error(`${person.name} has no mobile number or email address`);
  }

  async function deliver<K extends TemplateName>(
    agencyId: number,
    channelType: ChannelType,
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
    const text = template.text(data, agency);
    await ports.messenger.send({
      agencyId,
      channelType,
      from,
      to,
      cc,
      subject: template.subject,
      text,
      template: name,
      data,
      attachments: await Promise.all(attachmentFileIds.map((id) => files.get(id))),
    });
    return text;
  }

  async function sendToPropertyManager<K extends TemplateName>(
    propertyManagerId: number,
    name: K,
    data: TemplateData<K>,
    options: SendOptions = {},
  ) {
    const pm = await modules.profiles.propertyManager(propertyManagerId);
    const text = await deliver(pm.agencyId, 'email', pm.email, [], name, data, options.attachmentFileIds ?? []);
    await modules.tickets.logMessage({
      agencyId: pm.agencyId,
      direction: 'out',
      personId: null,
      channelType: 'email',
      address: pm.email,
      template: name,
      text,
      issueId: options.issueId ?? null,
      fileIds: options.attachmentFileIds ?? [],
    });
  }

  return {
    /** The channel the next message to this person would use. */
    async channelFor(personId: number): Promise<ChannelType> {
      return route(await modules.profiles.person(personId)).channelType;
    },

    async send<K extends TemplateName>(personId: number, name: K, data: TemplateData<K>, options: SendOptions = {}) {
      const person = await modules.profiles.person(personId);
      const { channelType, to } = route(person, options.preferEmail);
      const pm = options.copyPropertyManagerId ? await modules.profiles.propertyManager(options.copyPropertyManagerId) : null;
      const cc = pm && channelType === 'email' ? [pm.email] : [];
      const fileIds = options.attachmentFileIds ?? [];
      const text = await deliver(person.agencyId, channelType, to, cc, name, data, fileIds);
      await modules.tickets.logMessage({
        agencyId: person.agencyId,
        direction: 'out',
        personId,
        channelType,
        address: to,
        template: name,
        text,
        issueId: options.issueId ?? null,
        fileIds,
      });
      if (pm && !cc.length) await sendToPropertyManager(pm.id, name, data, options);
    },

    sendToPropertyManager,

    /** Sends the onboarding test message on one of the Agency's channels. */
    async sendTest(agencyId: number, channelType: ChannelType, to: string) {
      if (!(await modules.profiles.channelAddress(agencyId, channelType))) invalid(`Connect the ${channelType} channel first`);
      await deliver(agencyId, channelType, to, [], 'onboarding.test_message', {}, []);
    },
  };
}

export type Notifications = ReturnType<typeof createNotifications>;
