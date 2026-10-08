export function Placeholder({ name }: { name: string }) {
  return (
    <div className="flex flex-1 flex-col p-4">
      <div className="bg-muted/50 text-muted-foreground flex flex-1 items-center justify-center rounded-xl text-sm">
        {name}: not built yet.
      </div>
    </div>
  )
}
