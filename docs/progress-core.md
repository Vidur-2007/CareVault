
## Phase 1: local database (2026-11-14)

Built:
- `src/core/db/schema.ts`: Dexie database `carevault`, version 1, with the eleven tables and indexes from core spec section 3.
- `src/core/db/repos.ts`: one typed repo per table. `repos.transaction(fn)` groups writes into one atomic batch over every table; a failure inside it rolls all of them back.
- `src/core/db/events.ts`: the change notifier behind `subscribe()`. It fires once per write batch, after the batch is committed, and never for a batch that rolled back.
- `src/core/db/seed.ts`: `loadSampleProfile(repos)` writes the fixture sample case in one batch.
- 28 tests against `fake-indexeddb`.

For the UI side:
- `loadSampleProfile` behaves like the mock: if the sample profile already exists it writes nothing and returns it, so the caregiver's changes to the sample are kept. There is no "reset the sample" yet.
- Lists that the contract returns in time order are sorted by the actual instant. Rows with the same timestamp have no guaranteed order between them.
- Sample documents have no stored file until Phase 4 creates `public/sample-docs/`.
- `createRealServices()` is still the Phase 0 stub. It is wired in Phase 3.

Notes for the core side:
- `reviewItems.resolvedAt` is indexed as the spec says, but IndexedDB does not index `null`, so open items are read by `profileId` and filtered in memory.
- Tests that store a `Blob` need `// @vitest-environment node` at the top of the file: jsdom's `Blob` does not survive the structured clone that `fake-indexeddb` performs.
- Inside `repos.transaction`, await only repo calls. Hashing, `fetch` and timers must happen before the batch, otherwise IndexedDB commits early.
