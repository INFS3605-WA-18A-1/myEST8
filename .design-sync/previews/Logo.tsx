import { Logo } from 'myest8-design-system';

export const Sizes = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
    <Logo />
    <Logo size="sm" />
  </div>
);

export const OnTheRail = () => (
  <div style={{ background: 'var(--ink)', color: 'var(--rail-text)', padding: 16, width: 220 }}>
    <Logo />
  </div>
);
