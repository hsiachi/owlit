export function Placeholder({ name }: { name: string }) {
  return (
    <div className="bg-muted/50 text-muted-foreground flex min-h-screen flex-1 items-center justify-center rounded-xl text-sm md:min-h-min">
      {name}: not built yet.
    </div>
  )
}
