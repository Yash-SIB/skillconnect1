export type Person = { id: string; name: string; initials: string; color: string; online?: boolean };
export type Conversation = { id: string; name: string; description: string; person?: Person; private?: boolean };
export type Message = { id: string; author: Person; text: string; time: string; attachments?: string[] };

export const setupTasks = {
  channel: "Set up your first channel",
  invite: "Invite teammates",
  message: "Send your first message",
  profile: "Complete your profile",
};

export type Task = keyof typeof setupTasks;
export type Panel = "channel" | "invite" | "dm" | "apps" | "calendar" | "drive" | "profile" | "handbook" | "welcome" | "files" | "workspace" | "details" | "notifications" | "call";

export function conversationLabel(conversation: Conversation) {
  return conversation.person ? conversation.name : "#" + conversation.name;
}

export function messageTime(date = new Date()) {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
