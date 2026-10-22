-- A stand-in for the Supabase objects the migration depends on. For LOCAL TESTS ONLY: never apply it to a real project.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key,
  email text
);

create function auth.uid() returns uuid
language sql stable as $$
  select nullif(coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::json ->> 'sub', '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Supabase grants every privilege on new public tables to the API roles by default. The migration has to undo that.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
-- Supabase also grants execute on new public functions to the API roles. PostgreSQL grants it to PUBLIC as well.
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
