# CareVault: core spec (laptop A, branch `feat/core`)

Read `00-overview.spec.md` first. This file covers everything behind the `CareVaultServices` interface: local database, rules engine, document reading, drug reference, sharing, Gmail import, backup, the server and deployment. You build no screens.

## 1. What you own

```
src/core/**            server/**            public/sample-docs/**
.github/workflows/**   docs/progress-core.md   docs/contract-requests-core.md
```

Phase 0 runs on laptop B and creates the frozen files, including a stub of `src/core/createRealServices.ts` that you replace. You never edit `src/contract/**`, `src/services/index.ts`, `package.json`, `tsconfig*.json`, `vite.config.ts`, `.env.example`, or anything under `src/ui/**`.

Your single export to the rest of the app:

```ts
// src/core/createRealServices.ts
import type { CareVaultServices } from '../contract/services';
export function createRealServices(): CareVaultServices { /* ... */ }
```

## 2. Module layout

```
src/core/
├─ createRealServices.ts     wires everything to the contract
├─ db/
│  ├─ schema.ts              Dexie database and table definitions
│  ├─ repos.ts               typed read/write helpers, one per table
│  ├─ events.ts              change notifier used by subscribe()
│  └─ seed.ts                loadSampleProfile() from the fixtures
├─ rules/                    PURE functions, no Dexie, no network
│  ├─ normalize.ts           ingredient names and units
│  ├─ totals.ts              duplicates and daily totals
│  ├─ diff.ts                prescription comparison
│  ├─ status.ts              status transitions and events
│  ├─ review.ts              which review items should exist
│  ├─ passport.ts            builds the Passport object
│  └─ *.test.ts
├─ reading/
│  ├─ ocr/engine.ts          interface OcrEngine { recognize(image: Blob): Promise<OcrResult> }
│  ├─ ocr/paddle.ts          PaddleOCR.js implementation
│  ├─ ocr/tesseract.ts       Tesseract.js implementation
│  ├─ pdfText.ts             pdfjs-dist text extraction, first-page render for scans
│  ├─ parse.ts               raw text -> ExtractionCandidate (deterministic)
│  ├─ quality.ts             decides needsCloud
│  ├─ cloud.ts               client for POST /api/extract
│  └─ read.ts                orchestrates the above
├─ drugref/
│  ├─ table.json             bundled reference data
│  └─ lookup.ts
├─ share/
│  ├─ crypto.ts              AES-GCM encrypt/decrypt, key import/export
│  └─ client.ts              calls /api/share
├─ gmail/
│  ├─ token.ts               Google Identity Services token client
│  └─ api.ts                 Gmail REST calls
└─ backup/
   └─ backup.ts              export/import with a passphrase
server/
├─ index.ts                  Hono app, static serving, error handling
├─ extract.ts                Gemini call
├─ share.ts                  Supabase share store
└─ schema.sql                table definition for Supabase
```

## 3. Local database (Dexie)

Database name `carevault`. Tables and indexes:

| Table | Primary key | Indexes |
| --- | --- | --- |
| profiles | id | |
| prescribers | id | profileId |
| medicines | id | profileId, [profileId+status] |
| events | id | profileId, medicineId, at |
| documents | id | profileId, sha256, documentDate |
| files | id (same as document id) | (stores `{ id, blob }`) |
| prescriptionLines | id | documentId |
| reviewItems | id | profileId, resolvedAt |
| visits | id | profileId, at |
| shares | id | (stores ShareLink plus revokeToken) |
| settings | key | |

Rules:

- Every write goes through `repos.ts` and ends by calling `events.notify()`, which fires the `subscribe` listeners (debounced to one call per tick).
- Multi-table writes (applying a prescription, resolving a review item) run inside one Dexie transaction.
- Tests use `fake-indexeddb`.

## 4. Rules engine

All functions are pure: plain data in, plain data out. The services layer loads data, calls the rules, and writes the result. This keeps the safety-critical code testable without a database.

Required functions (names may vary, behaviour may not):

