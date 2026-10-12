import { PostButton } from 'myest8-design-system';

export const OneClickActions = () => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
    <PostButton action="/requests/88/confirm" size="sm">Confirm</PostButton>
    <PostButton action="/requests/88/reject" size="sm" variant="secondary">Reject</PostButton>
  </div>
);

export const WithConfirm = () => (
  <PostButton action="/jobs/311/cancel" variant="danger" confirm="Cancel this Job? The tradie will be told.">
    Cancel job
  </PostButton>
);
