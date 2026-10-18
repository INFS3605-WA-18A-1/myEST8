// Every message myEST8 sends. Each template is fixed text with placeholders;
// nothing here is written by a model.

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

const GUIDED_QUESTIONS: Record<GuidedQuestion, string> = {
  location: 'Where in the property is the issue?',
  started: 'When did it start?',
  worsening: 'Is it getting worse? Reply YES or NO.',
  availability:
    'When are you usually home? Reply 1 for weekday mornings, 2 for weekday afternoons, 3 for Saturdays or 4 for any time.',
};

export const AVAILABILITY_LABELS: Record<Availability, string> = {
  weekday_mornings: 'weekday mornings',
  weekday_afternoons: 'weekday afternoons',
  saturdays: 'Saturdays',
  any_time: 'any time',
};

const trade = (t: Trade) => t.replace('_', ' ');
const visit = (at: string, agency: AgencyInfo) => formatVisit(at, agency.timeZone);

export const templates = {
  'tenant.acknowledgement': template<{ tenantName: string; propertyAddress: string }>(
    'We got your message',
    (d, a) => `Hi ${d.tenantName}, this is ${a.name}. Thanks for letting us know about an issue at ${d.propertyAddress}. We've got your message.`,
  ),
  'tenant.guided_question': template<{ question: GuidedQuestion }>('A quick question', (d) => GUIDED_QUESTIONS[d.question]),
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
  'tenant.visit_time': template<{ visitStart: string; trade: Trade; tradieBusinessName: string }>(
    'Repair visit booked',
    (d, a) => `${d.tradieBusinessName} (${trade(d.trade)}) will visit on ${visit(d.visitStart, a)}. Reply YES to confirm or tell us if you need another time.`,
  ),
  'tenant.visit_moved': template<{ visitStart: string; tradieBusinessName: string }>(
    'Repair visit moved',
    (d, a) => `Your visit from ${d.tradieBusinessName} has moved to ${visit(d.visitStart, a)}. Reply YES to confirm or tell us if you need another time.`,
  ),
  'tenant.inspection': template<{ tradieBusinessName: string; trade: Trade; visitStart: string }>(
    'A tradie is coming to inspect',
    (d, a) =>
      `Before we fix it, ${d.tradieBusinessName} (${trade(d.trade)}) will come to inspect the issue so they can give a firm price: ${visit(d.visitStart, a)}. ` +
      'Reply YES if that time works, or tell us if you need another time.',
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

  'tradie.quote_request': template<{ trade: Trade; urgency: Urgency; description: string; suburb: string; quoteLink: string }>(
    'Quote request',
    (d, a) =>
      `${a.name} is asking for a quote: ${trade(d.trade)} job in ${d.suburb} (${d.urgency}). Issue: ${d.description}. ` +
      `Give your Estimate (a ballpark from the description and photos) here, and say if you need to inspect before your Firm Quote (your fixed price): ${d.quoteLink} ` +
      'Or reply with a ballpark price and earliest time, or NO to decline.',
  ),
  'tradie.quote_reminder': template<{ trade: Trade; suburb: string; quoteLink: string }>(
    'Reminder: quote request',
    (d, a) =>
      `Reminder from ${a.name}: can you give an Estimate for the ${trade(d.trade)} job in ${d.suburb}? ${d.quoteLink} ` +
      'Or reply with a ballpark price and earliest time, or NO to decline.',
  ),
  'tradie.not_chosen': template<{ trade: Trade; suburb: string }>(
    'Quote not chosen',
    (d, a) => `Thanks for quoting for the ${trade(d.trade)} job in ${d.suburb}. ${a.name} has gone with another quote this time.`,
  ),
  'tradie.work_order': template<{ propertyAddress: string; description: string; trade: Trade; visitStart: string; visitEnd: string }>(
    'Work order',
    (d, a) => `Work order from ${a.name}: ${trade(d.trade)} at ${d.propertyAddress}, ${visit(d.visitStart, a)}. Issue: ${d.description}. Reply DONE when finished, or tell us if you need another time.`,
  ),
  'tradie.done_too_early': template<{ propertyAddress: string; visitStart: string; inspection: boolean }>(
    'Not done yet',
    (d, a) =>
      `Thanks. Your ${d.inspection ? 'Site Inspection' : 'visit'} at ${d.propertyAddress} is booked for ${visit(d.visitStart, a)}, so ${a.name} can't mark it done yet. ` +
      `Reply DONE after the visit${d.inspection ? ' and we will ask for your Firm Quote' : ''}, or tell us if you need another time.`,
  ),
  'tradie.visit_moved': template<{ propertyAddress: string; visitStart: string }>(
    'Visit moved',
    (d, a) => `Your visit to ${d.propertyAddress} has moved to ${visit(d.visitStart, a)}.`,
  ),

  'tradie.inspection': template<{ propertyAddress: string; trade: Trade; summary: string; visitStart: string; visitEnd: string }>(
    'Site Inspection booked',
    (d, a) =>
      `Site Inspection for ${a.name}: ${trade(d.trade)} at ${d.propertyAddress}, ${visit(d.visitStart, a)}. Issue: ${d.summary}. ` +
      'Reply DONE after your visit and we will ask for your Firm Quote, or tell us if you need another time.',
  ),
  'tradie.firm_quote_request': template<{ trade: Trade; suburb: string; propertyAddress: string; quoteLink: string }>(
    'Your Firm Quote',
    (d, a) =>
      `Thanks for inspecting the ${trade(d.trade)} job at ${d.propertyAddress}. Please give ${a.name} your Firm Quote: ` +
      `your fixed price, the scope of work, how long it takes and the dates you can start: ${d.quoteLink}`,
  ),
  'tradie.firm_quote_reminder': template<{ trade: Trade; suburb: string; propertyAddress: string; quoteLink: string }>(
    'Reminder: your Firm Quote',
    (d, a) => `Reminder from ${a.name}: after your Site Inspection at ${d.propertyAddress}, please give your Firm Quote for the ${trade(d.trade)} job: ${d.quoteLink}`,
  ),
  'tradie.firm_quote_link': template<{ trade: Trade; suburb: string; propertyAddress: string; quoteLink: string }>(
    'Give your Firm Quote',
    (d, a) =>
      `Thanks. ${a.name} already has your Estimate for the ${trade(d.trade)} job in ${d.suburb}. ` +
      `A Firm Quote needs your fixed price, the scope of work, how long it takes and the dates you can start, so please give it here: ${d.quoteLink}`,
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
