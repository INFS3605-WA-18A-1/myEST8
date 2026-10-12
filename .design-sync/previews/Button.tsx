import { Button } from 'myest8-design-system';

export const Variants = () => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
    <Button type="button">Approve quote</Button>
    <Button type="button" variant="secondary">Ask for another quote</Button>
    <Button type="button" variant="danger">Cancel job</Button>
    <Button type="button" variant="ghost">Not now</Button>
  </div>
);

export const Small = () => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
    <Button type="button" size="sm">Confirm</Button>
    <Button type="button" size="sm" variant="secondary">Review</Button>
  </div>
);

export const Disabled = () => (
  <Button type="button" disabled>
    Send to Property Owner
  </Button>
);

export const BlockOnPhone = () => (
  <div style={{ maxWidth: 360 }}>
    <Button block>Send photos</Button>
  </div>
);
