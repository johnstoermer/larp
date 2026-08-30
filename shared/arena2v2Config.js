export const ARENA_2V2_MODE = 'arena_2v2';
export const ARENA_2V2_TEAM_SIZE = 2;
export const ARENA_2V2_TEAM_COUNT = 2;
export const ARENA_2V2_COMBATANT_COUNT =
  ARENA_2V2_TEAM_SIZE * ARENA_2V2_TEAM_COUNT;

export function isArena2v2Mode(value) {
  const mode = String(value ?? '').trim().toLowerCase();
  return mode === ARENA_2V2_MODE || mode === 'arena-2v2' || mode === '2v2';
}

export function arena2v2TeamForSlot(slot) {
  return Math.abs(Math.trunc(Number(slot) || 0)) % ARENA_2V2_TEAM_COUNT;
}

export function arena2v2TeamSlot(slot) {
  return Math.floor(
    Math.abs(Math.trunc(Number(slot) || 0)) / ARENA_2V2_TEAM_COUNT,
  ) % ARENA_2V2_TEAM_SIZE;
}
