import { Docket, EmptyState, Lane } from 'myest8-design-system';

export const WithDockets = () => (
  <div style={{ maxWidth: 360 }}>
    <Lane title="Quoting" count={2}>
      <Docket number={1042} href="#" urgency="urgent" address="14 Arden St, Coogee" street="14 Arden St" issue="Hot water system leaking from the base" meta={['Plumber', '2 Quotes']} />
      <Docket number={1037} href="#" urgency="high" address="3/22 Brook St, Coogee" street="3/22 Brook St" issue="Oven won't heat past 100 degrees" meta={['Electrician', '1 day ago']} />
    </Lane>
  </div>
);

export const Empty = () => (
  <div style={{ maxWidth: 360 }}>
    <Lane title="Booked" count={0}>
      <EmptyState text="No Jobs booked yet." />
    </Lane>
  </div>
);
