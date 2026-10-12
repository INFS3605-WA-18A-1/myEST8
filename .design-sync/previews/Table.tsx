import { Table, StatusBadge } from 'myest8-design-system';

export const Quotes = () => (
  <div style={{ maxWidth: 640 }}>
    <Table
      caption="Quotes for Ticket #1042"
      headers={['Tradie', 'Status', 'Available', 'Amount']}
      align={['left', 'left', 'left', 'right']}
      rows={[
        ["Jim's Plumbing", <StatusBadge status="quoted" />, 'Tue 13 Oct', '$480.00'],
        ['Coogee Plumbing Co', <StatusBadge status="quoted" />, 'Wed 14 Oct', '$615.00'],
        ['Eastern Suburbs Hot Water', <StatusBadge status="requested" />, '—', '—'],
      ]}
    />
  </div>
);

export const Properties = () => (
  <div style={{ maxWidth: 640 }}>
    <Table
      caption="Properties"
      headers={['Address', 'Tenant', 'Open Tickets']}
      align={['left', 'left', 'right']}
      rows={[
        ['14 Arden St, Coogee', 'Priya Shah', 2],
        ['3/22 Brook St, Coogee', 'Tom Nguyen', 1],
        ['8 Dudley St, Randwick', 'Alice Martin', 0],
      ]}
    />
  </div>
);
