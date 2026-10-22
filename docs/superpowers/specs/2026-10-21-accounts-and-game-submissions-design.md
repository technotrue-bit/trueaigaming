# Accounts and game submissions: design

Date: 2026-10-21
Status: draft for review

## Summary

TrueAIGaming gets user accounts. Signed-in people submit a game by link. The site owner reviews each submission. Approved games appear in the home grid, get their own `/games/<id>/` page, and go into the sitemap. Their Play button opens the game in a new tab. Uploading and hosting game files is a later project.

## Goals

- Sign up with email and password, verify the email, sign in, sign out, and reset a forgotten password.
- Choose a unique handle. A public profile at `/u/<handle>` lists that person's approved games.
- Submit a game: name, description, play link, optional source link, thumbnail, player range, and a "how it was made" note.
- The owner approves or rejects each submission, with a note on rejections.
- Approved games publish without anyone editing `public/games.json` by hand.

## Non-goals (v1)

- Uploading or hosting game files.
- Comments, likes, ratings.
- A report button and moderation queue for published games. This is sub-project 3.
- Email notifications about review decisions. Status shows in the account instead.
- Payments of any kind.

## Decisions to confirm

Each decision has a recommendation. Please confirm or change them.

1. **Auth and database: Supabase.** It provides hosted Postgres, email and password sign-in, email verification, password reset, and row-level security. The alternative is Clerk for sign-in with Neon for Postgres. That's two services where Supabase is one.
2. **Publishing: rebuild on approval.** Approving a submission calls a Vercel deploy hook, so the prerendered grid, game pages and sitemap include the new game. The alternative is loading approved games in the browser at runtime. That's simpler, but user games wouldn't be in the HTML crawlers see.
3. **Reviewer: owner only.** An account with `is_admin = true` gets the review page. The flag is set by hand in the database.
4. **Thumbnail: uploaded by the creator.** A 16:9 PNG, JPG or WebP up to 1 MB, stored in Vercel Blob. SVG is rejected.
5. **Footer copy changes.** "No accounts. Just games." is no longer true, so it needs new wording. The README's privacy claims also change. Analytics stay cookieless.

## Users and flows

**Sign up.** Email, password (at least 12 characters), and handle. Supabase sends a verification email. Creating or editing submissions requires a verified email. Browsing does not.

**Sign in and out.** Standard. A forgotten password sends a reset email.

**Submit.** A form at `/submit`. It posts to `POST /api/submissions`, and the new submission starts as `pending`. An account may have at most 5 pending submissions at once and at most 3 new ones per day.

**Review.** The owner sees `/admin/review`, which lists pending submissions. Each one shows the play link (opening in a new tab) and the thumbnail. The owner can approve, or reject with a required note. Approving sets `status = approved` and calls the deploy hook. The page then shows "Live in a few minutes".

**Edit.** The owner can edit a pending or rejected submission. Rejected submissions return to `pending`. Editing an approved submission also sets it back to `pending`, and the save calls the deploy hook so it leaves the site straight away. It returns only after re-approval.

**Delete.** The owner can delete a submission. If it was approved, the save calls the deploy hook, so it leaves the site. Deleting an account deletes its submissions and profile.

**Profile.** `/u/<handle>` shows the handle and the account's approved games. It's rendered in the browser, so it's not in the sitemap in v1.

## Architecture

- The static Vite site stays as it is.
- New serverless routes sit under `api/`, following `api/feedback.ts`: `api/submissions` (create, list own, edit, delete), and `api/admin/submissions` (list pending, approve, reject, republish).
- The browser signs in with the Supabase client. Every API route verifies the caller's token on the server and never trusts a user id sent by the browser.
- The service-role key lives only in server code and the build environment. It never reaches the browser bundle.
- Pages: `/account`, `/account/submissions`, `/submit`, `/admin/review`, and `/u/<handle>`. The last one is a rewrite in `vercel.json` to a `profile.html` page.
- **Build.** `vite.config.ts` reads approved submissions from the database at build time and adds them to the games from `public/games.json`. The existing `scripts/seo.mjs` then generates the grid, game pages and sitemap as before. `public/games.json` keeps your first-party games.
- **Id collisions.** A submission slug must not match an id in `games.json`. The build fails if one does.

