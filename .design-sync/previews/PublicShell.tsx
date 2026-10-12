import { Button, Field, PublicShell, Steps } from 'myest8-design-system';

export const TenantTracker = () => (
  <PublicShell title="Your repair at 14 Arden St" subtitle="Hot water system leaking from the base">
    <Steps
      vertical
      items={[
        { label: 'Reported', done: true, detail: 'Mon 12 Oct' },
        { label: 'Photos received', done: true },
        { label: 'Getting quotes', done: false },
        { label: 'Booked', done: false },
        { label: 'Fixed', done: false },
      ]}
    />
  </PublicShell>
);

export const SignIn = () => (
  <PublicShell title="Sign in" width="narrow" footer="myEST8 for Property Managers">
    <Field label="Email" name="email" type="email" autocomplete="email" />
    <Field label="Password" name="password" type="password" autocomplete="current-password" />
    <Button block>Sign in</Button>
  </PublicShell>
);
