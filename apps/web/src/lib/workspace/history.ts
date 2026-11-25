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
