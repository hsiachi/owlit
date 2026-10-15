// Whether a key event's target is a field being typed in: a text input, a text area, a native select,
// or anything inside an editable region (the PDF comment box, the doc editor)
export const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
