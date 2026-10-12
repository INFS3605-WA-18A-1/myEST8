import { Segmented } from 'myest8-design-system';

export const MineAll = () => (
  <div>
  <Segmented
    items={[
      { label: 'Mine', href: '#', active: true },
      { label: 'All', href: '#', active: false },
    ]}
  />
  </div>
);
