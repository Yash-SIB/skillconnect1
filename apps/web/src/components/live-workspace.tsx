"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ApiError } from "@/lib/api/client";
import type { ApiConversation, ApiMessagePage, SendMessageRequest } from "@/lib/api/models";
import { createApiWorkspace, displayConversation, displayMessage } from "@/lib/workspace/api-adapter";
import { acceptSent, appendOlder } from "@/lib/workspace/history";
import type { Conversation, Person } from "@/lib/workspace/models";
import { mayRetrySend, type Resource } from "@/lib/workspace/resource";
import { prepareMessage } from "@/lib/workspace/sending";
import { ChatHeader, MessageList } from "./chat";
import { MessageComposer } from "./composer";
import { Modal } from "./dialogs";
import { WorkspaceSidebar } from "./navigation";
import { Avatar, BrandMark, IconButton } from "./ui";
import { WorkspaceStatus } from "./workspace-status";

type Access =
  | { status: "configuration-pending" | "login-required" }
  | { status: "ready"; workspaceId: string };

export function LiveWorkspaceEntry({ access }: { access: Access }) {
  if (access.status === "ready") return <LiveWorkspace key={access.workspaceId} workspaceId={access.workspaceId} />;
  return <LiveGate loginRequired={access.status === "login-required"} />;
}

function LiveGate({ loginRequired }: { loginRequired: boolean }) {
  return (
    <main className="live-gate">
      <section className="live-gate-card" aria-labelledby="live-title">
        <BrandMark />
        <h1 id="live-title">{loginRequired ? "Sign in to SkillConnect" : "SkillConnect live workspace"}</h1>
        <p>{loginRequired ? "A current employee session is required." : "Employee sign-in is pending configuration."}</p>
        <Link href="/login">Open sign-in</Link>
      </section>
    </main>
  );
}

type Adapter = ReturnType<typeof createApiWorkspace>;
const emptyPeople = new Map<string, Person>();

function LiveWorkspace({ workspaceId }: { workspaceId: string }) {
  const adapter = useMemo(() => createApiWorkspace(workspaceId), [workspaceId]);
  const [items, setItems] = useState<Resource<ApiConversation[]>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState("");
  const [people, setPeople] = useState<Record<string, ReadonlyMap<string, Person>>>({});
  const [expired, setExpired] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const [pendingSends, setPendingSends] = useState(() => new Map<string, SendMessageRequest>());

  const checkSession = useCallback((error: unknown) => {
    if (error instanceof ApiError && error.status === 401) {
      setPendingSends(new Map());
      setPeople({});
      setItems({ status: "loading" });
      setExpired(true);
    }
  }, []);

  useEffect(() => {
    if (expired) return;
    const controller = new AbortController();
    adapter.conversations(controller.signal).then(
      (value) => { if (!controller.signal.aborted) setItems({ status: "ready", value }); },
      (error) => {
        if (controller.signal.aborted) return;
        checkSession(error);
        setItems({ status: "error", error });
      },
    );
    return () => controller.abort();
  }, [adapter, attempt, checkSession, expired]);

  const rememberMembers = useCallback((id: string, members: Person[]) => {
    setPeople((previous) => ({ ...previous, [id]: new Map(members.map((member) => [member.id, member])) }));
  }, []);

  function rememberSend(id: string, input?: SendMessageRequest) {
    setPendingSends((previous) => {
      const next = new Map(previous);
      if (input) next.set(id, input);
      else next.delete(id);
      return next;
    });
  }

  if (expired) return <LiveGate loginRequired />;
  const conversations = items.status === "ready" ? items.value.map((item) => displayConversation(item, people[item.id])) : [];
  const conversation = conversations.find(({ id }) => id === selected) ?? conversations[0];

  function closeNavigation() {
    setMobileOpen(false);
    toggle.current?.focus();
  }

  return (
    <div className={`workspace ${mobileOpen ? "mobile-navigation-open" : ""}`}>
      <header className="topbar">
        <div className="product">
          <IconButton ref={toggle} icon="menu" className="mobile-menu" label="Toggle workspace navigation" aria-controls="workspace-sidebar" aria-expanded={mobileOpen} onClick={() => {
            if (mobileOpen) closeNavigation();
            else {
              setMobileOpen(true);
              requestAnimationFrame(() => closeButton.current?.focus());
            }
          }} />
          <strong>SkillConnect</strong>
        </div>
      </header>
      <div className="rail"><span className="workspace-mark"><BrandMark /></span></div>
      <WorkspaceSidebar conversations={conversations} activeId={conversation?.id ?? ""} choose={(id) => {
        setSelected(id);
        setMobileOpen(false);
        if (mobileOpen) requestAnimationFrame(() => title.current?.focus({ preventScroll: true }));
      }} mobileOpen={mobileOpen} closeMobile={closeNavigation} closeButtonRef={closeButton} />
      {conversation ? <LiveConversation key={conversation.id} conversation={conversation} adapter={adapter}
        title={title} people={people[conversation.id] ?? emptyPeople}
        rememberMembers={rememberMembers} checkSession={checkSession} pendingSend={pendingSends.get(conversation.id)} rememberSend={rememberSend} /> :
        <main className="chat">
          {items.status === "loading" && <WorkspaceStatus loading="Loading conversations…" />}
          {items.status === "error" && <WorkspaceStatus error={items.error} retry={() => {
            setItems({ status: "loading" });
            setAttempt((value) => value + 1);
          }} />}
          {items.status === "ready" && <p className="workspace-state">You don’t belong to any conversations in this workspace yet.</p>}
        </main>}
    </div>
  );
}

