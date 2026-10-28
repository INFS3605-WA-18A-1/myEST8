// Every message myEST8 sends. Each template is fixed text with placeholders. An
// SMS or WhatsApp message is this text. An email is written by Claude Haiku from
// the template's data, with this text as its draft, and is this text whenever no
// model is configured, the model fails, or its text drops or adds a fact
// (ADR 0011, src/composing.ts).

import { dollars, type Availability, type Trade, type Urgency } from './shared.ts';
import { formatVisit } from './zoned-time.ts';

export type GuidedQuestion = 'location' | 'started' | 'worsening' | 'availability';

interface AgencyInfo {
  name: string;
  timeZone: string;
}

interface Template<D> {
  subject: string;
  text: (data: D, agency: AgencyInfo) => string;
}

function template<D>(subject: string, text: (data: D, agency: AgencyInfo) => string): Template<D> {
  return { subject, text };
}

/** Each guided question as it is asked, with a hint at how to reply. */
const GUIDED_QUESTIONS: Record<GuidedQuestion, string> = {
  location: 'Where in the property is the issue?',
  started: 'When did it start?',
  worsening: 'Is it getting worse? (yes or no)',
  availability: 'When are you usually home: weekday mornings, weekday afternoons, Saturdays or any time?',
};

export const AVAILABILITY_LABELS: Record<Availability, string> = {
  weekday_mornings: 'weekday mornings',
  weekday_afternoons: 'weekday afternoons',
  saturdays: 'Saturdays',
  any_time: 'any time',
};

