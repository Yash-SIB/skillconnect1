# Messaging API

The messaging routes require an `Authorization: Bearer <service assertion>` issued by the future trusted Next.js service. The verifier supplies the internal employee UUID. Without a configured verifier, the server returns 401 for all five routes. Request headers and JSON fields cannot set the sender or caller identity.

All IDs are UUIDs. POST requests require `Content-Type: application/json`, a single object containing supported fields, and a body of at most 64 KiB. Responses use JSON and `Cache-Control: no-store`.

| Method and path | Request | Success |
| --- | --- | --- |
| `GET /api/v1/conversations` | `?workspace_id=<uuid>` | `200` with `{"conversations":[...]}`, newest conversation first |
| `POST /api/v1/conversations` | Channel or DM object below | `201` with a conversation, or `200` with the existing DM for the pair |
| `GET /api/v1/conversations/{id}/members` | No body | `200` with `{"members":[{"id":"<uuid>","display_name":"Alex"}]}` |
| `GET /api/v1/conversations/{id}/messages` | Optional `limit` and `cursor` query parameters | `200` with `{"messages":[...],"next_cursor":"<cursor>"}` |
| `POST /api/v1/conversations/{id}/messages` | `{"client_id":"<uuid>","body":"Hello team"}` | `201` with the saved message, or `200` with the original for an identical retry |

### Conversation objects

```json
{"workspace_id":"<uuid>","kind":"channel","name":"product-updates","visibility":"private"}
```

```json
{"workspace_id":"<uuid>","kind":"dm","peer_id":"<other employee uuid>"}
```

Responses also include the server-generated `id` and `created_at`. Channel names are lowercase, at most 64 characters, and use letters, digits, and single hyphens between words. Visibility must be `public` or `private`. A channel is created with the requester as its first member. Duplicate channel names return 409. A DM has two distinct employees in the same workspace. The response describes the peer from the requester's perspective.

### Messages and pagination

```json
{"id":"<uuid>","conversation_id":"<uuid>","sender_id":"<uuid>","client_id":"<uuid>","body":"Hello team","created_at":"2026-11-24T10:00:00Z"}
```

Message text must contain nonblank content, at most 4,000 Unicode code points, with no NUL bytes. Surrounding whitespace in valid text is stored as sent. Retry a send with the same `client_id` and exact body. Each key is scoped to the conversation and sender. Reusing the key for a different body or a deleted message returns 409.

Messages are returned newest first by `(created_at, id)`. The default limit is 50 and the maximum is 100. Pass the opaque, conversation-specific `next_cursor` unchanged as the `cursor` parameter to retrieve older messages. The final page omits `next_cursor`. Empty collections are arrays. Deleted messages are excluded. Conversation and member lists are unpaged.

### Access and errors

- Every operation checks that the caller's employee account and workspace membership are active. Listing, reading, and sending also require active conversation membership, including for public channels. Channel discovery and join or invite flows are outside this increment.
- Member lists expose active member IDs and display names. Adding or resolving a DM requires both employees to be active in the same workspace. Sending to a DM also checks that the peer is still active there. An active participant can still read past DM messages after the other employee's departure.
- PostgreSQL uses parameterized statements. Conversation creation and membership insertion are atomic. Message sends use the existing unique key with `ON CONFLICT` and a follow-up read under Read Committed to return the winner of a concurrent retry. [PostgreSQL transaction isolation](https://www.postgresql.org/docs/18/transaction-iso.html)

Errors use the shape `{"error":{"code":"not_found","message":"Resource not found"}}`. Statuses include 400 for validation, 401 for invalid or missing authentication, 403 for an unavailable workspace membership or inactive DM peer on send, 404 for a missing or inaccessible conversation or DM peer on creation, 409 for conflicts, 413 for an oversized body, and 415 for an unsupported content type. 500 and 503 return generic messages.

## Real-time delivery

### Connect and subscribe

1. Connect to `GET /api/v1/ws` using the same `Authorization: Bearer <service assertion>` requirement as REST. In deployment, a trusted upgrade gateway validates the browser session and passes the service assertion. Browser WebSocket clients cannot set this header directly. Query parameters cannot authenticate a request. The current server returns 401 until the trusted verifier is configured.
2. Send one `Origin` header that matches an exact HTTP(S) origin in `WS_ALLOWED_ORIGINS`. Include the port if it is part of the origin. Missing, duplicate, or disallowed origins are refused with 403 for authenticated upgrade requests. An empty allowlist refuses all upgrades. Use WSS for deployed traffic.
3. Send a JSON text frame to subscribe. The server resolves the workspace from the conversation and checks active employee, workspace, and conversation membership before acknowledging.

```json
{"version":1,"type":"conversation.subscribe","conversation_id":"<uuid>"}
```

The acknowledgment is `{"version":1,"type":"conversation.subscribed","conversation_id":"<uuid>"}`. Use `conversation.unsubscribe` with the same request fields to remove a subscription. The reply type is `conversation.unsubscribed`. Errors use `{"version":1,"type":"error","code":"subscription_denied","conversation_id":"<uuid>"}` with the conversation field omitted for invalid input. Other error codes include `invalid_event`, `unsupported_event`, `subscription_unavailable`, and `subscription_limit`.

Sockets support up to eight connections per employee and 64 subscriptions per connection. Each socket has a 64-frame outbound queue. A full queue closes the slow connection with code `1013`. Inbound JSON messages are limited to 2 KiB and 20 per second per connection. The server pings every 15 seconds and applies a 35-second pong deadline. It revalidates the service assertion and subscriptions on heartbeats and before message delivery. A revoked or expired session or a lost subscription closes the connection. Clients need a fresh service assertion on reconnect.

### Version 1 events

```json
{
  "version": 1,
  "type": "message.created",
  "conversation_id": "<uuid>",
  "message": {
    "id": "<uuid>",
    "conversation_id": "<uuid>",
    "sender_id": "<uuid>",
    "client_id": "<uuid>",
    "body": "Hello team",
    "created_at": "2026-11-24T10:00:00Z"
  }
}
```

| Event | Version 1 payload | Status |
| --- | --- | --- |
| `message.created` | Envelope above with the persisted REST message | Published after commit to authorized subscribers |
| `message.updated` | Same fields as `message.created` with the updated message | Contract only |
| `message.deleted` | `version`, `type`, `conversation_id`, `message_id` | Contract only |
| `typing.started`, `typing.stopped` | `version`, `type`, `conversation_id`, `employee_id` | Contract only. The future server derives `employee_id` from authentication |

### Reconnect and recover

Reconnect with backoff and fresh authentication, subscribe again, and wait for the subscription acknowledgment. Fetch the newest REST history page and follow its cursors until it overlaps the history already held locally. Keep consuming live events during this fetch and merge both sources using the server-generated message `id`. An identical REST retry returns the existing message without publishing another event. Concurrent sends may arrive in a different order from REST history. Use the REST order `(created_at, id)` when displaying the merged timeline.

The hub runs in one process. It provides no replay buffer, delivery acknowledgment, cross-instance fanout, or durable delivery guarantee. A crash between database commit and publication, a full queue, a disconnect, or an unavailable authorization check can leave events undelivered. PostgreSQL history remains the recovery source. Authorization is checked immediately before each write. A revocation cannot retract a frame already in flight. A future outbox should record events in the same transaction as the message. A separate worker can then publish to shared pub/sub and route events through each instance's authorized hub. The current implementation has no Redis dependency.
