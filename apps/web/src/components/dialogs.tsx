import { useLayoutEffect, useId, useRef, useState, type FormEvent } from "react";
 import { conversationLabel, type Conversation, type Panel, type Person } from "@/lib/workspace/models";
import { AppsPreview, demoApps } from "./apps";
import { Icon } from "./icon";
import { Avatar, IconButton } from "./ui";

export function Modal({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useLayoutEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    dialog?.querySelector<HTMLElement>("[data-initial-focus]")?.focus();
    return () => dialog?.close();
  }, []);

  return (
    <dialog ref={ref} className="dialog" aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); close(); }} onKeyDown={(event) => {
      if (event.key === "Escape" && !event.nativeEvent.isComposing) {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    }} onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div className="dialog-body">
        <header><h2 id={titleId}>{title}</h2><IconButton icon="close" label="Close dialog" onClick={close} /></header>
        {children}
      </div>
    </dialog>
  );
}

const titles: Record<Panel, string> = {
  channel: "Create a channel", invite: "Invite people", dm: "New direct message", apps: "Connect apps", profile: "Profile settings",
  calendar: demoApps.calendar.name, drive: demoApps.drive.name,
  handbook: "Company handbook", welcome: "Personalize welcome message", files: "Workspace files", workspace: "Skillinabox workspace",
  details: "Conversation details", notifications: "Notifications", call: "Voice and video calls",
};

export function WorkspaceDialog({ panel, close, conversation, profile, teammates, addChannel, invite, startDm, saveProfile, handbook, saveHandbook, welcome, saveWelcome }: {
  panel: Panel; close: () => void; conversation: Conversation; profile: Person; teammates: Person[];
  addChannel: (name: string, description: string, privateChannel: boolean) => string | undefined; invite: () => void;
  startDm: (person: Person) => void; saveProfile: (name: string) => void; handbook: string; saveHandbook: (text: string) => void;
  welcome: string; saveWelcome: (text: string) => void;
}) {
  const [error, setError] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value = String(data.get("value") ?? "").trim();
    if (!value) {
      setError("Enter a value to continue.");
      return;
    }
    switch (panel) {
      case "channel": {
        const problem = addChannel(value, String(data.get("description") ?? "").trim(), data.has("private"));
        if (problem) {
          setError(problem);
          return;
        }
        break;
      }
      case "invite": invite(); break;
      case "profile": saveProfile(value); break;
      case "handbook": saveHandbook(value); break;
      case "welcome": saveWelcome(value); break;
    }
    close();
  }

  const forms = {
    channel: { label: "Channel name", hint: "Use lowercase letters, numbers, and hyphens.", placeholder: "e.g. product-updates", value: "", action: "Create channel" },
    invite: { label: "Email address", hint: "Preview the invite flow. No email will be sent.", placeholder: "teammate@example.com", value: "", action: "Simulate invite" },
    profile: { label: "Display name", hint: "Update your name for this demo session.", placeholder: "", value: profile.name, action: "Save profile" },
    handbook: { label: "Handbook notes", hint: "Draft a handbook entry for this demo session.", placeholder: "Add a note for new teammates", value: handbook, action: "Save draft" },
    welcome: { label: "Welcome message", hint: `Set the opening message in ${conversationLabel(conversation)} for this session.`, placeholder: "Welcome your teammates to this channel", value: welcome, action: "Save welcome message" },
  };
  const form = panel in forms ? forms[panel as keyof typeof forms] : null;
  const longText = panel === "handbook" || panel === "welcome";

  return (
    <Modal title={titles[panel]} close={close}>
      {form && (
        <form className="dialog-form" onSubmit={submit}>
          <p id="panel-hint">{form.hint}</p>
          <label>{form.label}
            {longText ? <textarea data-initial-focus aria-describedby="panel-hint" name="value" rows={4} maxLength={1000} required defaultValue={form.value} placeholder={form.placeholder} /> :
              <input data-initial-focus aria-describedby="panel-hint" name="value" type={panel === "invite" ? "email" : "text"} maxLength={panel === "invite" ? 254 : 48} required defaultValue={form.value} placeholder={form.placeholder} />}
          </label>
          {panel === "channel" && <>
            <label>Description <input name="description" maxLength={160} placeholder="What is this channel for?" /></label>
            <label className="check-field"><input type="checkbox" name="private" /> Mark as private in the demo</label>
          </>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button type="submit" className="primary-button">{form.action}</button>
        </form>
      )}
      {panel === "dm" && <div className="dialog-list">{teammates.map((person) => <button type="button" key={person.id} onClick={() => { startDm(person); close(); }}><Avatar person={person} status />{person.name}<Icon name="arrow" /></button>)}</div>}
      {panel === "apps" && <AppsPreview />}
      {(panel === "calendar" || panel === "drive") && <AppsPreview app={panel} />}
      {panel === "files" && <p>File sharing is unavailable in the local demo.</p>}
      {panel === "workspace" && <p>This workspace uses fictional teammates and sample messages. Changes stay in this browser tab. Additional workspaces are unavailable in this preview.</p>}
      {panel === "details" && <p><strong>{conversationLabel(conversation)}</strong><br />{conversation.description}</p>}
      {panel === "notifications" && <p>Live notifications are unavailable in the local demo.</p>}
      {panel === "call" && <p>Calling and recording are unavailable in Phase 1.</p>}
    </Modal>
  );
}
