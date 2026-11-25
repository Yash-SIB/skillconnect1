import assert from "node:assert/strict";
import test from "node:test";
import { parseSocketEvent } from "../src/lib/api/events.ts";
import { createWorkspaceSocket, sameOriginSocketUrl } from "../src/lib/workspace/socket.ts";
import { appendOlder, mergeMessages, reconcileRecovery, recoverHistory } from "../src/lib/workspace/history.ts";

const roomA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const roomB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1";
const employee = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3";
const messageId = (sequence) => `aaaaaaaa-aaaa-aaaa-aaaa-${String(sequence).padStart(12, "0")}`;
const message = (sequence, room = roomA) => ({
  id: messageId(sequence),
  conversation_id: room,
  sender_id: employee,
  client_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4",
  body: "Persisted message",
  created_at: `2026-11-25T12:00:00.${String(sequence).padStart(6, "0")}Z`,
});
const created = (entry) => ({ version: 1, type: "message.created", conversation_id: entry.conversation_id, message: entry });
const control = (type, conversation_id = roomA) => ({ version: 1, type, conversation_id });

function fixture(enabled = true, random = () => 0) {
  const sockets = [];
  const statuses = [];
  const timers = new Map();
  let now = 0;
  let serial = 0;
  const clock = {
    now: () => now,
    random,
    schedule(callback, delay) {
      const key = ++serial;
      timers.set(key, { callback, at: now + delay });
      return () => timers.delete(key);
    },
  };
  function advance(delta) {
    const target = now + delta;
    for (;;) {
      const first = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!first || first[1].at > target) break;
      timers.delete(first[0]);
      now = first[1].at;
      first[1].callback();
    }
    now = target;
  }
  const client = createWorkspaceSocket({
    enabled, clock, onStatus: (state) => statuses.push(state),
    connect() {
      const transport = {
        sent: [], closed: [],
        send(frame) { this.sent.push(JSON.parse(frame)); },
        close(code) { this.closed.push(code); },
        opens() { this.onopen?.({}); },
        receives(frame) { this.onmessage?.({ data: JSON.stringify(frame) }); },
        loses(code = 1006) { this.onclose?.({ code }); },
      };
      sockets.push(transport);
      return transport;
    },
  });
  function subscribe(id) {
    const received = [];
    let acks = 0;
    let rejections = 0;
    const dispose = client.subscribe({
      id, message: (entry) => received.push(entry),
      subscribed: () => acks++, rejected: () => rejections++,
    });
    return { received, dispose, acks: () => acks, rejections: () => rejections };
  }
  return { client, sockets, statuses, timers, advance, subscribe };
}

test("same-origin URLs use WSS on HTTPS, with no query or credentials", () => {
  assert.equal(sameOriginSocketUrl("https://workspace.example.test/login?token=ignored"), "wss://workspace.example.test/api/v1/ws");
  assert.equal(sameOriginSocketUrl("http://localhost:3000"), "ws://localhost:3000/api/v1/ws");
  assert.throws(() => sameOriginSocketUrl("http://workspace.example.test"), /requires HTTPS/);
});

test("pending configuration never connects, even with a requested subscription", () => {
  const f = fixture(false);
  f.subscribe(roomA);
  f.client.start();
  f.advance(300_000);
  f.client.stop();
  assert.deepEqual(f.sockets, []);
  assert.deepEqual(f.statuses, []);
  assert.equal(f.timers.size, 0);
});

