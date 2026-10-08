import { BookOpen, FileText, Network, type LucideProps } from "lucide-react"
import type { SourceKind } from "../types"

export const sourceKindLabel: Record<SourceKind, string> = {
  paper: "Library",
  doc: "Docs",
  knowledge: "Knowledge",
}

export function SourceIcon({ kind, ...props }: { kind: SourceKind } & LucideProps) {
  const Icon = kind === "paper" ? BookOpen : kind === "doc" ? FileText : Network
  return <Icon {...props} />
}
