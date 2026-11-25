import { channels, directMessage, initialMessages, people, profile } from "../demo.ts";
import { messageTime, type Message, type Person } from "./models.ts";

export const demoWorkspace = {
  initial() {
    return {
      conversations: [...channels, ...people.slice(0, 3).map(directMessage)],
      messages: Object.fromEntries(Object.entries(initialMessages).map(([id, messages]) => [id, [...messages]])),
      profile,
    };
  },
  home: channels[0],
  teammates: people,
  directMessage,
  send(id: string, author: Person, text: string, attachments: string[]): Message {
    return { id, author, text, attachments, time: messageTime() };
  },
};
