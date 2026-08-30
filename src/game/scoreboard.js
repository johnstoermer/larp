function statValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

function sameIdentity(first, second) {
  return String(first) === String(second);
}

export function buildScoreboardRows(
  players = [],
  { localId = null, localTeam = null } = {},
) {
  return players
    .filter((player) => player && player.id != null)
    .map((player) => {
      const local = sameIdentity(player.id, localId);
      const ally = local || (
        localTeam != null &&
        Number(player.team) === Number(localTeam)
      );
      return Object.freeze({
        id: player.id,
        name: String(player.name || 'Player').slice(0, 18),
        kills: statValue(player.kills ?? player.stats?.kills),
        deaths: statValue(player.deaths ?? player.stats?.deaths),
        assists: statValue(player.assists ?? player.stats?.assists),
        local,
        ally,
      });
    })
    .sort((first, second) =>
      Number(second.local) - Number(first.local) ||
      Number(second.ally) - Number(first.ally) ||
      second.kills - first.kills ||
      first.deaths - second.deaths ||
      first.name.localeCompare(second.name) ||
      String(first.id).localeCompare(String(second.id)));
}

export function observedArenaStats(previous, next, stats) {
  const updated = stats.map((entry) => ({
    kills: statValue(entry?.kills),
    deaths: statValue(entry?.deaths),
    assists: statValue(entry?.assists),
  }));
  if (!previous?.players?.length || !next?.players?.length) return updated;

  for (const player of next.players) {
    const slot = Number(player?.slot);
    if (slot !== 0 && slot !== 1) continue;
    const prior = previous.players.find((candidate) => Number(candidate?.slot) === slot);
    if (!prior || prior.dead || !player.dead) continue;
    updated[slot].deaths += 1;
    updated[1 - slot].kills += 1;
  }
  return updated;
}
