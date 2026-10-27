// The play page's own copy of a game's storage, kept in this site's storage on the player's device.
//
// A game on the play page runs in a frame from another address, and iPhone Safari never keeps a framed page's
// storage once Safari closes. For games that opt in, the page keeps every key the game writes ("tag:put") and hands
// the whole copy back before the game starts ("tag:hello" -> "tag:mirror"). It never leaves the device.

/** Per game, at most this many keys, each value this long, and this much in all. */
export const MAX_KEYS = 64;
export const MAX_KEY_LENGTH = 64;
export const MAX_VALUE_LENGTH = 512 * 1024;
export const MAX_TOTAL_LENGTH = 1024 * 1024;

export const storageKey = (gameId) => `tag:device:${gameId}`;

/** Reads the copy for `gameId` from `storage`; an empty copy when there is none or it is unreadable. */
export function readCopy(storage, gameId) {
  try {
    const raw = storage?.getItem(storageKey(gameId));
    const data = raw ? JSON.parse(raw) : null;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    const copy = {};
    for (const [k, v] of Object.entries(data)) if (typeof v === 'string') copy[k] = v;
    return copy;
  } catch {
    return {};
  }
}

/**
 * Applies one write from the game: a string value sets the key, null removes it. Returns the new copy, or null when
 * the write breaks the limits (the copy is then left as it was; the game still has the value itself).
 */
export function applyPut(copy, key, value) {
  if (typeof key !== 'string' || !key || key.length > MAX_KEY_LENGTH) return null;
  const next = { ...copy };
  if (value === null) delete next[key];
  else if (typeof value === 'string' && value.length <= MAX_VALUE_LENGTH) next[key] = value;
  else return null;
  if (Object.keys(next).length > MAX_KEYS) return null;
  let total = 0;
  for (const [k, v] of Object.entries(next)) total += k.length + v.length;
  return total > MAX_TOTAL_LENGTH ? null : next;
}

/** Writes the copy back; false when the browser refused (full, or storage blocked). */
export function writeCopy(storage, gameId, copy) {
  try {
    storage.setItem(storageKey(gameId), JSON.stringify(copy));
    return true;
  } catch {
    return false;
  }
}
