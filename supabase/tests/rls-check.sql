-- Checks for supabase/migrations/0001_accounts_submissions.sql. Run as a superuser after the shim and the migration.
-- Every failed assertion raises an exception, so `psql -v ON_ERROR_STOP=1` exits non-zero. The last statement prints "rls ok".
\set ON_ERROR_STOP on
set client_min_messages = warning;

create schema t;

-- Runs sql as the given role ('postgres' keeps the superuser) with the given user id in the JWT claims.
-- Returns the number of rows the statement returned or changed.
create function t.exec(who text, uid uuid, sql text) returns bigint
language plpgsql as $$
declare
  n bigint;
begin
  perform set_config('request.jwt.claims', case when uid is null then '' else json_build_object('sub', uid)::text end, true);
  if who <> 'postgres' then execute format('set local role %I', who); end if;
  execute sql;
  get diagnostics n = row_count;
  reset role;
  return n;
exception when others then
  reset role;
  raise;
end;
$$;

-- Runs a select and returns its row count.
create function t.count(who text, uid uuid, sql text) returns bigint
language plpgsql as $$
declare
  n bigint;
begin
  perform set_config('request.jwt.claims', case when uid is null then '' else json_build_object('sub', uid)::text end, true);
  if who <> 'postgres' then execute format('set local role %I', who); end if;
  execute 'select count(*) from (' || sql || ') q' into n;
  reset role;
  return n;
exception when others then
  reset role;
  raise;
end;
$$;

-- Asserts that sql fails with the given SQLSTATE and, when given, a message containing msg.
create function t.expect(label text, who text, uid uuid, sql text, state text, msg text default null) returns void
language plpgsql as $$
declare
  got_state text;
  got_msg text;
begin
  begin
    perform t.exec(who, uid, sql);
  exception when others then
    get stacked diagnostics got_state = returned_sqlstate, got_msg = message_text;
    reset role;
    if got_state <> state then
      raise exception 'FAIL %: expected SQLSTATE % but got % (%)', label, state, got_state, got_msg;
    end if;
    if msg is not null and position(msg in got_msg) = 0 then
      raise exception 'FAIL %: expected message containing "%" but got "%"', label, msg, got_msg;
    end if;
    return;
  end;
  raise exception 'FAIL %: expected SQLSTATE % but the statement succeeded', label, state;
end;
$$;

create function t.eq(label text, got bigint, want bigint) returns void
language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL %: expected % but got %', label, want, got;
  end if;
end;
$$;

-- Inserts a submission as the superuser. Extra columns override the defaults.
create function t.sub(owner uuid, slug text, status text default 'pending', age interval default interval '0') returns uuid
language plpgsql as $$
declare
  new_id uuid;
begin
  insert into submissions (owner_id, slug, name, description, how_it_was_made, play_url, min_players, max_players, status, created_at)
  values (owner, slug, 'Game ' || slug, 'A game', 'Made with an AI', 'https://example.com/' || slug, 1, 4, status::submission_status, now() - age)
  returning id into new_id;
  return new_id;
end;
$$;

-- Fixtures: A and B are ordinary users, R is the admin who reviews.
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@example.com'),
  ('cccccccc-0000-0000-0000-000000000003', 'admin@example.com');
insert into profiles (id, handle, display_name, is_admin) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'user-a', 'User A', false),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'user-b', 'User B', false),
  ('cccccccc-0000-0000-0000-000000000003', 'the-admin', 'Admin', true);

do $$
declare
  a constant uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  b constant uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
  r constant uuid := 'cccccccc-0000-0000-0000-000000000003';
  a_pending uuid; b_pending uuid; b_approved uuid; a_approved uuid;
  n bigint;
