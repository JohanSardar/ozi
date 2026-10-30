import { assert, it } from "@effect/vitest";
import {
  EventId,
  MessageId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2DomainEvent,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ThreadSearch from "./ThreadSearch.ts";

const layerTest = Layer.mergeAll(ThreadSearch.layer, ProjectionStore.layer).pipe(
  Layer.provideMerge(SqlitePersistence.layerMemory),
);

const providerInstanceId = ProviderInstanceId.make("codex");
const at = (minute: number) => DateTime.makeUnsafe(Date.UTC(2026, 8, 27, 0, minute));

const thread = (
  threadId: ThreadId,
  projectId: string,
  overrides: {
    readonly archivedAt?: DateTime.Utc;
    readonly deletedAt?: DateTime.Utc;
    readonly subagentOf?: ThreadId;
    readonly title?: string;
    readonly settledAt?: DateTime.Utc;
  } = {},
): OrchestrationV2DomainEvent => ({
  id: EventId.make(`created:${threadId}`),
  type: "thread.created",
  threadId,
  providerInstanceId,
  occurredAt: at(0),
  payload: {
    createdBy: "user",
    creationSource: "web",
    id: threadId,
    title: overrides.title ?? threadId,
    providerInstanceId,
    modelSelection: { instanceId: providerInstanceId, model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    workingDirectory: null,
    activeProviderThreadId: null,
    lineage: overrides.subagentOf
      ? {
          parentThreadId: overrides.subagentOf,
          relationshipToParent: "subagent",
          rootThreadId: overrides.subagentOf,
        }
      : { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
    forkedFrom: null,
    createdAt: at(0),
    updatedAt: at(0),
    archivedAt: overrides.archivedAt ?? null,
    settledOverride: overrides.settledAt === undefined ? null : "settled",
    settledAt: overrides.settledAt ?? null,
    lastVisitedAt: null,
    deletedAt: overrides.deletedAt ?? null,
  },
});

const message = (
  threadId: ThreadId,
  id: string,
  role: "user" | "assistant" | "system",
  text: string,
  options: {
    readonly minute?: number;
    readonly streaming?: boolean;
    readonly createdBy?: "user" | "agent";
  } = {},
): OrchestrationV2DomainEvent => ({
  id: EventId.make(`message:${id}`),
  type: "message.updated",
  threadId,
  providerInstanceId,
  occurredAt: at(options.minute ?? 1),
  payload: {
    createdBy: options.createdBy ?? (role === "user" ? "user" : "agent"),
    creationSource: role === "user" ? "web" : "provider",
    id: MessageId.make(id),
    threadId,
    runId: null,
    nodeId: null,
    role,
    text,
    attachments: [],
    streaming: options.streaming ?? false,
    createdAt: at(options.minute ?? 1),
    updatedAt: at(options.minute ?? 1),
  },
});

it.layer(layerTest)("ThreadSearch filters before it ranks", (it) => {
  it.effect("orders message matches by when they were written, not by row order", () =>
    Effect.gen(function* () {
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const search = yield* ThreadSearch.ThreadSearch;
      const project = "project:written";
      const recent = ThreadId.make("thread:written-recent");
      const imported = ThreadId.make("thread:written-imported");
      // An imported history lands after newer messages in row order.
      yield* Effect.forEach(
        [
          thread(recent, project),
          message(recent, "written-recent", "user", "kestrel deploy notes", { minute: 30 }),
          thread(imported, project),
          message(imported, "written-imported", "user", "kestrel deploy notes", { minute: 1 }),
        ],
        projections.apply,
        { discard: true },
      );
      const { matches } = yield* search.search({ query: "kestrel" });
      assert.deepEqual(
        matches.map((match) => match.threadId),
        [recent, imported],
      );
    }),
  );

  it.effect("ranks a thread about the word above a passing mention", () =>
    Effect.gen(function* () {
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const search = yield* ThreadSearch.ThreadSearch;
      const project = "project:about";
      const about = ThreadId.make("thread:about-osprey");
      const mention = ThreadId.make("thread:mention-osprey");
      yield* Effect.forEach(
        [
          thread(about, project),
          ...Array.from({ length: 12 }, (_, index) =>
            message(about, `about-osprey-${index}`, "assistant", `osprey step ${index}`, {
              minute: 2,
            }),
          ),
          thread(mention, project),
          message(mention, "mention-osprey", "user", "also check osprey", { minute: 5 }),
        ],
        projections.apply,
        { discard: true },
      );
      const { matches } = yield* search.search({ query: "osprey" });
      assert.deepEqual(
        matches.map((match) => [match.threadId, match.hits]),
        [
          [about, 12],
          [mention, 1],
        ],
      );
    }),
  );

  it.effect("counts a thread's hits at its best match only", () =>
    Effect.gen(function* () {
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const search = yield* ThreadSearch.ThreadSearch;
      const project = "project:best-hits";
      const clarks = ThreadId.make("thread:clarks");
      const larks = ThreadId.make("thread:lark-many");
      yield* Effect.forEach(
        [
          thread(clarks, project),
          message(clarks, "clarks-lark", "user", "Lark once", { minute: 3 }),
          ...Array.from({ length: 31 }, (_, index) =>
            message(clarks, `clarks-${index}`, "assistant", "Clark the plan", { minute: 3 }),
          ),
          thread(larks, project),
          ...Array.from({ length: 8 }, (_, index) =>
            message(larks, `lark-many-${index}`, "assistant", "Lark again", { minute: 3 }),
          ),
        ],
        projections.apply,
        { discard: true },
      );
      const { matches } = yield* search.search({ query: "lark" });
      assert.deepEqual(
        matches.map((match) => [match.threadId, match.hits]),
        [
          [larks, 8],
          [clarks, 1],
        ],
      );
    }),
  );

  it.effect("finds a visible match behind hundreds of hidden or narrower hits", () =>
    Effect.gen(function* () {
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const search = yield* ThreadSearch.ThreadSearch;
      const project = "project:crowded";
      const parent = ThreadId.make("thread:crowded-parent");
      const subagent = ThreadId.make("thread:crowded-subagent");
      const older = ThreadId.make("thread:crowded-older");
      yield* Effect.forEach(
        [
          thread(parent, project),
          thread(subagent, project, { subagentOf: parent }),
          thread(older, project),
          ...Array.from({ length: 450 }, (_, index) =>
            message(subagent, `subagent-${index}`, "assistant", "needle needle"),
          ),
          ...Array.from({ length: 450 }, (_, index) =>
            message(older, `older-${index}`, "assistant", "pnpm 11 pnpm"),
          ),
          message(parent, "parent-needle", "user", "a needle in a long haystack of other words"),
          // Agent-written notices in user messages are not indexed, so they never read as "You".
          message(older, "older-notice", "user", "needle update from a watched pull request", {
            createdBy: "agent",
          }),
          message(parent, "parent-pnpm", "user", "moved the repo to pnpm 12 today"),
        ],
        projections.apply,
        { discard: true },
      );

      const threadIds = (query: string) =>
        search.search({ query }).pipe(Effect.map(({ matches }) => matches.map((m) => m.threadId)));
      assert.deepEqual(yield* threadIds("needle"), [parent]);
      assert.deepEqual(yield* threadIds("pnpm 12"), [parent]);
    }),
  );

  it.effect("keeps a thread picked for the query when the limit cuts", () =>
    Effect.gen(function* () {
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const search = yield* ThreadSearch.ThreadSearch;
      const sql = yield* SqlClient.SqlClient;
      const project = "project:plover";
      const busy = ThreadId.make("thread:plover-busy");
      const picked = ThreadId.make("thread:plover-picked");
      yield* Effect.forEach(
        [
          thread(busy, project),
          message(busy, "plover-1", "user", "plover notes", { minute: 3 }),
          message(busy, "plover-2", "user", "more plover notes", { minute: 4 }),
          thread(picked, project),
          message(picked, "plover-old", "user", "one plover mention", { minute: 1 }),
        ],
        projections.apply,
        { discard: true },
      );
      const threadIds = () =>
        search
          .search({ query: "plover", limit: 1 })
          .pipe(Effect.map(({ matches }) => matches.map((m) => m.threadId)));
      assert.deepEqual(yield* threadIds(), [busy]);
      // A pick at time 0 would read as no pick.
      yield* TestClock.adjust("1 day");
      const at = DateTime.toEpochMillis(yield* DateTime.now);
      yield* sql`
        UPDATE orchestration_v2_projection_threads
        SET payload_json = json_set(payload_json, '$.opens', json(${JSON.stringify({
          openedAt: at,
          score: 1,
          picks: [{ query: "plover", at }],
        })}))
        WHERE thread_id = ${picked}
      `;
      assert.deepEqual(yield* threadIds(), [picked]);
    }),
  );

  it.effect("finds a curly apostrophe for a straight one and back", () =>
    Effect.gen(function* () {
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const search = yield* ThreadSearch.ThreadSearch;
      const project = "project:apostrophes";
      const curly = ThreadId.make("thread:apostrophe-curly");
      const straight = ThreadId.make("thread:apostrophe-straight");
      yield* Effect.forEach(
        [
          thread(curly, project),
          message(curly, "apostrophe-curly", "user", "the gannet\u2019s nest"),
          thread(straight, project),
          message(straight, "apostrophe-straight", "user", "a kittiwake's nest"),
        ],
        projections.apply,
        { discard: true },
      );
      const threadIds = (query: string) =>
        search.search({ query }).pipe(Effect.map(({ matches }) => matches.map((m) => m.threadId)));
      assert.deepEqual(yield* threadIds("gannet's"), [curly]);
      assert.deepEqual(yield* threadIds("kittiwake\u2019s"), [straight]);
    }),
  );

  it.effect("leaves out answers to an agent's question, which show in its card", () =>
    Effect.gen(function* () {
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const search = yield* ThreadSearch.ThreadSearch;
      const project = "project:answers";
      const asked = ThreadId.make("thread:answers");
      yield* Effect.forEach(
        [
          thread(asked, project),
          message(asked, "async-answer:request-1", "user", "use the albatross drive"),
        ],
        projections.apply,
        { discard: true },
      );
      assert.deepEqual((yield* search.search({ query: "albatross" })).matches, []);
    }),
  );

  it.effect("matches messages as they read, with links as their text", () =>
    Effect.gen(function* () {
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const search = yield* ThreadSearch.ThreadSearch;
      const project = "project:heron";
      const labeled = ThreadId.make("thread:heron-label");
      const addressOnly = ThreadId.make("thread:heron-address");
      yield* Effect.forEach(
        [
          thread(labeled, project),
          message(labeled, "heron-label", "assistant", "See [the heron plan](https://x.dev/a) now"),
          thread(addressOnly, project),
          message(addressOnly, "heron-address", "user", "Read [this](https://heron.dev/b)"),
        ],
        projections.apply,
        { discard: true },
      );
      const { matches } = yield* search.search({ query: "heron" });
      assert.deepEqual(
        matches.map((match) => [match.threadId, match.snippet]),
        [[labeled, "See the heron plan now"]],
      );
    }),
  );

  it.effect("reads at most the newest 10,000 index hits, however many the filters drop", () =>
    Effect.gen(function* () {
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const search = yield* ThreadSearch.ThreadSearch;
      const sql = yield* SqlClient.SqlClient;
      const project = "project:kestrel";
      const old = ThreadId.make("thread:kestrel-old");
      const busy = ThreadId.make("thread:kestrel-busy");
      yield* Effect.forEach(
        [
          thread(old, project),
          message(old, "kestrel-old", "user", "kestrel ci is red"),
          thread(busy, project),
        ],
        projections.apply,
        { discard: true },
      );
      const insertBusy = (count: number) => sql`
        WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${count})
        INSERT INTO orchestration_v2_projection_messages
          (message_id, thread_id, role, streaming, created_at, updated_at, payload_json)
        SELECT 'kestrel-busy-' || i, ${busy}, 'assistant', 0, ${DateTime.formatIso(at(5))},
          ${DateTime.formatIso(at(5))}, json_object('text', 'kestrel packages')
        FROM n
      `;
      const threadIds = (query: string) =>
        search.search({ query }).pipe(Effect.map(({ matches }) => matches.map((m) => m.threadId)));
      yield* insertBusy(9_999);
      assert.deepEqual(yield* threadIds("kestrel ci"), [old]);
      yield* sql`DELETE FROM orchestration_v2_projection_messages WHERE thread_id = ${busy}`;
      yield* insertBusy(10_000);
      assert.deepEqual(yield* threadIds("kestrel ci"), []);
    }),
  );
});

it.layer(layerTest)("ThreadSearch across scripts and without the index", (it) => {
  it.effect(
    "matches Korean, Japanese, and two-character Chinese words, and whole short words",
    () =>
      Effect.gen(function* () {
        const projections = yield* ProjectionStore.ProjectionStoreV2;
        const search = yield* ThreadSearch.ThreadSearch;
        const sql = yield* SqlClient.SqlClient;
        const project = "project:scripts";
        const threadId = ThreadId.make("thread:scripts");
        const drafts = ThreadId.make("thread:drafts");
        const addresses = ThreadId.make("thread:addresses");
        yield* Effect.forEach(
          [
            thread(threadId, project),
            message(threadId, "korean", "user", "검색 기능을 고쳐 주세요"),
            message(threadId, "japanese", "user", "がんばって検索します"),
            message(threadId, "chinese", "user", "明天部署到生产环境"),
            message(threadId, "fts", "assistant", "the FTS index is ready"),
            thread(drafts, project),
            message(drafts, "drafts", "assistant", "saved two drafts and shifts"),
            message(threadId, "camel", "assistant", "Configure enableFTS today"),
            message(threadId, "accented", "user", "Review Résumé indexing"),
            thread(addresses, project),
            message(addresses, "addresses", "user", "This addresses Résumé indexing"),
          ],
          projections.apply,
          { discard: true },
        );
        const threadIds = (query: string) =>
          search
            .search({ query })
            .pipe(Effect.map(({ matches }) => matches.map((m) => m.threadId)));

        // Short words must start a word, which camelCase and accented words do.
        for (const query of ["검색 기능", "がんばって", "部署", "fts", "enable"]) {
          assert.deepEqual(yield* threadIds(query), [threadId], query);
        }
        // "res" inside "addresses" does not hide the accented word after it.
        assert.sameMembers(yield* threadIds("res"), [threadId, addresses]);
        // A word beats the same letters inside a longer word, even in an older message.
        const trust = ThreadId.make("thread:trust");
        const rust = ThreadId.make("thread:rust");
        yield* Effect.forEach(
          [
            thread(rust, project),
            message(rust, "rust", "assistant", "Rust rewrite notes"),
            thread(trust, project),
            message(trust, "trust", "user", "We trust the build"),
          ],
          projections.apply,
          { discard: true },
        );
        const { matches } = yield* search.search({ query: "rust" });
        assert.deepEqual(
          matches.map((match) => [match.threadId, (match.quality ?? 1) <= 0.3]),
          [
            [rust, false],
            [trust, true],
          ],
        );
        // Without the index (an SQLite build without FTS5 trigrams) search scans instead.
        yield* sql`DROP TABLE orchestration_v2_message_search`;
        assert.deepEqual(yield* threadIds("検索"), [threadId]);
        assert.deepEqual(yield* threadIds("fts"), [threadId]);
      }),
  );
});

it.layer(layerTest)("ThreadSearch.searchOlderSettled", (it) => {
  it.effect("returns older settled title matches in scope, then older message hits", () =>
    Effect.gen(function* () {
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const search = yield* ThreadSearch.ThreadSearch;
      const project = "project:kestrel";
      const other = "project:kestrel-other";
      const id = (name: string) => ThreadId.make(`thread:kestrel-${name}`);
      const old = at(10);
      yield* Effect.forEach(
        [
          thread(id("old"), project, { title: "Kestrel nest", settledAt: old }),
          thread(id("recent"), project, { title: "Kestrel nest", settledAt: at(50) }),
          thread(id("open"), project, { title: "Kestrel nest" }),
          thread(id("child"), project, { title: "Kestrel nest", subagentOf: id("old") }),
          thread(id("elsewhere"), other, { title: "Kestrel nest", settledAt: old }),
          thread(id("note"), project, { title: "Unrelated", settledAt: old }),
          thread(id("new-note"), project, { title: "Unrelated", settledAt: at(50) }),
        ],
        projections.apply,
        { discard: true },
      );
      const before = DateTime.formatIso(at(30));
      const messageThreadIds = [id("new-note"), id("note"), id("old")];
      assert.sameMembers(
        [...(yield* search.searchOlderSettled({ query: "kestrel", before, messageThreadIds }))],
        [id("old"), id("elsewhere"), id("note")],
      );
      // The scope applies to titles and message hits; message hits follow the titles in order.
      assert.deepEqual(
        yield* search.searchOlderSettled({
          query: "kestrel",
          before,
          messageThreadIds: [id("elsewhere"), ...messageThreadIds],
        }),
        [id("old"), id("note")],
      );
      // A palette also matches the environment's name.
      assert.include(
        yield* search.searchOlderSettled({
          query: "laptop unrelated",
          before,
          environmentLabel: "Laptop",
          messageThreadIds: [],
        }),
        id("note"),
      );
    }),
  );
});

it.layer(layerTest)("ThreadSearch.searchThreadsWithOlderSettledRows", (it) => {
  it.effect("adds older settled rows to message hits, or alone for titles only", () =>
    Effect.gen(function* () {
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const search = yield* ThreadSearch.ThreadSearch;
      const sql = yield* SqlClient.SqlClient;
      const project = "project:plover";
      const old = ThreadId.make("thread:plover-old");
      const recent = ThreadId.make("thread:plover-recent");
      yield* Effect.forEach(
        [
          thread(old, project, { title: "Plover nest", settledAt: at(10) }),
          thread(recent, project, { title: "Plover nest", settledAt: at(50) }),
          message(recent, "plover-note", "user", "a plover note", { minute: 2 }),
        ],
        projections.apply,
        { discard: true },
      );
      const run = (request: { readonly titlesOnly?: boolean }) =>
        ThreadSearch.searchThreadsWithOlderSettledRows({
          request: { query: "plover", olderSettledBefore: DateTime.formatIso(at(30)), ...request },
          search: search.search,
          searchOlderSettled: search.searchOlderSettled,
          sql,
          readThreads: (threadIds) =>
            projections.readShellSnapshot({ location: "active", threadIds }),
          latestSequence: Effect.succeed(7),
        });
      const withMessages = yield* run({});
      assert.deepEqual(
        withMessages.matches.map((match) => match.threadId),
        [recent],
      );
      assert.equal(withMessages.snapshotSequence, 7);
      assert.deepEqual(
        withMessages.threads?.map((row) => row.id),
        [old],
      );
      const titles = yield* run({ titlesOnly: true });
      assert.deepEqual(titles.matches, []);
      assert.deepEqual(
        titles.threads?.map((row) => row.id),
        [old],
      );
      // Without the cut it is the plain message search.
      assert.isUndefined(
        (yield* ThreadSearch.searchThreadsWithOlderSettledRows({
          request: { query: "plover" },
          search: search.search,
          searchOlderSettled: search.searchOlderSettled,
          sql,
          readThreads: (threadIds) =>
            projections.readShellSnapshot({ location: "active", threadIds }),
          latestSequence: Effect.succeed(7),
        })).threads,
      );
    }),
  );
});

it.layer(layerTest)("ThreadSearch.searchThreads", (it) => {
  it.effect("keeps room for a message-only thread behind many titled ones", () =>
    Effect.gen(function* () {
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const search = yield* ThreadSearch.ThreadSearch;
      const project = "project:petrel";
      const messageOnly = ThreadId.make("thread:petrel-message");
      yield* Effect.forEach(
        [
          thread(messageOnly, project),
          // The oldest message, so a cut taken before titles drop would lose it.
          message(messageOnly, "petrel-old", "user", "a petrel note", { minute: 1 }),
          ...Array.from({ length: 50 }, (_, index) => {
            const id = ThreadId.make(`thread:petrel-${index}`);
            return [
              thread(id, project, { title: `Petrel ${index}` }),
              message(id, `petrel-${index}`, "user", "petrel again", { minute: 2 }),
            ];
          }).flat(),
        ],
        projections.apply,
        { discard: true },
      );
      const { matches } = yield* search.searchThreads({ query: "petrel", limit: 5 });
      assert.include(
        matches.map((match) => match.threadId),
        messageOnly,
      );
    }),
  );

  it.effect("leaves titled threads out before the hit limit", () =>
    Effect.gen(function* () {
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const search = yield* ThreadSearch.ThreadSearch;
      const sql = yield* SqlClient.SqlClient;
      const project = "project:hit-limit";
      const messageOnly = ThreadId.make("thread:grebe-message");
      const titled = ThreadId.make("thread:grebe-titled");
      yield* Effect.forEach(
        [
          thread(messageOnly, project, { title: "Unrelated" }),
          message(messageOnly, "grebe-old", "user", "a grebe note", { minute: 1 }),
          thread(titled, project, { title: "Grebe" }),
        ],
        projections.apply,
        { discard: true },
      );
      // Newer hits than one read holds, all in the titled thread.
      yield* sql`
        WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 2000)
        INSERT INTO orchestration_v2_projection_messages
          (message_id, thread_id, role, streaming, created_at, updated_at, payload_json)
        SELECT 'grebe-titled-' || i, ${titled}, 'assistant', 0, ${DateTime.formatIso(at(5))},
          ${DateTime.formatIso(at(5))}, json_object('text', 'grebe again')
        FROM n
      `;
      const { matches } = yield* search.searchThreads({ query: "grebe", limit: 5 });
      assert.include(
        matches.map((match) => match.threadId),
        messageOnly,
      );
    }),
  );
});

it.effect("starts snippets a few words before the match so one line shows it", () =>
  Effect.sync(() => {
    const snippet = (text: string, word: string) =>
      ThreadSearch.buildSearchSnippet(text, text.indexOf(word));
    const long = `${"lead ".repeat(60)}the NEEDLE sits here ${"tail ".repeat(60)}`;
    const cut = snippet(long, "NEEDLE");
    assert.isAtMost(cut.length, 240);
    assert.match(cut, /^…(lead ){2,4}the NEEDLE sits here/);
    assert.isTrue(cut.endsWith("…"));
    // Whitespace collapses only in the shown part, so the offset still lands.
    assert.match(snippet(`${"word\n\n  ".repeat(60)}un café`, "café"), /un café$/);
    // A cut never splits an emoji's surrogate pair.
    assert.notMatch(
      snippet(`x${"🚀".repeat(200)}needle`, "needle"),
      /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/,
    );
    // Emphasis and code marks go, as the thread shows the text.
    assert.equal(
      ThreadSearch.buildSearchSnippet("Use **bold** and `code` here", 0),
      "Use bold and code here",
    );
    assert.equal(ThreadSearch.buildSearchSnippet("Call __init__ first", 0), "Call __init__ first");
    // Short text still moves a late match into view.
    assert.equal(snippet(`${"word ".repeat(20)}needle`, "needle"), "…word word word word needle");
  }),
);

it.effect("searches on the reader worker while the writer is busy", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-thread-search-" });
    const layerFile = Layer.mergeAll(ThreadSearch.layer, ProjectionStore.layer).pipe(
      Layer.provideMerge(SqlitePersistence.layerFromPath(path.join(directory, "state.sqlite"))),
      Layer.provide(NodeServices.layer),
    );

    yield* Effect.gen(function* () {
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const search = yield* ThreadSearch.ThreadSearch;
      const sql = yield* SqlClient.SqlClient;
      const project = "project:search-reader";
      const threadId = ThreadId.make("thread:reader");
      yield* Effect.forEach(
        [thread(threadId, project), message(threadId, "reader", "user", "needle on the reader")],
        projections.apply,
        { discard: true },
      );

      const writerHeld = yield* Deferred.make<void>();
      const releaseWriter = yield* Deferred.make<void>();
      const writer = yield* Effect.forkChild(
        sql.withTransaction(
          Deferred.succeed(writerHeld, undefined).pipe(
            Effect.andThen(Deferred.await(releaseWriter)),
          ),
        ),
      );
      yield* Deferred.await(writerHeld);
      const result = yield* search.search({ query: "needle" });
      yield* Deferred.succeed(releaseWriter, undefined);
      yield* Fiber.join(writer);

      assert.deepEqual(
        result.matches.map((match) => match.threadId),
        [threadId],
      );
    }).pipe(Effect.provide(layerFile));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
