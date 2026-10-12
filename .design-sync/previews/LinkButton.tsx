import { LinkButton } from 'myest8-design-system';

export const Default = () => <LinkButton href="#">Open Ticket</LinkButton>;

export const Variants = () => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
    <LinkButton href="#" variant="primary">Add a Property</LinkButton>
    <LinkButton href="#">Back to dashboard</LinkButton>
    <LinkButton href="#" variant="ghost">View all requests</LinkButton>
  </div>
);

export const Small = () => (
  <LinkButton href="#" size="sm">
    Download spreadsheet
  </LinkButton>
);
