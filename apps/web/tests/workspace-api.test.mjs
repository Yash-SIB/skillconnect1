import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, createMessagingClient } from "../src/lib/api/client.ts";
import { createApiWorkspace, displayConversation, displayMessage } from "../src/lib/workspace/api-adapter.ts";
import { demoWorkspace } from "../src/lib/workspace/demo-adapter.ts";
import { acceptSent, appendOlder } from "../src/lib/workspace/history.ts";
import { mayRetrySend, requestMessage } from "../src/lib/workspace/resource.ts";
import { prepareMessage } from "../src/lib/workspace/sending.ts";

const workspaceId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const conversationId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2";
const employeeId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3";
const clientId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4";
const messageId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5";
const created_at = "2026-11-24T10:00:00.000001Z";
const channel = { id: conversationId, workspace_id: workspaceId, kind: "channel", name: "engineering", visibility: "private", created_at };
const dm = { id: conversationId, workspace_id: workspaceId, kind: "dm", peer_id: employeeId, created_at };
const saved = { id: messageId, conversation_id: conversationId, sender_id: employeeId, client_id: clientId, body: "  Hello team  ", created_at };
const member = { id: employeeId, display_name: "Avery Sample" };
const base = "/api/v1/conversations";
const historyPath = `${base}/${conversationId}/messages`;

function mockHttp(...replies) {
  const calls = [];
  const client = createMessagingClient(async (url, options) => {
    calls.push({ url, options });
    assert.ok(replies.length, "unexpected HTTP request");
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    return reply;
  });
  return { calls, client };
}

test("authenticated adapter lists conversations and maps only data returned by the API", async () => {
  const { calls, client } = mockHttp(Response.json({ conversations: [channel, dm] }), Response.json({ members: [member] }));
  const api = createApiWorkspace(workspaceId, client);
  const signal = new AbortController().signal;
  const list = await api.conversations(signal);
  const people = new Map((await api.members(conversationId, signal)).map((person) => [person.id, person]));
  assert.deepEqual(calls.map(({ url }) => url), [`${base}?workspace_id=${workspaceId}`, `${base}/${conversationId}/members`]);
  assert.ok(calls.every(({ options }) => options.signal === signal && options.credentials === "same-origin" &&
    options.redirect === "error" && options.cache === "no-store" && !options.headers.Authorization));
  assert.equal(displayConversation(list[0]).private, true);
  assert.equal(displayConversation(list[1], people).name, "Avery Sample");
  assert.equal(people.get(employeeId).online, undefined);
  assert.equal(displayConversation(list[1]).name, "Direct message");
  assert.equal(displayMessage(saved, people).author.name, "Avery Sample");
  assert.equal(displayMessage(saved, new Map()).author.name, "Unavailable member");
});

test("create sends the documented channel and DM bodies without a supplied identity", async () => {
  const { calls, client } = mockHttp(Response.json(channel, { status: 201 }), Response.json(dm));
  const api = createApiWorkspace(workspaceId, client);
  await api.createConversation({ kind: "channel", name: "engineering", visibility: "private", description: "discarded field" });
  await api.createConversation({ kind: "dm", peer_id: employeeId, sender_id: "discarded field" });
  assert.deepEqual(calls.map(({ options }) => JSON.parse(options.body)), [
    { workspace_id: workspaceId, kind: "channel", name: "engineering", visibility: "private" },
    { workspace_id: workspaceId, kind: "dm", peer_id: employeeId },
  ]);
});

test("history passes opaque cursors unchanged and merges older rows without duplicates", async () => {
  const older = { ...saved, id: "older" };
  const cursor = "opaque+cursor/?&";
  const { calls, client } = mockHttp(
    Response.json({ messages: [saved], next_cursor: cursor }),
    Response.json({ messages: [saved, older] }),
  );
  const api = createApiWorkspace(workspaceId, client);
  const page = await api.history(conversationId);
  const next = await api.history(conversationId, { limit: 20, cursor: page.next_cursor });
  const query = new URL(calls[1].url, "https://workspace.example.test").searchParams;
  assert.equal(query.get("limit"), "20");
  assert.equal(query.get("cursor"), cursor);
  assert.deepEqual(appendOlder(page, next), { messages: [saved, older], next_cursor: undefined });
  const newer = { ...saved, id: "newer", created_at: "2026-11-24T10:00:00.000002Z" };
  assert.deepEqual(acceptSent(page, newer).messages, [newer, saved]);
  assert.equal(acceptSent(page, saved), page);
});

test("a network-uncertain send retries with the same key and exact body", async () => {
  const { calls, client } = mockHttp(new TypeError("offline"), Response.json(saved));
  const api = createApiWorkspace(workspaceId, client);
  const submission = prepareMessage(saved.body, undefined, () => clientId);
  await assert.rejects(api.send(conversationId, submission), (error) => error.kind === "network" && mayRetrySend(error));
  const retry = prepareMessage(saved.body, submission, () => assert.fail("retry minted a new key"));
  assert.deepEqual(await api.send(conversationId, retry), saved);
  assert.deepEqual(calls.map(({ url, options }) => [url, options.method, JSON.parse(options.body)]), [
    [historyPath, "POST", { client_id: clientId, body: saved.body }],
    [historyPath, "POST", { client_id: clientId, body: saved.body }],
  ]);
  assert.equal(prepareMessage("edited", retry, () => "new-key").client_id, "new-key");
});

test("HTTP and malformed responses remain errors without demo fallback", async () => {
  for (const [status, code, wording] of [
    [401, "unauthorized", /Sign in/],
    [403, "forbidden", /permission/],
    [404, "not_found", /unavailable/],
    [409, "conflict", /conflicts/],
  ]) {
    const { client, calls } = mockHttp(Response.json({ error: { code, message: "opaque upstream detail" } }, { status }));
    await assert.rejects(createApiWorkspace(workspaceId, client).conversations(), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, status);
      assert.equal(error.code, code);
      assert.match(requestMessage(error), wording);
      assert.equal(mayRetrySend(error), false);
      return true;
    });
    assert.equal(calls.length, 1);
  }
  const { client } = mockHttp(Response.json({ messages: [{ ...saved, conversation_id: workspaceId }] }));
  await assert.rejects(client.listMessages(conversationId), { kind: "invalid_response" });
  await assert.rejects(client.listMembers("../other"), { kind: "invalid_request" });
});

test("demo fixture state is independent of the authenticated transport", () => {
  const first = demoWorkspace.initial();
  first.conversations.pop();
  first.messages.general.pop();
  const second = demoWorkspace.initial();
  assert.equal(second.conversations.length, 8);
  assert.equal(second.messages.general.length, 2);
  const entry = demoWorkspace.send("local-1", second.profile, "Local message", []);
  assert.equal(entry.id, "local-1");
  assert.equal(entry.author.id, "you");
});
