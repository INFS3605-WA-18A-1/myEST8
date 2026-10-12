import { Tabs } from 'myest8-design-system';

export const WithCounts = () => (
  <div>
  <Tabs
    items={[
      { label: 'Open', href: '#', active: true, count: 12 },
      { label: 'Booked', href: '#', active: false, count: 7 },
      { label: 'Done', href: '#', active: false },
    ]}
  />
  </div>
);
