import { useId, useRef, useState } from "react";
 import { conversationLabel, type Conversation, type Panel, type Person } from "@/lib/workspace/models";
import { Modal } from "./dialogs";
import { Icon, type IconName } from "./icon";
import { Avatar, IconButton } from "./ui";

const formats: { icon: IconName; label: string; marker: string }[] = [
  { icon: "bold", label: "Bold", marker: "**" },
  { icon: "italic", label: "Italic", marker: "_" },
  { icon: "strike", label: "Strikethrough", marker: "~~" },
  { icon: "code", label: "Inline code", marker: "`" },
];

const emojis = [
  ["👋", "Wave"], ["😊", "Smile"], ["👍", "Thumbs up"],
  ["🎉", "Celebrate"], ["❤️", "Heart"], ["🙌", "Raised hands"],
];

type Picker = "emoji" | "mention";

function ComposerPicker({ picker, close, select, teammates }: { picker: Picker; close: () => void; select: (value: string) => void; teammates: Person[] }) {
  return (
    <Modal title={picker === "emoji" ? "Add an emoji" : "Mention a teammate"} close={close}>
      {picker === "emoji" ? (
        <div className="emoji-picker">
          {emojis.map(([emoji, label], i) => <button key={label} type="button" data-initial-focus={i === 0 ? true : undefined} aria-label={label} title={label} onClick={() => select(emoji)}>{emoji}</button>)}
        </div>
      ) : (
        <div className="dialog-list">
          <p>Mentions are inserted as text.</p>
          {teammates.map((person, i) => (
            <button key={person.id} type="button" data-initial-focus={i === 0 ? true : undefined} onClick={() => select(`@${person.name} `)}>
              <Avatar person={person} />{person.name}
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

export function MessageComposer({ conversation, draft, attachments = [], change, addAttachments, removeAttachment, send, open, inputRef, teammates = [], busy = false }: {
  conversation: Conversation;
  draft: string;
  attachments?: string[];
  change: (text: string) => void;
  addAttachments?: (names: string[]) => void;
  removeAttachment?: (name: string) => void;
  send: () => void;
  open?: (panel: Panel) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  teammates?: Person[];
  busy?: boolean;
}) {
  const [format, setFormat] = useState(true);
  const [picker, setPicker] = useState<Picker | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const shortcutId = useId();
  const messageLabel = `Message ${conversationLabel(conversation)}`;
  const canSend = !busy && Boolean(draft.trim() || attachments.length);

  function insert(before: string, after = "", replaceSelection = false) {
    const input = inputRef.current;
    if (!input) return;
    const { selectionStart, selectionEnd } = input;
    const selected = replaceSelection ? "" : draft.slice(selectionStart, selectionEnd);
    change(draft.slice(0, selectionStart) + before + selected + after + draft.slice(selectionEnd));
    const start = selectionStart + before.length;
    const end = start + selected.length;
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(after ? start : end, end);
    });
  }

  function insertListItem() {
    const cursor = inputRef.current?.selectionStart ?? 0;
    insert(cursor === 0 || draft[cursor - 1] === "\n" ? "- " : "\n- ");
  }

  return (
    <div className="composer-area">
      <form className="composer" onSubmit={(event) => { event.preventDefault(); if (canSend) send(); }}>
        {format && <div className="format-bar" role="group" aria-label="Message formatting">
          {formats.map(({ icon, marker, label }) => <IconButton key={icon} icon={icon} label={label} onClick={() => insert(marker, marker)} />)}
          <IconButton icon="list" label="Bulleted list" onClick={insertListItem} />
        </div>}
        <textarea ref={inputRef} rows={2} maxLength={4000} value={draft} aria-label={messageLabel} aria-describedby={shortcutId} placeholder={messageLabel} onChange={(event) => change(event.target.value)} onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (canSend) send();
          }
        }} />
        {attachments.length > 0 && removeAttachment && (
          <div className="composer-attachments">
            <ul aria-label="Files to attach">
              {attachments.map((name) => <li key={name}><Icon name="clip" /><span title={name}>{name}</span><IconButton icon="close" label={`Remove ${name}`} onClick={() => {
                removeAttachment(name);
                inputRef.current?.focus();
              }} /></li>)}
            </ul>
            <small>Only file names are kept in this preview.</small>
          </div>
        )}
        {addAttachments && <input hidden ref={fileInput} type="file" multiple onChange={(event) => {
          addAttachments(Array.from(event.target.files ?? [], (file) => file.name));
          event.target.value = "";
        }} />}
        <div className="composer-tools">
          <div className="composer-actions" role="group" aria-label="Message tools">
            <IconButton icon="format" label="Toggle formatting" className="format-toggle" aria-pressed={format} onClick={() => setFormat(!format)} />
            <IconButton icon="smile" label="Add emoji" aria-haspopup="dialog" onClick={() => setPicker("emoji")} />
            {!!teammates.length && <IconButton icon="at" label="Mention teammate" aria-haspopup="dialog" onClick={() => setPicker("mention")} />}
            {addAttachments && <IconButton icon="clip" label="Attach files (local preview)" onClick={() => fileInput.current?.click()} />}
            {open && <>
              <span className="toolbar-divider" aria-hidden="true" />
              <IconButton icon="video" label="Video calls" onClick={() => open("call")} />
              <IconButton icon="mic" label="Voice calls" onClick={() => open("call")} />
            </>}
          </div>
          <button className="send-button" type="submit" disabled={!canSend} aria-label={busy ? "Sending message" : "Send message"}><Icon name="send" />{busy ? "Sending…" : "Send"}</button>
        </div>
      </form>
      <p className="composer-hint" id={shortcutId}><kbd>Enter</kbd> to send <span aria-hidden="true">·</span> <kbd>Shift</kbd> + <kbd>Enter</kbd> for a new line</p>
      {picker && <ComposerPicker picker={picker} teammates={teammates} close={() => setPicker(null)} select={(value) => {
        setPicker(null);
        insert(value, "", true);
      }} />}
    </div>
  );
}
