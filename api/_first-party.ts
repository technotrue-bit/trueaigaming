import games from '../public/games.json' with { type: 'json' };

/* The ids of the first-party games, from public/games.json. The wrappers pass them to the logic, which refuses a
   submission whose game address matches one. The file is imported, so it ships with the function. */
export function firstPartyIds(): string[] {
  return (games as Array<{ id: string }>).map((game) => game.id);
}
