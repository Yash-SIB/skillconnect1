type InlinePart = {
  kind: "text" | "bold" | "italic" | "strike" | "code";
  text: string;
};

type MessageBlock = { kind: "text"; text: string } | { kind: "list"; items: string[] };

const inlinePattern = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|(?<!\w)_([^_\n]+)_(?!\w)|~~([^~\n]+)~~/g;

export function parseInline(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  let end = 0;

  for (const match of text.matchAll(inlinePattern)) {
    if (match.index > end) parts.push({ kind: "text", text: text.slice(end, match.index) });
    const [token, code, bold, italic, strike] = match;

    if (code !== undefined) parts.push({ kind: "code", text: code });
    if (bold !== undefined) parts.push({ kind: "bold", text: bold });
    if (italic !== undefined) parts.push({ kind: "italic", text: italic });
    if (strike !== undefined) parts.push({ kind: "strike", text: strike });

    end = match.index + token.length;
  }

  if (end < text.length) parts.push({ kind: "text", text: text.slice(end) });
  return parts;
}

export function parseMessageBlocks(text: string): MessageBlock[] {
  const blocks: MessageBlock[] = [];

  for (const line of text.split(/\r?\n/)) {
    const previous = blocks.at(-1);
    if (line.startsWith("- ") && line.slice(2).trim()) {
      const item = line.slice(2);
      if (previous?.kind === "list") previous.items.push(item);
      else blocks.push({ kind: "list", items: [item] });
    } else if (previous?.kind === "text") {
      previous.text += "\n" + line;
    } else {
      blocks.push({ kind: "text", text: line });
    }
  }

  return blocks;
}
