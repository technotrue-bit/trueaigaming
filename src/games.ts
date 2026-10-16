import './style.css';

export interface Game {
  id: string;
  name: string;
  description: string;
  playUrl: string;
  thumbnail: string;
  status: string;
  repo?: string;
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

/** Thumbnails must be same-origin paths (the CSP only allows img-src 'self'). */
function safeLocalPath(value: unknown): string | null {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function parseGame(raw: unknown): Game | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const playUrl = safeHttpsUrl(r.playUrl);
  const thumbnail = safeLocalPath(r.thumbnail);
  if (!isNonEmptyString(r.id) || !isNonEmptyString(r.name) || !playUrl || !thumbnail) return null;
  return {
    id: r.id,
    name: r.name,
    description: typeof r.description === 'string' ? r.description : '',
    playUrl,
    thumbnail,
    status: isNonEmptyString(r.status) ? r.status.toLowerCase() : 'live',
    repo: safeHttpsUrl(r.repo) ?? undefined,
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
