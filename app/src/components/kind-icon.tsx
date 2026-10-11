import type { LucideProps } from "lucide-react"
import { KIND_ICON, type Kind } from "@/lib/kinds"

export function KindIcon({ kind, ...props }: { kind: Kind } & LucideProps) {
  const Icon = KIND_ICON[kind]
  return <Icon {...props} />
}
