import { useEffect } from "react";

export function isOperatorShortcut(
  event: KeyboardEvent,
  shortcut: string,
  busy: boolean,
  eligible: boolean,
): boolean {
  if (!shortcut || event.code !== shortcut || event.repeat || busy || !eligible ||
      event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  const target = event.target;
  if (target && "tagName" in target && (
    ("isContentEditable" in target && target.isContentEditable === true) ||
    ["INPUT", "TEXTAREA"].includes(String(target.tagName))
  )) return false;
  return true;
}

export function useOperatorShortcut(
  shortcut: string,
  busy: boolean,
  eligible: boolean,
  onActivate: () => void,
): void {
  useEffect(() => {
    const activate = (event: KeyboardEvent) => {
      if (!isOperatorShortcut(event, shortcut, busy, eligible)) return;
      event.preventDefault();
      onActivate();
    };
    window.addEventListener("keydown", activate);
    return () => window.removeEventListener("keydown", activate);
  }, [shortcut, busy, eligible, onActivate]);
}