## Data model

`profiles`
- `id` uuid, primary key, references the auth user
- `handle` text, unique, 3 to 24 characters from `a-z 0-9 -`, not on a reserved list (`admin`, `api`, `u`, `submit`, `account`, and similar)
- `display_name` text, up to 40 characters
- `is_admin` boolean, default false
- `created_at` timestamp

`submissions`
- `id` uuid, primary key
- `owner_id` uuid, references `profiles`
- `slug` text, unique, URL-safe, 3 to 60 characters. It becomes the game id.
- `name` text, up to 60 characters
- `description` text, up to 140 characters
- `how_it_was_made` text, up to 600 characters
- `play_url` text, https only, up to 2048 characters
- `source_url` text, https, optional
- `thumbnail_url` text, optional
- `min_players`, `max_players` integers, 1 to 16, with `min <= max`
- `status` enum: `pending`, `approved`, `rejected`
- `review_note` text, optional
- `reviewed_by` uuid, optional
- `reviewed_at`, `created_at`, `updated_at` timestamps

**Row-level security.** Anyone can read profile handles and display names. Anyone can read approved submissions. Owners can read their own rows. Only the server, using the service role, writes submissions and changes `status`, `review_note` and the review fields. The `authenticated` role has no INSERT, UPDATE or DELETE grant on `submissions` at all: the API is the only writer, through the service role, and the browser only reads.

## Link and content rules

- `play_url` and `source_url` must be `https`. They can't include credentials, `localhost`, or IP-address hosts.
- Validation is a single shared module, `src/shared/submission.ts`, used by the API and the form. The database has check constraints as a second layer.
- All text is rendered as text, never as HTML, as the existing code already does.
- Thumbnails are checked by file signature, not just the extension, and must be 1 MB or less.

## Security and abuse

- **Headers.** `connect-src` gains the Supabase project origin. `img-src` gains the Vercel Blob public host. `frame-src` does not change, so user games are never framed.
- **Play links.** They open with `target="_blank" rel="noopener noreferrer"`.
- **Phishing.** A reviewer opens each link before approving. Reports in sub-project 3 cover what gets past review.
- **Rate limits.** Supabase's built-in auth limits apply to sign-up and sign-in. Submission limits are enforced in the database.
- **Account deletion.** Required before launch, for privacy.

## Privacy

Stored data: email (managed by Supabase), handle, display name, and submission content. The site still sets no analytics cookies. A short privacy page must exist before launch. It's a launch blocker, not a v1 feature.

## Errors

- API errors return `{ ok: false, error }`, the same shape as the feedback endpoint.
- If the deploy hook fails, the approval is still saved. The owner sees "Rebuild not started" and can retry with **Republish**.
- If the build can't read the database, the build fails. Vercel keeps the last good deployment live, so the site doesn't lose games. This is safer than silently dropping user games.
- If the auth service is down, sign-in shows an error. The rest of the site still works.

## Testing

- **Unit.** Validation in the shared module, following the existing `node --test` setup.
- **Build.** Approved games appear in the grid, game pages and sitemap. Slug collisions fail the build.
- **API.** Signed-out requests get 401. Unverified accounts get 403. Non-admins get 403 on review routes. The pending limit is enforced.
- **Security.** Tests with two accounts check that row-level security stops one user reading or changing another's pending submissions. Owner emails never appear in public responses.
- **End to end (Playwright).** Sign up, verify, submit, approve, rebuild against a test deploy hook, and check the game appears.
- **Manual.** Sign-in and the submit form on a real iPhone.

## Rollout

1. Create the Supabase project, the schema and the RLS policies. Add the environment variables to Vercel for preview and production.
2. Sign-up, sign-in and profile pages, behind a `SUBMISSIONS_ENABLED` flag.
3. Submit and owner pages.
4. Review page and publishing through the deploy hook.
5. Footer copy, README, privacy page, and the CSP changes.
6. Turn the flag on.

## Open questions

- The exact reserved-handle list.
- The player range limit. The draft uses 16.
- Whether to add approval emails once the platform has users.
