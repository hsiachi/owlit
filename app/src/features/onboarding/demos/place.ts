import { createContext, useContext, useEffect, useState } from "react"

// The places in the small window's rail, in the app's order
export type DemoPlace = "home" | "chat" | "docs" | "knowledge" | "library"

export const DEMO_PLACES: DemoPlace[] = ["home", "chat", "docs", "knowledge", "library"]

export interface PlaceClaim {
  place: DemoPlace | null
  // Owlit's dot on a place in the rail (Chat, while a hand-off's result waits to be seen)
  dot: DemoPlace | null
}

// A scene says where in the app it is, so the rail's lift follows it as it moves (Ask goes from the Library
// to Chat). The newest claim wins: while one scene fades out and the next fades in, both are mounted.
export const DemoPlaceContext = createContext<((token: symbol, claim: PlaceClaim | null) => void) | null>(null)

export function useDemoPlace(place: DemoPlace | null, dot: DemoPlace | null = null) {
  const claim = useContext(DemoPlaceContext)
  const [token] = useState(() => Symbol("scene"))
  useEffect(() => {
    claim?.(token, { place, dot })
  }, [claim, token, place, dot])
  useEffect(() => () => claim?.(token, null), [claim, token])
}
