# SkillConnect — Codex Project Instructions

## Purpose
Build **SkillConnect**, a private internal real-time messaging and collaboration application for **Skillinabox**. It should be inspired by the information architecture and interaction patterns of Slack and Discord, while using an original Skillinabox-branded design. This file is the initial product and engineering specification for Codex.

## Working rules for Codex
- First inspect the repository and summarize what already exists. Do not overwrite working files or assume a blank repository.
- Implement in small, testable increments. For each increment, state the files changed, commands to run, what works, and what remains mocked.
- Prioritize the frontend prototype first. Do not implement all backend, integration, and WebRTC features in a single pass.
- Use TypeScript, accessible components, responsive layouts, and maintainable module boundaries.
- Do not expose secrets, commit `.env` files, or claim integrations work until connected and tested.
- Use sample employees and mock messages clearly labeled as demo data. Don't use actual employee information without permission.
- Do not import Slack branding, Slack logos, proprietary illustrations, or the Slack app entry. The reference is for layout and UX inspiration, not pixel-for-pixel copying.
- Ask only when a blocker changes architecture or requires credentials; otherwise choose documented sensible defaults and proceed.

## Product goals
An internal company workspace where authorized Skillinabox employees can:
1. Sign in securely using Google OAuth / OpenID Connect (subject to company account/invite access policy).
2. Navigate workspaces, public/private channels, and one-to-one direct messages.
3. Exchange messages in real time with history, acknowledgements, reconnect handling, and authorization.
4. Invite teammates via approved flow.
5. See presence, typing, unread counts, and notifications.
6. Share attachments and search past conversations.
7. Connect approved integrations such as Google Calendar and Google Drive (later phase).
8. Make voice/video calls and share screens via WebRTC / LiveKit (later phase).

## Design brief — approved direction
The user provided a desktop Slack screenshot as layout reference and a Skillinabox logo as color reference. Preserve the core three-region desktop layout:
- Narrow left **navigation rail**: workspace icon, Home, Files, Apps & Tools, add workspace, profile.
- **Workspace sidebar**: Skillinabox workspace title and menu; Channels list with add channel; Direct Messages list with invite people; Apps section with Google Calendar, Google Drive, and Connect Apps; onboarding/checklist panel near the bottom.
- **Main chat region**: top global search; conversation title and header controls; Messages tab; welcome/introduction state; cards for company handbook, welcome message, and invite teammates; chat timeline; rich composer with formatting, emoji, mention, attachment, call/microphone affordances, and send.
- Provide dialogs for Create Channel, Invite People, New DM, Connect Apps, and profile/settings.
- Show selected channel, hover/focus states, accessible keyboard controls, loading/empty/error states, and responsive behavior for smaller screens.
- Use original content and illustrations or simple CSS/icons; never present a mocked action as a successful real integration.

### Brand palette (approximate from uploaded Skillinabox logo; confirm against official brand guide)
- Cyan blue: `#29BCE5` — selected navigation, primary controls, links.
- Orange: `#F56622` — accent actions and prominent CTAs.
- Yellow: `#FFBA35` — highlights and onboarding/notification accents.
- Gray: `#A7A9AC` — muted content.
- Charcoal: `#333333` — dark surfaces.
- App background: `#17191D`; sidebar: `#292D32`; raised surface: `#22272B`; border: `#444A50`; primary text: `#FFFFFF`; secondary text: `#C4CBD1`.
- Follow accessible contrast requirements; bright colors should be accents rather than large reading surfaces.

## Default content
Seed/demo channels: `#general`, `#announcements`, `#engineering`, `#design`, `#social`.
Direct message section: sample employees, New DM, Invite People.
Apps section: Google Calendar, Google Drive, Connect Apps. **No Slack app**.
Onboarding checklist: Set up your first channel; Invite teammates; Send your first message; Complete profile.
Welcome cards: Add company handbook; Personalize welcome message; Invite teammates.

## Scope and priorities
### P0 — first working prototype / MVP foundation
- Private repository and monorepo structure
- Polished branded frontend with navigation, responsive layout, channels, DM lists, composer, dialogs, setup checklist
- Mock data and *working local frontend interactions* for first demo
- Once approved: Google sign-in, protected workspace, employees, membership and roles
- PostgreSQL-backed channels, conversations, message history
- Go REST API and authenticated WebSocket events; cross-browser real-time messaging

### P1 — collaboration
- Presence, typing indicators, unread counts/read state
- File uploads with scoped storage permissions and malware/size checks
- Notifications, search, message edit/delete, reactions
- User onboarding and invites persisted in database

### P2 — calling and integrations
- WebRTC via LiveKit SFU, secure room tokens, voice/video and screen sharing
- Google Calendar / Drive integrations with real OAuth consent and least-privilege scopes
- Advanced moderation, admin tools, operational scaling

## Technology stack
- Web: Next.js App Router + TypeScript + Tailwind CSS + shadcn/ui; use Tiptap only when rich text is needed.
- API: Go modular monolith, versioned REST routes and WebSocket hub.
- Database: PostgreSQL, migrations and explicit membership constraints.
- Redis: optional for multi-instance pub/sub, short-lived presence and rate limits; not the message source of truth.
- Authentication: Google OAuth/OIDC with verified identity, company allowlist/invitations, secure HTTP-only sessions and server-side trust between Next.js and Go.
- Calls: LiveKit / WebRTC later, separate secure media connectivity, TURN where necessary.
- Deployment: Docker Compose for local development; CI with GitHub Actions; staging before production.

