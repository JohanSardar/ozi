import * as Semaphore from "effect/Semaphore";

export const dataRootPermit = Semaphore.makeUnsafe(1);
