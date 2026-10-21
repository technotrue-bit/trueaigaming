# Accounts and Game Submissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add email-and-password accounts and link-based game submissions with owner review, so approved games publish to the site through a rebuild.

**Architecture:** The static Vite site stays. Serverless routes in `api/` are thin wrappers over logic in `server/*.mjs`, which takes an injected store and fetch so it can be tested without a network. Supabase provides Postgres, auth and row-level security. Approved submissions are merged into the build's game list, so the grid, game pages and sitemap are generated the same way as today.

**Tech Stack:** Vite and TypeScript for the browser, Vercel serverless functions, `@supabase/supabase-js`, `@vercel/blob`, Node 22 `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-21-accounts-and-game-submissions-design.md` (commit `33856ce`)

## Global Constraints

- Handle: 3 to 24 characters from `a-z`, `0-9`, `-`. Input is trimmed and lowercased first. It must start and end with a letter or digit. Reserved list in Task 1.
- `display_name`: up to 40 characters.
- Password: at least 12 characters.
- Slug: 3 to 60 characters, `^[a-z0-9-]+$`. It becomes the game id.
- `name`: up to 60 characters. `description`: up to 140. `how_it_was_made`: up to 600. Lengths count code points after trimming.
- `play_url` and `source_url`: `https` only, up to 2048 characters, no credentials, no `localhost`, no IP-address hosts.
- Players: integers 1 to 16, `min <= max`.
- Limits per account: 5 pending submissions at once, and 3 new submissions in a rolling 24 hours.
- Thumbnail: PNG, JPEG or WebP, 1,048,576 bytes or less, checked by file signature. SVG is rejected. Stored in Vercel Blob with `access: 'public'`. Thumbnail host: `*.public.blob.vercel-storage.com`.
- Rejecting a submission requires a note.
- Errors use `{ ok: false, error: string }` with the status codes in each task.
- `SUBMISSIONS_ENABLED` (server and build) and `VITE_SUBMISSIONS_ENABLED` (browser) are each `'true'` or unset. When off, the build reads no database and API routes return `503 { ok: false, error: 'Submissions are not open yet' }`.
- Env: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DEPLOY_HOOK_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Only `VITE_*` values reach the browser. The service key never does.
- `SUPABASE_PROJECT_ORIGIN` (format `https://<ref>.supabase.co`) is an input from the owner, needed in Task 2. Task 16 writes it into `vercel.json`.
- Play buttons for user games open with `target="_blank" rel="noopener noreferrer"`. `frame-src` never changes.
- Footer copy: `Free to play. Sign up to share your own game.` (proposed wording; the owner confirms it in review).

## Review Focus

1. Odd handle, URL and text input: uppercase, unicode lookalikes, `javascript:`, `data:` and `http:` URLs, credentials in URLs, IPv4 and IPv6 hosts, emoji counted as code points. Test: Task 1.
2. Double submits and repeated requests: a repeated identical POST for a taken slug is refused and does not create a second row. Test: Task 5.
3. Unverified accounts and forged or expired tokens on every write route. Tests: Tasks 3, 4, 5, 6.
4. A rebuild hook that fails or times out after an approval or deletion: the change stays saved and Republish works. Tests: Tasks 5, 6.
5. Slug collisions with `games.json` ids, reserved handles, and disguised files (an SVG or HTML named `.png`, or a file over 1 MB). Tests: Tasks 1, 5, 7.

---

## File Structure

Create:
- `src/shared/submission-rules.mjs`: validation shared by the API and the browser forms.
- `supabase/migrations/0001_accounts_submissions.sql`: schema, check constraints, RLS.
- `supabase/tests/rls-check.sql`: RLS checks, run against the test project.
- `server/http.mjs`, `server/auth.mjs`, `server/supabase.mjs`, `server/deploy.mjs`: request, token, client and rebuild helpers.
- `server/store.mjs`: the Supabase-backed store. `server/test-store.mjs`: in-memory store with the same methods, for tests.
- `server/profiles.mjs`, `server/submissions.mjs`, `server/admin.mjs`: route logic.
- `scripts/published-games.mjs`: loads approved submissions for the build.
- `scripts/fixtures/published-games.json`: one valid row and one colliding row, for build checks.
- `api/profile.ts`, `api/submissions/index.ts`, `api/submissions/[id].ts`, `api/submissions/thumbnail.ts`, `api/admin/submissions/index.ts`, `api/admin/submissions/[id].ts`, `api/admin/republish.ts`: thin wrappers.
- `src/account/client.ts`, `src/account/api.ts`: browser Supabase client and API helper.
- `account.html` with `src/account/account.ts`; `submit.html` with `src/account/submit.ts`; `submissions.html` with `src/account/submissions.ts`; `admin.html` with `src/admin/review.ts`; `profile.html` with `src/profile/profile.ts`; `privacy.html`.
- `public/thumbs/placeholder.png`: 1280x720 fallback thumbnail.
- Tests: `scripts/submission-rules.test.mjs`, `server/http.test.mjs`, `server/auth.test.mjs`, `server/deploy.test.mjs`, `server/profiles.test.mjs`, `server/submissions.test.mjs`, `server/admin.test.mjs`, `scripts/published-games.test.mjs`, `scripts/site-copy.test.mjs`. Extend `scripts/cards.test.mjs`.

