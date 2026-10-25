/** Submit only for an explicit modifier chord; never while composing or repeating a key. */
export function isAuditSubmitShortcut(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "repeat" | "isComposing" | "defaultPrevented">,
): boolean {
  return event.key === "Enter" && (event.ctrlKey || event.metaKey) &&
    !event.altKey && !event.shiftKey && !event.repeat && !event.isComposing && !event.defaultPrevented;
}
