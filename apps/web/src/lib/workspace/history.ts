import type { ApiMessage, ApiMessagePage } from "../api/models.ts";

export function appendOlder(current: ApiMessagePage, page: ApiMessagePage): ApiMessagePage {
  const seen = new Set(current.messages.map(({ id }) => id));
  const additions = page.messages.filter(({ id }) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return { messages: [...current.messages, ...additions], next_cursor: page.next_cursor };
}

function newestFirst(a: ApiMessage, b: ApiMessage) {
  const milliseconds = Date.parse(b.created_at) - Date.parse(a.created_at);
  if (milliseconds) return milliseconds;
  // PostgreSQL can return microseconds. Date.parse only preserves milliseconds.
  const fraction = (value: string) => (value.match(/\.(\d+)/)?.[1] ?? "").padEnd(9, "0");
  const left = fraction(a.created_at);
  const right = fraction(b.created_at);
  if (left !== right) return left < right ? 1 : -1;
  return a.id === b.id ? 0 : a.id < b.id ? 1 : -1;
}

export function acceptSent(current: ApiMessagePage, message: ApiMessage): ApiMessagePage {
  if (current.messages.some(({ id }) => id === message.id)) return current;
  return { ...current, messages: [...current.messages, message].sort(newestFirst) };
}

export function mergeMessages(current: ApiMessage[], incoming: ApiMessage[]) {
  if (incoming.length === 0) return current;
  const messages = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) {
    if (!messages.has(message.id)) messages.set(message.id, message);
  }
  return [...messages.values()].sort(newestFirst);
}

type Recovery = {
  page: ApiMessagePage;
  coverage: "overlap" | "exhausted" | "incomplete";
};

// Walk newest-first to the oldest previously loaded REST row. A match against
// just any live event would skip earlier holes when events arrive out of order.
export async function recoverHistory(
  fetchPage: (cursor: string | undefined, signal: AbortSignal) => Promise<ApiMessagePage>,
  boundary: string | undefined,
  signal: AbortSignal,
  maxPages = 10,
): Promise<Recovery> {
  let page: ApiMessagePage = { messages: [] };
  const cursors = new Set<string>();
  for (let count = 0; count < maxPages; count++) {
    signal.throwIfAborted();
    const result = await fetchPage(page.next_cursor, signal);
    signal.throwIfAborted();
    page = appendOlder(page, result);
    if (!result.next_cursor) return { page, coverage: "exhausted" };
    if (boundary && result.messages.some(({ id }) => id === boundary)) return { page, coverage: "overlap" };
    if (cursors.has(result.next_cursor)) break;
    cursors.add(result.next_cursor);
  }
  return { page, coverage: "incomplete" };
}

export function reconcileRecovery(current: ApiMessagePage, recovery: Recovery): ApiMessagePage {
  const usedCursor = current.messages.length > 0 ? current.next_cursor : recovery.page.next_cursor;
  return {
    messages: mergeMessages(current.messages, recovery.page.messages),
    next_cursor: recovery.coverage === "exhausted" ? undefined : usedCursor,
  };
}
