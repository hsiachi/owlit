import { toast } from "sonner"

// Copy, saying so only when it fails; callers decide how to confirm success
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    toast.error("Could not write to the clipboard")
    return false
  }
}
