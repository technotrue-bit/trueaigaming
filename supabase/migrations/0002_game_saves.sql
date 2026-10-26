-- Game saves: one row per player per game, so progress follows a signed-in player to any device.
--
-- The play page writes the rows with the player's own session (the authenticated role), never the service role.
-- Row-level security limits every read and write to the player's own rows. Only games listed in game_saves_game
-- may be saved, and a save is capped at 32 KB, so an account cannot be used as free storage.
--
-- revision is a counter the page compares on every update (update ... where revision = <the one it read>). When
-- another device saved in between, the update changes no rows; the page then reads the newer copy, the game
-- merges it into its own and saves again. Deleting the account (auth.users) deletes its saves.
--
-- Accounts are 13 and up. Aurora's World, a game for young children, is deliberately not listed and never will
-- be without verifiable parental consent: its progress stays on the device.

create table game_saves (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  game_id text not null
    constraint game_saves_game check (game_id in ('flag-catch')),
  data jsonb not null
    constraint game_saves_data_object check (jsonb_typeof(data) = 'object')
    constraint game_saves_data_size check (octet_length(data::text) <= 32768),
  revision bigint not null default 1
    constraint game_saves_revision_positive check (revision > 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, game_id)
);

create trigger game_saves_set_updated_at
  before update on game_saves
  for each row execute function set_updated_at();

alter table game_saves enable row level security;

-- Start from nothing, then grant back only what the page uses. user_id and updated_at are never client-set.
revoke all on game_saves from anon, authenticated;
grant all on game_saves to service_role;
grant select (game_id, data, revision, updated_at) on game_saves to authenticated;
grant insert (game_id, data) on game_saves to authenticated;
grant update (data, revision) on game_saves to authenticated;

create policy game_saves_select_own on game_saves
  for select to authenticated using (user_id = auth.uid());
create policy game_saves_insert_own on game_saves
  for insert to authenticated with check (user_id = auth.uid());
create policy game_saves_update_own on game_saves
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
