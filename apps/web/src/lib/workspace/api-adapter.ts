import { createMessagingClient } from "../api/client.ts";
import type { ApiConversation, ApiMember, ApiMessage, ChannelVisibility, HistoryQuery, SendMessageRequest } from "../api/models.ts";
import type { Conversation, Message, Person } from "./models.ts";

type CreateConversation = { kind: "channel"; name: string; visibility: ChannelVisibility } | { kind: "dm"; peer_id: string };

export function displayMember(member: ApiMember): Person {
  const initials = member.display_name.trim().split(/\s+/).slice(0, 2).map((word) => Array.from(word)[0]).join("").toUpperCase();
  return { id: member.id, name: member.display_name, initials: initials || "?", color: "violet" };
}

function unknownPerson(id: string, name: string): Person {
  return { id, name, initials: "?", color: "violet" };
}

export function displayConversation(item: ApiConversation, members?: ReadonlyMap<string, Person>): Conversation {
  if (item.kind === "channel") {
    return { id: item.id, name: item.name, description: "", private: item.visibility === "private" };
  }
  const person = members?.get(item.peer_id) ?? unknownPerson(item.peer_id, "Direct message");
  return { id: item.id, name: person.name, description: "", person };
}

export function displayMessage(item: ApiMessage, members: ReadonlyMap<string, Person>): Message {
  return {
    id: item.id,
    author: members.get(item.sender_id) ?? unknownPerson(item.sender_id, "Unavailable member"),
    text: item.body,
    time: new Date(item.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
  };
}

export function createApiWorkspace(workspaceId: string, client = createMessagingClient()) {
  return {
    conversations: (signal?: AbortSignal) => client.listConversations(workspaceId, signal),
    createConversation: (input: CreateConversation, signal?: AbortSignal) => client.createConversation({ ...input, workspace_id: workspaceId }, signal),
    async members(id: string, signal?: AbortSignal) {
      return (await client.listMembers(id, signal)).map(displayMember);
    },
    history: (id: string, query?: HistoryQuery, signal?: AbortSignal) => client.listMessages(id, query, signal),
    send: (id: string, input: SendMessageRequest, signal?: AbortSignal) => client.sendMessage(id, input, signal),
  };
}
