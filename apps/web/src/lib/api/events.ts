import type { ApiMessage } from "./models.ts";

type ConversationEvent = { version: 1; conversation_id: string };
export type SocketCommand = ConversationEvent & { type: "conversation.subscribe" | "conversation.unsubscribe" };
export type SocketEvent =
  | (ConversationEvent & { type: "conversation.subscribed" | "conversation.unsubscribed" })
  | (ConversationEvent & { type: "message.created" | "message.updated"; message: ApiMessage })
  | (ConversationEvent & { type: "message.deleted"; message_id: string })
  | (ConversationEvent & { type: "typing.started" | "typing.stopped"; employee_id: string })
  | { version: 1; type: "error"; conversation_id?: string; code: string };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
const errorCodes = new Set(["invalid_event", "unsupported_event", "subscription_denied", "subscription_unavailable", "subscription_limit"]);

export function isSocketId(value: unknown): value is string {
  return typeof value === "string" && uuid.test(value);
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function socketMessage(value: unknown, conversationId: string): ApiMessage | undefined {
  if (!object(value) || !isSocketId(value.id) || value.conversation_id !== conversationId ||
    !isSocketId(value.sender_id) || !isSocketId(value.client_id) || typeof value.body !== "string" ||
    value.body.includes("\0") || Array.from(value.body).length > 4000 ||
    typeof value.created_at !== "string" || !timestamp.test(value.created_at) || !Number.isFinite(Date.parse(value.created_at))) return;
  return {
    id: value.id, conversation_id: conversationId, sender_id: value.sender_id,
    client_id: value.client_id, body: value.body, created_at: value.created_at,
  };
}

export function parseSocketEvent(raw: unknown): SocketEvent | undefined {
  if (typeof raw !== "string" || raw.length > 32 * 1024) return;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return;
  }
  if (!object(value) || value.version !== 1) return;
  const { type, conversation_id } = value;
  if (type === "error") {
    if (typeof value.code !== "string" || !errorCodes.has(value.code) ||
      (conversation_id !== undefined && !isSocketId(conversation_id))) return;
    return { version: 1, type, conversation_id, code: value.code };
  }
  if (!isSocketId(conversation_id)) return;
  const scope = { version: 1 as const, conversation_id };
  switch (type) {
    case "conversation.subscribed":
    case "conversation.unsubscribed":
      return { ...scope, type };
    case "message.created":
    case "message.updated": {
      const message = socketMessage(value.message, conversation_id);
      if (message) return { ...scope, type, message };
      return;
    }
    case "message.deleted":
      if (isSocketId(value.message_id)) return { ...scope, type, message_id: value.message_id };
      return;
    case "typing.started":
    case "typing.stopped":
      if (isSocketId(value.employee_id)) return { ...scope, type, employee_id: value.employee_id };
  }
}