begin
  -- Schema shape the PostgREST embeds rely on.
  perform t.eq('submissions.owner_id references profiles', (
    select count(*) from pg_constraint
    where conrelid = 'submissions'::regclass and contype = 'f' and confrelid = 'profiles'::regclass
      and conkey = array[(select attnum from pg_attribute where attrelid = 'submissions'::regclass and attname = 'owner_id')]), 1);
  perform t.eq('rls enabled', (select count(*) from pg_class where oid in ('profiles'::regclass, 'submissions'::regclass) and relrowsecurity), 2);

  a_pending := t.sub(a, 'a-pending');
  a_approved := t.sub(a, 'a-approved', 'approved');
  b_pending := t.sub(b, 'b-pending');
  b_approved := t.sub(b, 'b-approved', 'approved');
  update submissions set review_note = 'secret note', reviewed_by = r, reviewed_at = now() where id in (a_approved, b_approved);

  -- Constraints, as the superuser.
  perform t.expect('handle Dev', 'postgres', null, $q$insert into profiles (id, handle) select gen_random_uuid(), 'Dev'$q$, '23514');
  perform t.expect('handle a', 'postgres', null, $q$insert into profiles (id, handle) select gen_random_uuid(), 'a'$q$, '23514');
  perform t.expect('handle ab', 'postgres', null, $q$insert into profiles (id, handle) select gen_random_uuid(), 'ab'$q$, '23514');
  perform t.expect('handle dev-', 'postgres', null, $q$insert into profiles (id, handle) select gen_random_uuid(), 'dev-'$q$, '23514');
  perform t.expect('handle 25 chars', 'postgres', null, format($q$insert into profiles (id, handle) select gen_random_uuid(), %L$q$, repeat('a', 25)), '23514');
  perform t.expect('handle with underscore', 'postgres', null, $q$insert into profiles (id, handle) select gen_random_uuid(), 'dev_x'$q$, '23514');
  perform t.expect('display name 41 chars', 'postgres', null, format($q$update profiles set display_name = %L where id = %L$q$, repeat('x', 41), a), '23514');
  perform t.exec('postgres', null, format($q$update profiles set display_name = %L where id = %L$q$, repeat('x', 40), a));
  perform t.exec('postgres', null, format($q$update profiles set display_name = 'User A' where id = %L$q$, a));
  -- A 24 character handle is the longest allowed. These profiles are rolled back with the sub-block below.
  begin
    insert into auth.users (id) values ('dddddddd-0000-0000-0000-00000000000d');
    insert into profiles (id, handle) values ('dddddddd-0000-0000-0000-00000000000d', repeat('a', 24));
    raise exception 'rollback-ok';
  exception when others then
    if sqlerrm <> 'rollback-ok' then raise exception 'FAIL 24 char handle should be accepted: %', sqlerrm; end if;
  end;
  insert into auth.users (id) values ('eeeeeeee-0000-0000-0000-00000000000e');
  perform t.expect('duplicate handle 23505', 'postgres', null,
    $q$insert into profiles (id, handle) values ('eeeeeeee-0000-0000-0000-00000000000e', 'user-a')$q$, '23505');
  delete from auth.users where id = 'eeeeeeee-0000-0000-0000-00000000000e';

  perform t.expect('duplicate slug', 'postgres', null, format($q$select t.sub(%L, 'a-pending', 'rejected')$q$, a), '23505');
  perform t.expect('slug too short', 'postgres', null, format($q$select t.sub(%L, 'ab', 'rejected')$q$, b), '23514');
  perform t.expect('slug uppercase', 'postgres', null, format($q$select t.sub(%L, 'Bad-Slug', 'rejected')$q$, b), '23514');
  perform t.expect('slug 61 chars', 'postgres', null, format($q$select t.sub(%L, %L, 'rejected')$q$, b, repeat('a', 61)), '23514');
  perform t.expect('play_url http', 'postgres', null, format($q$update submissions set play_url = 'http://x.com' where id = %L$q$, a_pending), '23514');
  perform t.expect('play_url too long', 'postgres', null, format($q$update submissions set play_url = 'https://' || repeat('x', 2041) where id = %L$q$, a_pending), '23514');
  perform t.expect('source_url http', 'postgres', null, format($q$update submissions set source_url = 'http://x.com' where id = %L$q$, a_pending), '23514');
  perform t.exec('postgres', null, format($q$update submissions set source_url = 'https://github.com/x/y' where id = %L$q$, a_pending));
  perform t.exec('postgres', null, format($q$update submissions set source_url = null where id = %L$q$, a_pending));
  perform t.expect('players 0,4', 'postgres', null, format($q$update submissions set min_players = 0, max_players = 4 where id = %L$q$, a_pending), '23514');
  perform t.expect('players 4,2', 'postgres', null, format($q$update submissions set min_players = 4, max_players = 2 where id = %L$q$, a_pending), '23514');
  perform t.expect('players 1,17', 'postgres', null, format($q$update submissions set min_players = 1, max_players = 17 where id = %L$q$, a_pending), '23514');
  perform t.exec('postgres', null, format($q$update submissions set min_players = 16, max_players = 16 where id = %L$q$, a_pending));
  perform t.exec('postgres', null, format($q$update submissions set min_players = 1, max_players = 4 where id = %L$q$, a_pending));
  perform t.expect('empty name', 'postgres', null, format($q$update submissions set name = '' where id = %L$q$, a_pending), '23514');
  perform t.expect('name 61 chars', 'postgres', null, format($q$update submissions set name = repeat('n', 61) where id = %L$q$, a_pending), '23514');
  perform t.expect('description 141 chars', 'postgres', null, format($q$update submissions set description = repeat('d', 141) where id = %L$q$, a_pending), '23514');
  perform t.expect('how_it_was_made 601 chars', 'postgres', null, format($q$update submissions set how_it_was_made = repeat('h', 601) where id = %L$q$, a_pending), '23514');
  perform t.exec('postgres', null, format($q$update submissions set description = repeat('d', 140), how_it_was_made = repeat('h', 600), name = repeat('n', 60) where id = %L$q$, a_pending));
  perform t.expect('bad status', 'postgres', null, format($q$update submissions set status = 'maybe' where id = %L$q$, a_pending), '22P02');

  -- updated_at moves on every update.
  update submissions set updated_at = '2020-01-01' where id = a_pending;
  update submissions set name = 'Renamed' where id = a_pending;
  if (select updated_at from submissions where id = a_pending) <= '2020-01-01' then
    raise exception 'FAIL updated_at was not refreshed';
  end if;

  -- User A: row visibility.
  perform t.eq('A sees own pending', t.count('authenticated', a, format('select id from submissions where id = %L', a_pending)), 1);
  perform t.eq('A cannot see B pending', t.count('authenticated', a, format('select id from submissions where id = %L', b_pending)), 0);
  perform t.eq('A sees B approved', t.count('authenticated', a, format('select id from submissions where id = %L', b_approved)), 1);
  perform t.eq('A sees exactly own rows and approved rows', t.count('authenticated', a, 'select id from submissions'), 3);
  perform t.eq('B sees exactly own rows and approved rows', t.count('authenticated', b, 'select id from submissions'), 3);

  -- User A: review columns stay private. The base table does not grant them; my_submissions shows the owner's own.
  perform t.expect('A review_note on submissions', 'authenticated', a, 'select review_note from submissions', '42501');
  perform t.expect('A reviewed_by on submissions', 'authenticated', a, 'select reviewed_by from submissions', '42501');
  perform t.expect('A select * on submissions', 'authenticated', a, 'select * from submissions', '42501');
  perform t.eq('A my_submissions own rows only', t.count('authenticated', a, 'select review_note from my_submissions'), 2);
  perform t.eq('A my_submissions sees own review_note', t.count('authenticated', a, $q$select 1 from my_submissions where review_note = 'secret note'$q$), 1);
  perform t.eq('A my_submissions hides B', t.count('authenticated', a, format('select 1 from my_submissions where id = %L', b_pending)), 0);
  perform t.eq('B my_submissions own rows only', t.count('authenticated', b, 'select 1 from my_submissions'), 2);
  perform t.expect('anon my_submissions', 'anon', null, 'select * from my_submissions', '42501');

  -- User A: writes.
  perform t.expect('A status to approved', 'authenticated', a, format($q$update submissions set status = 'approved' where id = %L$q$, a_pending), '42501');
  perform t.expect('A status to rejected', 'authenticated', a, format($q$update submissions set status = 'rejected' where id = %L$q$, a_pending), '42501');
  perform t.expect('A approved row stays approved on content edit', 'authenticated', a, format($q$update submissions set name = 'Sneaky' where id = %L$q$, a_approved), '42501');
  perform t.expect('A review_note', 'authenticated', a, format($q$update submissions set review_note = 'x' where id = %L$q$, a_pending), '42501');
  perform t.expect('A reviewed_by', 'authenticated', a, format($q$update submissions set reviewed_by = %L where id = %L$q$, a, a_pending), '42501');
  perform t.expect('A reviewed_at', 'authenticated', a, format($q$update submissions set reviewed_at = now() where id = %L$q$, a_pending), '42501');
  perform t.expect('A owner_id', 'authenticated', a, format($q$update submissions set owner_id = %L where id = %L$q$, b, a_pending), '42501');
  perform t.eq('A cannot update B row', t.exec('authenticated', a, format($q$update submissions set name = 'Hacked' where id = %L$q$, b_pending)), 0);
  perform t.eq('A cannot update B approved row', t.exec('authenticated', a, format($q$update submissions set name = 'Hacked', status = 'pending' where id = %L$q$, b_approved)), 0);
  perform t.eq('A cannot delete B row', t.exec('authenticated', a, format('delete from submissions where id = %L', b_pending)), 0);
  perform t.eq('A cannot delete B approved row', t.exec('authenticated', a, format('delete from submissions where id = %L', b_approved)), 0);
  perform t.eq('B rows untouched', (select count(*) from submissions where id in (b_pending, b_approved) and name not like 'Hacked'), 2);
  perform t.eq('A edits own pending', t.exec('authenticated', a, format($q$update submissions set name = 'Mine', status = 'pending' where id = %L$q$, a_pending)), 1);
  perform t.eq('A edit sends approved row back to pending', t.exec('authenticated', a, format($q$update submissions set name = 'Edited', status = 'pending' where id = %L$q$, a_approved)), 1);
  perform t.eq('edited row is pending', (select count(*) from submissions where id = a_approved and status = 'pending'), 1);
  update submissions set status = 'approved' where id = a_approved;
  perform t.expect('A insert as approved', 'authenticated', a,
    format($q$insert into submissions (owner_id, slug, name, description, how_it_was_made, play_url, min_players, max_players, status) values (%L, 'a-sneaky', 'n', 'd', 'h', 'https://x.com', 1, 2, 'approved')$q$, a), '42501');
  perform t.expect('A insert for B', 'authenticated', a,
    format($q$insert into submissions (owner_id, slug, name, description, how_it_was_made, play_url, min_players, max_players) values (%L, 'a-for-b', 'n', 'd', 'h', 'https://x.com', 1, 2)$q$, b), '42501');
  perform t.expect('A insert with review_note', 'authenticated', a,
    format($q$insert into submissions (owner_id, slug, name, description, how_it_was_made, play_url, min_players, max_players, review_note) values (%L, 'a-note', 'n', 'd', 'h', 'https://x.com', 1, 2, 'x')$q$, a), '42501');
  perform t.eq('A inserts own pending', t.exec('authenticated', a,
    format($q$insert into submissions (owner_id, slug, name, description, how_it_was_made, play_url, min_players, max_players) values (%L, 'a-second', 'n', 'd', 'h', 'https://x.com', 1, 2)$q$, a)), 1);
  perform t.eq('A deletes own row', t.exec('authenticated', a, $q$delete from submissions where slug = 'a-second'$q$), 1);
  -- Duplicate slug through the client path is 23505 as well.
  perform t.expect('A duplicate slug', 'authenticated', a,
    format($q$insert into submissions (owner_id, slug, name, description, how_it_was_made, play_url, min_players, max_players) values (%L, 'b-pending', 'n', 'd', 'h', 'https://x.com', 1, 2)$q$, a), '23505');

  -- Profiles, as clients.
  perform t.eq('A updates own display_name', t.exec('authenticated', a, format($q$update profiles set display_name = 'New name' where id = %L$q$, a)), 1);
  perform t.eq('A cannot update B display_name', t.exec('authenticated', a, format($q$update profiles set display_name = 'Hacked' where id = %L$q$, b)), 0);
  perform t.eq('B display_name untouched', (select count(*) from profiles where id = b and display_name = 'User B'), 1);
  perform t.expect('A handle update', 'authenticated', a, format($q$update profiles set handle = 'other' where id = %L$q$, a), '42501');
  perform t.expect('A is_admin update', 'authenticated', a, format($q$update profiles set is_admin = true where id = %L$q$, a), '42501');
  perform t.expect('A profile insert', 'authenticated', a, format($q$insert into profiles (id, handle) values (%L, 'zzz')$q$, gen_random_uuid()), '42501');
  perform t.expect('A cannot delete profiles', 'authenticated', a, 'delete from profiles', '42501');
  perform t.expect('A is_admin select', 'authenticated', a, 'select is_admin from profiles', '42501');
  perform t.expect('A created_at select', 'authenticated', a, 'select created_at from profiles', '42501');
  perform t.eq('A reads all profiles', t.count('authenticated', a, 'select id, handle, display_name from profiles'), 3);
  update profiles set display_name = 'User A' where id = a;

  -- Anonymous client.
  perform t.eq('anon sees only approved rows', t.count('anon', null, 'select id from submissions'), (select count(*) from submissions where status = 'approved'));
  perform t.eq('anon sees no pending row', t.count('anon', null, $q$select id from submissions where status <> 'approved'$q$), 0);
  perform t.eq('anon sees some approved rows', t.count('anon', null, 'select id from submissions') , 2);
  perform t.expect('anon review_note', 'anon', null, 'select review_note from submissions', '42501');
  perform t.expect('anon reviewed_by', 'anon', null, 'select reviewed_by from submissions', '42501');
  perform t.expect('anon reviewed_at', 'anon', null, 'select reviewed_at from submissions', '42501');
  perform t.expect('anon select * submissions', 'anon', null, 'select * from submissions', '42501');
  perform t.expect('anon is_admin', 'anon', null, 'select is_admin from profiles', '42501');
  perform t.expect('anon select * profiles', 'anon', null, 'select * from profiles', '42501');
  perform t.expect('anon created_at', 'anon', null, 'select created_at from profiles', '42501');
  perform t.expect('anon where is_admin', 'anon', null, 'select handle from profiles where is_admin', '42501');
  perform t.expect('anon insert submission', 'anon', null, format($q$insert into submissions (owner_id, slug, name, description, how_it_was_made, play_url, min_players, max_players) values (%L, 'anon-x', 'n', 'd', 'h', 'https://x.com', 1, 2)$q$, a), '42501');
  perform t.expect('anon update submission', 'anon', null, format($q$update submissions set name = 'x' where id = %L$q$, b_approved), '42501');
  perform t.expect('anon delete submission', 'anon', null, format($q$delete from submissions where id = %L$q$, b_approved), '42501');
  perform t.expect('anon update profile', 'anon', null, $q$update profiles set display_name = 'x'$q$, '42501');
  -- The profile page queries.
  perform t.eq('anon profile by handle', t.count('anon', null, $q$select handle, display_name from profiles where handle = 'user-b'$q$), 1);
  perform t.eq('anon profile page games', t.count('anon', null,
    $q$select s.slug, s.name, s.description from submissions s join profiles p on p.id = s.owner_id where s.status = 'approved' and p.handle = 'user-b'$q$), 1);
  perform t.eq('anon profile page hides pending', t.count('anon', null,
    $q$select s.slug from submissions s join profiles p on p.id = s.owner_id where p.handle = 'user-b'$q$), 1);

  -- Service role: the server's queries, and bypass of row-level security (but not of the triggers, tested below).
  perform t.eq('service approved + handle, display_name', t.count('service_role', null,
    $q$select s.*, p.handle, p.display_name from submissions s join profiles p on p.id = s.owner_id where s.status = 'approved'$q$), 2);
  perform t.eq('service pending + handle', t.count('service_role', null,
    $q$select s.*, p.handle from submissions s join profiles p on p.id = s.owner_id where s.status = 'pending'$q$), 2);
  perform t.eq('service sees is_admin', t.count('service_role', null, 'select is_admin from profiles where is_admin'), 1);
  perform t.eq('service approves pending row', t.exec('service_role', null,
    format($q$update submissions set status = 'approved', review_note = 'nice', reviewed_by = %L, reviewed_at = now() where id = %L and status = 'pending'$q$, r, b_pending)), 1);
  perform t.eq('service rejects pending row', t.exec('service_role', null,
    format($q$update submissions set status = 'rejected', review_note = 'no', reviewed_by = %L, reviewed_at = now() where id = %L and status = 'pending'$q$, r, a_pending)), 1);
  perform t.eq('service reads every profile', t.count('service_role', null, 'select * from profiles'), 3);

  -- Cascades.
  perform t.eq('delete profile cascades to submissions', (select count(*) from submissions where owner_id = b), 2);
  delete from profiles where id = b;
  perform t.eq('B submissions gone', (select count(*) from submissions where owner_id = b), 0);
  perform t.eq('A submissions kept', (select count(*) from submissions where owner_id = a), 2);
  -- reviewed_by is cleared when the reviewer's profile is deleted.
  perform t.eq('reviewed_by set before', (select count(*) from submissions where reviewed_by = r), 2);
  delete from profiles where id = r;
  perform t.eq('reviewed_by cleared', (select count(*) from submissions where reviewed_by is not null), 0);
  perform t.eq('submission survives reviewer deletion', (select count(*) from submissions where owner_id = a), 2);
  -- Deleting the auth user cascades to its profile and submissions.
  delete from auth.users where id = a;
  perform t.eq('auth user delete cascades', (select count(*) from profiles where id = a) + (select count(*) from submissions where owner_id = a), 0);
