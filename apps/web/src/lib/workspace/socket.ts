import { isSocketId, parseSocketEvent, type SocketCommand } from "../api/events.ts";
import type { ApiMessage } from "../api/models.ts";

export type SocketStatus = "disconnected" | "connecting" | "connected" | "reconnecting" | "failed";
export type SocketTransport = Pick<WebSocket, "onopen" | "onmessage" | "onclose" | "onerror" | "send" | "close">;

type Subscription = {
  id: string;
  subscribed: () => void;
  message: (message: ApiMessage) => void;
  rejected: () => void;
};
type Clock = {
  now: () => number;
  random: () => number;
  schedule: (callback: () => void, delay: number) => () => void;
};

const realClock: Clock = {
  now: () => Date.now(),
  random: () => Math.random(),
  schedule(callback, delay) {
    const timer = setTimeout(callback, delay);
    return () => clearTimeout(timer);
  },
};

const maxRetries = 5;
const deadlineMs = 10_000;
const stableMs = 30_000;
const commandSpacingMs = 60;
const retryable = new Set([1000, 1001, 1006, 1011, 1012, 1013]);

export function sameOriginSocketUrl(origin: string) {
  const url = new URL("/api/v1/ws", origin);
  if (url.protocol === "https:") url.protocol = "wss:";
  else if (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) url.protocol = "ws:";
  else throw new Error("Realtime requires HTTPS outside localhost.");
  url.username = "";
  url.password = "";
  return url.href;
}

export function createWorkspaceSocket({
  enabled, onStatus, connect = () => new WebSocket(sameOriginSocketUrl(window.location.origin)), clock = realClock,
}: { enabled: boolean; onStatus: (status: SocketStatus) => void; connect?: () => SocketTransport; clock?: Clock }) {
  let socket: SocketTransport | undefined;
  let running = false;
  let status: SocketStatus = "disconnected";
  let retries = 0;
  let openedAt: number | undefined;
  let lastCommand = -Infinity;
  let desired: Subscription | undefined;
  let active: Subscription | undefined;
  let rejected: Subscription | undefined;
  let pending: { type: SocketCommand["type"]; subscription: Subscription } | undefined;
  let cancelRetry: (() => void) | undefined;
  let cancelDeadline: (() => void) | undefined;
  let cancelCommand: (() => void) | undefined;
  const seen = new Set<string>();

  function setStatus(next: SocketStatus) {
    if (status === next) return;
    status = next;
    onStatus(next);
  }

  function clearDeadline() {
    cancelDeadline?.();
    cancelDeadline = undefined;
  }

  function detach() {
    const previous = socket;
    socket = undefined;
    active = undefined;
    rejected = undefined;
    pending = undefined;
    clearDeadline();
    cancelCommand?.();
    cancelCommand = undefined;
    if (previous) {
      previous.onopen = previous.onclose = previous.onmessage = previous.onerror = null;
      previous.close(1000);
    }
  }

  function disconnected(code: number) {
    if (openedAt !== undefined && clock.now() - openedAt >= stableMs) retries = 0;
    openedAt = undefined;
    detach();
    if (!running) return;
    if (!retryable.has(code) || retries >= maxRetries) {
      running = false;
      setStatus("failed");
      return;
    }
    const upper = Math.min(15_000, 500 * 2 ** retries++);
    setStatus("reconnecting");
    if (!running) return;
    cancelRetry = clock.schedule(() => {
      cancelRetry = undefined;
      if (running) open();
    }, Math.round(upper * (0.5 + 0.5 * clock.random())));
  }

  function driveSubscription() {
    if (!socket || status !== "connected" || pending || active === desired) return;
    const subscription = active ?? desired;
    if (!subscription || (!active && rejected === desired)) return;
    const delay = commandSpacingMs - (clock.now() - lastCommand);
    if (delay > 0) {
      cancelCommand ??= clock.schedule(() => {
        cancelCommand = undefined;
        driveSubscription();
      }, delay);
      return;
    }
    const type = active ? "conversation.unsubscribe" : "conversation.subscribe";
    const frame: SocketCommand = { version: 1, type, conversation_id: subscription.id };
    pending = { type, subscription };
    lastCommand = clock.now();
    cancelDeadline = clock.schedule(() => disconnected(1006), deadlineMs);
    try {
      socket.send(JSON.stringify(frame));
    } catch {
      disconnected(1006);
    }
  }

  function open() {
    let transport: SocketTransport;
    try {
      transport = connect();
    } catch {
      disconnected(1006);
      return;
    }
    socket = transport;
    cancelDeadline = clock.schedule(() => disconnected(1006), deadlineMs);
    transport.onopen = () => {
      if (socket !== transport) return;
      clearDeadline();
      openedAt = clock.now();
      lastCommand = -Infinity;
      setStatus("connected");
      driveSubscription();
    };
    // Browser handshake errors are opaque; the corresponding close is the retry trigger.
    transport.onerror = () => {};
    transport.onclose = (event) => { if (socket === transport) disconnected(event.code); };
    transport.onmessage = ({ data }) => {
      if (socket !== transport || status !== "connected") return;
      const event = parseSocketEvent(data);
      if (!event) return;
      if (event.type === "message.created") {
        if (!active || active !== desired || active.id !== event.conversation_id || seen.has(event.message.id)) return;
        seen.add(event.message.id);
        if (seen.size > 2048) {
          for (const id of seen) {
            seen.delete(id);
            break;
          }
        }
        active.message(event.message);
        return;
      }
      if (!pending) return;
      const { type, subscription } = pending;
      const ack = type === "conversation.subscribe" ? "conversation.subscribed" : "conversation.unsubscribed";
      if (event.type === ack && event.conversation_id === subscription.id) {
        pending = undefined;
        clearDeadline();
        active = type === "conversation.subscribe" ? subscription : undefined;
        if (active && active === desired) active.subscribed();
      } else if (event.type === "error" && (!event.conversation_id || event.conversation_id === subscription.id)) {
        pending = undefined;
        clearDeadline();
        if (type === "conversation.unsubscribe") {
          disconnected(1006);
          return;
        }
        rejected = subscription;
        if (subscription === desired) subscription.rejected();
      }
      driveSubscription();
    };
  }

  return {
    start() {
      if (!enabled || running) return;
      running = true;
      retries = 0;
      setStatus("connecting");
      if (running) open();
    },
    stop() {
      running = false;
      openedAt = undefined;
      cancelRetry?.();
      cancelRetry = undefined;
      detach();
      seen.clear();
      setStatus("disconnected");
    },
    subscribe(subscription: Subscription) {
      if (!isSocketId(subscription.id)) throw new Error("Conversation ID must be a UUID.");
      const selection = { ...subscription, id: subscription.id.toLowerCase() };
      desired = selection;
      seen.clear();
      driveSubscription();
      return () => {
        if (desired !== selection) return;
        desired = undefined;
        seen.clear();
        driveSubscription();
      };
    },
  };
}
