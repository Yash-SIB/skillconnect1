import { Fragment } from "react";
import { parseInline, parseMessageBlocks } from "@/lib/message-format";

const inlineElements = { bold: "strong", italic: "em", strike: "s", code: "code" } as const;

function InlineContent({ text }: { text: string }) {
  return parseInline(text).map((part, index) => {
    if (part.kind === "text") return <Fragment key={index}>{part.text}</Fragment>;
    const Element = inlineElements[part.kind];
    return <Element key={index}>{part.text}</Element>;
  });
}

export function MessageContent({ text }: { text: string }) {
  return (
    <div className="message-content">
      {parseMessageBlocks(text).map((block, index) => block.kind === "list" ? (
        <ul key={index}>
          {block.items.map((item, itemIndex) => <li key={itemIndex}><InlineContent text={item} /></li>)}
        </ul>
      ) : (
        <div key={index}><InlineContent text={block.text} /></div>
      ))}
    </div>
  );
}