end;
$$;

-- Caps. Each owner gets a fresh user.
do $$
declare
  p constant uuid := '11111111-0000-0000-0000-0000000000f1';  -- pending cap
  d constant uuid := '11111111-0000-0000-0000-0000000000f2';  -- daily cap
  e constant uuid := '11111111-0000-0000-0000-0000000000f3';  -- edit-back-to-pending cap
  s constant uuid := '11111111-0000-0000-0000-0000000000f4';  -- service role
  approved_id uuid;
  ins text := $q$insert into submissions (owner_id, slug, name, description, how_it_was_made, play_url, min_players, max_players) values (%L, %L, 'n', 'd', 'h', 'https://x.com', 1, 2)$q$;
  i int;
begin
  insert into auth.users (id) values (p), (d), (e), (s);
  insert into profiles (id, handle) values (p, 'cap-pending'), (d, 'cap-daily'), (e, 'cap-edit'), (s, 'cap-service');

  -- Pending cap on insert. The five rows are two days old, so the daily cap does not interfere.
  for i in 1..5 loop perform t.sub(p, 'p-' || i, 'pending', interval '2 days'); end loop;
  perform t.expect('6th pending insert (authenticated)', 'authenticated', p, format(ins, p, 'p-6'), 'P0001', 'pending_limit');
  perform t.expect('6th pending insert (service_role)', 'service_role', null, format(ins, p, 'p-6'), 'P0001', 'pending_limit');
  perform t.expect('6th pending insert (superuser)', 'postgres', null, format(ins, p, 'p-6'), 'P0001', 'pending_limit');
  perform t.eq('pending stays 5', (select count(*) from submissions where owner_id = p and status = 'pending'), 5);
  -- A non-pending insert is not blocked by the pending cap.
  perform t.eq('rejected insert allowed at 5 pending', t.exec('service_role', null, format($q$insert into submissions (owner_id, slug, name, description, how_it_was_made, play_url, min_players, max_players, status) values (%L, 'p-rej', 'n', 'd', 'h', 'https://x.com', 1, 2, 'rejected')$q$, p)), 1);
  -- Editing a pending row keeps it pending and is allowed at the cap.
  perform t.eq('pending content edit allowed at the cap', t.exec('authenticated', p, $q$update submissions set name = 'same' where slug = 'p-1'$q$), 1);

  -- Daily cap. Three rows in the last 24 hours, none pending.
  for i in 1..3 loop perform t.sub(d, 'd-' || i, 'rejected'); end loop;
  perform t.expect('4th insert in 24 hours (authenticated)', 'authenticated', d, format(ins, d, 'd-4'), 'P0001', 'daily_limit');
  perform t.expect('4th insert in 24 hours (service_role)', 'service_role', null, format(ins, d, 'd-4'), 'P0001', 'daily_limit');
  perform t.expect('4th insert in 24 hours (rejected status)', 'service_role', null,
    format($q$insert into submissions (owner_id, slug, name, description, how_it_was_made, play_url, min_players, max_players, status) values (%L, 'd-5', 'n', 'd', 'h', 'https://x.com', 1, 2, 'rejected')$q$, d), 'P0001', 'daily_limit');
  perform t.eq('daily count stays 3', (select count(*) from submissions where owner_id = d), 3);
  -- Rows older than 24 hours do not count; deleting a row frees the slot.
  update submissions set created_at = now() - interval '25 hours' where slug = 'd-1';
  perform t.eq('insert allowed once a row is older than 24 hours', t.exec('authenticated', d, format(ins, d, 'd-4')), 1);

  -- Editing an approved or rejected row back to pending is capped.
  for i in 1..5 loop perform t.sub(e, 'e-' || i, 'pending', interval '2 days'); end loop;
  approved_id := t.sub(e, 'e-approved', 'approved', interval '2 days');
  perform t.sub(e, 'e-rejected', 'rejected', interval '2 days');
  perform t.expect('approved to pending at 5 pending (authenticated)', 'authenticated', e,
    format($q$update submissions set status = 'pending', name = 'again' where id = %L$q$, approved_id), 'P0001', 'pending_limit');
  perform t.expect('approved to pending at 5 pending (service_role)', 'service_role', null,
    format($q$update submissions set status = 'pending' where id = %L$q$, approved_id), 'P0001', 'pending_limit');
  perform t.expect('rejected to pending at 5 pending (service_role)', 'service_role', null,
    $q$update submissions set status = 'pending' where slug = 'e-rejected'$q$, 'P0001', 'pending_limit');
  perform t.eq('status unchanged after refusal', (select count(*) from submissions where id = approved_id and status = 'approved'), 1);
  perform t.eq('approved to pending allowed at 4 pending', t.exec('postgres', null, $q$delete from submissions where slug = 'e-1'$q$), 1);
  perform t.eq('approved to pending allowed at 4 pending (update)', t.exec('authenticated', e,
    format($q$update submissions set status = 'pending', name = 'again' where id = %L$q$, approved_id)), 1);
  perform t.eq('pending is 5 again', (select count(*) from submissions where owner_id = e and status = 'pending'), 5);

  -- Caps are per owner: owner s is unaffected by the others.
  perform t.eq('other owner unaffected', t.exec('service_role', null, format(ins, s, 's-1')), 1);
end;
$$;

drop schema t cascade;

select 'rls ok';
