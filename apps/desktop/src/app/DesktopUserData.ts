import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

export const resolveUserDataPath = Effect.fn("desktop.userData.resolveUserDataPath")(
  function* (input: {
    readonly appDataDirectory: string;
    readonly stateDir: string;
    readonly isDevelopment: boolean;
    readonly platform: NodeJS.Platform;
  }) {
    const path = yield* Path.Path;
    return input.isDevelopment
      ? path.join(input.stateDir, "electron")
      : path.join(input.appDataDirectory, "ozi");
  },
);
