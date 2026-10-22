import * as Schema from "effect/Schema";
import * as Record from "effect/Record";

export class LocalStorageOperationError extends Schema.TaggedError<LocalStorageOperationError>()(
  "LocalStorageOperationError",
  {
    operation: Schema.Literals(["read", "decode", "encode", "update", "write", "remove", "notify"]),
    storageKey: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to ${this.operation} local storage item ${this.storageKey}.`;
  }
}

const fallbackStorage: Storage = (() => {
  const store = new Map<string, string>();
  return {
    clear: () => store.clear(),
    getItem: (_) => store.get(_) ?? null,
    key: (_) => Record.keys(store).at(_) ?? null,
    get length() {
      return store.size;
    },
    removeItem: (_) => store.delete(_),
    setItem: (_, value) => store.set(_, value),
  };
})();

const getStorage = (): Storage =>
  typeof window !== "undefined" ? window.localStorage : fallbackStorage;

const read = (key: string) => {
  try {
    return getStorage().getItem(key);
  } catch (cause) {
    throw new LocalStorageOperationError({ operation: "read", storageKey: key, cause });
  }
};

const decode = <T, E>(key: string, schema: Schema.Codec<T, E>, value: string) => {
  try {
    return Schema.decodeSync(Schema.fromJsonString(schema))(value);
  } catch (cause) {
    throw new LocalStorageOperationError({ operation: "decode", storageKey: key, cause });
  }
};

const encode = <T, E>(key: string, schema: Schema.Codec<T, E>, value: T) => {
  try {
    return Schema.encodeSync(Schema.fromJsonString(schema))(value);
  } catch (cause) {
    throw new LocalStorageOperationError({ operation: "encode", storageKey: key, cause });
  }
};

export const getLocalStorageItem = <T, E>(key: string, schema: Schema.Codec<T, E>): T | null => {
  const item = read(key);
  return item === null ? null : decode(key, schema, item);
};

export const setLocalStorageItem = <T, E>(key: string, value: T, schema: Schema.Codec<T, E>) => {
  const valueToSet = encode(key, schema, value);
  try {
    getStorage().setItem(key, valueToSet);
  } catch (cause) {
    throw new LocalStorageOperationError({ operation: "write", storageKey: key, cause });
  }
};
