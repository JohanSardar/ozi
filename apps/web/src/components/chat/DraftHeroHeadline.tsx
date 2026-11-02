export function DraftHeroHeadline(props: { agent: string }) {
  return (
    <div className="text-center">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        What should {props.agent} work on?
      </h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Ask for anything. Updates show up in the inbox.
      </p>
    </div>
  );
}