Modify: `package.json` (dependency, test script), `tsconfig.json` (`allowJs`), `api/tsconfig.json` (`allowJs`), `scripts/seo.mjs`, `src/games.ts`, `src/home.ts`, `src/play.ts`, `vite.config.ts`, `vercel.json`, `index.html`, `README.md`.

Test script: each task that adds a test file adds it to the `test` script in `package.json`, so `npm test` runs `node --test scripts/*.test.mjs server/*.test.mjs`.

---

### Task 1: Shared submission rules

**Files:**
- Create: `src/shared/submission-rules.mjs`, `scripts/submission-rules.test.mjs`
- Modify: `tsconfig.json` (add `"allowJs": true`, so `src/` can import the `.mjs` module), `package.json` (test script)

**Interfaces:**
- Produces:
  - `type Result<T> = { ok: true, value: T } | { ok: false, error: string }`
  - `validateHandle(value: unknown): Result<string>`: trims, lowercases, validates.
  - `validateDisplayName(value: unknown): Result<string>`
  - `validatePassword(value: unknown): Result<string>`: at least 12 characters.
  - `validateSlug(value: unknown): Result<string>`
  - `slugFromName(name: string): string`: lowercase, non-alphanumerics to hyphens, trims hyphens, max 60 characters.
  - `validateHttpsUrl(value: unknown): Result<string>`: rejects non-https, credentials, `localhost`, IPv4 and IPv6 literal hosts, and length over 2048.
  - `validatePlayers(min: unknown, max: unknown): Result<{ minPlayers: number, maxPlayers: number }>`
  - `isBlobThumbnailUrl(value: unknown): boolean`: https, and the host ends with `.public.blob.vercel-storage.com`.
  - `validateSubmission(input: unknown): Result<SubmissionFields>` where `SubmissionFields` is `{ name, slug, description, howItWasMade, playUrl, sourceUrl: string | null, thumbnailUrl: string | null, minPlayers, maxPlayers }`.
  - `RESERVED_HANDLES: Set<string>`: `admin`, `api`, `u`, `submit`, `account`, `submissions`, `profile`, `privacy`, `games`, `play`, `support`, `help`, `login`, `signup`, `logout`, `null`, `undefined`.

- [ ] **Step 1: Write the failing tests**

Key assertions (one `test()` per line):

```js
validateHandle(' Dev-1 ')            // ok, value 'dev-1'
validateHandle('ab')                 // error: too short
validateHandle('a'.repeat(25))       // error: too long
validateHandle('admin')              // error: reserved
validateHandle('dev_1') / ('dév') / ('dev.') / ('-dev') / ('dev-')   // error each
validateHttpsUrl('http://x.com')     // error
validateHttpsUrl('javascript:alert(1)') / ('data:text/html,x')       // error
validateHttpsUrl('https://user:pw@x.com/')                           // error: credentials
validateHttpsUrl('https://localhost:3000') / ('https://127.0.0.1/') / ('https://[::1]/')   // error
validateHttpsUrl('https://ok.example.com/play')                      // ok
validateHttpsUrl('https://' + 'a'.repeat(2050))                      // error: too long
validateSubmission with name of 60 emoji                             // ok (code points, not UTF-16 units)
validateSubmission with name of 61 emoji                             // error
validateSubmission({..., sourceUrl: ''})                             // ok, sourceUrl null
validateSubmission({..., thumbnailUrl: 'https://evil.com/x.png'})    // error
validatePlayers(1, 16) ok; (0, 4) error; (4, 2) error; (1, 17) error
isBlobThumbnailUrl('https://abc.public.blob.vercel-storage.com/x.png')          // true
isBlobThumbnailUrl('https://x.public.blob.vercel-storage.com.evil.com/x.png')   // false
isBlobThumbnailUrl('http://abc.public.blob.vercel-storage.com/x.png')           // false
slugFromName('  Pie Flick!! 2  ') === 'pie-flick-2'
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test scripts/submission-rules.test.mjs`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement `src/shared/submission-rules.mjs`**

Plain JavaScript with `// @ts-check` and JSDoc, like `scripts/seo.mjs`. No dependencies. Count length with `[...s].length`. Reject IPv4 literals with a regex and IPv6 by checking for `:` in the hostname from `new URL()`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test scripts/submission-rules.test.mjs`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/shared/submission-rules.mjs scripts/submission-rules.test.mjs tsconfig.json package.json
git commit -m "Add shared submission validation rules"
```

---

### Task 2: Database schema and row-level security

**Files:**
- Create: `supabase/migrations/0001_accounts_submissions.sql`, `supabase/tests/rls-check.sql`

**Interfaces:**
- Produces: tables `profiles` (`id`, `handle`, `display_name`, `is_admin`, `created_at`) and `submissions` (`id`, `owner_id`, `slug`, `name`, `description`, `how_it_was_made`, `play_url`, `source_url`, `thumbnail_url`, `min_players`, `max_players`, `status`, `review_note`, `reviewed_by`, `reviewed_at`, `created_at`, `updated_at`), plus enum `submission_status` (`pending`, `approved`, `rejected`).

**Input from the owner:** the Supabase project, with its `SUPABASE_PROJECT_ORIGIN`, anon key, service key, and a test database URL as `TEST_DATABASE_URL`. If any is missing, stop and ask for it before running the verification step.

- [ ] **Step 1: Write the migration**