test("validates version 1 envelopes and rejects malformed or cross-conversation payloads", () => {
  const correct = created(message(1));
  assert.deepEqual(parseSocketEvent(JSON.stringify(correct)), correct);
  assert.deepEqual(parseSocketEvent('{"version":1,"type":"error","code":"invalid_event"}'),
    { version: 1, type: "error", code: "invalid_event", conversation_id: undefined });
  for (const bad of [
    correct, "invalid JSON", "x".repeat(32 * 1024 + 1),
    JSON.stringify({ ...correct, version: 2 }),
    JSON.stringify({ ...correct, type: "ping" }),
    JSON.stringify({ ...correct, message: message(1, roomB) }),
    JSON.stringify({ ...correct, message: { ...correct.message, sender_id: "invalid" } }),
    JSON.stringify({ ...correct, message: { ...correct.message, created_at: "last Tuesday" } }),
    JSON.stringify({ ...correct, message: { ...correct.message, body: 123 } }),
  ]) assert.equal(parseSocketEvent(bad), undefined);
});

test("applies only acknowledged messages and deduplicates by server ID", () => {
  const f = fixture();
  const selected = f.subscribe(roomA);
  f.client.start();
  const socket = f.sockets[0];
  socket.opens();
  assert.deepEqual(socket.sent, [control("conversation.subscribe")]);
  socket.receives(created(message(1)));
  assert.deepEqual(selected.received, []);
  socket.receives(control("conversation.subscribed"));
  socket.receives(created(message(1, roomB)));
  socket.receives({ ...created(message(1)), type: "message.updated" });
  socket.receives(created(message(1)));
  socket.receives(created(message(1)));
  assert.equal(selected.acks(), 1);
  assert.deepEqual(selected.received, [message(1)]);
  assert.deepEqual(f.statuses, ["connecting", "connected"]);
});

test("serializes subscription switches and discards late frames for the old selection", () => {
  const f = fixture();
  const previous = f.subscribe(roomA);
  f.client.start();
  const socket = f.sockets[0];
  socket.opens();
  previous.dispose();
  const next = f.subscribe(roomB);
  socket.receives(control("conversation.subscribed"));
  socket.receives(created(message(1)));
  f.advance(60);
  assert.deepEqual(socket.sent, [control("conversation.subscribe"), control("conversation.unsubscribe")]);
  socket.receives(control("conversation.unsubscribed"));
  f.advance(60);
  assert.deepEqual(socket.sent.at(-1), control("conversation.subscribe", roomB));
  socket.receives(control("conversation.subscribed", roomB));
  socket.receives(created(message(2)));
  socket.receives(created(message(3, roomB)));
  assert.deepEqual(previous.received, []);
  assert.equal(previous.acks(), 0);
  assert.equal(next.acks(), 1);
  assert.deepEqual(next.received, [message(3, roomB)]);
});

test("a rejected subscription never accepts events or loops commands", () => {
  const f = fixture();
  const selected = f.subscribe(roomA);
  f.client.start();
  const socket = f.sockets[0];
  socket.opens();
  socket.receives({ ...control("error"), code: "subscription_denied" });
  socket.receives(created(message(1)));
  f.advance(60_000);
  assert.equal(selected.rejections(), 1);
  assert.deepEqual(selected.received, []);
  assert.equal(socket.sent.length, 1);
});

test("recovers subscription after a transient close with capped exponential jitter", () => {
  const f = fixture(true, () => 0.5);
  const selected = f.subscribe(roomA);
  f.client.start();
  f.sockets[0].opens();
  f.sockets[0].receives(control("conversation.subscribed"));
  f.sockets[0].receives(created(message(1)));
  f.sockets[0].loses();
  assert.equal(f.statuses.at(-1), "reconnecting");
  f.advance(374);
  assert.equal(f.sockets.length, 1);
  f.advance(1);
  f.sockets[1].opens();
  f.sockets[1].receives(control("conversation.subscribed"));
  f.sockets[1].receives(created(message(1)));
  assert.equal(selected.acks(), 2);
  assert.deepEqual(selected.received, [message(1)]);

  for (const delay of [750, 1_500, 3_000, 6_000]) {
    const count = f.sockets.length;
    f.sockets.at(-1).loses();
    f.advance(delay);
    assert.equal(f.sockets.length, count + 1);
  }
  f.sockets.at(-1).loses();
  assert.equal(f.statuses.at(-1), "failed");
  assert.equal(f.timers.size, 0);
});

