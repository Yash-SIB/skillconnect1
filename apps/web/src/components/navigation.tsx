import { channels, setupTasks, type Conversation, type Panel, type Person, type Task } from "@/lib/demo";
import { appIds, AppIcon, demoApps } from "./apps";
import { Icon, type IconName } from "./icon";
import { Avatar, BrandMark, IconButton } from "./ui";

type OpenPanel = (panel: Panel) => void;

export function NavigationRail({ profile, open, home }: { profile: Person; open: OpenPanel; home: () => void }) {
  const links: { icon: IconName; label: string; action: () => void }[] = [
    { icon: "home", label: "Home", action: home },
    { icon: "files", label: "Files", action: () => open("files") },
    { icon: "grid", label: "Apps & Tools", action: () => open("apps") },
  ];
  return (
    <nav className="rail" aria-label="Primary">
      <button type="button" className="workspace-mark" aria-label="Skillinabox workspace" onClick={home}><BrandMark /></button>
      {links.map(({ icon, label, action }) => (
        <button key={icon} type="button" className={`rail-link ${icon === "home" ? "rail-active" : ""}`} onClick={action}>
          <span className="rail-link-icon"><Icon name={icon} /></span><span className="rail-link-label">{label}</span>
        </button>
      ))}
      <div className="rail-bottom">
        <IconButton icon="plus" label="Add workspace" className="add-workspace" onClick={() => open("workspace")} />
        <button type="button" className="profile-button" onClick={() => open("profile")} aria-label="Profile settings"><Avatar person={profile} status /></button>
      </div>
    </nav>
  );
}

function Section({ title, icon, action, actionLabel, children }: { title: string; icon: IconName; action?: () => void; actionLabel?: string; children: React.ReactNode }) {
  return (
    <section className="side-section">
      <h2><Icon name={icon} /><span>{title}</span>{action && actionLabel && <IconButton icon="plus" label={actionLabel} onClick={action} />}</h2>
      {children}
    </section>
  );
}

function ConversationRow({ conversation, active, choose }: { conversation: Conversation; active: boolean; choose: (id: string) => void }) {
  return (
    <button type="button" className={`side-row conversation-row ${active ? "selected" : ""}`} aria-current={active ? "page" : undefined} onClick={() => choose(conversation.id)}>
      {conversation.person ? <Avatar person={conversation.person} status /> : <Icon name={conversation.private ? "lock" : "hash"} />}
      <span>{conversation.name}</span>
    </button>
  );
}

export function SetupChecklist({ done, open, focusComposer }: { done: Task[]; open: OpenPanel; focusComposer: () => void }) {
  const taskActions = {
    channel: () => open("channel"),
    invite: () => open("invite"),
    message: focusComposer,
    profile: () => open("profile"),
  };

  return (
    <details className="checklist" open>
      <summary><span className="checklist-icon"><Icon name="spark" /></span><span>Setup checklist<small>{done.length} of 4 complete</small></span><Icon name="chevron" className="checklist-chevron" /></summary>
      <progress value={done.length} max={4} aria-label="Setup progress" />
      <ul>
        {(Object.keys(setupTasks) as Task[]).map((task) => (
          <li key={task}>
            <button type="button" className={done.includes(task) ? "task-complete" : ""} onClick={taskActions[task]}>
              <span className="task-circle" aria-hidden="true">{done.includes(task) && <Icon name="check" />}</span>{setupTasks[task]}
              {done.includes(task) && <span className="sr-only"> (complete)</span>}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function WorkspaceSidebar({ conversations, activeId, choose, open, done, focusComposer, mobileOpen, closeMobile, closeButtonRef }: {
  conversations: Conversation[]; activeId: string; choose: (id: string) => void; open: OpenPanel; done: Task[];
  focusComposer: () => void; mobileOpen: boolean; closeMobile: () => void; closeButtonRef: React.Ref<HTMLButtonElement>;
}) {
  const renderRow = (conversation: Conversation) => <ConversationRow key={conversation.id} conversation={conversation} active={conversation.id === activeId} choose={choose} />;
  return (
    <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`} id="workspace-sidebar" aria-label="Workspace navigation" onKeyDown={(event) => {
      if (mobileOpen && event.key === "Escape") closeMobile();
    }}>
      <div className="sidebar-header">
        <button className="workspace-title" type="button" onClick={() => open("workspace")}><span>Skillinabox<small>Team workspace</small></span><Icon name="chevron" /></button>
        <IconButton icon="pen" label="New direct message" className="desktop-compose" onClick={() => open("dm")} />
        <IconButton ref={closeButtonRef} icon="close" label="Close navigation" className="mobile-close" onClick={closeMobile} />
      </div>
      <nav className="sidebar-scroll" aria-label="Channels, direct messages, and apps">
        <Section title="Channels" icon="hash" action={() => open("channel")} actionLabel="Create channel">
          {conversations.filter((conversation) => !conversation.person).map(renderRow)}
          <button type="button" className="side-row side-action" onClick={() => open("channel")}><Icon name="plus" />Add channel</button>
        </Section>
        <Section title="Direct messages" icon="users">
          {conversations.filter((conversation) => conversation.person).map(renderRow)}
          <button type="button" className="side-row side-action" onClick={() => open("dm")}><Icon name="plus" />New direct message</button>
          <button type="button" className="side-row side-action" onClick={() => open("invite")}><Icon name="userPlus" />Invite people</button>
        </Section>
        <Section title="Apps" icon="grid">
          {appIds.map((app) => (
            <button key={app} type="button" className="side-row" aria-haspopup="dialog" onClick={() => open(app)}><AppIcon app={app} />{demoApps[app].name}</button>
          ))}
          <button type="button" className="side-row side-action" aria-haspopup="dialog" onClick={() => open("apps")}><Icon name="plus" />Connect apps</button>
        </Section>
        <button className="mobile-home side-row" type="button" onClick={() => choose(channels[0].id)}><Icon name="home" />Workspace home</button>
      </nav>
      <div className="sidebar-footer"><SetupChecklist done={done} open={open} focusComposer={focusComposer} /></div>
    </aside>
  );
}
