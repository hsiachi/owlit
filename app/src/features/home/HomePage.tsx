import { Placeholder } from "@/app/Placeholder"
import { WaitingOnYou } from "./WaitingOnYou"

// Home answers "where was I", "what is waiting for me" and "what changed while I was away". Only the
// second is built so far; the rest waits on the Home design round.
export function HomePage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 pt-10">
        <WaitingOnYou />
      </div>
      <Placeholder name="Home" />
    </div>
  )
}
