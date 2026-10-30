// Today's Flag: Flag Catch's daily challenge, for the home page's "Today" card.
//
// A copy of dailyFor in Flag Catch's src/daily.ts. The date picks the world, animal, mode, island size, rival skill
// and goal from a seed, so both copies show the same challenge with nothing sent anywhere. scripts/daily.test.mjs
// pins the same days as Flag Catch's own test, so a change on one side fails the other's test until both match.

/** Worlds and animals in Flag Catch's fixed daily order, with the names it shows and each animal's class. */
const WORLDS = [
  ['home', 'Home Isle'],
  ['reef', 'Ring Reef'],
  ['bluffs', 'Bumpy Bluffs'],
  ['frost', 'Frost Floe'],
  ['lagoon', 'Deep Lagoon'],
  ['storm', 'Storm Spire'],
  ['dunes', 'Rust Dunes'],
  ['lava', 'Lava Loop'],
];
const ANIMALS = [
  ['lion', 'Rally Lion', 'land'],
  ['penguin', 'Surf Penguin', 'water'],
  ['croc', 'Ski Croc', 'water'],
  ['bird', 'Moto Bird', 'land'],
  ['eagle', 'Sky Eagle', 'air'],
  ['mammoth', 'Skate Mammoth', 'land'],
  ['wolf', 'Turbo Wolf', 'land'],
  ['shark', 'Jet Shark', 'water'],
  ['goldfish', 'Bowl Goldfish', 'water'],
  ['panther', 'Dash Panther', 'land'],
  ['flyfish', 'Glide Fish', 'air'],
  ['bat', 'Night Bat', 'air'],
  ['frog', 'Pogo Frog', 'water'],
];
/** @type {Record<string, string[]>} */
const AVOID = { lava: ['water'], dunes: ['water'], lagoon: ['land'] };
/** @typedef {{ kind: 'win' | 'banks' | 'steals' | 'knockouts', n: number }} DailyGoal */
/** @type {Record<'capture' | 'playful', DailyGoal[]>} */
const GOALS = {
  capture: [
    { kind: 'win', n: 1 },
    { kind: 'banks', n: 1 },
    { kind: 'steals', n: 2 },
    { kind: 'knockouts', n: 4 },
  ],
  playful: [
    { kind: 'win', n: 1 },
    { kind: 'banks', n: 2 },
    { kind: 'steals', n: 3 },
    { kind: 'knockouts', n: 4 },
  ],
};

/** The local date as YYYY-MM-DD. @param {Date} d */
export function dayKey(d) {
  const p = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** FNV-1a over the date. @param {string} key */
function seedOf(key) {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0 || 1;
}

/** Mulberry32, as in Flag Catch's src/rng.ts. @param {number} seed */
function mulberry32(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Any day's challenge, with the names the card shows.
 * @param {Date | string} date
 */
export function dailyFor(date) {
  const key = typeof date === 'string' ? date : dayKey(date);
  const rng = mulberry32(seedOf(key));
  /** @template T @param {T[]} list @returns {T} */
  const pick = (list) => list[Math.floor(rng() * list.length)];
  const [world, worldName] = pick(WORLDS);
  const [animal, animalName] = pick(ANIMALS.filter(([, , cls]) => !(AVOID[world] ?? []).includes(cls)));
  /** @type {'capture' | 'playful'} */
  const mode = rng() < 3 / 4 ? 'capture' : 'playful';
  const per = rng() < 0.75 ? 8 : 16;
  const difficulty = rng() < 0.6 ? 'easy' : 'medium';
  const goal = { ...pick(GOALS[mode]) };
  return { key, world, worldName, animal, animalName, mode, per, difficulty, goal };
}

/** The goal in words, as the game shows it, in sentence case for the card. @param {{ goal: DailyGoal }} d */
export function goalText(d) {
  const { kind, n } = d.goal;
  if (kind === 'win') return 'Win the match';
  if (kind === 'banks') return n === 1 ? 'Score a flag yourself' : `Score ${n} flags yourself`;
  if (kind === 'steals') return n === 1 ? 'Grab a flag' : `Grab ${n} flags`;
  return n === 1 ? 'Pop a rival' : `Pop ${n} rivals`;
}

/** The game the daily belongs to; the play page passes ?daily=1 on to it only. */
export const DAILY_GAME = 'flag-catch';

/** The key of the day before `key`. @param {string} key */
export function dayBefore(key) {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d - 1, 12));
}

/**
 * Where the player stands today, from the play page's own copy of Flag Catch's save on this device (see
 * device-copy.mjs). Never sent anywhere. streak is 0 when no run is going.
 * @param {Record<string, string>} copy
 * @param {string} key
 */
export function standing(copy, key) {
  try {
    const daily = JSON.parse(copy['flagcatch.progress'] ?? 'null')?.daily;
    const last = typeof daily?.last === 'string' ? daily.last : '';
    const streak = Number.isInteger(daily?.streak) && daily.streak > 0 ? daily.streak : 0;
    const alive = last === key || last === dayBefore(key);
    return { done: last === key, streak: alive ? streak : 0 };
  } catch {
    return { done: false, streak: 0 };
  }
}
