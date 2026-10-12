import { EmptyState, LinkButton, Section } from 'myest8-design-system';

export const WithAction = () => (
  <div style={{ maxWidth: 520 }}>
    <Section title="Properties">
      <EmptyState text="No Properties yet. Add one to start taking repair requests." action={<LinkButton href="#" variant="primary">Add a Property</LinkButton>} />
    </Section>
  </div>
);

export const TextOnly = () => (
  <div style={{ maxWidth: 520 }}>
    <Section title="Needs your decision">
      <EmptyState text="Nothing needs you right now." />
    </Section>
  </div>
);
