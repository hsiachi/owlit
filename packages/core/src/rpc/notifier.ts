import type { NotificationName, Notifications, RpcNotification } from "@owlit/protocol"

type Listener = (notification: RpcNotification) => void

// Fans core's notifications out to whoever is attached: the desktop transport now, sockets later
export class Notifier {
  private listeners = new Set<Listener>()

  notify<T extends NotificationName>(topic: T, payload: Notifications[T]) {
    const notification: RpcNotification = { jsonrpc: "2.0", method: topic, params: payload }
    for (const listener of this.listeners) {
      try {
        listener(notification)
      } catch (error) {
        // One broken client must not stop the others from hearing
        console.error(`[core] a ${topic} listener threw`, error)
      }
    }
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}
