import { DetailsList, UrgencyBadge } from 'myest8-design-system';

export const TicketFacts = () => (
  <div style={{ maxWidth: 520 }}>
    <DetailsList
      items={[
        ['Property', '14 Arden Street, Coogee NSW 2034'],
        ['Tenant', 'Priya Shah, 0412 345 678'],
        ['Urgency', <UrgencyBadge urgency="urgent" />],
        ['Reported', 'Mon 12 Oct, 9:14 am'],
        ['Spend limit', '$500.00 without the Property Owner'],
      ]}
    />
  </div>
);
