import type {
  ApiConversation, ApiErrorResponse, ApiMember, ApiMessage, ApiMessagePage,
  ConversationRequest, HistoryQuery, SendMessageRequest,
} from "./models.ts";

export class ApiError extends Error {
  readonly kind: "http" | "network" | "invalid_response" | "invalid_request";
  readonly status?: number;
  readonly code?: string;

  constructor(kind: ApiError["kind"], status?: number, code?: string) {
    super(status === undefined ? kind : `HTTP ${status}`);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function timestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function conversation(value: unknown): value is ApiConversation {
  if (!record(value) || typeof value.id !== "string" || typeof value.workspace_id !== "string" || !timestamp(value.created_at)) return false;
  if (value.kind === "dm") return typeof value.peer_id === "string";
  return value.kind === "channel" && typeof value.name === "string" && (value.visibility === "public" || value.visibility === "private");
}

function member(value: unknown): value is ApiMember {
  return record(value) && typeof value.id === "string" && typeof value.display_name === "string";
}

function message(value: unknown): value is ApiMessage {
  return record(value) && typeof value.id === "string" && typeof value.conversation_id === "string" &&
    typeof value.sender_id === "string" && typeof value.client_id === "string" && typeof value.body === "string" && timestamp(value.created_at);
}

function arrayOf<T>(value: unknown, guard: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.every(guard);
}

function errorResponse(value: unknown): value is ApiErrorResponse {
  return record(value) && record(value.error) && typeof value.error.code === "string" && typeof value.error.message === "string";
}

const base = "/api/v1/conversations";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createMessagingClient(fetcher: typeof fetch = fetch) {
  async function request<T>(url: string, guard: (value: unknown) => value is T, signal?: AbortSignal, body?: object): Promise<T> {
    let response: Response;
    try {
      response = await fetcher(url, {
        method: body ? "POST" : "GET",
        credentials: "same-origin",
        redirect: "error",
        cache: "no-store",
        signal,
        headers: body ? { Accept: "application/json", "Content-Type": "application/json" } : { Accept: "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new ApiError("network");
    }
    let value: unknown;
    try {
      value = await response.json();
    } catch (error) {
      if (signal?.aborted) throw error;
      if (response.ok) throw new ApiError("invalid_response");
    }
    if (!response.ok) throw new ApiError("http", response.status, errorResponse(value) ? value.error.code : undefined);
    if (!guard(value)) throw new ApiError("invalid_response");
    return value;
  }

  const detail = (id: string) => {
    if (!uuid.test(id)) throw new ApiError("invalid_request");
    return `${base}/${id.toLowerCase()}`;
  };

  return {
    async listConversations(workspaceId: string, signal?: AbortSignal) {
      const search = new URLSearchParams({ workspace_id: workspaceId });
      const result = await request(`${base}?${search}`, (value): value is { conversations: ApiConversation[] } =>
        record(value) && arrayOf(value.conversations, (item): item is ApiConversation => conversation(item) && item.workspace_id === workspaceId.toLowerCase()), signal);
      return result.conversations;
    },
    createConversation(input: ConversationRequest, signal?: AbortSignal) {
      const body = input.kind === "channel"
        ? { workspace_id: input.workspace_id, kind: input.kind, name: input.name, visibility: input.visibility }
        : { workspace_id: input.workspace_id, kind: input.kind, peer_id: input.peer_id };
      return request(base, (item): item is ApiConversation =>
        conversation(item) && item.workspace_id === input.workspace_id.toLowerCase() && item.kind === input.kind, signal, body);
    },
    async listMembers(id: string, signal?: AbortSignal) {
      const result = await request(`${detail(id)}/members`, (value): value is { members: ApiMember[] } =>
        record(value) && arrayOf(value.members, member), signal);
      return result.members;
    },
    async listMessages(id: string, { limit, cursor }: HistoryQuery = {}, signal?: AbortSignal) {
      const search = new URLSearchParams();
      if (limit !== undefined) search.set("limit", String(limit));
      if (cursor !== undefined) search.set("cursor", cursor);
      return request(`${detail(id)}/messages${search.size ? `?${search}` : ""}`, (value): value is ApiMessagePage =>
        record(value) && arrayOf(value.messages, (item): item is ApiMessage => message(item) && item.conversation_id === id.toLowerCase()) &&
        (value.next_cursor === undefined || typeof value.next_cursor === "string"), signal);
    },
    async sendMessage(id: string, input: SendMessageRequest, signal?: AbortSignal) {
      const body = { client_id: input.client_id, body: input.body };
      return request(`${detail(id)}/messages`, (item): item is ApiMessage =>
        message(item) && item.conversation_id === id.toLowerCase() && item.client_id === input.client_id.toLowerCase() && item.body === input.body, signal, body);
    },
  };
}
