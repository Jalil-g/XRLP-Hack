import assert from "node:assert/strict";
import { test } from "node:test";
import { isAuditSubmitShortcut } from "../lib/shortcuts.ts";

const event = {
  key: "Enter", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
  repeat: false, isComposing: false, defaultPrevented: false,
};

test("audit submit requires Ctrl+Enter or Cmd+Enter", () => {
  assert.equal(isAuditSubmitShortcut(event), false);
  assert.equal(isAuditSubmitShortcut({ ...event, ctrlKey: true }), true);
  assert.equal(isAuditSubmitShortcut({ ...event, metaKey: true }), true);
  assert.equal(isAuditSubmitShortcut({ ...event, ctrlKey: true, key: "Escape" }), false);
});

test("shortcut ignores repeats, composition, extra modifiers, and handled events", () => {
  for (const field of ["altKey", "shiftKey", "repeat", "isComposing", "defaultPrevented"] as const) {
    assert.equal(isAuditSubmitShortcut({ ...event, ctrlKey: true, [field]: true }), false, field);
  }
});
