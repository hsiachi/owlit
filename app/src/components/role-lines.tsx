import type { Role } from "@owlit/protocol"
import { roleLines } from "@/features/chat/lib/selection"
import { cn } from "@/lib/utils"

// What a role may do, one line a class, as the composer's role menu, onboarding's Agent step and
// Settings › Owlit all say it: the same lines, read off the policy's table (roleLines)
export function RoleLines({ role, className }: { role: Role; className?: string }) {
  return (
    <ul className={cn("flex flex-col gap-0.5", className)}>
      {roleLines(role).map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  )
}
