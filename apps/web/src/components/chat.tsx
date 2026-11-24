import { useEffect, useRef } from "react";
import { conversationLabel, type Conversation, type Message, type Panel } from "@/lib/demo";
import { Icon, type IconName } from "./icon";
import { MessageContent } from "./message-content";
import { Avatar, IconButton } from "./ui";

export function ChatHeader({ conversation, favorite, toggleFavorite, open, search, titleRef }: {
  conversation: Conversation; favorite: boolean; toggleFavorite: () => void; open: (panel: Panel) => void; search: () => void;
  titleRef: React.Ref<HTMLHeadingElement>;
}) {
  return (
    <header className="chat-header">
      <div className="chat-titlebar">
        <div className="chat-title">{conversation.person ? <Avatar person={conversation.person} status /> : <Icon name={conversation.private ? "lock" : "hash"} />}<h1 ref={titleRef} tabIndex={-1}>{conversation.name}</h1></div>
        <IconButton icon="star" label="Favorite conversation" aria-pressed={favorite} className={favorite ? "favorite" : ""} onClick={toggleFavorite} />
        <div className="chat-actions">
          <IconButton icon="users" label="Conversation details" onClick={() => open("details")} />
          <IconButton icon="bell" label="Notifications" onClick={() => open("notifications")} />
          <IconButton icon="search" label="Search this conversation" onClick={search} />
          <IconButton icon="more" label="More conversation details" onClick={() => open("details")} />
        </div>
      </div>
      <div className="chat-tabs"><span><Icon name="chat" />Messages</span></div>
    </header>
  );
}

const cards: { panel: Panel; icon: IconName; title: string; detail: string; theme: string }[] = [
  { panel: "handbook", icon: "book", title: "Add company handbook", detail: "Give your team a place to start.", theme: "blue" },
  { panel: "welcome", icon: "chat", title: "Personalize welcome message", detail: "Say hello in your own words.", theme: "orange" },
  { panel: "invite", icon: "userPlus", title: "Invite teammates", detail: "Bring the team together.", theme: "yellow" },
];

function ChannelWelcome({ conversation, empty, open }: { conversation: Conversation; empty: boolean; open: (panel: Panel) => void }) {
  return (
    <section className="welcome" aria-labelledby="welcome-title">
      <div className="welcome-banner">
        <div className="welcome-copy">
          <h2 id="welcome-title">Welcome to <span>{conversationLabel(conversation)}</span></h2>
          <p>{conversation.description}</p>
          {empty && <p className="welcome-prompt">Send the first message to start the conversation.</p>}
        </div>
        <div className="welcome-art" aria-hidden="true">
          <div className="orbit orbit-one" /><div className="orbit orbit-two" />
          <div className="art-tile art-blue"><Icon name="hash" /></div>
          <div className="art-tile art-orange"><Icon name="chat" /></div>
          <div className="art-tile art-yellow"><Icon name="spark" /></div>
          <i className="art-dot art-dot-one" /><i className="art-dot art-dot-two" />
        </div>
      </div>
      <div className="welcome-cards">
        {cards.map(({ panel, icon, title, detail, theme }) => (
          <button type="button" key={panel} className={`welcome-card ${theme}`} onClick={() => open(panel)}>
            <span className="card-icon"><Icon name={icon} /></span>
            <Icon name="arrow" className="card-arrow" />
            <strong>{title}</strong>
            <small>{detail}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

export function MessageList({ conversation, messages, open, target }: { conversation: Conversation; messages: Message[]; open: (panel: Panel) => void; target?: { id: string } }) {
  const scroll = useRef<HTMLDivElement>(null);
  const latest = messages.at(-1);
  const latestId = latest?.id;
  const lastFromProfile = latest?.author.id === "you";
  const empty = messages.length === 0;
  const showWelcome = !conversation.person && (conversation.id === "general" || empty);

  useEffect(() => {
    const container = scroll.current;
    if (!container) return;

    const result = target && document.getElementById("message-" + target.id);
    if (result) {
      const offset = result.getBoundingClientRect().top - container.getBoundingClientRect().top;
      container.scrollTop += offset - (container.clientHeight - result.offsetHeight) / 2;
    } else if (latestId && (lastFromProfile || conversation.id !== "general")) {
      container.scrollTop = container.scrollHeight;
    }
  }, [conversation.id, latestId, lastFromProfile, target]);

  return (
    <div className="timeline" ref={scroll} role="region" aria-label="Conversation history" tabIndex={0}>
      <div className={`timeline-content ${empty ? "timeline-empty" : ""}`}>
        {showWelcome && <ChannelWelcome conversation={conversation} empty={empty} open={open} />}
        {!showWelcome && empty && (
          <section className="conversation-intro">
            {conversation.person && <Avatar person={conversation.person} />}
            <h2>{conversationLabel(conversation)}</h2>
            <p>{conversation.description} Send a message to get started.</p>
          </section>
        )}
        <div className="message-stream">
          {!empty && <div className="date-line"><span>Today</span></div>}
          <div role="log" aria-label="Messages" className="message-log">
            {messages.map((message) => (
              <article id={"message-" + message.id} key={message.id} className={target?.id === message.id ? "message message-target" : "message"}>
                <Avatar person={message.author} />
                <div className="message-body">
                  <div className="message-heading"><strong>{message.author.name}</strong><span>{message.time}</span></div>
                  {message.text && <MessageContent text={message.text} />}
                  {!!message.attachments?.length && (
                    <ul className="sent-attachments" aria-label="Attachment previews">
                      {message.attachments.map((name) => <li key={name}><Icon name="files" /><span>{name}<small>File name preview</small></span></li>)}
                    </ul>
                  )}
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
