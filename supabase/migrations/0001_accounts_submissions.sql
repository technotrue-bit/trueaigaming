-- Accounts and game submissions: tables, caps, row-level security and grants.
--
-- Error codes the server maps (Postgres reports them as SQLSTATE and message):
--   pending_limit  SQLSTATE P0001  message 'pending_limit'  An owner already has 5 pending submissions.
--   daily_limit    SQLSTATE P0001  message 'daily_limit'    An owner already created 3 submissions in the last 24 hours.
--   Both are plain `raise exception`, so the SQLSTATE is the default P0001 and the message tells them apart.
--   The server maps both to HTTP 429. A duplicate handle or slug is SQLSTATE 23505 (unique_violation).
--
-- The caps are enforced by triggers, so the service role (which bypasses row-level security) is bound by them
-- too. Each trigger takes a per-owner advisory lock before it counts, so two parallel requests cannot both pass.
--
-- Client roles (anon, authenticated) get column-level grants only. Supabase grants all privileges on new
-- tables in `public` to anon and authenticated by default, so this file revokes them first, then grants back
-- exactly what is meant to be public.

create type submission_status as enum ('pending', 'approved', 'rejected');

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  handle text not null unique
    constraint profiles_handle_format check (handle ~ '^[a-z0-9]([a-z0-9-]{1,22}[a-z0-9])$'),
  display_name text not null default ''
    constraint profiles_display_name_length check (char_length(display_name) <= 40),
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table submissions (
  id uuid primary key default gen_random_uuid(),
  -- This foreign key is required: PostgREST embeds profiles(handle) and profiles!inner(handle) through it.
  owner_id uuid not null references profiles (id) on delete cascade,
  slug text not null unique
    constraint submissions_slug_format check (slug ~ '^[a-z0-9-]{3,60}$'),
  name text not null
    constraint submissions_name_length check (char_length(name) between 1 and 60),
  description text not null
    constraint submissions_description_length check (char_length(description) <= 140),
  how_it_was_made text not null
    constraint submissions_how_it_was_made_length check (char_length(how_it_was_made) <= 600),
  play_url text not null
    constraint submissions_play_url_check check (play_url ~ '^https://' and char_length(play_url) <= 2048),
  source_url text
    constraint submissions_source_url_check check (source_url ~ '^https://' and char_length(source_url) <= 2048),
  thumbnail_url text
    constraint submissions_thumbnail_url_check check (
      thumbnail_url is null
      or (thumbnail_url ~ '^https://[a-z0-9-]+\.public\.blob\.vercel-storage\.com/' and char_length(thumbnail_url) <= 2048)),
  min_players integer not null,
  max_players integer not null,
  status submission_status not null default 'pending',
  review_note text,
  reviewed_by uuid references profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint submissions_players_range check (min_players between 1 and 16 and max_players between min_players and 16)
);

create index submissions_owner_status_idx on submissions (owner_id, status);
create index submissions_status_created_idx on submissions (status, created_at);

-- Append-only record of every submission an owner created, for the daily cap. The cap counts this table, not
-- submissions, so deleting a row and inserting another cannot beat it. Rows go only when the profile goes.
-- Client roles have no access (row-level security on, no policies, no grants); the trigger below writes it.
create table submission_creations (
  owner_id uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index submission_creations_owner_created_idx on submission_creations (owner_id, created_at);
alter table submission_creations enable row level security;

-- Keeps updated_at current on every update.
create function set_updated_at() returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger submissions_set_updated_at
  before update on submissions
  for each row execute function set_updated_at();

-- Atomic caps. SECURITY DEFINER so the counts see every row of the owner whatever role runs the statement.
-- pg_advisory_xact_lock serialises the owner's inserts and re-pendings until the transaction ends. The count
-- runs after the lock is taken, in READ COMMITTED, so it sees rows the previous holder of the lock committed.
-- This relies on READ COMMITTED, which is PostgREST's default. Under REPEATABLE READ or SERIALIZABLE the count
-- would use a snapshot taken before the lock and the caps could be exceeded.
create function enforce_submission_caps() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtext(new.owner_id::text));

  if tg_op = 'INSERT' then
    if new.status = 'pending'
       and (select count(*) from submissions where owner_id = new.owner_id and status = 'pending') >= 5 then
      raise exception 'pending_limit';
    end if;
    if (select count(*) from submission_creations
          where owner_id = new.owner_id and created_at > now() - interval '24 hours') >= 3 then
      raise exception 'daily_limit';
    end if;
    insert into submission_creations (owner_id, created_at) values (new.owner_id, new.created_at);
  else
    -- UPDATE that moves a row to pending from another status, or to another owner while pending. The row is not
    -- yet counted against new.owner_id, so it is not counted here.
    if (select count(*) from submissions where owner_id = new.owner_id and status = 'pending') >= 5 then
      raise exception 'pending_limit';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function enforce_submission_caps() from public, anon, authenticated, service_role;

