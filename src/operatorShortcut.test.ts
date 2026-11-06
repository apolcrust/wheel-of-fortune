import { describe, expect, it } from "vitest";
import { isOperatorShortcut } from "./operatorShortcut";

function keyboardEvent(overrides: Partial<KeyboardEvent> = {}) {
  return {
    code: "KeyO",
    repeat: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    target: null,
    ...overrides,
  } as KeyboardEvent;
}

function targetWithTag(tagName: string): EventTarget {
  const target = new EventTarget();
  Object.defineProperty(target, "tagName", { value: tagName });
  return target;
}

describe("operator shortcut activation", () => {
  it("activates only for the configured, eligible, idle shortcut", () => {
    expect(isOperatorShortcut(keyboardEvent(), "KeyO", false, true)).toBe(true);
    expect(isOperatorShortcut(keyboardEvent(), "KeyP", false, true)).toBe(false);
    expect(isOperatorShortcut(keyboardEvent(), "KeyO", true, true)).toBe(false);
    expect(isOperatorShortcut(keyboardEvent(), "KeyO", false, false)).toBe(false);
  });

  it("ignores repeats, modified keys, and text-entry controls", () => {
    expect(isOperatorShortcut(keyboardEvent({ repeat: true }), "KeyO", false, true)).toBe(false);
    expect(isOperatorShortcut(keyboardEvent({ ctrlKey: true }), "KeyO", false, true)).toBe(false);
    expect(isOperatorShortcut(keyboardEvent({ target: targetWithTag("INPUT") }), "KeyO", false, true)).toBe(false);
    expect(isOperatorShortcut(keyboardEvent({ target: targetWithTag("TEXTAREA") }), "KeyO", false, true)).toBe(false);
    expect(isOperatorShortcut(keyboardEvent({ target: targetWithTag("SELECT") }), "KeyO", false, true)).toBe(true);
    expect(isOperatorShortcut(keyboardEvent({ target: targetWithTag("BUTTON") }), "KeyO", false, true)).toBe(true);
  });
});
