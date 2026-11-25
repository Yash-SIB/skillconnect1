import type { SendMessageRequest } from "../api/models.ts";

export function prepareMessage(body: string, previous?: SendMessageRequest, generateId = () => crypto.randomUUID()): SendMessageRequest {
  return previous?.body === body ? previous : { client_id: generateId(), body };
}
