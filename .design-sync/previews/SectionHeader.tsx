import { LinkButton, SectionHeader } from 'myest8-design-system';

export const WithAction = () => (
  <div style={{ maxWidth: 560 }}>
    <SectionHeader title="Needs your decision" actions={<LinkButton href="#" size="sm" variant="ghost">View all</LinkButton>} />
  </div>
);
