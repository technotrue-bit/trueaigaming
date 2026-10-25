# Accounts launch checklist

Everything in the code is done and switched off by `SUBMISSIONS_ENABLED`. These are the account and settings steps
that turn it on. Do them in order. Steps 1 to 4 open accounts at outside services (all have free plans) and are the
owner's to do. Nothing here goes live until step 7.

## 1. Supabase (sign-in and database)

1. Create a project at supabase.com (free plan). Pick a US East region. Save the database password somewhere safe.
2. **SQL Editor:** paste and run `supabase/migrations/0001_accounts_submissions.sql`.
3. **Authentication → URL Configuration:**
   - Site URL: `https://trueaigaming.com`
   - Redirect URLs: `https://trueaigaming.com/account`, plus `https://*-true-team2.vercel.app/account` so preview builds can be tested.
4. **Authentication → Sign In / Providers → Email:** keep **Confirm email** on. Set the minimum password length to 12, to match the form.
5. **Project Settings → API:** note the Project URL and the `anon` key (public) and the `service_role` key (secret).
6. **CSP:** `vercel.json` allows one Supabase project in `connect-src` (`ycajnupfbiushygycclf`). If the new project's URL is
   different, change it there and in `SUPABASE_ORIGIN` in `scripts/site-copy.test.mjs`, or sign-in is blocked by the browser.

## 2. Email sender (Resend)

Supabase's built-in email only sends to the project's own team and is heavily rate-limited, so real sign-ups need a sender.

1. Create a Resend account (free plan) and add the domain `trueaigaming.com`.
2. Resend lists DNS records to add: a DKIM `TXT` at `resend._domainkey`, and an `MX` and an SPF `TXT` on its `send`
   subdomain. Add them in Vercel (Domains → trueaigaming.com → DNS). Leave the existing root `v=spf1 -all` and the
   `_dmarc` record as they are: Resend's SPF lives on the subdomain, and the DKIM signature is what passes DMARC.
3. When Resend shows the domain as verified, create an API key (sending access only).
4. **Supabase → Authentication → Emails → SMTP Settings:** enable custom SMTP.
   Host `smtp.resend.com`, port `465`, username `resend`, password the Resend API key,
   sender `noreply@trueaigaming.com`, sender name `TrueAIGaming`.
5. Optional: edit the Confirm signup and Reset password templates so they read like the site.

## 3. Bot check (Cloudflare Turnstile)

1. Create a free Cloudflare account, open **Turnstile**, and add a widget for hostname `trueaigaming.com`
   (add the preview host too if testing there). Mode: Managed.
2. **Supabase → Authentication → Attack Protection:** enable CAPTCHA protection, provider Turnstile, and paste the
   Turnstile **secret** key. Only Supabase gets the secret.
3. The **site** key is public and goes in Vercel as `VITE_TURNSTILE_SITE_KEY` (step 5).

Turn CAPTCHA protection on in Supabase and set the site key in the same release: with one but not the other,
every sign-up and sign-in fails.

## 4. Vercel deploy hook and Blob host

1. **Vercel → trueaigaming → Settings → Git → Deploy Hooks:** create one for branch `main`. Its URL is `DEPLOY_HOOK_URL`.
2. **Vercel → Storage → Create → Blob**, access **Public**, named for example `trueaigaming-thumbnails`. Connect it
   to the trueaigaming project with the environment variable prefix `THUMBNAIL_BLOB`, so its token lands in
   `THUMBNAIL_BLOB_READ_WRITE_TOKEN` and the private feedback store's `BLOB_READ_WRITE_TOKEN` is left alone.
3. Copy the host part of that store's URL (`<id>.public.blob.vercel-storage.com`). That is `BLOB_PUBLIC_HOST`.

## 5. Vercel environment variables

Add these to **Preview** first. Mark the secrets as Sensitive.

| Variable | Value |
| --- | --- |
| `SUPABASE_URL`, `VITE_SUPABASE_URL` | Supabase Project URL |
| `SUPABASE_ANON_KEY`, `VITE_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role key (Sensitive) |
| `DEPLOY_HOOK_URL` | Deploy hook URL (Sensitive) |
| `BLOB_PUBLIC_HOST` | Blob host, no `https://` |
| `VITE_TURNSTILE_SITE_KEY` | Turnstile site key |
| `SUBMISSIONS_ENABLED`, `VITE_SUBMISSIONS_ENABLED` | `true` |

## 6. Test on a preview build

1. Redeploy a preview. On a real iPhone: open `/account`, sign up with a birth date 13+ years ago, open the email, verify,
   choose a handle, submit a test game.
2. Try a birth date under 13 once and check the form closes.
3. Make your own account the reviewer in the Supabase SQL Editor:
   `update profiles set is_admin = true where handle = '<your handle>';`
4. Open `/admin/review`, approve the test game, and check it appears after the rebuild. Then delete it.
5. Try **Forgot password?** and **Delete account**.

## 7. Go live

Copy the same variables to **Production**, redeploy `main`, and repeat a quick sign-up on trueaigaming.com.
To switch accounts off again, set both `SUBMISSIONS_ENABLED` flags to anything but `true` and redeploy.