- `profiles.handle`: unique, `check (handle ~ '^[a-z0-9]([a-z0-9-]{1,22}[a-z0-9])$')`.
- `profiles.display_name`: `char_length <= 40`.
- `submissions.slug`: unique, `check (slug ~ '^[a-z0-9-]{3,60}$')`.
- `name`: `char_length <= 60`. `description`: `char_length <= 140`. `how_it_was_made`: `char_length <= 600`.
- `play_url`: `check (play_url ~ '^https://' and char_length(play_url) <= 2048)`. `source_url`: same, nullable.
- `min_players` and `max_players`: `check (min_players between 1 and 16 and max_players between min_players and 16)`.
- Enable RLS on both tables. Policies:
  - `profiles`: anyone can select.
  - `submissions`: anyone can select rows with `status = 'approved'`. Owners can select their own rows.
  - Owners can insert and delete their own rows. Insert `with check` requires `status = 'pending'`.
  - Owners can update their own rows only to `status = 'pending'`, and only the content columns. No client role can write `status`, `review_note`, `reviewed_by` or `reviewed_at`, through column grants.
- Server routes use the service role, which bypasses RLS, and check ownership in code.

- [ ] **Step 2: Write `supabase/tests/rls-check.sql`**

Impersonates two users with `set local role authenticated` and `set local request.jwt.claims`. Each assertion raises an exception on failure:
- User A cannot select user B's pending row.
- User A cannot update `status` on any row.
- An anonymous client sees only approved rows.
- An insert with a handle of `Dev` is refused by the check constraint.

Ends with `select 'rls ok';`.

- [ ] **Step 3: Apply the migration and the checks to the test project**

Run:
```bash
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0001_accounts_submissions.sql
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls-check.sql
```
Expected: the second command ends with `rls ok` and exits 0.

- [ ] **Step 4: Commit**

```bash
git add supabase
git commit -m "Add accounts and submissions schema with row-level security"
```

---

### Task 3: Server helpers

**Files:**
- Create: `server/http.mjs`, `server/auth.mjs`, `server/supabase.mjs`, `server/deploy.mjs`, and tests `server/http.test.mjs`, `server/auth.test.mjs`, `server/deploy.test.mjs`
- Modify: `api/tsconfig.json` (add `"allowJs": true`), `package.json` (add `@supabase/supabase-js`, extend the test script)

**Interfaces:**
- `server/http.mjs`:
  - `send(res, status: number, body: object, headers?: Record<string, string>): void`: writes JSON with the same headers as `api/feedback.ts`.
  - `readBody(req, maxBytes: number): Promise<Buffer>`: throws `PayloadTooLarge`.
  - `readJson(req, maxBytes: number): Promise<unknown>`: throws `PayloadTooLarge` or `InvalidJson`.
- `server/supabase.mjs`: `serviceClient({ url, serviceKey })`: a Supabase client with `auth.persistSession: false`.
- `server/auth.mjs`:
  - `readUser(req, { fetchImpl, url, anonKey }): Promise<{ id, email, verified, handle, displayName } | null>`: calls `GET {url}/auth/v1/user` with the bearer token. Returns `null` on 401 or a missing header. `verified` is `email_confirmed_at !== null`. `handle` and `displayName` come from `user_metadata`.
  - `requireUser(req, deps): Promise<{ user } | { status, error }>`: `null` gives `401 'Sign in first'`.
  - `requireVerified(req, deps)`: same, plus `403 'Verify your email first'`.
- `server/deploy.mjs`: `triggerRebuild({ hookUrl, fetchImpl }): Promise<{ ok: true } | { ok: false, error: string }>`: POST with a 10 second `AbortSignal.timeout`. `ok` only on a 2xx. A missing hook gives `'DEPLOY_HOOK_URL is not set'`.

- [ ] **Step 1: Write the failing tests**

