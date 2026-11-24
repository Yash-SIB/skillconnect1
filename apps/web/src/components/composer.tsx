import { useId, useRef, useState } from "react";
import { conversationLabel, people, type Conversation, type Panel } from "@/lib/demo";
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

function ComposerPicker({ picker, close, select }: { picker: Picker; close: () => void; select: (value: string) => void }) {
  return (
    <Modal title={picker === "emoji" ? "Add an emoji" : "Mention a teammate"} close={close}>
      {picker === "emoji" ? (
        <div className="emoji-picker">
          {emojis.map(([emoji, label], i) => <button key={label} type="button" data-initial-focus={i === 0 ? true : undefined} aria-label={label} title={label} onClick={() => select(emoji)}>{emoji}</button>)}
        </div>
      ) : (
        <div className="dialog-list">
          <p>Mentions use sample teammates and send no notifications.</p>
          {people.map((person, i) => (
            <button key={person.id} type="button" data-initial-focus={i === 0 ? true : undefined} onClick={() => select(`@${person.name} `)}>
              <Avatar person={person} />{person.name}
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

export function MessageComposer({ conversation, draft, attachments, change, addAttachments, removeAttachment, send, open, inputRef }: {
  conversation: Conversation;
  draft: string;
  attachments: string[];
  change: (text: string) => void;
  addAttachments: (names: string[]) => void;
  removeAttachment: (name: string) => void;
  send: () => void;
  open: (panel: Panel) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const [format, setFormat] = useState(true);
  const [picker, setPicker] = useState<Picker | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const shortcutId = useId();
  const messageLabel = `Message ${conversationLabel(conversation)}`;

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
      <form className="composer" onSubmit={(event) => { event.preventDefault(); send(); }}>
        {format && <div className="format-bar" role="group" aria-label="Message formatting">
          {formats.map(({ icon, marker, label }) => <IconButton key={icon} icon={icon} label={label} onClick={() => insert(marker, marker)} />)}
          <IconButton icon="list" label="Bulleted list" onClick={insertListItem} />
        </div>}
        <textarea ref={inputRef} rows={2} maxLength={4000} value={draft} aria-label={messageLabel} aria-describedby={shortcutId} placeholder={messageLabel} onChange={(event) => change(event.target.value)} onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            send();
          }
        }} />
        {attachments.length > 0 && (
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
        <input hidden ref={fileInput} type="file" multiple onChange={(event) => {
          addAttachments(Array.from(event.target.files ?? [], (file) => file.name));
          event.target.value = "";
        }} />
        <div className="composer-tools">
          <div className="composer-actions" role="group" aria-label="Message tools">
            <IconButton icon="format" label="Toggle formatting" className="format-toggle" aria-pressed={format} onClick={() => setFormat(!format)} />
            <IconButton icon="smile" label="Add emoji" aria-haspopup="dialog" onClick={() => setPicker("emoji")} />
            <IconButton icon="at" label="Mention teammate" aria-haspopup="dialog" onClick={() => setPicker("mention")} />
            <IconButton icon="clip" label="Attach files (local preview)" onClick={() => fileInput.current?.click()} />
            <span className="toolbar-divider" aria-hidden="true" />
            <IconButton icon="video" label="Video calls" onClick={() => open("call")} />
            <IconButton icon="mic" label="Voice calls" onClick={() => open("call")} />
          </div>
          <button className="send-button" type="submit" disabled={!draft.trim() && !attachments.length} aria-label="Send message"><Icon name="send" />Send</button>
        </div>
      </form>
      <p className="composer-hint" id={shortcutId}><kbd>Enter</kbd> to send <span aria-hidden="true">·</span> <kbd>Shift</kbd> + <kbd>Enter</kbd> for a new line</p>
      {picker && <ComposerPicker picker={picker} close={() => setPicker(null)} select={(value) => {
        setPicker(null);
        insert(value, "", true);
      }} />}
    </div>
  );
}
