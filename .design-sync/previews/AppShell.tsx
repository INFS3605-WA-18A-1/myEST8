import { AppShell, CountStrip, Docket, Lane, Segmented, StatusBadge } from 'myest8-design-system';

export const Dashboard = () => (
  <AppShell
    title="Dashboard"
    pm={{ name: 'Sam Carter' }}
    active="dashboard"
    agencyName="Coogee Bay Realty"
    today="Sat 10 Oct"
    navCounts={{ requests: 3, approvals: 2 }}
    controls={
      <Segmented
        items={[
          { label: 'Mine', href: '#', active: true },
          { label: 'All', href: '#', active: false },
        ]}
      />
    }
    flash={{ kind: 'ok', message: 'Quote approved and sent to the tradie.' }}
  >
    <CountStrip
      items={[
        { label: 'Requests to confirm', count: 3, href: '#' },
        { label: 'Quotes to approve', count: 2, href: '#' },
        { label: 'Quoting', count: 2, href: '#' },
        { label: 'Booked', count: 1, href: '#' },
      ]}
    />
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
      <Lane title="Quoting" count={2}>
        <Docket number={1042} href="#" urgency="urgent" address="14 Arden St, Coogee" street="14 Arden St" issue="Hot water system leaking from the base" meta={['Plumber', '2 Quotes', '3 hours ago']} unread={1} />
        <Docket number={1037} href="#" urgency="high" address="3/22 Brook St, Coogee" street="3/22 Brook St" issue="Oven won't heat past 100 degrees" meta={['Electrician', '1 day ago']} />
      </Lane>
      <Lane title="Booked" count={1}>
        <Docket number={1021} href="#" urgency="routine" address="8 Dudley St, Randwick" street="8 Dudley St" issue="Bedroom door sticks against the frame" meta={[<StatusBadge status="scheduled" job />, 'Wed 14 Oct']} />
      </Lane>
    </div>
  </AppShell>
);
