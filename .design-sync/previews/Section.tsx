import { DetailsList, LinkButton, Section } from 'myest8-design-system';

export const Titled = () => (
  <div style={{ maxWidth: 560 }}>
    <Section title="Property" actions={<LinkButton href="#" size="sm">Edit</LinkButton>}>
      <DetailsList
        items={[
          ['Address', '14 Arden Street, Coogee NSW 2034'],
          ['Tenant', 'Priya Shah'],
          ['Property Owner', 'Marcus Lee'],
        ]}
      />
    </Section>
  </div>
);

export const Untitled = () => (
  <div style={{ maxWidth: 560 }}>
    <Section>
      <p style={{ margin: 0 }}>Tenants report repairs by text message. myEST8 gathers photos, asks your tradies for quotes and books the job once you approve.</p>
    </Section>
  </div>
);
