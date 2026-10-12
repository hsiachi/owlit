import { useEffect, useRef, useState } from "react"
import { LogOutIcon } from "lucide-react"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { useChatStore } from "@/features/chat/store"
import type { Connector, SignIn } from "@/features/chat/types"
import { useFoldWhile } from "../form-state"
import { FoldedForm, IconAction, KeyInput, List, MaskedKey, Note, onHover, Picker, Row } from "../parts"

// The Owlit engine's sign-ins: one row for each it holds, and "Add a sign-in" for the rest. It can hold
// several at once; each chat picks a model from any of them in the composer.
export function EngineSignIns({ connector: c }: { connector: Connector }) {
  const check = useChatStore((s) => s.checkConnector)
  const [adding, setAdding] = useState(false)
  useFoldWhile(adding, () => setAdding(false))

  // What it holds is only known from the engine itself, so ask once if this run hasn't yet
  const asked = useRef(false)
  useEffect(() => {
    if (asked.current || c.signIns !== undefined || c.status === "checking") return
    asked.current = true
    void check(c.id)
  }, [c.id, c.signIns, c.status, check])

  const held = c.signIns ?? []
  // A provider's sign-ins replace each other (ChatGPT and an OpenAI key), so a held provider isn't offered again
  const heldProviders = new Set(held.map((s) => providerOf(c, s.methodId)))
  const offered = (c.signInMethods ?? []).filter((m) => !heldProviders.has(m.provider ?? m.id))

  return (
    <>
      {held.length > 0 && (
        <List>
          {held.map((s) => (
            <SignInRow key={s.methodId} connector={c} signIn={s} />
          ))}
        </List>
      )}
      {offered.length > 0 && <AddSignIn connector={c} methods={offered} open={adding} setOpen={setAdding} />}
    </>
  )
}

const providerOf = (c: Connector, methodId: string) => {
  const method = c.signInMethods?.find((m) => m.id === methodId)
  return method?.provider ?? methodId
}

// ChatGPT shows "Signed in" with Sign out on hover; a key shows its last four characters with Change,
// and Remove on hover, as Settings shows every key
function SignInRow({ connector: c, signIn: s }: { connector: Connector; signIn: SignIn }) {
  const signIn = useChatStore((st) => st.signInConnector)
  const signOut = useChatStore((st) => st.signOutConnector)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fold = () => setEditing(false)
  useFoldWhile(editing, fold)
  const apiKey = !!c.signInMethods?.find((m) => m.id === s.methodId)?.apiKey
  const remove = () => void signOut(c.id, s.methodId).catch((e: Error) => toast.error(e.message))

  const save = async (value: string) => {
    fold()
    setError(null)
    await signIn(c.id, s.methodId, value).catch((e: Error) => setError(e.message))
  }

  let control: React.ReactNode
  if (editing) {
    control = <KeyInput onSave={(value) => void save(value)} onCancel={fold} />
  } else if (apiKey) {
    control = <MaskedKey last4={s.hint} onChange={() => setEditing(true)} onRemove={remove} />
  } else {
    control = (
      <>
        <IconAction label="Sign out" className={onHover} onClick={remove}>
          <LogOutIcon />
        </IconAction>
        <span className="text-detail text-muted-foreground">Signed in</span>
      </>
    )
  }

  return (
    <Row name={s.name} control={control}>
      {error && <Note tone="bad">{error}</Note>}
    </Row>
  )
}

// Folded until asked for, like "Add an agent". ChatGPT signs in in the browser; the rest take a key.
function AddSignIn({ connector: c, methods, open, setOpen }: { connector: Connector; methods: NonNullable<Connector["signInMethods"]>; open: boolean; setOpen: (open: boolean) => void }) {
  const signIn = useChatStore((s) => s.signInConnector)
  const [methodId, setMethodId] = useState(methods[0].id)
  const [key, setKey] = useState("")
  const [waiting, setWaiting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const method = methods.find((m) => m.id === methodId) ?? methods[0]

  const close = () => {
    setOpen(false)
    setKey("")
    setError(null)
  }

  const run = async (apiKey?: string) => {
    setError(null)
    setWaiting(true)
    try {
      await signIn(c.id, method.id, apiKey)
      close()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setWaiting(false)
    }
  }

  return (
    <FoldedForm
      label="Add a sign-in"
      open={open}
      onOpen={() => setOpen(true)}
      onCancel={close}
      onSubmit={() => {
        if (method.apiKey) {
          if (key.trim()) void run(key.trim())
        } else {
          void run()
        }
      }}
      aside={<Picker label="Sign in with" value={method.id} options={methods.map((m) => ({ value: m.id, label: m.name }))} onChange={setMethodId} />}
      submit={
        <>
          {waiting && <Spinner />}
          {method.apiKey ? "Save key" : "Continue in browser"}
        </>
      }
      submitDisabled={waiting || (method.apiKey && !key.trim())}
    >
      {method.apiKey ? (
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">API key</span>
          <Input autoFocus type="password" autoComplete="off" spellCheck={false} placeholder="Paste the key" value={key} onChange={(e) => setKey(e.target.value)} className="font-mono text-detail" />
          <span className="text-xs text-muted-foreground">Kept on this Mac, in owlit's own folder. Model requests are billed to this key.</span>
        </label>
      ) : (
        <span className="text-xs text-muted-foreground">{waiting ? "Finish signing in in your browser." : "Opens your browser to sign in. Model requests use your ChatGPT plan."}</span>
      )}
      {error && <Note tone="bad">{error}</Note>}
    </FoldedForm>
  )
}
