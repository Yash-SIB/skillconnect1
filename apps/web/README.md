# SkillConnect web

## Workspace modes

- `/` opens the fictional workspace. Its adapter uses local fixtures, and its channels, direct messages, drafts, and sends stay in the browser tab.
- `/workspace` is the live entry point. It shows **Employee sign-in is pending configuration** without making messaging requests. The live UI can mount once a server-verified workspace ID is available. A 401 during a live request clears the visible workspace and prompts the user to sign in.

The shared sidebar, conversation header, member dialog, timeline, and composer accept live data. The REST adapter handles channel and DM creation, and the prepared live view handles conversation selection, members, history, and sending. The backend provides peer IDs and the conversation member roster, so a DM label resolves when its members are loaded. A historical sender outside the current roster displays as **Unavailable member**. Live channel and DM creation controls and an employee directory remain follow-up work.

The REST client in `src/lib/api` calls the five same-origin `/api/v1` paths. The browser sends only same-origin credentials and requests uncached responses. There is no proxy or assertion issuer in this phase. The adapter does not use demo data when a request fails.

The prepared live workspace can show connecting, connected, reconnecting, disconnected, or failed. It requires both a verified server bootstrap and an enabled trusted upgrade gateway before starting the socket. Today `/workspace` renders the configuration-pending screen and opens no connection. The demo never mounts the live socket. The [WebSocket contract](../../docs/api-contract.md#browser-client-behavior) describes subscription acknowledgments, retry and recovery limits, and why PostgreSQL history remains the recovery source.

An uncertain send retains its client ID and exact body while the live workspace stays open, including across conversation switches. Retrying unchanged text reuses that ID. Changed text is a new send. The client merges saved messages by server ID and loads older history using the returned cursor.

## Verify

From the project root in PowerShell:

```powershell
npm.cmd run test
npm.cmd run lint
npm.cmd run build
apps/web/node_modules/.bin/tsc.cmd --project apps/web/tsconfig.json --noEmit --incremental false
```

The build generates Next.js route types for the standalone TypeScript command. Tests use mocked HTTP and WebSocket transports and need no credentials or Go server. Run `npm.cmd run dev`, then open [the demo](http://localhost:3000/) and [the live entry](http://localhost:3000/workspace). Confirm the demo still switches conversations and sends locally, the live entry shows configuration pending, and the browser Network panel shows no WebSocket connection in either mode. See the [project README](../../README.md), [authentication plan](../../docs/authentication.md), and [Go API contract](../../docs/api-contract.md).
