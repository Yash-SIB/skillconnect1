# SkillConnect

SkillConnect is Skillinabox’s internal team workspace prototype. Phase 1 runs entirely with fictional demo data and uses the existing Next.js App Router, TypeScript, and Tailwind CSS setup in `apps/web`.

## Run locally

Use Node.js 22 and npm. From the project root, run the following in Windows PowerShell.

```powershell
npm.cmd --prefix apps/web ci
npm.cmd run dev
```

On macOS or Linux, use `npm` in place of `npm.cmd`. Open [localhost:3000](http://localhost:3000).

## Checks

Run these from the project root. The root scripts forward to `apps/web`, which owns the dependencies and lockfile.

```powershell
npm.cmd run lint
npm.cmd run test
npm.cmd run build
```

## Try the demo

1. Switch from **general** to **engineering** to try the empty channel welcome screen, or open a sample direct message. On a phone or tablet, open workspace navigation from the menu beside search.
2. Select **Add channel** and create `product-updates`. Send a message with Enter or the send button. Shift+Enter adds a new line. Try `**bold**`, `_italic_`, or a line starting with `- ` to check formatting in the timeline.
3. Try the emoji and teammate pickers. Use **Attach files** to preview a file name and remove it or send it with a message. Open global search and select a result to highlight the matching message.
4. Open **Invite people** and use `teammate@example.com` to simulate an invite. Open **Profile settings** to save a display name. The checklist advances as you finish these steps.
5. Return to **general** to try the handbook draft and welcome-message editor. Open **Connect apps** to see both integration previews, or select Calendar or Drive in the sidebar for its individual preview.

Conversations, drafts, messages, profile changes, and checklist progress live in the current browser tab and reset on reload. The invite flow sends no email. Mentions send no notifications. Attachment previews keep file names only. Integrations and calls are previews. Phase 1 requires no credentials or services.

The sign-in preview is at [localhost:3000/login](http://localhost:3000/login) and needs no credentials. See the [authentication plan](docs/authentication.md) for the Google Cloud setup, employee approval rules, and future Go API trust boundary.

## Backend

The [Go API guide](apps/api/README.md) covers the local PostgreSQL setup, migrations, health endpoint, and tests.