- `readJson` throws `PayloadTooLarge` when the body exceeds `maxBytes`, and `InvalidJson` on malformed JSON.
- `readUser` returns `null` on a 401, and `verified: false` when `email_confirmed_at` is null.
- `requireUser` returns status 401 for a signed-out request. `requireVerified` returns 403 for an unverified user.
- `triggerRebuild` returns `{ ok: false, error: 'DEPLOY_HOOK_URL is not set' }` when there is no hook. It returns an error on a 500, and `ok: true` on a 200.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test server/*.test.mjs`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement the four modules**

Each takes its dependencies as arguments, so tests pass fakes. Use `@supabase/supabase-js` only in `server/supabase.mjs`.

- [ ] **Step 4: Run the tests and confirm they pass, then type-check the API**

Run: `node --test server/*.test.mjs && npx tsc -p api`
Expected: tests pass and the type check exits 0.

- [ ] **Step 5: Commit**

```bash
git add server api/tsconfig.json package.json package-lock.json
git commit -m "Add server helpers for requests, auth, Supabase and rebuilds"
```

---

### Task 4: Profile logic and store

**Files:**
- Create: `server/store.mjs`, `server/test-store.mjs`, `server/profiles.mjs`, `server/profiles.test.mjs`, `api/profile.ts`

**Interfaces:**
- `server/store.mjs`: `createStore(client)` returns an object with these methods, used by every route module:
  - `getProfile(userId)`, `insertProfile({ id, handle, display_name })` (throws an error with `code === '23505'` on a duplicate handle), `deleteProfile(userId)`, `isAdmin(userId)`, `deleteAuthUser(userId)`
  - `listOwnSubmissions(ownerId)`, `getOwnSubmission(ownerId, id)`, `countPending(ownerId)`, `countSince(ownerId, iso)`, `insertSubmission(row)`, `updateSubmission(id, patch)`, `deleteSubmission(id)`, `listPending()`, `listApproved()`, `getSubmissionById(id)`
- `server/test-store.mjs`: `createTestStore(seed?)`: an in-memory store with the same method names.
- `server/profiles.mjs`:
  - `ensureProfile(store, user): Promise<Result<Profile>>`: returns the existing profile, or creates one from `user.handle` and `user.displayName`. Invalid or taken handles return `{ ok: false, status: 409, error: 'Choose a handle' }`.
  - `setHandle(store, user, handle): Promise<Result<Profile>>`: `409 'That handle is taken'` on a duplicate.
  - `deleteAccount({ store, user, rebuild }): Promise<{ ok: true, rebuild: Result | null }>`: deletes submissions, then the profile, then the auth user. Calls `rebuild()` only if an approved submission was removed.
- `api/profile.ts`: `GET` runs `requireUser` and `ensureProfile`. `POST` runs `requireUser` and `setHandle`. `DELETE` runs `requireUser` and `deleteAccount`.

Profiles are created from signup metadata on first sign-in. Signup without a session can't call the API, so the handle travels in `user_metadata`.

- [ ] **Step 1: Write the failing tests**

- `ensureProfile` creates a profile from metadata when none exists, and returns the same profile on a second call.
- `ensureProfile` returns `409` when the metadata handle is reserved, and creates nothing.
- `setHandle` returns `409 'That handle is taken'` when another profile has the handle.
- `deleteAccount` removes submissions, the profile and the auth user, and calls `rebuild` once only when an approved submission existed.
- `deleteAccount` never calls `rebuild` when only pending or rejected submissions were removed.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test server/profiles.test.mjs`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement `store.mjs`, `test-store.mjs`, `profiles.mjs`, and `api/profile.ts`**

`store.mjs` maps each method to a Supabase query. `api/profile.ts` is a thin wrapper that calls `readBody` for `POST`, the `send` helper and the logic functions, and reads env for the `serviceClient` deps.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test server/profiles.test.mjs && npx tsc -p api`
Expected: pass and exit 0.

- [ ] **Step 5: Commit**

```bash
git add server api/profile.ts
git commit -m "Add profile routes, store and in-memory test store"
```

---

### Task 5: Submission routes and thumbnail upload

**Files:**
- Create: `server/submissions.mjs`, `server/submissions.test.mjs`, `api/submissions/index.ts`, `api/submissions/[id].ts`, `api/submissions/thumbnail.ts`

**Interfaces:**
- `createSubmission({ store, ownerId, input, now }): Promise<Result<Submission>>`:
  - `countPending` at 5 or more returns `429 'You can have 5 pending submissions at a time'`.
  - `countSince(ownerId, now - 24h)` at 3 or more returns `429 'You can add 3 new submissions per day'`.
  - `validateSubmission` errors return `400`.
  - A thumbnail URL that fails `isBlobThumbnailUrl` returns `400`.
  - A slug collision returns `409 'That game address is taken'`.
  - Creates the row with `status: 'pending'`.
- `getOwnSubmission({ store, ownerId, id })`: `404 'Not found'` when the row is missing or belongs to someone else. The response never reveals which.
- `updateSubmission({ store, ownerId, id, input, now })`: returns `{ submission, wasApproved }`. Any edit sets `status: 'pending'`, and `review_note` is cleared.
- `deleteSubmission({ store, ownerId, id })`: returns `{ wasApproved }`.
- `checkThumbnail(buffer: Buffer, declaredType: string): Result<{ extension: 'png' | 'jpg' | 'webp' }>`:
  - Over 1,048,576 bytes returns `413 'Image must be 1 MB or less'`.
  - Signatures are PNG `89 50 4E 47 0D 0A 1A 0A`, JPEG `FF D8 FF`, WebP `RIFF????WEBP`. The declared type must match the detected type. Anything else, including SVG, returns `415 'Upload a PNG, JPEG or WebP image'`.
- Routes:
  - `GET /api/submissions` lists the caller's submissions.
  - `POST /api/submissions` returns `201`.
  - `GET /api/submissions/[id]` returns one, owner only.
  - `PATCH /api/submissions/[id]` returns `wasApproved` and, when true, calls `triggerRebuild`. The response includes `rebuild`.
  - `DELETE /api/submissions/[id]` follows the same rule.
  - `POST /api/submissions/thumbnail` takes raw bytes, runs `checkThumbnail`, then calls `put` from `@vercel/blob` with `access: 'public'` and `addRandomSuffix: true`. It returns `{ ok: true, url }`.
- All routes call `requireVerified` first.

- [ ] **Step 1: Write the failing tests**

Using `createTestStore` and a fake `rebuild`:

```js
test('pending cap: sixth pending submission is refused without inserting', ...)   // 429
test('daily cap: fourth submission in 24 hours is refused', ...)                   // 429
test('double submit: repeating the same slug creates one row, second gets 409', ...)
test('non-owner GET and PATCH return 404, not 403', ...)
test('editing an approved submission sets pending and calls rebuild once', ...)
test('deleting an approved submission calls rebuild once', ...)
test('deleting a pending submission does not call rebuild', ...)
test('thumbnail: SVG bytes declared as image/png return 415', ...)
test('thumbnail: 1,048,577 bytes return 413', ...)
test('thumbnail: a valid PNG signature returns ok with extension png', ...)
test('thumbnail: a thumbnail URL from another host is refused with 400', ...)
test('a rebuild that fails after an edit still saves the edit', ...)
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test server/submissions.test.mjs`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement the logic and the four route files**

Keep the route files thin. Do the checks in `server/submissions.mjs`.

- [ ] **Step 4: Run the tests and confirm they pass, then type-check**

Run: `node --test server/submissions.test.mjs && npx tsc -p api`
Expected: pass and exit 0.

- [ ] **Step 5: Commit**

```bash
git add server api/submissions
git commit -m "Add submission routes with limits, owner checks and thumbnail upload"
```

---

### Task 6: Admin review routes

**Files:**
- Create: `server/admin.mjs`, `server/admin.test.mjs`, `api/admin/submissions/index.ts`, `api/admin/submissions/[id].ts`, `api/admin/republish.ts`

**Interfaces:**
- `listPending({ store, adminId })`: `403 'Admins only'` when `isAdmin` is false.
- `reviewSubmission({ store, adminId, id, action: 'approve' | 'reject', note, rebuild })`:
  - Not an admin returns `403`.
  - `reject` with an empty note returns `400 'A note is required when rejecting'`.
  - Sets `status`, `review_note`, `reviewed_by` and `reviewed_at`.
  - `approve` calls `rebuild()`. The response is `{ ok: true, submission, rebuild }`. A failed rebuild still returns `ok: true`, with `rebuild.ok === false`.
  - `reject` does not call `rebuild`.
- `republish({ store, adminId, rebuild })`: admin only, calls `rebuild()`.
- Routes: `GET /api/admin/submissions` (pending), `POST /api/admin/submissions/[id]` with `{ action, note }`, `POST /api/admin/republish`. All call `requireUser` first.

- [ ] **Step 1: Write the failing tests**

```js
test('listPending refuses a non-admin with 403', ...)
test('reject without a note returns 400 and changes nothing', ...)
test('approve saves the status even when the rebuild fails', ...)   // rebuild.ok false, status approved
test('approve calls rebuild exactly once', ...)
test('reject does not call rebuild', ...)
test('republish refuses a non-admin and never calls rebuild', ...)
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test server/admin.test.mjs`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement `server/admin.mjs` and the three route files**

- [ ] **Step 4: Run the tests and confirm they pass, then type-check**

Run: `node --test server/admin.test.mjs && npx tsc -p api`
Expected: pass and exit 0.

- [ ] **Step 5: Commit**

```bash
git add server/admin.mjs server/admin.test.mjs api/admin
git commit -m "Add admin review and republish routes"
```

---

### Task 7: Published games for the build

**Files:**
- Create: `scripts/published-games.mjs`, `scripts/published-games.test.mjs`, `scripts/fixtures/published-games.json`, `public/thumbs/placeholder.png`
- Modify: `package.json` (test script)

**Interfaces:**
- Row shape, from Supabase or from the fixture: `{ slug, name, description, how_it_was_made, play_url, source_url, thumbnail_url, min_players, max_players, profiles: { handle, display_name } }`.
- `submissionToGame(row): Game`: `id` from `slug`, `thumbnail` from `thumbnail_url` or `'/thumbs/placeholder.png'`, `external: true`, `repo` from `source_url`, `howItWasMade` from `how_it_was_made`, `author` from `display_name` or `handle`, `status: 'live'`, `thumbSize: { width: 1280, height: 720 }`. The `Game` type is in `scripts/seo.mjs`.
- `loadPublishedGames({ env, fetchRows, existingIds }): Promise<Game[]>`:
  - Returns `[]` when `env.SUBMISSIONS_ENABLED !== 'true'`.
  - When `env.PUBLISHED_GAMES_JSON` is set, reads rows from that file. This is for build checks with fixtures.
  - Otherwise it needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Missing either throws `'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required when SUBMISSIONS_ENABLED=true'`.
  - A slug in `existingIds` throws `'Submission slug "<slug>" collides with a games.json id'`.
  - A row that fails `validateSubmission` throws. The build must not silently drop a game.
- Default `fetchRows` uses `@supabase/supabase-js` to select approved rows with `profiles(handle, display_name)`.

- [ ] **Step 1: Create the placeholder thumbnail**

Run:
```bash
python3 -c "from PIL import Image; Image.new('RGB', (1280, 720), (0x2B, 0x1D, 0x4E)).save('public/thumbs/placeholder.png')"
```
Expected: `public/thumbs/placeholder.png` is 1280x720.

- [ ] **Step 2: Write the failing tests**

```js
test('disabled flag returns no games and reads nothing', ...)
test('enabled: a valid row maps to a Game with external true', ...)
test('a missing thumbnail uses the placeholder', ...)
test('a slug that matches a games.json id throws', ...)
test('a row failing validation throws', ...)
test('enabled without Supabase env throws the documented message', ...)
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `node --test scripts/published-games.test.mjs`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 4: Implement the module and the fixture**

`scripts/fixtures/published-games.json` holds one valid row with slug `fixture-game`. The collision check uses the fixture's `existingIds` in the build check in Task 9.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `node --test scripts/published-games.test.mjs`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/published-games.mjs scripts/published-games.test.mjs scripts/fixtures public/thumbs/placeholder.png package.json
git commit -m "Load approved submissions for the build"
```

---

### Task 8: External games on the site

**Files:**
- Modify: `scripts/seo.mjs`, `src/games.ts`, `src/home.ts`, `src/play.ts`, `scripts/cards.test.mjs`

**Interfaces:**
- `Game` (both `scripts/seo.mjs` and `src/games.ts`): add `external?: boolean`.
- `loadGames` and `parseGame` accept an `https` thumbnail when `isBlobThumbnailUrl` is true. Other remote thumbnails stay rejected, as now. A remote thumbnail gets the default `thumbSize`.
- `cardHtml` and `card()` in `src/home.ts`: when `external` is true, the primary button is `<a class="btn btn-primary" href="${playUrl}" target="_blank" rel="noopener noreferrer">Play</a>`, and the cover links to `playUrl` with the same attributes. The "Play in browser" link is omitted, since it would duplicate the primary button. The Source link is unchanged.
- `gamePageHtml`: the same rule for its Play buttons.
- `src/play.ts`: when the game is `external`, call `location.replace(game.playUrl)`, so a direct `/play.html?id=` link never tries to frame it.

- [ ] **Step 1: Write the failing tests in `scripts/cards.test.mjs`**

```js
test('external card: primary Play goes to playUrl in a new tab, no /play.html link', ...)
test('external card: no "Play in browser" duplicate', ...)
test('loadGames accepts an https blob thumbnail', ...)       // via a temp games.json fixture or a direct call
test('loadGames rejects an https thumbnail from another host', ...)
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test scripts/cards.test.mjs`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement the changes in the four files**

Import `isBlobThumbnailUrl` from `src/shared/submission-rules.mjs` in both `scripts/seo.mjs` and `src/games.ts`.

- [ ] **Step 4: Run the tests, then type-check and build**

Run: `npm test && npx tsc --noEmit -p . && npm run build`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/seo.mjs src/games.ts src/home.ts src/play.ts scripts/cards.test.mjs
git commit -m "Show external submitted games with a new-tab Play button"
```

---

### Task 9: Build and dev integration

**Files:**
- Modify: `vite.config.ts`
- Create: none

**Interfaces:**
- `vite.config.ts` becomes `defineConfig(async () => ...)`. It computes `allGames = [...loadGames(), ...(await loadPublishedGames({ env: process.env, fetchRows, existingIds }))]`. `existingIds` is the set of ids from `public/games.json`.
- `writeGamePages(allGames)` writes game pages for the combined list. Build inputs use the same list.
- `transformIndexHtml` and `generateBundle` use the combined list, so the grid, JSON-LD and sitemap include approved games.
- `closeBundle`: overwrite `dist/games.json` with the combined list. The browser's runtime fetch in `src/home.ts` and `src/play.ts` reads that file, so it must match the prerender.
- `configureServer`: serve `/games.json` from the combined list, and rewrite game pages on change.

- [ ] **Step 1: Verify the baseline build**

Run: `npm run build`
Expected: builds without published games, as today.

- [ ] **Step 2: Implement the changes in `vite.config.ts`**

- [ ] **Step 3: Run the fixture build**

Run:
```bash
SUBMISSIONS_ENABLED=true PUBLISHED_GAMES_JSON=scripts/fixtures/published-games.json npm run build
test -f dist/games/fixture-game/index.html && grep -q fixture-game dist/games.json && grep -q fixture-game dist/sitemap.xml && echo "fixture build ok"
```
Expected: `fixture build ok`.

- [ ] **Step 4: Run the collision check**

Run:
```bash
SUBMISSIONS_ENABLED=true PUBLISHED_GAMES_JSON=scripts/fixtures/collision.json npm run build; echo "exit=$?"
```
Create `scripts/fixtures/collision.json` as a copy of the fixture, with slug `super-star-party`.
Expected: `exit=` is non-zero and the output names the collision.

- [ ] **Step 5: Confirm the flag-off build is unchanged**

Run: `npm run build && grep -c fixture-game dist/games.json || true`
Expected: the build succeeds and the grep finds nothing.

- [ ] **Step 6: Commit**

```bash
git add vite.config.ts scripts/fixtures
git commit -m "Merge approved submissions into the build, sitemap and dev server"
```

---

### Task 10: Browser client and API helper

**Files:**
- Create: `src/account/client.ts`, `src/account/api.ts`

**Interfaces:**
- `client.ts`: `supabase` (the browser client from `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, throwing a clear error if either is missing), `SUBMISSIONS_ENABLED = import.meta.env.VITE_SUBMISSIONS_ENABLED === 'true'`.
- `api.ts`: `apiFetch<T>(path: string, init?: RequestInit): Promise<T>`: adds `Authorization: Bearer <access_token>` from the current session, parses JSON, and throws `ApiError(status, message)` on `ok: false`.

No browser unit tests exist in this repo. Task 17 covers these through the end-to-end run.

- [ ] **Step 1: Write both files**

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p .`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/account/client.ts src/account/api.ts
git commit -m "Add browser Supabase client and API helper"
```

---

### Task 11: Account page

**Files:**
- Create: `account.html`, `src/account/account.ts`

**Behavior:**
- Flag off: "Submissions are not open yet."
- Signed out: a **Create account** form (email, password, handle, optional display name). It calls `supabase.auth.signUp` with `emailRedirectTo: <origin>/account` and `options.data = { handle, display_name }`, then shows "Check your email to verify your account." Also a **Sign in** form, and **Forgot password?**, which calls `resetPasswordForEmail`.
- Signed in, not verified: "Verify your email to submit games." with **Resend**, which calls `supabase.auth.resend({ type: 'signup', email })`.
- Signed in and verified: the handle (from `GET /api/profile`), links to **Submit a game** (`/submit`) and **My games** (`/account/submissions`), **Sign out**, and **Delete account**. Delete asks "Delete your account and all your games? This can't be undone." and calls `DELETE /api/profile`.
- If `GET /api/profile` returns `409`, show a handle form that calls `POST /api/profile`.

- [ ] **Step 1: Write `account.html` and `src/account/account.ts`**

- [ ] **Step 2: Type-check and build**

Run: `npx tsc --noEmit -p . && npm run build`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add account.html src/account/account.ts vite.config.ts
git commit -m "Add account page: sign up, sign in, verify, handle and delete"
```

Add `account.html` to the Vite `build.rollupOptions.input` in `vite.config.ts` in this step, next to `index.html` and `play.html`.

---

### Task 12: Submit page

**Files:**
- Create: `submit.html`, `src/account/submit.ts`
- Modify: `vite.config.ts` (add `submit.html` to the inputs)

**Behavior:**
- Fields: name (60), description (140, with a counter), how it was made (600, with a counter), play link (https), source link (optional), thumbnail (optional file input), min and max players (1 to 16). A **Game address** field starts from `slugFromName(name)` and can be edited.
- Validation uses `validateSubmission` from `src/shared/submission-rules.mjs`, so messages match the server.
- With a thumbnail: `POST /api/submissions/thumbnail` with the raw bytes and the file's type, then `POST /api/submissions` with `thumbnail_url`. On `201`, go to `/account/submissions?created=1`.
- `?edit=<id>` loads the submission with `GET /api/submissions/<id>`, fills the form, and saves with `PATCH`. A line says: "Editing a live game takes it off the site until it's approved again."
- Errors from the API are shown next to the form.

- [ ] **Step 1: Write the page and script**

- [ ] **Step 2: Type-check and build**

Run: `npx tsc --noEmit -p . && npm run build`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add submit.html src/account/submit.ts vite.config.ts
git commit -m "Add submit page with thumbnail upload and edit mode"
```

---

### Task 13: My games page

**Files:**
- Create: `submissions.html`, `src/account/submissions.ts`
- Modify: `vite.config.ts` (add `submissions.html` to the inputs)

**Behavior:**
- Lists `GET /api/submissions`. Each row shows the name, a status line (`Waiting for review`, `Live`, or `Not approved: <note>`), and **Edit** (links to `/submit?edit=<id>`) and **Delete** (with a confirm).
- `?created=1` shows "Submitted. It will appear on the site once it's approved."

- [ ] **Step 1: Write the page and script**

- [ ] **Step 2: Type-check and build**

Run: `npx tsc --noEmit -p . && npm run build`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add submissions.html src/account/submissions.ts vite.config.ts
git commit -m "Add my games page with status, edit and delete"
```

---

### Task 14: Admin review page

**Files:**
- Create: `admin.html`, `src/admin/review.ts`
- Modify: `vite.config.ts` (add `admin.html` to the inputs)

**Behavior:**
- Lists `GET /api/admin/submissions`. Each card shows name, description, how it was made, the play link (`target="_blank" rel="noopener noreferrer"`), the source link, the thumbnail, and the owner's handle.
- **Approve** calls `POST /api/admin/submissions/<id>` with `{ action: 'approve' }`. The result says "Live in a few minutes", or "Rebuild not started. Use Republish." when `rebuild.ok` is false.
- **Reject** needs a note. The button stays disabled until the note has text.
- **Republish** calls `POST /api/admin/republish`.
- A `403` shows "Admins only."

- [ ] **Step 1: Write the page and script**

- [ ] **Step 2: Type-check and build**

Run: `npx tsc --noEmit -p . && npm run build`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add admin.html src/admin/review.ts vite.config.ts
git commit -m "Add admin review page with approve, reject and republish"
```

---

### Task 15: Public profile page and rewrites

**Files:**
- Create: `profile.html`, `src/profile/profile.ts`
- Modify: `vercel.json` (add a `rewrites` array), `vite.config.ts` (add `profile.html` to the inputs)

**Behavior:**
- `vercel.json` rewrites: `/u/:handle` to `/profile.html`, `/account/submissions` to `/submissions.html`, `/submit` to `/submit.html`, `/admin/review` to `/admin.html`. `/account` to `/account.html`.
- `profile.html` reads the handle from `location.pathname`. Using the anon client, it reads `profiles` (`handle`, `display_name`), then the owner's approved submissions. RLS allows both.
- Unknown handle: "No player with that handle." Each game links to `/games/<slug>/`.
- The page is not in the sitemap.

- [ ] **Step 1: Write the page, script and rewrites**

- [ ] **Step 2: Type-check, build and confirm the rewrites in config**

Run: `npx tsc --noEmit -p . && npm run build && node -e "const v=require('./vercel.json'); console.log(v.rewrites.map(r=>r.source).join(' '))"`
Expected: the build passes, and the printed list includes `/u/:handle`, `/submit`, `/account/submissions`, `/admin/review` and `/account`.

- [ ] **Step 3: Commit**

```bash
git add profile.html src/profile/profile.ts vercel.json vite.config.ts
git commit -m "Add public profile page and route rewrites"
```

---

### Task 16: Launch copy, headers, privacy page

**Files:**
- Modify: `index.html` (footer), `scripts/seo.mjs` (footer in `gamePageHtml`), `vercel.json` (CSP)
- Create: `privacy.html`, `scripts/site-copy.test.mjs`
- Modify: `README.md`, `vite.config.ts` (add `privacy.html` to the inputs), `package.json` (test script)

**Behavior:**
- Footer copy on the home and game pages: replace "No accounts. Just games." with "Free to play. Sign up to share your own game." Add a link: "Sign in or share your game" to `/account`.
- `vercel.json` CSP: `connect-src` gains `SUPABASE_PROJECT_ORIGIN`. `img-src` gains `https://*.public.blob.vercel-storage.com`. `frame-src` is unchanged.
- `privacy.html` states what is stored (email through Supabase, handle, display name, game details, and the sign-in session in the browser). It names where data lives (Supabase and Vercel Blob), and says there are no tracking cookies and analytics are cookieless. It explains how to delete everything: **Delete account** on the account page. It gives the owner's contact as `https://x.com/itsmetrueg`. Link it from the footer.
- `README.md`: remove the "no accounts" claims. Add an accounts section with the env vars and the `SUBMISSIONS_ENABLED` flag.

- [ ] **Step 1: Write the failing tests in `scripts/site-copy.test.mjs`**

```js
test('home footer no longer says "No accounts"', ...)           // index.html does not contain it
test('CSP connect-src includes SUPABASE_PROJECT_ORIGIN', ...)    // from vercel.json headers
test('CSP img-src includes the Vercel Blob host', ...)
test('CSP frame-src is unchanged (still no user origins)', ...)  // frame-src equals the value before this change
test('privacy.html exists and mentions "Delete account"', ...)
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test scripts/site-copy.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Make the edits**

Write the `frame-src` assertion to compare against the value in the current `vercel.json` (`https://super-star-party.vercel.app https://*.vercel.app`), so the test shows whether the policy changed.

- [ ] **Step 4: Run the tests and the build**

Run: `npm test && npm run build`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add index.html scripts/seo.mjs vercel.json privacy.html scripts/site-copy.test.mjs README.md vite.config.ts package.json
git commit -m "Update copy, CSP and README for accounts; add privacy page"
```

---

### Task 17: Rollout and end-to-end check

**Files:**
- Create: `tools/accounts-e2e.mjs` (Playwright, same style as the existing `tools/probe-*.mjs`)

**Steps:**
- [ ] Set the test project's values, then run `SUBMISSIONS_ENABLED=true VITE_SUBMISSIONS_ENABLED=true npm run build && npx vite preview --port 4173 --strictPort`.
- [ ] The script signs up a random address, confirms the email through the admin API (`PATCH {url}/auth/v1/admin/users/{id}` with `{ email_confirm: true }`), signs in, sets a handle, and submits the fixture game with `https://example.com/game`.
- [ ] Expected: the submission shows "Waiting for review" on the games page.
- [ ] Set `is_admin = true` for a second test account with SQL, sign in as that account, and approve the submission. Expected: "Live in a few minutes" (or "Rebuild not started" when `DEPLOY_HOOK_URL` is unset, which is also a pass for this step).
- [ ] Run `SUBMISSIONS_ENABLED=true PUBLISHED_GAMES_JSON=<exported approved row as JSON> npm run build`. Expected: `dist/games/<slug>/index.html` exists.
- [ ] Delete the test account from the account page. Expected: its rows are gone from the database.
- [ ] Manual check on a real iPhone (Safari): sign up, verify the email link, submit, and open the game in a new tab.
- [ ] Turn the flag on in production (`SUBMISSIONS_ENABLED` and `VITE_SUBMISSIONS_ENABLED` both `true`) only after the steps above pass.
- [ ] Commit:
  ```bash
  git add tools/accounts-e2e.mjs
  git commit -m "Add end-to-end check for accounts and submissions"
  ```

---

## Self-Review

- **Spec coverage:** Sign-up, sign-in, verification, reset and handles: Tasks 4, 11. Submit and edit: Tasks 5, 12. Owner review and rejection notes: Tasks 6, 14. Delete and account deletion: Tasks 4, 5, 13. Public profile: Task 15. Data model and RLS: Task 2. Shared link and content rules: Task 1. Architecture and build: Tasks 3, 7, 9. Security headers and privacy copy: Task 16. Errors: Tasks 3 to 6. Testing: unit tests in Tasks 1 to 8, RLS in Task 2, build checks in Tasks 7 and 9, end-to-end in Task 17.
- **Type consistency:** `validateSubmission` returns `SubmissionFields`, used in Tasks 5, 7 and 12. `createTestStore` and `createStore` expose the same method names, used in Tasks 4 to 6. `triggerRebuild` returns the same `Result` shape everywhere, used in Tasks 4 to 6. `loadPublishedGames` takes `{ env, fetchRows, existingIds }` in Tasks 7 and 9.
- **Gaps closed:** Profiles are created from signup metadata, since signup without a session can't call the API. Approved edits and deletes trigger a rebuild, so removed games leave the site. Thumbnails must come from the Blob host, so the CSP and the games' `isBlobThumbnailUrl` check agree.
- **Open inputs:** the Supabase project and its keys (Task 2), and the owner's approval of the footer copy and the decisions in the spec.
