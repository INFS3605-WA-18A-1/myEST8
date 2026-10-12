import { Button, QueueRow, StatusBadge, UrgencyBadge } from 'myest8-design-system';

const thumb = (
  <img
    alt=""
    src={'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" fill="#dedcd4"/></svg>')}
  />
);

export const Decision = () => (
  <div style={{ maxWidth: 640 }}>
    <QueueRow
      decision
      href="#"
      thumb={thumb}
      title="Leaking hot water system"
      detail="14 Arden St, Coogee"
      badges={[<UrgencyBadge urgency="urgent" />, <StatusBadge status="maintenance_request" />]}
      meta="Reported 2 hours ago by Priya Shah"
      actions={
        <>
          <Button type="button" size="sm" variant="secondary">Review</Button>
          <Button type="button" size="sm">Confirm</Button>
        </>
      }
    />
  </div>
);

export const Quiet = () => (
  <div style={{ maxWidth: 640 }}>
    <QueueRow title="Quote from Jim's Plumbing" detail="$480.00 for Ticket #1042" badges={[<StatusBadge status="quoted" />]} meta="Received Tue 13 Oct, 8:45 am" />
  </div>
);
