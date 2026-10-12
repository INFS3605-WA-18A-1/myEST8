import { FlashMessage } from 'myest8-design-system';

export const Ok = () => (
  <div style={{ maxWidth: 520 }}>
    <FlashMessage kind="ok" message="Request confirmed and sent to three plumbers." />
  </div>
);

export const Error = () => (
  <div style={{ maxWidth: 520 }}>
    <FlashMessage kind="error" message="That quote has already been approved." />
  </div>
);