test("policy closes stop automatic retry and unmount cancels timers and stale callbacks", () => {
  const f = fixture();
  const selected = f.subscribe(roomA);
  f.client.start();
  const transport = f.sockets[0];
  transport.opens();
  transport.receives(control("conversation.subscribed"));
  transport.loses(1008);
  assert.equal(f.statuses.at(-1), "failed");
  assert.equal(f.timers.size, 0);

  f.client.start();
  const replacement = f.sockets[1];
  replacement.opens();
  replacement.receives(control("conversation.subscribed"));
  const queued = replacement.onmessage;
  selected.dispose(); // Conversation effect cleanup.
  f.client.stop(); // Workspace effect cleanup.
  queued({ data: JSON.stringify(created(message(1))) });
  f.advance(60_000);
  assert.deepEqual(replacement.closed, [1000]);
  assert.deepEqual(selected.received, []);
  assert.equal(replacement.onmessage, null);
  assert.equal(f.statuses.at(-1), "disconnected");
  assert.equal(f.timers.size, 0);
  assert.equal(f.sockets.length, 2);
});

test("connection and acknowledgment timeouts retry and shutdown cancels a scheduled reconnect", () => {
  const f = fixture();
  f.subscribe(roomA);
  f.client.start();
  f.advance(10_000);
  assert.equal(f.statuses.at(-1), "reconnecting");
  f.advance(250);
  f.sockets[1].opens();
  f.advance(10_000);
  assert.equal(f.statuses.at(-1), "reconnecting");
  f.client.stop();
  f.advance(60_000);
  assert.equal(f.sockets.length, 2);
  assert.equal(f.timers.size, 0);
});

test("merges REST sends, paginated history, recovery and live frames without losing newer rows", async () => {
  const signal = new AbortController().signal;
  const initial = { messages: [message(7), message(6)], next_cursor: "older" };
  const cursors = [];
  const recovery = await recoverHistory(async (cursor) => {
    cursors.push(cursor);
    return cursor ? { messages: [message(7), message(6)], next_cursor: "older" } :
      { messages: [message(9), message(8)], next_cursor: "missed" };
  }, initial.messages.at(-1).id, signal);
  assert.deepEqual(cursors, [undefined, "missed"]);
  assert.equal(recovery.coverage, "overlap");
  const olderWhileRecovering = appendOlder(initial, { messages: [message(5)], next_cursor: "even-older" });
  const recovered = reconcileRecovery(olderWhileRecovering, recovery);
  assert.equal(recovered.next_cursor, "even-older");
  const arrivals = mergeMessages([message(10)], [message(10), message(11), message(9)]);
  assert.deepEqual(mergeMessages(recovered.messages, arrivals).map(({ id }) => id),
    [11, 10, 9, 8, 7, 6, 5].map(messageId));
});

test("reports incomplete recovery, respects cancellation and can recover an empty baseline", async () => {
  const controller = new AbortController();
  const signal = controller.signal;
  const initial = { messages: [message(1)], next_cursor: "retain" };
  let count = 0;
  const incomplete = await recoverHistory(async () => ({ messages: [message(9)], next_cursor: String(++count) }),
    initial.messages[0].id, signal, 2);
  assert.equal(count, 2);
  assert.equal(incomplete.coverage, "incomplete");
  assert.equal(reconcileRecovery(initial, incomplete).next_cursor, "retain");
  const exhausted = await recoverHistory(async () => ({ messages: [message(9)] }), undefined, signal);
  assert.equal(exhausted.coverage, "exhausted");
  assert.deepEqual(reconcileRecovery({ messages: [] }, exhausted).messages, [message(9)]);
  await assert.rejects(recoverHistory(async () => {
    controller.abort();
    return { messages: [message(9)] };
  }, undefined, signal), { name: "AbortError" });
});
