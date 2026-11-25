export type ChannelVisibility = "public" | "private";
export type ConversationRequest = { workspace_id: string } & (
  | { kind: "channel"; name: string; visibility: ChannelVisibility }
  | { kind: "dm"; peer_id: string }
);
export type ApiConversation = ConversationRequest & { id: string; created_at: string };
export type ApiMember = { id: string; display_name: string };
export type ApiMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  client_id: string;
  body: string;
  created_at: string;
};
export type SendMessageRequest = Pick<ApiMessage, "client_id" | "body">;
export type HistoryQuery = { limit?: number; cursor?: string };
export type ApiMessagePage = { messages: ApiMessage[]; next_cursor?: string };
export type ApiErrorResponse = { error: { code: string; message: string } };
