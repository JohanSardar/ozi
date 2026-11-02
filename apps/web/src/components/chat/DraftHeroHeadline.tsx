export function DraftHeroHeadline(props: { agent: string }) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col items-center">
      <h1 className="w-full text-center font-normal text-2xl text-foreground tracking-tight sm:text-3xl">
        What should {props.agent} work on?
      </h1>
      <p className="mt-2 flex h-6 w-full items-center justify-center text-sm">
        Ask for anything. Updates show up in the inbox.
      </p>
    </div>
  );
}
