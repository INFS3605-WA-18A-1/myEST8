import { ChatBubble } from 'myest8-design-system';

export const Conversation = () => (
  <div style={{ maxWidth: 520 }}>
    <ChatBubble side="start" header="Priya Shah, 9:14 am" text={'Hi, the hot water system is leaking from the bottom.\nThere is water all over the laundry floor.'} />
    <ChatBubble side="end" header="myEST8, 9:15 am" text="Thanks Priya. Please reply with a few photos of the leak and the tank." footer="Delivered" />
    <ChatBubble side="start" header="Priya Shah, 9:20 am" text="Done, sent 4 photos." />
  </div>
);

export const Tones = () => (
  <div style={{ maxWidth: 520 }}>
    <ChatBubble side="end" tone="success" header="myEST8, Tue 8:50 am" text="Jim's Plumbing will come Wednesday between 8 and 10 am." />
    <ChatBubble side="end" tone="error" header="myEST8, Tue 9:02 am" text="This message couldn't be delivered." footer="Failed" />
  </div>
);
