export interface GmailMessagePayload {
  id: string;
  threadId: string;
  labelIds: string[];
  internalDate: string;
  payload: { mimeType: string; headers: { name: string; value: string }[]; body: { data?: string } };
}
