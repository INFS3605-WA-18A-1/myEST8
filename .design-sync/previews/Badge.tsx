import { Badge, StatusBadge, UrgencyBadge } from 'myest8-design-system';

export const Tones = () => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
    <Badge>Note</Badge>
    <Badge tone="info">Quoting</Badge>
    <Badge tone="success">Approved</Badge>
    <Badge tone="warning">Awaiting photos</Badge>
    <Badge tone="error">Declined</Badge>
  </div>
);

export const InARow = () => (
  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
    <UrgencyBadge urgency="high" />
    <StatusBadge status="awaiting_owner" />
    <Badge>Plumber</Badge>
  </div>
);
