import { Stat, StatGroup } from 'myest8-design-system';

export const MonthSummary = () => (
  <div style={{ maxWidth: 760 }}>
    <StatGroup>
      <Stat label="Tickets this month" value={27} />
      <Stat label="Jobs done" value={19} tone="success" />
      <Stat label="Average days to fix" value="3.4" hint="Down from 4.1" />
      <Stat label="Urgent repairs" value={2} tone="error" />
    </StatGroup>
  </div>
);
