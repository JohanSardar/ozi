import { it } from "@effect/vitest";
import * as Layer from "effect/Layer";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layer({ filename: ":memory:" })));

layer("016_CanonicalizeModelSelections", () => {});

layer("044_ClearAutomaticProjectModelDefaults", () => {});
