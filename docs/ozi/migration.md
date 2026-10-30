# Old-install migration (C5)

Stop the old server and desktop app. Use the new GUI's `ozi` executable:

```sh
ozi migrate --from-home "$OLD_OZI_HOME" --from-data-root "$OLD_OZI_DATA_ROOT" --home "$NEW_OZI_HOME" --dry-run --json
ozi migrate --from-home "$OLD_OZI_HOME" --from-data-root "$OLD_OZI_DATA_ROOT" --home "$NEW_OZI_HOME" --json
ozi serve --home "$NEW_OZI_HOME"
```

Both builds default to `~/.ozi`. C5 deliberately imports into a separate home,
leaving the old install available for rollback. The two source flags are required;
without `--home`, the destination is `<from-home>-gui` (`~/.ozi-gui` for the old
default). Ambient `OZI_HOME` does not select the migration destination. Keep using
that explicit new home in the service and desktop configuration during cutover.
Never start the new build against the old home. C6 owns the real service cutover.

Dry-run reads an isolated SQLite snapshot and reports source/destination paths,
chat and message counts, Pi sessions, schedules, webhooks and secret-file counts.
It writes neither source nor destination and never prints secret values. The
source must be stopped even for dry-run. Re-run the command without `--dry-run`
to apply exactly the same import policy.

The import preserves:

- Main's stored conversation, attachments, title, model and options, saved Pi
  chats, Pi worker sessions and unbound native sessions in main's Pi directory.
  Verbatim native JSONL backups remain in the copied cache. Active imports live
  in the GUI's `userdata/pi-sessions`, outside Pi's automatically migrated agent
  directory. Only their header's working directory and parent-session path change;
  every history entry and branch stays verbatim. Provider bindings point there. Imported history is passive and
  starts no agent turn. Runtime runs, checks and background effects are not
  restarted. Old non-Pi workers remain available in the untouched source.
- Schedule IDs, prompts, enabled state, intervals, local times/weekdays, due
  times, run history, webhook tokens, signing keys, filters, replay records and
  pending/coalesced deliveries. Their existing chat IDs remain stable. Webhook
  paths remain stable; the public origin must route to the new server at cutover.
- Settings, provider configuration, secret-store bytes and references,
  keybindings, themes, attachments and Pi agent configuration. Ozi becomes the
  default provider, using main's model and options and the copied Pi config.
- The entire data repository, including `system.md`, `adhd.md`, `skills/`,
  `protected/`, uncommitted files, local refs and `.git` history. Its new path is
  `<new-home>/harness`, configured on the Ozi provider.

Target files and directories are owner-only, retaining executable bits. The
command rejects existing unrelated destinations, overlapping paths, symbolic
links, data roots backed by an external git worktree, missing native sessions
and schedules targeting missing chats. Resolve these in the old install before
retrying; it does not silently discard them.

The new database is initialized with the GUI's own migrations. No old database
or migration ledger is opened by the new server. The completed home is published
by renaming a private staging directory on the same filesystem. Failures before
publication leave no partial target; retries build it again. A published
`migration.json` makes repeated invocations for the same source a no-op, even
after the new server starts. Repeating an import is not an incremental sync.
Keep the sources stopped until cutover; an interrupted process can leave an
unused owner-only `.ozi-migration-*` staging directory beside the target.

## Acceptance

`e2e/c5.migration.test.ts` requires an installed checkout of the old harness via
`OZI_C5_LEGACY_REPO`. It starts that real server with temporary home/data roots
and fake provider transports, creates main history, sessions, schedules and a
signed webhook, then stops it. The new CLI imports into another temporary home;
the new server reads the conversation and resumes native context through real Pi and Claude with a fake HTTP provider transport. Checks cover
source-byte preservation, git history, secret permissions, original webhook URL
and signature, idempotency and rejected destinations/links. Without that checkout,
only the CLI help contract runs. CI remains typecheck and lint only.

```sh
OZI_C5_LEGACY_REPO="$OLD_HARNESS_CHECKOUT" ~/ozi-fleet/heavy.sh node_modules/.bin/vp test run --root e2e c5.migration.test.ts
```
