"use client";

import { useEffect, useRef, useState } from "react";
 import { demoWorkspace } from "@/lib/workspace/demo-adapter";
 import { conversationLabel, messageTime, type Panel, type Person, type Task } from "@/lib/workspace/models";
import { ChatHeader, MessageList } from "./chat";
import { MessageComposer } from "./composer";
import { Modal, WorkspaceDialog } from "./dialogs";
import { Icon } from "./icon";
import { NavigationRail, WorkspaceSidebar } from "./navigation";
import { IconButton } from "./ui";

export function Workspace() {
  const [initial] = useState(demoWorkspace.initial);
  const [conversations, setConversations] = useState(initial.conversations);
  const [activeId, setActiveId] = useState(demoWorkspace.home.id);
  const [messages, setMessages] = useState(initial.messages);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [draftFiles, setDraftFiles] = useState<Record<string, string[]>>({});
  const [favorites, setFavorites] = useState<string[]>([]);
  const [done, setDone] = useState<Task[]>([]);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [profile, setProfile] = useState(initial.profile);
  const [handbook, setHandbook] = useState("");
  const [notice, setNotice] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchScope, setSearchScope] = useState<"all" | "current" | null>(null);
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<{ id: string }>();
  const composer = useRef<HTMLTextAreaElement>(null);
  const nextMessageId = useRef(0);
  const navigationToggle = useRef<HTMLButtonElement>(null);
  const closeNavigationButton = useRef<HTMLButtonElement>(null);
  const conversationTitle = useRef<HTMLHeadingElement>(null);

  const conversation = conversations.find(({ id }) => id === activeId) ?? demoWorkspace.home;
  const currentMessages = messages[activeId] ?? [];
  const draft = drafts[activeId] ?? "";
  const attachments = draftFiles[activeId] ?? [];
  const welcomeId = activeId === "general" ? "welcome" : `welcome-${activeId}`;
  const welcome = currentMessages.find((message) => message.id === welcomeId)?.text ?? "";

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPanel(null);
        setQuery("");
        setSearchScope("all");
      }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function choose(id: string, messageId?: string) {
    setTarget(messageId ? { id: messageId } : undefined);
    setActiveId(id);
    setMobileOpen(false);
    if (mobileOpen || searchScope || panel === "channel" || panel === "dm") {
      requestAnimationFrame(() => conversationTitle.current?.focus({ preventScroll: true }));
    }
  }

  function closeNavigation() {
    setMobileOpen(false);
    navigationToggle.current?.focus();
  }

  function toggleNavigation() {
    if (mobileOpen) {
      closeNavigation();
      return;
    }
    setMobileOpen(true);
    requestAnimationFrame(() => closeNavigationButton.current?.focus());
  }

  function complete(task: Task) {
    setDone((previous) => previous.includes(task) ? previous : [...previous, task]);
  }

  function setDraft(text: string) {
    setDrafts((previous) => ({ ...previous, [activeId]: text.slice(0, 4000) }));
  }

  function send() {
    const text = draft.trim();
    if (!text && !attachments.length) return;
    const entry = demoWorkspace.send(`local-${++nextMessageId.current}`, profile, text, attachments);
    setTarget(undefined);
    setMessages((previous) => ({ ...previous, [activeId]: [...(previous[activeId] ?? []), entry] }));
    setDraft("");
    setDraftFiles((previous) => ({ ...previous, [activeId]: [] }));
    complete("message");
    composer.current?.focus();
  }

  function addAttachments(names: string[]) {
    setDraftFiles((previous) => ({
      ...previous,
      [activeId]: [...new Set([...(previous[activeId] ?? []), ...names])],
    }));
  }

  function removeAttachment(name: string) {
    setDraftFiles((previous) => ({
      ...previous,
      [activeId]: (previous[activeId] ?? []).filter((file) => file !== name),
    }));
  }

  function saveWelcome(text: string) {
    const time = messageTime();
    setMessages((previous) => {
      const entries = previous[activeId] ?? [];
      const updated = entries.some(({ id }) => id === welcomeId)
        ? entries.map((entry) => entry.id === welcomeId ? { ...entry, text } : entry)
        : [{ id: welcomeId, author: profile, text, time }, ...entries];
      return { ...previous, [activeId]: updated };
    });
    setNotice(`Welcome message saved for ${conversationLabel(conversation)}.`);
    requestAnimationFrame(() => conversationTitle.current?.focus({ preventScroll: true }));
  }

  function addChannel(name: string, description: string, privateChannel: boolean) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) return "Use letters a–z, numbers, and single hyphens between words.";
    if (conversations.some((item) => !item.person && item.name === name)) return "A channel with this name already exists.";
    const id = "channel-" + name;
    setConversations((previous) => [...previous, { id, name, description: description || "A new channel in the demo workspace.", private: privateChannel }]);
    choose(id);
    complete("channel");
  }

  function startDm(person: Person) {
    setConversations((previous) => previous.some(({ id }) => id === person.id) ? previous : [...previous, demoWorkspace.directMessage(person)]);
    choose(person.id);
  }

  function openSearch(scope: "all" | "current") {
    setQuery("");
    setSearchScope(scope);
  }

  const term = query.trim().toLowerCase();
  const searchable = searchScope === "current" ? [conversation] : conversations;
  const matches = term && searchScope === "all" ? searchable.filter((item) => conversationLabel(item).toLowerCase().includes(term)) : [];
  const messageMatches = term ? searchable.flatMap((item) =>
    (messages[item.id] ?? []).filter((message) =>
      message.text.toLowerCase().includes(term) || message.attachments?.some((name) => name.toLowerCase().includes(term))
    ).map((message) => ({ conversation: item, message }))
  ).slice(0, 12) : [];

  return (
    <div className={`workspace ${mobileOpen ? "mobile-navigation-open" : ""}`}>
      <header className="topbar">
        <div className="product">
          <IconButton ref={navigationToggle} icon="menu" label="Toggle workspace navigation" className="mobile-menu" aria-controls="workspace-sidebar" aria-expanded={mobileOpen} onClick={toggleNavigation} />
          <strong>SkillConnect</strong>
        </div>
        <button type="button" className="global-search" onClick={() => openSearch("all")}><Icon name="search" /><span>Search Skillinabox</span><kbd>Ctrl K</kbd></button>
      </header>
      <NavigationRail profile={profile} open={setPanel} home={() => choose(demoWorkspace.home.id)} />
      <WorkspaceSidebar conversations={conversations} activeId={activeId} choose={choose} open={setPanel} done={done} homeId={demoWorkspace.home.id} mobileOpen={mobileOpen} closeMobile={closeNavigation} closeButtonRef={closeNavigationButton} focusComposer={() => {
        setMobileOpen(false);
        requestAnimationFrame(() => composer.current?.focus());
      }} />
      <main className="chat">
        <ChatHeader titleRef={conversationTitle} conversation={conversation} favorite={favorites.includes(activeId)} toggleFavorite={() => setFavorites((previous) => previous.includes(activeId) ? previous.filter((id) => id !== activeId) : [...previous, activeId])} open={setPanel} search={() => openSearch("current")} />
        <MessageList key={activeId} conversation={conversation} messages={currentMessages} open={setPanel} target={target} />
        <MessageComposer conversation={conversation} draft={draft} attachments={attachments} change={setDraft} addAttachments={addAttachments} removeAttachment={removeAttachment} send={send} open={setPanel} inputRef={composer} teammates={demoWorkspace.teammates} />
      </main>
      <div className={notice ? "notice" : "sr-only"} role="status">{notice}{notice && <IconButton icon="close" label="Dismiss status" onClick={() => setNotice("")} />}</div>
      {panel && <WorkspaceDialog key={panel} panel={panel} close={() => setPanel(null)} conversation={conversation} profile={profile} teammates={demoWorkspace.teammates} addChannel={addChannel} invite={() => {
        complete("invite");
        setNotice("Demo invite recorded. No email was sent.");
      }} startDm={startDm} saveProfile={(name) => {
        const updated = { ...profile, name, initials: name.split(/\s+/).slice(0, 2).map((part) => Array.from(part)[0]).join("").toUpperCase() };
        setProfile(updated);
        setMessages((previous) => Object.fromEntries(Object.entries(previous).map(([id, entries]) => [id, entries.map((entry) => entry.author.id === updated.id ? { ...entry, author: updated } : entry)])));
        complete("profile");
      }} handbook={handbook} saveHandbook={(text) => {
        setHandbook(text);
        setNotice("Handbook draft saved for this session.");
      }} welcome={welcome} saveWelcome={saveWelcome} />}
      {searchScope && <Modal title={searchScope === "all" ? "Search Skillinabox" : `Search ${conversationLabel(conversation)}`} close={() => setSearchScope(null)}>
        <div className="search-field"><Icon name="search" /><input data-initial-focus type="search" aria-label="Search demo conversations and messages" placeholder="Enter a search term" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
        <div className="search-results" aria-live="polite">
          {matches.map((item) => <button type="button" key={item.id} onClick={() => { choose(item.id); setSearchScope(null); }}><strong>{conversationLabel(item)}</strong><Icon name="arrow" /></button>)}
          {messageMatches.map(({ conversation: item, message }) => <button type="button" key={message.id} onClick={() => { choose(item.id, message.id); setSearchScope(null); }}><span><strong>{conversationLabel(item)} · {message.author.name}</strong><small>{message.text || message.attachments?.join(", ")}</small></span><Icon name="arrow" /></button>)}
          {term && !matches.length && !messageMatches.length && <p>No results for “{query.trim()}”.</p>}
        </div>
      </Modal>}
    </div>
  );
}
