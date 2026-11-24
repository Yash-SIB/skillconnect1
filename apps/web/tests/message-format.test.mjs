import assert from "node:assert/strict";
import test from "node:test";
import { parseInline, parseMessageBlocks } from "../src/lib/message-format.ts";

test("renders each of the composer's inline formatting shortcuts", () => {
  assert.deepEqual(parseInline("**bold** _emphasis_ ~~old~~ `**literal**`"), [
    { kind: "bold", text: "bold" },
    { kind: "text", text: " " },
    { kind: "italic", text: "emphasis" },
    { kind: "text", text: " " },
    { kind: "strike", text: "old" },
    { kind: "text", text: " " },
    { kind: "code", text: "**literal**" },
  ]);
});

test("preserves markup-looking text, underscores in names, and unfinished shortcuts", () => {
  const text = "<img src=x> release_candidate_1 **unfinished";
  assert.deepEqual(parseInline(text), [{ kind: "text", text }]);
});

test("groups adjacent bullet items while preserving ordinary line breaks", () => {
  assert.deepEqual(parseMessageBlocks("First\r\nSecond\r\n- A\r\n- **B**\r\n\r\nClosing"), [
    { kind: "text", text: "First\nSecond" },
    { kind: "list", items: ["A", "**B**"] },
    { kind: "text", text: "\nClosing" },
  ]);
});
