import type { ApiMessage } from "./models.ts";

type ConversationEvent = { version: 1; conversation_id: string };
export type SocketCommand = ConversationEvent & { type: "conversation.subscribe" | "conversation.unsubscribe" };
export type SocketEvent =
  | (ConversationEvent & { type: "conversation.subscribed" | "conversation.unsubscribed" })
  | (ConversationEvent & { type: "message.created" | "message.updated"; message: ApiMessage })
  | (ConversationEvent & { type: "message.deleted"; message_id: string })
  | (ConversationEvent & { type: "typing.started" | "typing.stopped"; employee_id: string })
  | { version: 1; type: "error"; conversation_id?: string; code: string };
