# Ozi data and connections

Ozi stores chats, settings, attachments and credentials on the server you run. Installed state uses `~/.ozi` or `OZI_HOME`; development uses `.ozi` inside the checkout. It does not import T3 Code homes or browser profiles.

Messages and attached context go to the agent provider you select. Those providers and any external tools you connect have their own terms and data practices.

Usage telemetry is disabled by default. Enabling it requires an explicit `OZI_TELEMETRY_ENABLED=true`, `OZI_POSTHOG_KEY` and `OZI_POSTHOG_HOST`. Cloud relay and mobile release accounts must also be configured explicitly; Ozi ships no T3 service account defaults.
