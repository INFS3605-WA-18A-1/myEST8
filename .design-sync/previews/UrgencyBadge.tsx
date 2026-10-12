import { UrgencyBadge } from 'myest8-design-system';

export const Levels = () => (
  <div style={{ display: 'flex', gap: 8 }}>
    <UrgencyBadge urgency="urgent" />
    <UrgencyBadge urgency="high" />
    <UrgencyBadge urgency="routine" />
  </div>
);
