-- Checks for supabase/migrations/0002_game_saves.sql. Run as a superuser after the shim and both migrations.
-- Every failed assertion raises an exception. The last statement prints "game saves ok".
\set ON_ERROR_STOP on
set client_min_messages = warning;

create schema g;

create function g.exec(who text, uid uuid, sql text) returns bigint
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

create function g.expect(label text, who text, uid uuid, sql text, state text) returns void
language plpgsql as $$
declare
  got_state text;
  got_msg text;
begin
  begin
    perform g.exec(who, uid, sql);
  exception when others then
    get stacked diagnostics got_state = returned_sqlstate, got_msg = message_text;
    reset role;
    if got_state <> state then
      raise exception 'FAIL %: expected SQLSTATE % but got % (%)', label, state, got_state, got_msg;
    end if;
    return;
  end;
  raise exception 'FAIL %: expected SQLSTATE % but the statement succeeded', label, state;
end;
$$;

create function g.eq(label text, got bigint, want bigint) returns void
language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAIL %: expected % but got %', label, want, got; end if;
end;
$$;

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-0000000000a1', 'save-a@example.com'),
  ('bbbbbbbb-0000-0000-0000-0000000000b2', 'save-b@example.com');

do $$
declare
  a constant uuid := 'aaaaaaaa-0000-0000-0000-0000000000a1';
  b constant uuid := 'bbbbbbbb-0000-0000-0000-0000000000b2';
begin
  perform g.eq('rls enabled', (select count(*) from pg_class where oid = 'game_saves'::regclass and relrowsecurity), 1);

  -- A player saves, reads and updates their own row; user_id comes from the session.
  perform g.eq('a inserts own save', g.exec('authenticated', a, $q$insert into game_saves (game_id, data) values ('flag-catch', '{"points": 5}')$q$), 1);
  perform g.eq('row belongs to a', (select count(*) from game_saves where user_id = a and revision = 1), 1);
  perform g.eq('a reads own save', g.exec('authenticated', a, 'select data from game_saves'), 1);
  perform g.eq('a updates at the revision read',
    g.exec('authenticated', a, $q$update game_saves set data = '{"points": 9}', revision = 2 where game_id = 'flag-catch' and revision = 1$q$), 1);
  perform g.eq('stale revision changes nothing',
    g.exec('authenticated', a, $q$update game_saves set data = '{"points": 1}', revision = 2 where game_id = 'flag-catch' and revision = 1$q$), 0);
  perform g.eq('updated_at moves on update', (select count(*) from game_saves where user_id = a and updated_at >= now()), 1);
  perform g.expect('second row for the same game', 'authenticated', a, $q$insert into game_saves (game_id, data) values ('flag-catch', '{}')$q$, '23505');

  -- Nobody else sees or changes it.
  perform g.expect('user_id is not readable', 'authenticated', a, 'select user_id from game_saves', '42501');
  perform g.eq('b sees no rows', g.exec('authenticated', b, 'select game_id, data from game_saves'), 0);
  perform g.eq('b cannot update a', g.exec('authenticated', b, $q$update game_saves set data = '{}', revision = 99$q$), 0);
  perform g.expect('anon cannot read', 'anon', null, 'select game_id from game_saves', '42501');
  perform g.expect('anon cannot insert', 'anon', null, $q$insert into game_saves (game_id, data) values ('flag-catch', '{}')$q$, '42501');
  perform g.expect('b cannot write as a', 'authenticated', b,
    $q$insert into game_saves (user_id, game_id, data) values ('aaaaaaaa-0000-0000-0000-0000000000a1', 'flag-catch', '{}')$q$, '42501');
  perform g.expect('a cannot move the row to b', 'authenticated', a,
    $q$update game_saves set user_id = 'bbbbbbbb-0000-0000-0000-0000000000b2'$q$, '42501');
  perform g.expect('a cannot delete', 'authenticated', a, 'delete from game_saves', '42501');
  perform g.expect('a cannot set updated_at', 'authenticated', a, $q$update game_saves set updated_at = now() - interval '1 year'$q$, '42501');
  perform g.expect('signed out cannot insert', 'authenticated', null, $q$insert into game_saves (game_id, data) values ('flag-catch', '{}')$q$, '42501');

  -- Only listed games, objects only, 32 KB at most, revision above zero.
  perform g.expect('unlisted game', 'authenticated', b, $q$insert into game_saves (game_id, data) values ('squishy-closet', '{}')$q$, '23514');
  perform g.expect('not an object', 'authenticated', b, $q$insert into game_saves (game_id, data) values ('flag-catch', '[1]')$q$, '23514');
  perform g.expect('too big', 'authenticated', b,
    $q$insert into game_saves (game_id, data) values ('flag-catch', jsonb_build_object('x', repeat('a', 33000)))$q$, '23514');
  perform g.expect('revision zero', 'authenticated', a, $q$update game_saves set revision = 0$q$, '23514');

  -- Deleting the account deletes the save.
  delete from auth.users where id = a;
  perform g.eq('save gone with the account', (select count(*) from game_saves where user_id = a), 0);
end;
$$;

drop schema g cascade;

select 'game saves ok';
