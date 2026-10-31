import './style.css';
import { isBlobThumbnailUrl } from './shared/submission-rules.mjs';

export interface Game {
  id: string;
  name: string;
  description: string;
  playUrl: string;
  thumbnail: string;
  /** Smaller WebP copy of a local thumbnail, set at build time when one exists. */
  thumbnailWebp?: string;
  status: string;
  repo?: string;
  /** Submitted game hosted elsewhere: Play goes to playUrl in a new tab, never /play.html. */
  external?: boolean;
  /** Shown behind the card's info button. Cards without it get no button. */
  howItWasMade?: string;
  minPlayers?: number;
  maxPlayers?: number;
  /** Smallest viewport (CSS px) the game's portrait layout fits. Below it the play page scales the frame down. */
  minWidth?: number;
  minHeight?: number;
  /** Same, for landscape. */
  minWidthLandscape?: number;
  minHeightLandscape?: number;
  /** The game can keep its save in a signed-in player's account (it speaks the tag:ready / tag:load / tag:save messages). */
  cloudSave?: boolean;
  /** The game reads a "Move to a new phone" link (#move=...); the play page passes the link's fragment on to it. */
  moveCode?: boolean;
  /**
   * The play page keeps a copy of the game's save in this site's storage on the device (it speaks tag:hello /
   * tag:mirror / tag:put), with no account. Games with cloudSave get the copy too.
   */
  deviceCopy?: boolean;
  /**
   * The game has live online matches (Flag Catch). Signed in, the play page hands it a match ticket (tag:online) that
   * names the player by their username, so other players see only real usernames.
   */
  online?: boolean;
  /** The game has a daily challenge of its own; its card gets a small "Daily challenge" chip. */
  daily?: boolean;
}

/** Min-size hints must be sane CSS pixel sizes; anything else is ignored so the play page defaults apply. */
function minSize(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 200 && value <= 4000 ? Math.round(value) : undefined;
}

function positiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

/** Only allow https URLs so games.json can't inject javascript:/data: links. */
function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** Same-origin paths only. */
function safeLocalPath(value: unknown): string | null {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : null;
}

/** Same-origin path, or an https Vercel Blob URL without credentials, for submitted games (the CSP img-src must allow that host). */
function safeThumbnail(value: unknown): string | null {
  if (typeof value === 'string' && isBlobThumbnailUrl(value)) {
    const url = new URL(value);
    if (!url.username && !url.password) return url.href;
  }
  return safeLocalPath(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function parseGame(raw: unknown): Game | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const playUrl = safeHttpsUrl(r.playUrl);
  const thumbnail = safeThumbnail(r.thumbnail);
  if (!isNonEmptyString(r.id) || !isNonEmptyString(r.name) || !playUrl || !thumbnail) return null;
  return {
    id: r.id,
    name: r.name,
    description: typeof r.description === 'string' ? r.description : '',
    playUrl,
    thumbnail,
    thumbnailWebp: safeLocalPath(r.thumbnailWebp) ?? undefined,
    status: isNonEmptyString(r.status) ? r.status.toLowerCase() : 'live',
    repo: safeHttpsUrl(r.repo) ?? undefined,
    external: r.external === true ? true : undefined,
    howItWasMade: isNonEmptyString(r.howItWasMade) ? r.howItWasMade.trim() : undefined,
    minPlayers: positiveInt(r.minPlayers),
    maxPlayers: positiveInt(r.maxPlayers),
    minWidth: minSize(r.minWidth),
    minHeight: minSize(r.minHeight),
    minWidthLandscape: minSize(r.minWidthLandscape),
    minHeightLandscape: minSize(r.minHeightLandscape),
    cloudSave: r.cloudSave === true && r.external !== true ? true : undefined,
    moveCode: r.moveCode === true && r.external !== true ? true : undefined,
    deviceCopy: r.deviceCopy === true && r.external !== true ? true : undefined,
    online: r.online === true && r.external !== true ? true : undefined,
    daily: r.daily === true ? true : undefined,
  };
}

export async function loadGames(): Promise<Game[]> {
  const res = await fetch('/games.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`games.json: HTTP ${res.status}`);
  const data: unknown = await res.json();
  if (!Array.isArray(data)) throw new Error('games.json must be an array');
  return data.map(parseGame).filter((g): g is Game => g !== null);
}

/** Tiny DOM helper: text content only, never innerHTML. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, string>> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value !== undefined) node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

/** Status values become a CSS modifier; anything unexpected maps to a neutral style. */
export function statusClass(status: string): string {
  return /^[a-z-]+$/.test(status) ? `status status-${status}` : 'status';
}
