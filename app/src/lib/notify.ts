// A system notification, only while owlit isn't the window in front (in front, the page or a toast says
// it). Clicking it brings owlit back, then runs onClick (to open what it's about).
export function notifyWhenAway({ title, body, onClick }: { title: string; body?: string; onClick?: () => void }) {
  if (typeof Notification === "undefined" || document.hasFocus()) return
  const notification = new Notification(title, { body })
  notification.onclick = () => {
    window.focus()
    onClick?.()
  }
}
