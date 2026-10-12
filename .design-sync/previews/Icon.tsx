import { Icon } from 'myest8-design-system';

export const AppIcons = () => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, color: 'var(--ink)' }}>
    <Icon name="squares-four" />
    <Icon name="calendar-dots" />
    <Icon name="wrench" />
    <Icon name="device-mobile" />
    <Icon name="share-network" />
    <Icon name="paper-plane-tilt" />
    <Icon name="file-xls" />
    <Icon name="warning-circle" />
  </div>
);

export const WithText = () => (
  <div style={{ display: 'grid', gap: 8, fontSize: 14 }}>
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--done)' }}>
      <Icon name="check-circle" weight="fill" /> Quote approved
    </span>
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--urgent)' }}>
      <Icon name="warning-circle" /> Water near a power point
    </span>
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--action)' }}>
      <Icon name="house" size="size-4" /> 14 Arden St, Coogee
    </span>
  </div>
);
