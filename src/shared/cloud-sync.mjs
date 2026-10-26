// Account saves for the play page: keeps one game's save in step with the player's account.
//
// The game owns the merging. On "tag:ready" the page reads the account's copy and hands it to the game; the game
// folds it into its own save and sends the result back, which the page writes. Every write names the revision it
// read, so when another device saved in between nothing is overwritten: the page reads again, the game merges again
// and sends a save that holds both. Offline, the write waits and is retried; the game keeps its own copy meanwhile.

/** Largest save the page will send, in bytes of JSON. The database refuses anything bigger. */
export const MAX_SAVE_BYTES = 32768;

/** Conflicts in a row before the page stops trying until the next save (two devices racing, or a bug). */
const MAX_CONFLICTS = 5;

/** Bytes of JSON for `data`, or Infinity when it cannot be sent (too big, cyclic, not an object). */
export function saveBytes(data) {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return Infinity;
  try {
    return new TextEncoder().encode(JSON.stringify(data)).length;
  } catch {
    return Infinity;
  }
}

/**
 * @typedef {{ data: unknown, revision: number } | null} SaveRow
 * @typedef {{
 *   read(): Promise<SaveRow>,
 *   insert(data: object): Promise<number | 'conflict'>,
 *   update(data: object, revision: number): Promise<number | 'conflict'>,
 * }} SaveStore
 *   insert and update resolve with the row's new revision, or 'conflict' when the row exists already (insert) or
 *   has moved past `revision` (update). Network and server errors reject.
 */

/**
 * @param {{ store: SaveStore, send: (data: unknown) => void, onError?: (err: unknown) => void }} options
 *   send hands the account's copy (or null when there is none yet) to the game.
 */
export function createSaveSync({ store, send, onError = () => {} }) {
  /** @type {number | null | undefined} revision of the row as last read or written; null: no row; undefined: not read */
  let revision;
  /** @type {object | undefined} the newest save not written yet */
  let pending;
  let busy = false;
  let conflicts = 0;

  async function load() {
    const row = await store.read();
    revision = row ? row.revision : null;
    send(row ? row.data : null);
  }

  async function flush() {
    if (busy || pending === undefined || revision === undefined) return;
    busy = true;
    const data = pending;
    pending = undefined;
    let again = true;
    try {
      const got = revision === null ? await store.insert(data) : await store.update(data, revision);
      if (got === 'conflict') {
        // The game's next save, sent after it merges the newer copy, holds this one too.
        pending = undefined;
        again = false;
        if (++conflicts <= MAX_CONFLICTS) await load();
      } else {
        revision = got;
        conflicts = 0;
      }
    } catch (err) {
      if (pending === undefined) pending = data;
      again = false;
      onError(err);
    } finally {
      busy = false;
    }
    if (again) await flush();
  }

  return {
    /** The game started (or restarted): read the account's copy and hand it over. */
    async ready() {
      try {
        await load();
      } catch (err) {
        revision = undefined;
        onError(err);
        return;
      }
      await flush();
    },
    /** The game sent its save. Too big or not an object: ignored, the game still has it. */
    save(data) {
      if (saveBytes(data) > MAX_SAVE_BYTES) return false;
      pending = data;
      void flush();
      return true;
    },
    /** Back online: finish a read or write that failed. */
    async retry() {
      if (revision === undefined) {
        try {
          await load();
        } catch (err) {
          onError(err);
          return;
        }
      }
      await flush();
    },
    /** For tests: resolves when no write is in flight. */
    get busy() {
      return busy;
    },
  };
}
