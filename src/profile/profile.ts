import '../style.css';
import { el } from '../games';
import { SUBMISSIONS_ENABLED, supabase } from '../account/client';
import { validateHandle } from '../shared/submission-rules.mjs';

const CLOSED = 'Submissions are not open yet';
const LOADING = 'Loading…';
const NOT_FOUND = 'No player with that handle.';
const FALLBACK = 'Something went wrong, try again.';

/** The only profile fields this page reads. RLS makes these public. */
interface ProfileRow {
  handle: string;
  display_name: string | null;
}

/** The only submission fields this page reads. The query returns approved rows only. */
interface GameRow {
  slug: string;
  name: string;
  description: string | null;
}

// Every lookup returns null when the element is missing, so a missing element cannot blank the page.
const byId = <T extends HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;

const pageHead = byId<HTMLElement>('page-head');
const notice = byId<HTMLParagraphElement>('notice');
const retry = byId<HTMLButtonElement>('retry');
const player = byId<HTMLElement>('player');
const playerName = byId<HTMLHeadingElement>('player-name');
const playerHandle = byId<HTMLParagraphElement>('player-handle');
const empty = byId<HTMLParagraphElement>('empty');
const list = byId<HTMLUListElement>('games');

/** Shows one message in the notice. Try again shows only when a retry can help. */
function setNotice(text: string, canRetry = false): void {
  if (notice) {
    notice.textContent = text;
    notice.hidden = text === '';
  }
  if (retry) retry.hidden = !canRetry;
}

function hidePlayer(): void {
  if (player) player.hidden = true;
}

/**
 * The handle from /u/<handle>, decoded and checked with the shared rules, so only a-z, 0-9 and hyphens reach a query.
 * Null when the path has no valid handle. A malformed escape also gives null, so it shows the not-found text.
 */
function handleFromPath(): string | null {
  const match = /^\/u\/([^/]+)\/?$/.exec(location.pathname);
  if (!match) return null;
  let raw: string;
  try {
    raw = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  const checked = validateHandle(raw);
  return checked.ok ? checked.value : null;
}

/** One approved game. The link goes to the game page by its slug, encoded. Text only. */
function gameItem(row: GameRow): HTMLLIElement {
  const children: Node[] = [el('a', { class: 'profile-game-link', href: `/games/${encodeURIComponent(row.slug)}/` }, row.name)];
  const description = row.description?.trim() ?? '';
  if (description) children.push(el('p', { class: 'profile-game-desc' }, description));
  return el('li', { class: 'profile-game' }, ...children);
}

/** Fills the profile. The heading is the display name, or the handle when there is none. */
function showPlayer(profile: ProfileRow, games: GameRow[]): void {
  const displayName = profile.display_name?.trim() ?? '';
  if (playerName) playerName.textContent = displayName || `@${profile.handle}`;
  if (playerHandle) {
    playerHandle.textContent = `@${profile.handle}`;
    playerHandle.hidden = displayName === '';
  }
  if (list) list.replaceChildren(...games.map(gameItem));
  if (empty) empty.hidden = games.length > 0;
  if (player) player.hidden = false;
  setNotice('');
}

/**
 * Reads the profile, then the owner's approved games. Never rejects. Any failure, including a missing Supabase setting,
 * shows the fixed text with Try again. The error itself is never shown or logged.
 */
async function load(): Promise<void> {
  // With the flag off, nothing is queried.
  if (!SUBMISSIONS_ENABLED) return;
  setNotice(LOADING);
  hidePlayer();
  try {
    const handle = handleFromPath();
    if (!handle) {
      setNotice(NOT_FOUND);
      return;
    }

    // Anyone can read profile handles and display names under RLS. Only handle and display_name are selected.
    const profileReply = await supabase.from('profiles').select('handle, display_name').eq('handle', handle).maybeSingle();
    if (profileReply.error) throw new Error('profile read failed');
    const profile = profileReply.data as ProfileRow | null;
    if (!profile) {
      setNotice(NOT_FOUND);
      return;
    }

    // Anyone can read approved submissions under RLS. The owner is matched by handle through the embedded profile, so
    // the profile id is never read.
    const gamesReply = await supabase
      .from('submissions')
      .select('slug, name, description, profiles!inner(handle)')
      .eq('status', 'approved')
      .eq('profiles.handle', handle)
      .order('name', { ascending: true });
    if (gamesReply.error) throw new Error('games read failed');
    showPlayer(profile, (gamesReply.data ?? []) as GameRow[]);
  } catch {
    setNotice(FALLBACK, true);
  }
}

// The flag is checked first. When it is off, the only thing shown is the notice. The retry listener is registered in each
// branch, before anything else in that branch that can throw.
if (!SUBMISSIONS_ENABLED) {
  retry?.addEventListener('click', () => void load());
  setNotice(CLOSED);
} else {
  retry?.addEventListener('click', () => void load());
  if (pageHead) pageHead.hidden = false;
  void load();
}