```ts
normalizeIngredientName(raw: string): string
// lowercase, trim, strip salt and pharmacopoeia suffixes ('IP', 'BP', 'USP',
// 'hydrochloride', 'besylate', ...), map synonyms through the drug reference
// ('acetaminophen' -> 'paracetamol')

toBaseUnit(strength: number, unit: DoseUnit): { value: number; unit: 'mcg' | 'ml' | 'IU' }
sameMedicine(a: Ingredient[], b: Ingredient[]): boolean      // equal sets of normalized names
ingredientTotals(active: Medicine[]): IngredientTotal[]       // only ingredients in 2+ medicines
diffPrescriptions(previous: PrescriptionLine[] | null, latest: PrescriptionLine[]): DiffRowDraft[]
planPrescriptionApply(state, prescriberId, documentId, lines): WritePlan
// WritePlan = medicines to insert/update, events to append, review items to open
planReviewResolution(state, item, resolution, opts): WritePlan
expectedReviewItems(state): ReviewItemDraft[]                 // idempotent: never duplicates an open item
buildChangeSummary(state): ChangeSummary | null
buildPassport(state, today: ISODate): Passport
```

Behaviour is defined in section 9 of the overview. Test requirements:

- A golden test seeds the sample case from `src/contract/fixtures/sampleCase.ts` through the same functions the app uses and asserts every expected result in overview section 10, including `3450`.
- Unit conversion: 0.5 g + 250 mg = 750 mg; 500 mcg + 1 mg = 1.5 mg; mixing mg with ml or IU never sums and yields separate totals.
- `dosesPerDay: null` gives `complete: false` and no misleading total.
- Brand names differ, ingredients equal: detected as the same medicine.
- Combination products: a medicine with two ingredients contributes to both totals; `sameMedicine` requires the full set to match.
- A prescription from prescriber B never changes medicines from prescriber A.
- The first prescription from a prescriber (no previous one) produces only `added` rows and no review items.
- Applying the same prescription twice changes nothing the second time.
- A medicine absent from the new prescription becomes `needs_confirmation`, never `stopped`.
- Floating point: totals are rounded to at most 3 decimal places before display or comparison.

Aim for full branch coverage in `src/core/rules`.

## 5. Document reading

`reading.read(file, { allowCloud })`:

1. If the file is a PDF with a text layer, extract text with `pdfjs-dist`. If it has no text layer, render page 1 to an image and continue as an image.
2. Run the on-device OCR engine.
3. `parse.ts` turns raw text into an `ExtractionCandidate` using regular expressions and the drug reference: product names, strengths (`(\d+(\.\d+)?)\s?(mcg|mg|g|ml|IU)`), composition lines ("Each tablet contains ..."), dose patterns (`1-0-1`, `BD`, `TDS`, `OD`, "twice a day"), dates, "Dr." names.
4. `quality.ts` sets `needsCloud` when no product name matched the drug reference, or OCR confidence is low, or the text is very short.
5. If `needsCloud` and `allowCloud`, send the image to `/api/extract` and use that result with `engine: 'cloud'`. If `needsCloud` and not `allowCloud`, reject with `ServiceError('cloud_consent_required')`.
6. Every line is cross-checked against the drug reference. A mismatch adds a warning string to that line; it never silently corrects a value.

Cloud results are validated with `zod` before use. Anything that fails validation is dropped and reported as a warning.

OCR engine choice is a spike in Phase 4: run both engines on at least ten real pack photos and two printed prescriptions, on a mid-range phone browser. Record load time, model download size, time per image and whether the product name and strength were read. Write the result and the decision in `docs/progress-core.md`. Keep both implementations behind `OcrEngine`; the loser stays as fallback. Load OCR code and models lazily, only when the first scan starts.

Synthetic sample documents: create the six sample documents from overview section 10 as files in `public/sample-docs/` (generate them from HTML: two cardiology prescriptions, one diabetes prescription, three reports). Use an invented clinic name and no real person's details.

## 6. Drug reference

`table.json` is an array of:

```json
{ "productName": "Dolo 650", "aliases": ["dolo-650", "dolo 650 mg"],
  "form": "tablet",
  "ingredients": [{ "name": "paracetamol", "strength": 650, "unit": "mg" }] }
```

plus a `synonyms` map for ingredient names (`"acetaminophen": "paracetamol"`).

Start with every product in the sample case and about 40 common Indian products across pain relief, blood pressure, diabetes, cholesterol, acid reflux and cold remedies, including at least five combination products that contain paracetamol. Take compositions from the pack label or the manufacturer's page, and list the source of each entry in `src/core/drugref/SOURCES.md`. Do not invent a composition; leave a product out if you cannot confirm it.

`lookup.ts`: exact and fuzzy match on product name and aliases (case and punctuation insensitive), returning the entry and a match score.

## 7. Sharing

Create:

