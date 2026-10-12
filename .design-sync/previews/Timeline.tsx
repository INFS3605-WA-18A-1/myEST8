import { Timeline } from 'myest8-design-system';

export const TicketHistory = () => (
  <div style={{ maxWidth: 480 }}>
    <Timeline
      items={[
        { at: 'Mon 12 Oct, 9:14 am', title: 'Priya Shah reported a leak', detail: 'Hot water system leaking from the base.' },
        { at: 'Mon 12 Oct, 9:20 am', title: 'Photos received', detail: '4 photos from the Tenant' },
        { at: 'Mon 12 Oct, 10:02 am', title: 'Quotes requested from 3 plumbers' },
        { at: 'Tue 13 Oct, 8:45 am', title: "Jim's Plumbing quoted $480.00" },
      ]}
    />
  </div>
);
