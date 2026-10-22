import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";

import { OwnerCredential } from "./OwnerCredential.ts";

const encodeCredential = Schema.encodeEffect(Schema.fromJsonString(OwnerCredential));

export const publish = Effect.fn("OwnerSession.publish")(function* () {
  const auth = yield* EnvironmentAuth.EnvironmentAuth;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const issued = yield* auth.issueSession({ label: "ozi owner", subject: "local-owner" });
  const file = path.join(config.stateDir, "owner.json");
  const directory = yield* fs.makeTempDirectoryScoped({
    directory: config.stateDir,
    prefix: "owner-",
  });
  const temporary = path.join(directory, "credential.json");
  yield* fs.writeFileString(temporary, yield* encodeCredential({ token: issued.token }), {
    mode: 0o600,
  });
  yield* fs.rename(temporary, file);
});
