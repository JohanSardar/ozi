export interface ShownStatus<A> {
  readonly key: string;
  readonly value: A;
}

export interface DelayedStatus<A> {
  readonly update: (key: string, value: A | null) => void;
  readonly dispose: () => void;
}
