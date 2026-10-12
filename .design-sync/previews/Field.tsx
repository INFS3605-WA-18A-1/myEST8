import { Field } from 'myest8-design-system';

export const Text = () => (
  <div style={{ maxWidth: 360 }}>
    <Field label="Mobile" name="mobile" type="tel" placeholder="0412 345 678" hint="We text the Tenant from this number." />
  </div>
);

export const WithError = () => (
  <div style={{ maxWidth: 360 }}>
    <Field label="Business name" name="businessName" required value="" error="Enter the business name as it appears on their invoices." />
  </div>
);

export const Select = () => (
  <div style={{ maxWidth: 360 }}>
    <Field
      label="Trade"
      name="trade"
      type="select"
      placeholder="Choose a trade"
      value="plumber"
      options={[
        { value: 'plumber', label: 'Plumber' },
        { value: 'electrician', label: 'Electrician' },
        { value: 'handyman', label: 'Handyman' },
      ]}
    />
  </div>
);

export const Textarea = () => (
  <div style={{ maxWidth: 360 }}>
    <Field label="Reason for the Tenant" name="reason" type="textarea" rows={3} placeholder="Why this is rejected" />
  </div>
);

export const Checkbox = () => (
  <div style={{ maxWidth: 360 }}>
    <Field label="Ask the Property Owner before booking jobs over $500" name="ownerApproval" type="checkbox" checked />
  </div>
);
