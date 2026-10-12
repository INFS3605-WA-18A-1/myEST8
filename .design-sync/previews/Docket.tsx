import { Docket, StatusBadge } from 'myest8-design-system';

export const Urgent = () => (
  <div style={{ maxWidth: 420 }}>
    <Docket
      number={1042}
      href="#"
      urgency="urgent"
      address="14 Arden Street, Coogee NSW 2034"
      street="14 Arden St"
      issue="Hot water system leaking from the base; water pooling in the laundry"
      meta={['Plumber', '2 Quotes', '3 hours ago']}
      unread={2}
    />
  </div>
);

export const High = () => (
  <div style={{ maxWidth: 420 }}>
    <Docket
      number={1037}
      href="#"
      urgency="high"
      address="3/22 Brook Street, Coogee NSW 2034"
      street="3/22 Brook St"
      issue="Oven won't heat past 100 degrees"
      meta={[<StatusBadge status="awaiting_owner" />, 'Electrician', '1 day ago']}
    />
  </div>
);

export const Routine = () => (
  <div style={{ maxWidth: 420 }}>
    <Docket
      number={1021}
      href="#"
      urgency="routine"
      address="8 Dudley Street, Randwick NSW 2031"
      street="8 Dudley St"
      issue="Bedroom door sticks against the frame and won't latch"
      meta={['Handyman', '4 days ago']}
    />
  </div>
);

export const TicketHeader = () => (
  <Docket
    number={1042}
    size="large"
    urgency="urgent"
    address="14 Arden Street, Coogee NSW 2034"
    issue="Hot water system leaking from the base; water pooling in the laundry"
    meta={[<StatusBadge status="quoting" job />, 'Reported by Priya Shah', 'Mon 12 Oct, 9:14 am']}
  />
);
