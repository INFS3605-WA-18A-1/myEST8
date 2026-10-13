import { CountStrip } from 'myest8-design-system';

export const Dashboard = () => (
  <div>
  <CountStrip
    items={[
      { label: 'Requests to confirm', count: 3, href: '#' },
      { label: 'Quotes to approve', count: 2, href: '#' },
      { label: 'Quoting', count: 5, href: '#' },
      { label: 'With Property Owner', count: 1, href: '#' },
      { label: 'Booked', count: 7, href: '#' },
    ]}
  />
  </div>
);
