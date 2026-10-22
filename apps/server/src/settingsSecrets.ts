import {
  ClaudeSettings,
  CodexSettings,
  type ServerSettings,
  secretSettingsFields,
} from "@t3tools/contracts";
import { piClient } from "@t3tools/provider-pi/client";

export const SECRET_REDACTED = "\u2022\u2022\u2022\u2022\u2022\u2022";

const providerSecretFields = new Map([
  ["codex", secretSettingsFields(CodexSettings)],
  ["claudeAgent", secretSettingsFields(ClaudeSettings)],
  ...[piClient].map(
    (definition) =>
      [definition.driverKind, secretSettingsFields(definition.settingsSchema)] as const,
  ),
]);
const encode = (value: string) => Buffer.from(value, "utf8").toString("base64url");

export interface SettingsSecret {
  readonly secretName: string;
  readonly kind: "field" | "environment";
  readonly value: string;
  readonly redacted: boolean;
  readonly sensitive: boolean;
  readonly providerInstanceId?: string;
  readonly environmentVariable?: string;
}

type SecretValue = Pick<SettingsSecret, "value" | "redacted">;

export function mapSettingsSecrets(
  settings: ServerSettings,
  map: (secret: SettingsSecret) => SecretValue,
): ServerSettings {
  const mapFields = (
    fields: Readonly<Record<string, unknown>>,
    secretFields: ReadonlyArray<string>,
    name: (field: string, serverHost: string | null) => string,
  ) => {
    const next = { ...fields };
    for (const field of secretFields) {
      if (!(field in next)) continue;
      next[field] = writeSecretFieldValues(
        next[field],
        readSecretFieldValues(next[field]).map(([serverHost, value]) => {
          const result = map({
            secretName: name(field, serverHost),
            kind: "field",
            value,
            redacted: value === SECRET_REDACTED,
            sensitive: true,
          });
          return [serverHost, result.redacted ? SECRET_REDACTED : result.value] as const;
        }),
      );
    }
    return next;
  };

  const providerInstances = Object.fromEntries(
    Object.entries(settings.providerInstances).map(([instanceId, instance]) => {
      const config = instance.config;
      return [
        instanceId,
        {
          ...instance,
          ...(config !== null && typeof config === "object" && !Array.isArray(config)
            ? {
                config: mapFields(
                  config as Record<string, unknown>,
                  providerSecretFields.get(instance.driver) ?? [],
                  (field, serverHost) =>
                    `provider-config-${encode(instanceId)}-${encode(instance.driver)}-${encode(field)}` +
                    (serverHost === null ? "" : `-${encode(serverHost)}`),
                ),
              }
            : {}),
          ...(instance.environment
            ? {
                environment: instance.environment.map((variable) => {
                  const result = map({
                    secretName: `provider-env-${encode(instanceId)}-${encode(variable.name)}`,
                    kind: "environment",
                    value: variable.value,
                    redacted: variable.valueRedacted === true,
                    sensitive: variable.sensitive,
                    providerInstanceId: instanceId,
                    environmentVariable: variable.name,
                  });
                  const { valueRedacted: _omit, ...rest } = variable;
                  return {
                    ...rest,
                    value: result.value,
                    ...(result.redacted ? { valueRedacted: true } : {}),
                  };
                }),
              }
            : {}),
        },
      ];
    }),
  );

  return { ...settings, providerInstances };
}

function readSecretFieldValues(
  value: unknown,
): ReadonlyArray<readonly [serverHost: string | null, value: string]> {
  if (typeof value === "string") return [[null, value]];
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value).flatMap(([serverHost, entry]) =>
    typeof entry === "string" ? [[serverHost.trim().toLowerCase(), entry] as const] : [],
  );
}

function writeSecretFieldValues(
  original: unknown,
  values: ReadonlyArray<readonly [serverHost: string | null, value: string]>,
): unknown {
  if (typeof original === "string") return values[0]?.[1] ?? "";
  return Object.fromEntries(values.map(([serverHost, value]) => [serverHost ?? "", value]));
}