create trigger submissions_caps_insert
  before insert on submissions
  for each row execute function enforce_submission_caps();

create trigger submissions_caps_to_pending
  before update on submissions
  for each row
  when (new.status = 'pending' and (old.status is distinct from new.status or old.owner_id is distinct from new.owner_id))
  execute function enforce_submission_caps();

-- Row-level security.
alter table profiles enable row level security;
alter table submissions enable row level security;

-- Grants. Start from nothing for the client roles.
revoke all on profiles from anon, authenticated;
revoke all on submissions from anon, authenticated;
revoke all on submission_creations from anon, authenticated, service_role;
grant select on submission_creations to service_role;
grant usage on schema public to anon, authenticated, service_role;
grant all on profiles, submissions to service_role;

-- profiles: public columns only. is_admin and created_at are never granted to client roles, so a public read
-- cannot reveal who the admins are. A signed-in user may change only their own display_name. The server creates
-- profiles, and changes handles, with the service role.
grant select (id, handle, display_name) on profiles to anon, authenticated;
grant update (display_name) on profiles to authenticated;

create policy profiles_select_all on profiles
  for select to anon, authenticated using (true);
create policy profiles_update_own on profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- submissions: the public columns. review_note, reviewed_by and reviewed_at are not granted to any client role.
grant select (id, owner_id, slug, name, description, how_it_was_made, play_url, source_url, thumbnail_url,
              min_players, max_players, status, created_at, updated_at)
  on submissions to anon, authenticated;

-- A policy cannot hide columns. Granting review_note and reviewed_by to authenticated would let any signed-in user
-- read them on APPROVED rows (reviewed_by would reveal who the admins are). So the owner reads the review
-- columns of their own rows through this view instead. It runs with its owner's rights and filters on auth.uid().
-- security_barrier keeps a caller's own filter functions from running on rows the view has not yet filtered out,
-- so a cast in a caller's WHERE cannot leak another owner's review_note through an error message.
create view my_submissions with (security_barrier = true) as
  select * from submissions where owner_id = auth.uid();
revoke all on my_submissions from anon, authenticated;
grant select on my_submissions to authenticated;
grant all on my_submissions to service_role;

-- Owners insert only as pending, and update only the content columns plus status, which the policy limits to
-- 'pending'. Granting status for update is what lets an edit send an approved row back to review; the policy
-- check below makes any other status value fail. owner_id is not updatable. No client role can write
-- review_note, reviewed_by or reviewed_at.
grant insert (owner_id, name, slug, description, how_it_was_made, play_url, source_url, thumbnail_url,
              min_players, max_players, status)
  on submissions to authenticated;
grant update (name, slug, description, how_it_was_made, play_url, source_url, thumbnail_url,
              min_players, max_players, status)
  on submissions to authenticated;
grant delete on submissions to authenticated;

create policy submissions_select_approved on submissions
  for select to anon, authenticated using (status = 'approved');
create policy submissions_select_own on submissions
  for select to authenticated using (owner_id = auth.uid());
create policy submissions_insert_own on submissions
  for insert to authenticated with check (owner_id = auth.uid() and status = 'pending');
create policy submissions_update_own on submissions
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and status = 'pending');
create policy submissions_delete_own on submissions
  for delete to authenticated using (owner_id = auth.uid());
