// The card that opens under a paragraph for something said about its words: Owlit's note (agent-notes)
// and a reader's comment (reader-comments). One shape, so the two can't drift; only the rule's colour
// says whose it is (owlit-mark or person-mark). Who and when come first, the actions sit at the bottom
// right as text buttons. The card's overhang into the margin is on the fold, so the fold's clip never
// cuts it.
export function sideCardTheme(prefix: string, rule: string) {
  const textButton = {
    height: "26px",
    padding: "0 8px",
    borderRadius: "8px",
    fontSize: "13px",
    background: "none",
    border: "none",
    color: "var(--muted-foreground)",
    cursor: "pointer",
  }
  return {
    [`.${prefix}-fold`]: { marginLeft: "-16px" },
    [`.${prefix}`]: {
      margin: "4px 0 14px",
      padding: "8px 12px 6px 13px",
      backgroundColor: "var(--card)",
      border: "1px solid var(--border)",
      borderLeft: `3px solid ${rule}`,
      borderRadius: "4px 10px 10px 4px",
      fontSize: "14px",
      lineHeight: "1.55",
      cursor: "default",
    },
    [`.${prefix} p`]: { margin: "0" },
    [`.${prefix}-head`]: { display: "flex", alignItems: "center", gap: "8px", minHeight: "20px", marginBottom: "2px", fontSize: "12px", color: "var(--muted-foreground)" },
    [`.${prefix}-lost`]: { fontSize: "13px", color: "var(--muted-foreground)", marginBottom: "6px !important" },
    [`.${prefix}-actions`]: { display: "flex", justifyContent: "flex-end", gap: "2px", marginTop: "4px", marginRight: "-6px" },
    [`.${prefix}-actions[hidden]`]: { display: "none" },
    [`.${prefix}-actions button`]: textButton,
    [`.${prefix}-actions button:hover`]: { backgroundColor: "var(--accent)", color: "var(--foreground)" },
    // A field inside the card (a reply) is drawn as every field is: the input border, darker on focus
    [`.${prefix} textarea`]: {
      resize: "none",
      font: "inherit",
      fontSize: "14px",
      padding: "6px 10px",
      borderRadius: "10px",
      border: "1px solid var(--input)",
      background: "transparent",
      color: "var(--foreground)",
      outline: "none",
    },
    [`.${prefix} textarea:focus`]: { borderColor: "color-mix(in oklch, var(--foreground) 30%, transparent)" },
    // The words it is about: a 2px underline below and thicker than a link's, a wash while it is open that
    // fades in over --t-mark (the words are redrawn when the card opens, so a keyframe, in index.css)
    [`.${prefix}-mark`]: {
      textDecorationLine: "underline",
      textDecorationColor: rule,
      textDecorationThickness: "2px",
      textUnderlineOffset: "5px",
      textDecorationSkipInk: "none",
    },
  }
}

// The wash's own keyframe rule, shared by both
export const washOpen = "note-wash var(--t-mark) var(--ease)"
