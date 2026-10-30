import type { Game } from './games';
import { createSaveSync } from './shared/cloud-sync.mjs';
import { applyPut, readCopy, writeCopy } from './shared/device-copy.mjs';

/**
 * Account saves on the play page, for games that opt in with "cloudSave" in games.json (Flag Catch). Only when
 * accounts are switched on and the player is signed in; otherwise the game keeps its save on the device and this
 * page never answers it. The page talks to the game only through postMessage with the game's own origin, and the
 * game never sees the sign-in: the page reads and writes the game_saves row with the player's session. Signed in, the
 * page also tells the game the player's public username ("tag:player"), which Flag Catch shows on its minimap.
 */
export function startCloudSaves(game: Game, frame: HTMLIFrameElement): void {
  if (game.cloudSave || game.deviceCopy) startDeviceCopy(game, frame);
  if (game.online) startOnline(game, frame);
  if (!game.cloudSave) return;
  if (import.meta.env.VITE_SUBMISSIONS_ENABLED !== 'true') return;
  const origin = new URL(game.playUrl).origin;
  let sync: ReturnType<typeof createSaveSync> | null = null;
  let handle: Promise<string | null> | null = null;

  /** The player's username, read once a visit. Null when it cannot be read; the game then says "You". */
  async function readHandle(): Promise<string | null> {
    const { apiFetch } = await import('./account/api');
    try {
      const reply = await apiFetch<{ profile?: { handle?: unknown } }>('/api/profile');
      return typeof reply.profile?.handle === 'string' ? reply.profile.handle : null;
    } catch {
      return null;
    }
  }

  async function begin(): Promise<void> {
    const { supabase } = await import('./account/client');
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    handle ??= readHandle();
    void handle.then((name) => {
      if (name) frame.contentWindow?.postMessage({ type: 'tag:player', game: game.id, v: 1, name }, origin);
    });
    const rows = () => supabase.from('game_saves');
    sync ??= createSaveSync({
      store: {
        async read() {
          const { data: row, error } = await rows().select('data, revision').eq('game_id', game.id).maybeSingle();
          if (error) throw error;
          return row ? { data: row.data as unknown, revision: Number(row.revision) } : null;
        },
        async insert(save) {
          const { data: row, error } = await rows().insert({ game_id: game.id, data: save }).select('revision').single();
          if (error?.code === '23505') return 'conflict';
          if (error) throw error;
          return Number(row.revision);
        },
        async update(save, revision) {
          const { data: changed, error } = await rows()
            .update({ data: save, revision: revision + 1 })
            .eq('game_id', game.id)
            .eq('revision', revision)
            .select('revision');
          if (error) throw error;
          return changed.length ? Number(changed[0].revision) : 'conflict';
        },
      },
      send: (save) => frame.contentWindow?.postMessage({ type: 'tag:load', game: game.id, v: 1, data: save }, origin),
      onError: (err) => console.warn('Account save not synced yet; it is still saved on this device.', err),
    });
    await sync.ready();
  }

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== frame.contentWindow || event.origin !== origin) return;
    const msg = event.data as { type?: unknown; game?: unknown; data?: unknown } | null;
    if (!msg || msg.game !== game.id) return;
    if (msg.type === 'tag:ready') void begin().catch((err) => console.warn('Account saves are off for this visit.', err));
    else if (msg.type === 'tag:save' && sync) sync.save(msg.data as object);
  });
  window.addEventListener('online', () => void sync?.retry());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void sync?.retry();
  });
}

/**
 * Keeps the game's save on this device in the site's own storage, signed in or not (see shared/device-copy.mjs), for
 * games with cloudSave or deviceCopy. iPhone Safari forgets a framed game's storage when Safari closes; this copy is
 * what brings it back.
 */
function startDeviceCopy(game: Game, frame: HTMLIFrameElement): void {
  const origin = new URL(game.playUrl).origin;
  const storage = (() => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  })();
  if (!storage) return;
  let copy = readCopy(storage, game.id) as Record<string, string>;
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== frame.contentWindow || event.origin !== origin) return;
    const msg = event.data as { type?: unknown; game?: unknown; key?: unknown; value?: unknown } | null;
    if (!msg || msg.game !== game.id) return;
    if (msg.type === 'tag:hello') {
      frame.contentWindow?.postMessage({ type: 'tag:mirror', game: game.id, v: 1, data: copy }, origin);
    } else if (msg.type === 'tag:put') {
      const next = applyPut(copy, msg.key, msg.value);
      if (next && writeCopy(storage, game.id, next)) copy = next;
    }
  });
}

/** A new ticket this long before the old one runs out, so a long play session never meets an expired one. */
const TICKET_REFRESH_MS = 3 * 3600 * 1000;

/**
 * Online matches, for games with "online" in games.json (Flag Catch). When the game says it's ready, the page tells it
 * whether the player is signed in ("tag:online"). Signed in, it also hands over a match ticket from /api/match-ticket
 * (the player's username, signed by the site), the site's public key that every phone in a room checks tickets
 * with, and the site's Supabase address and public anon key, which rooms meet on. The sign-in itself stays here.
 */
function startOnline(game: Game, frame: HTMLIFrameElement): void {
  const origin = new URL(game.playUrl).origin;
  const post = (data: object) => frame.contentWindow?.postMessage({ type: 'tag:online', game: game.id, v: 1, ...data }, origin);
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function tell(): Promise<void> {
    if (timer) clearTimeout(timer);
    timer = null;
    const url: string | undefined = import.meta.env.VITE_SUPABASE_URL;
    const key: string | undefined = import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (import.meta.env.VITE_SUBMISSIONS_ENABLED !== 'true' || !url || !key) return void post({ signedIn: false });
    const { supabase } = await import('./account/client');
    const { data } = await supabase.auth.getSession();
    if (!data.session) return void post({ signedIn: false });
    const { apiFetch } = await import('./account/api');
    const reply = await apiFetch<{ ticket?: unknown; exp?: unknown; key?: unknown }>('/api/match-ticket');
    if (typeof reply.ticket !== 'string' || typeof reply.exp !== 'number' || !reply.key) return void post({ signedIn: false });
    post({ signedIn: true, ticket: reply.ticket, key: reply.key, realtime: { url, key } });
    timer = setTimeout(() => void tell().catch(() => {}), Math.max(60_000, reply.exp - Date.now() - TICKET_REFRESH_MS));
  }

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== frame.contentWindow || event.origin !== origin) return;
    const msg = event.data as { type?: unknown; game?: unknown } | null;
    if (msg?.type === 'tag:ready' && msg.game === game.id) {
      void tell().catch((err) => {
        console.warn('Online play is off for this visit.', err);
        post({ signedIn: false });
      });
    }
  });
}
