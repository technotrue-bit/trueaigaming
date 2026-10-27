import type { Game } from './games';
import { createSaveSync } from './shared/cloud-sync.mjs';
import { applyPut, readCopy, writeCopy } from './shared/device-copy.mjs';

/**
 * Account saves on the play page, for games that opt in with "cloudSave" in games.json (Flag Catch). Only when
 * accounts are switched on and the player is signed in; otherwise the game keeps its save on the device and this
 * page never answers it. The page talks to the game only through postMessage with the game's own origin, and the
 * game never sees the sign-in: the page reads and writes the game_saves row with the player's session.
 */
export function startCloudSaves(game: Game, frame: HTMLIFrameElement): void {
  if (game.cloudSave || game.deviceCopy) startDeviceCopy(game, frame);
  if (!game.cloudSave) return;
  if (import.meta.env.VITE_SUBMISSIONS_ENABLED !== 'true') return;
  const origin = new URL(game.playUrl).origin;
  let sync: ReturnType<typeof createSaveSync> | null = null;

  async function begin(): Promise<void> {
    const { supabase } = await import('./account/client');
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
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
