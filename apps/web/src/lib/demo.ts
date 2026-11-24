export type Person = { id: string; name: string; initials: string; color: string; online?: boolean };
export type Conversation = { id: string; name: string; description: string; person?: Person; private?: boolean };
export type Message = { id: string; author: Person; text: string; time: string; attachments?: string[] };

export function conversationLabel(conversation: Conversation) {
  return conversation.person ? conversation.name : "#" + conversation.name;
}

export const profile: Person = { id: "you", name: "Alex Morgan", initials: "AM", color: "violet", online: true };

export const people: Person[] = [
  { id: "maya", name: "Maya Patel", initials: "MP", color: "coral", online: true },
  { id: "arjun", name: "Arjun Mehta", initials: "AM", color: "mint", online: true },
  { id: "nina", name: "Nina Rao", initials: "NR", color: "gold" },
  { id: "leo", name: "Leo Fernandes", initials: "LF", color: "violet" },
];

export const channels: Conversation[] = [
  { id: "general", name: "general", description: "The place for team-wide updates, introductions, and everyday conversations." },
  { id: "announcements", name: "announcements", description: "Company news and important updates." },
  { id: "engineering", name: "engineering", description: "Technical discussions and engineering updates." },
  { id: "design", name: "design", description: "Design reviews, ideas, and work in progress." },
  { id: "social", name: "social", description: "A space to share what’s happening outside work." },
];

export function directMessage(person: Person): Conversation {
  return { id: person.id, name: person.name, description: "A direct conversation with " + person.name + ".", person };
}

export const initialMessages: Record<string, Message[]> = {
  general: [
    { id: "welcome", author: people[0], time: "10:24 AM", text: "Hey team! 👋 Welcome to SkillConnect. Introduce yourself here and tell us what you’re working on this week." },
    { id: "intro", author: people[1], time: "10:31 AM", text: "Excited to have everyone in one place! I’m starting with the onboarding checklist." },
  ],
  announcements: [{ id: "update", author: people[0], time: "9:15 AM", text: "Our next team demo is on Friday. Bring something you’d like to share!" }],
  maya: [{ id: "hello", author: people[0], time: "11:00 AM", text: "Hey Alex! Let me know if you need a hand getting set up." }],
};

export const setupTasks = {
  channel: "Set up your first channel",
  invite: "Invite teammates",
  message: "Send your first message",
  profile: "Complete your profile",
};

export type Task = keyof typeof setupTasks;
export type Panel = "channel" | "invite" | "dm" | "apps" | "calendar" | "drive" | "profile" | "handbook" | "welcome" | "files" | "workspace" | "details" | "notifications" | "call";
