import { Steps } from 'myest8-design-system';

const tracker = [
  { label: 'Reported', done: true, detail: 'Mon 12 Oct' },
  { label: 'Photos received', done: true },
  { label: 'Getting quotes', done: false },
  { label: 'Booked', done: false },
  { label: 'Fixed', done: false },
];

export const TenantTracker = () => (
  <div style={{ maxWidth: 360 }}>
    <Steps items={tracker} vertical />
  </div>
);

export const SetupWizard = () => (
  <div style={{ maxWidth: 640 }}>
    <Steps
      horizontal
      current={1}
      items={[
        { label: 'Agency', done: true, href: '#' },
        { label: 'Properties', done: false },
        { label: 'Tradies', done: false },
        { label: 'Go live', done: false },
      ]}
    />
  </div>
);