/** The same labels at the start of a line or on a choice: "Weekday mornings". */
export function availabilityChoice(value: Availability): string {
  const label = AVAILABILITY_LABELS[value];
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const trade = (t: Trade) => t.replace('_', ' ');
const visit = (at: string, agency: AgencyInfo) => formatVisit(at, agency.timeZone);
const titled = (value: string) => {
  const text = value.replaceAll('_', ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/** How long a booked visit is, in the words a Tradie's email uses. */
export function visitLengthLabel(start: string, end: string): string {
  const minutes = Math.round((Date.parse(end) - Date.parse(start)) / 60_000);
  if (minutes > 0 && minutes % (24 * 60) === 0) {
    const days = minutes / (24 * 60);
    return days === 1 ? '1 day' : `${days} days`;
  }
  if (minutes > 0 && minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? '1 hour' : `${hours} hours`;
  }
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

/** The Firm Quote's days, or 2 hours when the Job went ahead on an Estimate. */
export function quotedLengthLabel(durationDays: number | null): string {
  if (durationDays) return durationDays === 1 ? '1 day' : `${durationDays} days`;
  return '2 hours';
}

const kept = (rows: (string | false | null | undefined)[]) => rows.filter((row): row is string => !!row);
const blocks = (parts: (string | false | null | undefined)[]) => kept(parts).join('\n\n');

function offerDetails(d: { propertyAddress: string; length: string; availability: Availability; note?: string | null }) {
  return kept([
    `Address: ${d.propertyAddress}`,
    `Length: ${d.length}`,
    `Tenant usually home: ${availabilityChoice(d.availability)}`,
    d.note ? `Tenant's note: ${d.note}` : null,
  ]).join('\n');
}

function quoteRequestBody(
  d: { trade: Trade; urgency: Urgency; description: string; suburb: string; quoteLink: string },
  opening: string,
) {
  return blocks([
    opening,
    kept([`Trade: ${titled(d.trade)}`, `Suburb: ${d.suburb}`, `Urgency: ${titled(d.urgency)}`, `Issue: ${d.description}`]).join('\n'),
    `Give your quote: ${d.quoteLink}`,
    `Can't take this job: ${d.quoteLink}/decline`,
    'Or reply with a ballpark price and earliest time, or NO to decline.',
  ]);
}

function firmQuoteBody(
  d: { propertyAddress: string; issue: string; inspectedOn: string | null; quoteLink: string },
  agency: AgencyInfo,
  opening: string,
) {
  return blocks([
    opening,
    kept([
      `Address: ${d.propertyAddress}`,
      d.inspectedOn ? `Inspected on: ${visit(d.inspectedOn, agency)}` : null,
      `What's needed: ${d.issue}`,
    ]).join('\n'),
    `Give your Firm Quote: ${d.quoteLink}`,
  ]);
}

export const templates = {
  'tenant.acknowledgement': template<{ tenantName: string; propertyAddress: string }>(
    'We got your message',
    (d, a) => `Hi ${d.tenantName}, this is ${a.name}. Thanks for letting us know about an issue at ${d.propertyAddress}. We've got your message.`,
  ),
  // Only the questions the Tenant hasn't answered yet, in the usual order. Each line starts with its number so an email can lay them out as a list.
  'tenant.missing_details': template<{ tenantName: string; questions: GuidedQuestion[] }>('A few quick questions', (d) =>
    [`Thanks, ${d.tenantName}. To get this sorted we just need:`, ...d.questions.map((q, i) => `${i + 1}. ${GUIDED_QUESTIONS[q]}`)].join('\n'),
  ),
  'tenant.upload_link': template<{ uploadLink: string; alreadyHave?: number }>(
    'Please send photos',
    (d) =>
      d.alreadyHave
        ? `Thanks, we have your ${d.alreadyHave} photo${d.alreadyHave === 1 ? '' : 's'}. Add more here if it helps: ${d.uploadLink}`
        : `Thanks. Please upload a few photos of the issue here, straight from your phone: ${d.uploadLink}`,
  ),
  'tenant.urgent_repair_reminder': template<{
    limitCents: number;
    nominatedTradies: { businessName: string; phone: string }[];
    receiptLink: string;
  }>('Urgent repair: what to do now', (d) =>
    [
      'This sounds urgent. You can arrange the repair yourself straight away and claim up to ' +
        `${dollars(d.limitCents)} back from the property owner.`,
      d.nominatedTradies.length
        ? `Please use one of the property's nominated tradies where possible: ${d.nominatedTradies.map((t) => `${t.businessName} ${t.phone}`).join(', ')}.`
        : '',
      `When it's done, send us the receipt (a photo or PDF) here, and we'll pass your Reimbursement Request to the property owner: ${d.receiptLink}`,
    ]
      .filter(Boolean)
      .join(' '),
  ),
  'tenant.common_area_passed_on': template<{ buildingManagerName: string }>(
    'Passed to the building manager',
    (d) => `Thanks. This is a common area issue, so we've passed it to the building manager, ${d.buildingManagerName}, who looks after it with the strata.`,
  ),
  'tenant.confirmed': template<{ trackerLink: string }>(
    'Your repair is confirmed',
    (d) => `Your maintenance request is confirmed. Follow its progress here: ${d.trackerLink}`,
  ),
  'tenant.rejected': template<{ reason: string }>(
    'About your maintenance request',
    (d) => `We won't be going ahead with your maintenance request. Reason: ${d.reason}`,
  ),
  'tenant.choose_visit_time': template<{ tradieBusinessName: string; trade: Trade; choices: { label: string; url: string }[] }>(
    'Choose a visit time',
    (d) => [`${d.tradieBusinessName} (${trade(d.trade)}) can visit. Pick a time.`, ...d.choices.map((c) => `${c.label}: ${c.url}`)].join('\n\n'),
  ),
  'tenant.pick_visit_time_reminder': template<{ choices: { label: string; url: string }[] }>(
    'Reminder: choose a visit time',
    (d) => [`Reminder: please pick a visit time.`, ...d.choices.map((c) => `${c.label}: ${c.url}`)].join('\n\n'),
  ),
  'tenant.say_when_home': template<{ whenHomeLink: string }>(
    'Other visit times',
    (d) => `Thanks. We'll ask the tradie for other times.\n\nSay when you're home: ${d.whenHomeLink}`,
  ),
  'tenant.visit_time': template<{ visitStart: string; trade: Trade; tradieBusinessName: string; confirmLink: string; anotherTimeLink: string }>(
    'Repair visit booked',
    (d, a) =>
      `${d.tradieBusinessName} (${trade(d.trade)}) will visit on ${visit(d.visitStart, a)}.\n\nConfirm this time: ${d.confirmLink}\n\nNeed another time?: ${d.anotherTimeLink}`,
  ),
  'tenant.visit_booked': template<{ visitStart: string; anotherTimeLink: string }>(
    'Repair visit booked',
    (d, a) => `Booked for ${visit(d.visitStart, a)}.\n\nNeed another time?: ${d.anotherTimeLink}`,
  ),
  'tenant.visit_moved': template<{ visitStart: string; tradieBusinessName: string; confirmLink: string; anotherTimeLink: string }>(
    'Repair visit moved',
    (d, a) =>
      `Your visit from ${d.tradieBusinessName} has moved to ${visit(d.visitStart, a)}.\n\nConfirm this time: ${d.confirmLink}\n\nNeed another time?: ${d.anotherTimeLink}`,
  ),
  'tenant.inspection': template<{ tradieBusinessName: string; trade: Trade; visitStart: string; confirmLink: string; anotherTimeLink: string }>(
    'A tradie is coming to inspect',
    (d, a) =>
      `Before we fix it, ${d.tradieBusinessName} (${trade(d.trade)}) will come to inspect the issue so they can give a firm price: ${visit(d.visitStart, a)}.\n\n` +
      `Confirm this time: ${d.confirmLink}\n\nNeed another time?: ${d.anotherTimeLink}`,
  ),
  'tenant.inspection_cancelled': template<{ tradieBusinessName: string; visitStart: string }>(
    'Inspection cancelled',
    (d, a) => `${d.tradieBusinessName} won't be coming to inspect on ${visit(d.visitStart, a)}: that visit is cancelled, so you don't need to be home for it. We'll let you know when the repair is booked.`,
  ),
  'tenant.fixed_properly': template<{ trade: Trade; tradieBusinessName: string }>(
    'Was it fixed properly?',
    (d) => `${d.tradieBusinessName} has finished the ${trade(d.trade)} job. Was it fixed properly? Reply with a number from 1 (not at all) to 5 (perfectly).`,
  ),
  'tenant.reimbursed': template<{ propertyAddress: string; amountCents: number | null }>(
    'Reimbursement Request paid',
    (d) =>
      `Good news: the property owner has reimbursed you${d.amountCents === null ? '' : ` ${dollars(d.amountCents)}`} for the urgent repair at ${d.propertyAddress}. ` +
      "If the money hasn't reached you in a few days, reply to this message.",
  ),
  'tenant.ticket_closed': template<{ propertyAddress: string }>(
    'Repair complete',
    (d) => `The repair at ${d.propertyAddress} is complete and we've closed it. Thanks for your patience.`,
  ),
  // The Property Manager's own message, checked and sent as it stands: the body is the text, whoever or whatever drafted it.
  'tenant.follow_up': template<{ text: string }>('About your maintenance request', (d) => d.text),

  'tradie.quote_request': template<{ trade: Trade; urgency: Urgency; description: string; suburb: string; quoteLink: string }>(
    'Quote request',
    (d, a) =>
      quoteRequestBody(
        d,
        `${a.name} is asking for a quote. Give your Estimate (a ballpark from the description and photos), and say if you need to inspect before your Firm Quote.`,
      ),
  ),
  'tradie.quote_reminder': template<{ trade: Trade; urgency: Urgency; description: string; suburb: string; quoteLink: string }>(
    'Reminder: quote request',
    (d, a) => quoteRequestBody(d, `Reminder from ${a.name}: please give an Estimate for this job.`),
  ),
  'tradie.not_chosen': template<{ trade: Trade; suburb: string; inspectionStart?: string }>(
    'Quote not chosen',
    (d, a) =>
      `Thanks for quoting for the ${trade(d.trade)} job in ${d.suburb}. ${a.name} has gone with another quote this time.` +
      (d.inspectionStart ? ` Your Site Inspection on ${visit(d.inspectionStart, a)} is cancelled, so please don't go.` : ''),
  ),
  'tradie.offer_times': template<{ trade: Trade; propertyAddress: string; quoteLink: string; length: string; availability: Availability }>(
    'Offer visit times',
    (d, a) => blocks([`${a.name} has approved your quote for the ${trade(d.trade)} job.`, offerDetails(d), `Offer visit times: ${d.quoteLink}`]),
  ),
  'tradie.offer_times_reminder': template<{ trade: Trade; propertyAddress: string; quoteLink: string; length: string; availability: Availability }>(
    'Reminder: offer visit times',
    (d, a) => blocks([`Reminder from ${a.name}: please offer visit times for the ${trade(d.trade)} job.`, offerDetails(d), `Offer visit times: ${d.quoteLink}`]),
  ),
  'tradie.offer_new_times': template<{ trade: Trade; propertyAddress: string; quoteLink: string; length: string; availability: Availability }>(
    'Offer new visit times',
    (d) =>
      blocks([
        `The visit for the ${trade(d.trade)} job needs a new time. The current visit stays booked until they pick one.`,
        offerDetails(d),
        `Offer visit times: ${d.quoteLink}`,
      ]),
  ),
  'tradie.offer_times_again': template<{
    trade: Trade;
    propertyAddress: string;
    quoteLink: string;
    length: string;
    availability: Availability;
    note: string | null;
  }>(
    'Offer visit times again',
    (d) => blocks([`The Tenant can't make the times you offered for the ${trade(d.trade)} job.`, offerDetails(d), `Offer visit times: ${d.quoteLink}`]),
  ),
  'tradie.work_order': template<{
    propertyAddress: string;
    description: string;
    trade: Trade;
    visitStart: string;
    visitEnd: string;
    /** What was approved: the Firm Quote's price, or the Not-to-exceed Cap on an Estimate proceeded on. */
    approvedCents: number;
    stage: 'estimate' | 'firm';
    tenantName: string;
    tenantContact: string;
    quoteLink: string;
  }>(
    'Work order',
    (d, a) => {
      const approved =
        d.stage === 'estimate'
          ? `Approved on your Estimate: not to exceed ${dollars(d.approvedCents)}.`
          : `Approved: your Firm Quote of ${dollars(d.approvedCents)}.`;
      return blocks([
        `Work order from ${a.name}. ${d.description}. ${approved}`,
        kept([
          `Address: ${d.propertyAddress}`,
          `When: ${visit(d.visitStart, a)}`,
          `Length: ${visitLengthLabel(d.visitStart, d.visitEnd)}`,
          `Tenant: ${d.tenantName}`,
          `Tenant contact: ${d.tenantContact}`,
        ]).join('\n'),
        d.quoteLink ? `View job: ${d.quoteLink}` : null,
        d.quoteLink ? `Mark job done: ${d.quoteLink}/done` : null,
        d.quoteLink ? `Need another time?: ${d.quoteLink}/another` : null,
      ]);
    },
  ),
  'tradie.done_too_early': template<{ propertyAddress: string; visitStart: string; inspection: boolean }>(
    'Not done yet',
    (d, a) =>
      `Thanks. Your ${d.inspection ? 'Site Inspection' : 'visit'} at ${d.propertyAddress} is booked for ${visit(d.visitStart, a)}, so ${a.name} can't mark it done yet. ` +
      `Reply DONE after the visit${d.inspection ? ' and we will ask for your Firm Quote' : ''}, or tell us if you need another time.`,
  ),
  'tradie.visit_moved': template<{ propertyAddress: string; visitStart: string; wasStart: string; quoteLink: string }>(
    'Visit moved',
    (d, a) =>
      blocks([
        'Your visit has moved.',
        kept([`Address: ${d.propertyAddress}`, `Was: ${visit(d.wasStart, a)}`, `Now: ${visit(d.visitStart, a)}`]).join('\n'),
        d.quoteLink ? `View job: ${d.quoteLink}` : null,
        d.quoteLink ? `Need another time?: ${d.quoteLink}/another` : null,
      ]),
  ),

  'tradie.inspection': template<{
    propertyAddress: string;
    trade: Trade;
    summary: string;
    visitStart: string;
    visitEnd: string;
    tenantContact: string;
    quoteLink: string;
  }>(
    'Site Inspection booked',
    (d, a) =>
      blocks([
        `Site Inspection for ${a.name}: ${d.summary}.`,
        kept([`Address: ${d.propertyAddress}`, `When: ${visit(d.visitStart, a)}`, `Tenant contact: ${d.tenantContact}`]).join('\n'),
        d.quoteLink ? `View inspection: ${d.quoteLink}` : null,
        d.quoteLink ? `Mark inspection done: ${d.quoteLink}/inspection-done` : null,
        d.quoteLink ? `Need another time?: ${d.quoteLink}/inspection-another` : null,
      ]),
  ),
  'tradie.firm_quote_request': template<{ trade: Trade; suburb: string; propertyAddress: string; quoteLink: string; issue: string; inspectedOn: string | null }>(
    'Your Firm Quote',
    (d, a) =>
      firmQuoteBody(
        d,
        a,
        `Thanks for inspecting the ${trade(d.trade)} job. Please give ${a.name} your Firm Quote: your fixed price, the scope of work, how long it takes and the dates you can start.`,
      ),
  ),
  'tradie.firm_quote_reminder': template<{ trade: Trade; suburb: string; propertyAddress: string; quoteLink: string; issue: string; inspectedOn: string | null }>(
    'Reminder: your Firm Quote',
    (d, a) => firmQuoteBody(d, a, `Reminder from ${a.name}: please give your Firm Quote for the ${trade(d.trade)} job.`),
  ),
  'tradie.firm_quote_link': template<{ trade: Trade; suburb: string; propertyAddress: string; quoteLink: string; issue: string; inspectedOn: string | null }>(
    'Give your Firm Quote',
    (d, a) =>
      firmQuoteBody(
        d,
        a,
        `Thanks. ${a.name} already has your Estimate for the ${trade(d.trade)} job in ${d.suburb}. A Firm Quote needs your fixed price, the scope of work, how long it takes and the dates you can start.`,
      ),
  ),

  'owner.approval_request': template<{
    propertyAddress: string;
    trade: Trade;
    tradieBusinessName: string;
    quotePriceCents: number;
    repairCostCents: number;
    maxRepairCostCents: number;
  }>(
    'Approval needed',
    (d) =>
      `Approval needed for ${d.propertyAddress}: ${trade(d.trade)} quote from ${d.tradieBusinessName} for ${dollars(d.quotePriceCents)}. ` +
      `This brings the repair cost to ${dollars(d.repairCostCents)}, over the property's Max Repair Cost of ${dollars(d.maxRepairCostCents)}. Reply YES to approve or NO to decline.`,
  ),
  'owner.approval_reminder': template<{ propertyAddress: string; trade: Trade; quotePriceCents: number }>(
    'Reminder: approval needed',
    (d) => `Reminder: we need your approval for the ${trade(d.trade)} quote of ${dollars(d.quotePriceCents)} at ${d.propertyAddress}. Reply YES or NO.`,
  ),
  'owner.work_booked': template<{ propertyAddress: string; trade: Trade; visitStart: string }>(
    'Repair booked',
    (d, a) => `A ${trade(d.trade)} repair at ${d.propertyAddress} is booked for ${visit(d.visitStart, a)}.`,
  ),
  'owner.work_moved': template<{ propertyAddress: string; trade: Trade; visitStart: string }>(
    'Repair visit moved',
    (d, a) => `The ${trade(d.trade)} repair at ${d.propertyAddress} has moved to ${visit(d.visitStart, a)}.`,
  ),
  'owner.ticket_closed': template<{ propertyAddress: string; description: string }>(
    'Repair complete',
    (d) => `The repair at ${d.propertyAddress} (${d.description}) is complete.`,
  ),
  'owner.urgent_repair_receipt': template<{ propertyAddress: string; tenantName: string; description: string; amountCents: number; limitCents: number }>(
    'Reimbursement Request for an urgent repair',
    (d) =>
      `${d.tenantName} arranged an urgent repair at ${d.propertyAddress} (${d.description}) and asks to be reimbursed ${dollars(d.amountCents)}. ` +
      'The receipt is attached, and we have checked it. Please organise the reimbursement to the tenant and let us know when it is paid. ' +
      `Tenants can claim up to ${dollars(d.limitCents)} for urgent repairs.`,
  ),

  'building_manager.common_area_issue': template<{ propertyAddress: string; tenantName: string; message: string }>(
    'Common area issue',
    (d, a) => `${a.name} here. ${d.tenantName}, a tenant at ${d.propertyAddress}, reported a common area issue: "${d.message}"`,
  ),

  'onboarding.test_message': template<Record<string, never>>(
    'Test message',
    (_, a) => `This is a test message from ${a.name} on myEST8. This channel is working.`,
  ),

  'onboarding.verification_code': template<{ code: string }>(
    'Your myEST8 code',
    (d, a) => `${a.name}: your myEST8 code is ${d.code}. It expires in 10 minutes.`,
  ),
};

export type TemplateName = keyof typeof templates;
export type TemplateData<K extends TemplateName> = Parameters<(typeof templates)[K]['text']>[0];