function LiveConversation({ conversation, adapter, title, people, rememberMembers, checkSession, pendingSend, rememberSend }: {
  conversation: Conversation;
  adapter: Adapter;
  title: React.Ref<HTMLHeadingElement>;
  people: ReadonlyMap<string, Person>;
  rememberMembers: (id: string, members: Person[]) => void;
  checkSession: (error: unknown) => void;
  pendingSend?: SendMessageRequest;
  rememberSend: (id: string, input?: SendMessageRequest) => void;
}) {
  const { id } = conversation;
  const [history, setHistory] = useState<Resource<ApiMessagePage>>({ status: "loading" });
  const [members, setMembers] = useState<Resource<Person[]>>({ status: "loading" });
  const [showMembers, setShowMembers] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState(() => pendingSend?.body ?? "");
  const [sending, setSending] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<{ error: unknown }>();
  const [sendError, setSendError] = useState<{ error: unknown }>();
  const controller = useRef<AbortController>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const sendingNow = useRef(false);
  const pagingNow = useRef(false);

  useEffect(() => {
    const request = new AbortController();
    controller.current = request;
    const rejected = (error: unknown, report: (error: unknown) => void) => {
      if (request.signal.aborted) return;
      checkSession(error);
      report(error);
    };
    adapter.history(id, {}, request.signal).then(
      (value) => { if (!request.signal.aborted) setHistory({ status: "ready", value }); },
      (error) => rejected(error, (failure) => setHistory({ status: "error", error: failure })),
    );
    adapter.members(id, request.signal).then(
      (value) => {
        if (request.signal.aborted) return;
        setMembers({ status: "ready", value });
        rememberMembers(id, value);
      },
      (error) => rejected(error, (failure) => {
        rememberMembers(id, []);
        setMembers({ status: "error", error: failure });
      }),
    );
    return () => request.abort();
  }, [adapter, attempt, checkSession, id, rememberMembers]);

  const page = history.status === "ready" ? history.value : undefined;
  const messages = (page?.messages ?? []).map((entry) => displayMessage(entry, people)).reverse();

  function reload() {
    setHistory({ status: "loading" });
    setMembers({ status: "loading" });
    setOlderError(undefined);
    setAttempt((value) => value + 1);
  }

  async function loadOlder() {
    const signal = controller.current?.signal;
    if (!signal || !page?.next_cursor || pagingNow.current) return;
    pagingNow.current = true;
    setLoadingOlder(true);
    setOlderError(undefined);
    try {
      const older = await adapter.history(id, { cursor: page.next_cursor }, signal);
      if (!signal.aborted) setHistory((current) => current.status === "ready"
        ? { status: "ready", value: appendOlder(current.value, older) } : current);
    } catch (error) {
      if (signal.aborted) return;
      checkSession(error);
      if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
        setHistory({ status: "error", error });
      } else setOlderError({ error });
    } finally {
      pagingNow.current = false;
      setLoadingOlder(false);
    }
  }

  async function send() {
    const signal = controller.current?.signal;
    if (!signal || !page || !draft.trim() || sendingNow.current) return;
    sendingNow.current = true;
    setSending(true);
    setSendError(undefined);
    try {
      const input = prepareMessage(draft, pendingSend);
      rememberSend(id, input);
      const message = await adapter.send(id, input, signal);
      if (signal.aborted) return;
      rememberSend(id);
      setDraft((current) => current === input.body ? "" : current);
      setHistory((current) => current.status === "ready"
        ? { status: "ready", value: acceptSent(current.value, message) } : current);
      composer.current?.focus();
    } catch (error) {
      if (signal.aborted) return;
      checkSession(error);
      // Keep the key after a conflict too, so another click cannot silently create a duplicate.
      setSendError({ error });
    } finally {
      sendingNow.current = false;
      setSending(false);
    }
  }

  return (
    <main className="chat">
      <ChatHeader conversation={conversation} titleRef={title} showMembers={() => setShowMembers(true)} />
      {history.status === "loading" && <WorkspaceStatus loading="Loading message history…" />}
      {history.status === "error" && <WorkspaceStatus error={history.error} retry={reload} />}
      {page && <>
        <MessageList conversation={conversation} messages={messages} historyControl={
          olderError ? <WorkspaceStatus error={olderError.error} retry={() => { void loadOlder(); }} /> :
            page.next_cursor && <button className="history-button" type="button" disabled={loadingOlder} onClick={() => { void loadOlder(); }}>{loadingOlder ? "Loading earlier messages…" : "Load earlier messages"}</button>
        } />
        <div>
          {sendError && <WorkspaceStatus error={sendError.error} retry={mayRetrySend(sendError.error) && !sending && draft.trim()
            ? () => { void send(); } : undefined} />}
          <MessageComposer conversation={conversation} draft={draft} change={setDraft} send={() => { void send(); }} busy={sending} inputRef={composer} />
        </div>
      </>}
      {showMembers && <Modal title="Conversation members" close={() => setShowMembers(false)}>
        {members.status === "loading" && <WorkspaceStatus loading="Loading members…" />}
        {members.status === "error" && <WorkspaceStatus error={members.error} retry={reload} />}
        {members.status === "ready" && (members.value.length ?
          <ul className="conversation-members">{members.value.map((person) => <li key={person.id}><Avatar person={person} />{person.name}</li>)}</ul> :
          <p>No active members to display.</p>)}
      </Modal>}
    </main>
  );
}
