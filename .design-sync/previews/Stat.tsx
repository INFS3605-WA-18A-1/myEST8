import { Stat } from 'myest8-design-system';

export const Default = () => (
  <div style={{ maxWidth: 200 }}>
    <Stat label="Open Tickets" value={12} hint="3 opened this week" />
  </div>
);

export const Tones = () => (
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 180px)', gap: 8 }}>
    <Stat label="Urgent" value={2} tone="error" />
    <Stat label="Approved spend" value="$3,420.00" tone="success" />
    <Stat label="With Property Owner" value={4} tone="warning" />
  </div>
);
