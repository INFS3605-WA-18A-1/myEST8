import { Alert } from 'myest8-design-system';

export const Tones = () => (
  <div style={{ display: 'grid', gap: 12, maxWidth: 520 }}>
    <Alert>The Tenant can upload up to 10 photos from this link.</Alert>
    <Alert tone="success">Quote approved. Jim's Plumbing has been asked to book a time.</Alert>
    <Alert tone="warning">This quote is over the $500 limit, so the Property Owner must approve it.</Alert>
    <Alert tone="error">This link has expired. Ask your Property Manager for a new one.</Alert>
  </div>
);

export const WithTitle = () => (
  <div style={{ maxWidth: 520 }}>
    <Alert tone="warning" title="Check before confirming">
      The photos show water near a power point. Consider marking this Urgent.
    </Alert>
  </div>
);
