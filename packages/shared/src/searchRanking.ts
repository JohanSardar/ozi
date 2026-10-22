export type RankedSearchResult<T> = {
  item: T;
  score: number;
  tieBreaker: string;
};