## Proposed monorepo
```text
skillconnect/
  apps/
    web/                    # Next.js
      src/app/
      src/components/workspace/
      src/components/chat/
      src/components/dialogs/
      src/hooks/
      src/lib/
    api/                    # Go
      cmd/server/
      internal/auth/
      internal/users/
      internal/conversations/
      internal/messages/
      internal/realtime/
      migrations/
  docs/
    architecture.md
    database-design.md
    api-contract.md
    decisions/
  infra/
    docker/
    nginx/
  .github/workflows/
  .env.example
  .gitignore
  docker-compose.yml
  README.md
  AGENTS.md
```
Use actual repository structure when present; do not create empty folders unnecessarily.

## Suggested component map
- `NavigationRail`, `WorkspaceSidebar`, `ChannelList`, `DirectMessageList`, `AppsSection`, `SetupChecklist`
- `ChatHeader`, `MessageList`, `MessageItem`, `MessageComposer`, `WelcomeCards`
- `CreateChannelDialog`, `InvitePeopleDialog`, `NewDMDialog`, `ConnectAppDialog`, `ProfileMenu`
- Keep visual components separate from business logic, authentication, APIs, and mock fixtures.

## Data model (planned; subject to design review)
- `users`, `workspaces`, `workspace_members`
- `conversations` (channel/DM), `conversation_members`
- `messages` (IDs, sender, conversation, client idempotency key, content, timestamps, edit/deletion state)
- `attachments`, `message_reactions`, `read_receipts`, `sessions`, and optionally `invitations`
- Membership and role checks enforced on **every** read/write and WebSocket subscription.
- PostgreSQL stores permanent messages. WebSocket events are delivery signals, not a database.
- Message delivery should have idempotency, acks, replay/cursor pagination, and reconnect sync; plan transactional outbox or equivalent for multi-instance durability.

## Initial API contract (planned)
- `GET /api/v1/me`
- `GET /api/v1/conversations`
- `POST /api/v1/conversations`
- `GET /api/v1/conversations/{id}/messages`
- `POST /api/v1/conversations/{id}/messages`
- `PATCH /api/v1/messages/{id}`
- `DELETE /api/v1/messages/{id}`
- `GET /api/v1/users`
- `GET /api/v1/ws` (authenticated socket)
- `POST /api/v1/calls/token` (later)
Plan event names such as `message.created`, `message.updated`, `typing.started`, `presence.changed`, and `read.updated`.

## Security and quality requirements
- Private company GitHub repo; feature branches, pull requests, tests and code review.
- Google login only for verified/approved employees; do not trust client-supplied identity/email.
- HTTP-only secure cookies, CSRF considerations, token expiry/revocation, TLS/WSS, strict authorization and input validation.
- Rate limits, pagination, payload limits, safe rendering, attachment scanning, logging without sensitive message contents.
- Unit, integration, and browser E2E tests; appropriate error/empty/loading states.
- Fast initial render, virtualized long lists, lazy loading where appropriate; avoid premature microservices.
- Accessible WCAG-oriented keyboard/focus/contrast behavior; mobile adaptation.

## Milestones
1. **Foundation + UI prototype:** Repo, Next.js, Tailwind/shadcn, theme tokens, workspace shell, default data, functional local channel/DM switching, create-channel dialog, invite dialog, apps section, onboarding cards and checklist, message composer with local messages.
2. **Authentication:** Google OIDC, invitation/allowlist, secure session boundaries, guarded routes.
3. **Persistence:** Go API, PostgreSQL migrations, channel/DM management, message history.
4. **Realtime:** WebSocket server/client, persistent send, ack/reconnect/resync, permissions and tests.
5. **Collaboration:** Presence, typing, read state, attachments, search, notifications.
6. **Calling + rollout:** LiveKit voice/video/screen sharing, monitoring, security checks, staging pilot.
These milestones are not guaranteed one-week delivery commitments; estimates depend on staffing and requirements.

## Immediate Codex task — START HERE
1. Inspect existing code. If the repository is empty, scaffold a Next.js TypeScript App Router app in `apps/web`, configure Tailwind and shadcn/ui.
2. Build the first high-fidelity branded responsive workspace, following the **approved screenshot's layout** but with Skillinabox palette and no Slack logo/app.
3. Include channels, DMs, Invite People, Google Calendar, Google Drive, Connect Apps, onboarding setup checklist, welcome cards, global search UI, channel header, and message composer.
4. For the prototype, implement local state for channel switching, sample DM navigation, create channel, mock sending, onboarding progress, and dialogs. Clearly distinguish mock states and future integrations.
5. Prepare `README.md` with exact install/run instructions and add basic frontend tests where feasible.
6. Report what was done, how to verify manually, any deviations from the design, and the next smallest implementation step. Do **not** start WebRTC, live third-party OAuth, or production deployment in this first iteration.

## How to use visual references
The designer/user previously supplied (1) a Slack desktop layout screenshot, (2) a Skillinabox company logo, and (3) a recolored SkillConnect mockup. These images must be added to the repository (e.g., `docs/references/`) or provided in Codex's conversation for it to inspect. This text file alone does not contain the images.
