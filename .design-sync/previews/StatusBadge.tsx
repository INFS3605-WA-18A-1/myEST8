import { StatusBadge } from 'myest8-design-system';

export const JobStages = () => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
    <StatusBadge status="quoting" job />
    <StatusBadge status="awaiting_owner" job />
    <StatusBadge status="approved" job />
    <StatusBadge status="scheduled" job />
    <StatusBadge status="done" job />
    <StatusBadge status="cancelled" job />
  </div>
);

export const RequestsAndQuotes = () => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
    <StatusBadge status="awaiting_photos" />
    <StatusBadge status="maintenance_request" />
    <StatusBadge status="quoted" />
    <StatusBadge status="approved" />
    <StatusBadge status="declined_by_owner" />
    <StatusBadge status="not_chosen" />
  </div>
);