1. Serialize the `Passport` to JSON.
2. Generate a random 256-bit AES-GCM key and a 96-bit IV with `crypto.subtle` and `crypto.getRandomValues`.
3. Encrypt. POST `{ ciphertext, iv, expiresAt }` (base64url) to `/api/share`.
4. Build the URL `${origin}/share/${id}#${base64url(key)}`. The key is in the fragment, so it is never sent to the server.
5. Store `{ id, url, expiresAt, revoked, revokeToken }` in the local `shares` table.

Open (`sharing.open(id, key)`): GET the ciphertext, decrypt, validate with `zod`, return the `Passport`. Map 404 to `not_found`, 410 to `expired` or `revoked`.

Revoke: DELETE with the stored `revokeToken`.

## 8. Gmail import

- Load the Google Identity Services script on demand. Use the token model (`google.accounts.oauth2.initTokenClient`) with scope `https://www.googleapis.com/auth/gmail.readonly`. The access token stays in memory only and is never written to IndexedDB or sent to our server.
- `findCandidates`: search with a query such as `has:attachment filename:pdf newer_than:60d (report OR lab OR result OR prescription)`, read message metadata, return candidates.
- `importAttachment`: download the attachment, compute SHA-256, create a `DocumentRecord` with `source: 'email'`, `state: 'pending_confirmation'`, and open a `new_document` review item.
- The Google Cloud OAuth consent screen stays in Testing status with the team's test Gmail address added as a test user. Document the setup steps in `docs/progress-core.md`.

## 9. Backup

Export: dump all tables and files to JSON (blobs as base64), derive a key from the passphrase with PBKDF2 (SHA-256, random salt, iteration count taken from the current OWASP password storage guidance), encrypt with AES-GCM, return a Blob with a small JSON header (`version`, `salt`, `iv`). Import: reverse; a wrong passphrase rejects with `bad_passphrase`; import replaces the current database after the UI has asked for confirmation.

## 10. Server

One Hono app on Node:

- Serves the built app from `dist/` with an SPA fallback to `index.html`.
- `POST /api/extract`: validates the body with `zod`, rejects images over 6 MB, calls the Gemini API with the image and a JSON response schema matching `ExtractionCandidate` lines. The model id comes from `GEMINI_MODEL`. The system instruction says: transcribe only what is printed or written; use null for anything unreadable; do not infer, correct or add medical knowledge. The server stores nothing and logs no request bodies.
- `POST /api/share`, `GET /api/share/:id`, `DELETE /api/share/:id`: backed by the Supabase table in `server/schema.sql`:

```sql
create table shares (
  id uuid primary key default gen_random_uuid(),
  ciphertext text not null,
  iv text not null,
  expires_at timestamptz not null,
  revoke_token_hash text not null,
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);
alter table shares enable row level security;  -- no policies: only the service role can read or write
```

- The server uses the Supabase service role key from the environment. `expires_at` is capped at 7 days from now. The revoke token is random; only its SHA-256 hash is stored. Ciphertext is capped at 200 KB.
- Simple in-memory rate limit per IP on all `/api` routes.
- `GET /api/health` returns 200 and performs one cheap Supabase query (used by the keep-alive workflow).

`.github/workflows/keepalive.yml`: scheduled every 3 days, requests `/api/health` on the deployed URL (stored as a repository variable).

`.github/workflows/ci.yml` already exists from Phase 0 (on push and pull request: `npm ci`, `npm run check`). Change it only if the server build needs it.

## 11. npm scripts (created in Phase 0 by the UI side; listed here because the server scripts are yours)

| Script | Does |
| --- | --- |
| `dev` | Vite dev server with `VITE_USE_MOCK` from `.env` |
| `dev:server` | Hono server with file watching |
| `build` | Vite build, then server build |
| `start` | Runs the built server, which serves `dist/` |
| `typecheck` | `tsc --noEmit` |
| `test` | Vitest, run once |
| `check` | `typecheck`, `test`, `build` |

## 12. Core definition of done

- Golden test and all rules tests pass.
- A contract test calls every method of `createRealServices()` against `fake-indexeddb` and checks the shapes against the types.
- `reading.read` returns a correct candidate for each file in `public/sample-docs/` on device, without the cloud.
- Share create, open, expiry and revoke work against a real Supabase project.
- Server deployed on Deployxa; `/api/health` returns 200.
- `docs/progress-core.md` lists setup steps for Supabase, the Gemini key, the Google OAuth client and Deployxa.
