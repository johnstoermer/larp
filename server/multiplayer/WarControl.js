import { WAR_RULES } from '../../shared/warConfig.js';

const clamp = (value, minimum, maximum) =>
  Math.max(minimum, Math.min(maximum, value));

export class WarControl {
  constructor({ now = Date.now(), rules = {} } = {}) {
    this.rules = Object.freeze({ ...WAR_RULES, ...rules });
    this.phase = 'locked';
    this.unlockAt = now + this.rules.unlockMs;
    this.lastUpdateAt = now;
    this.owner = null;
    this.captureTeam = null;
    this.captureProgress = 0;
    this.scores = [0, 0];
    this.contested = false;
    this.overtime = false;
    this.overtimeGraceEndsAt = 0;
    this.winner = null;
  }

  update(now, occupancy = [0, 0]) {
    const previousUpdateAt = this.lastUpdateAt;
    this.lastUpdateAt = now;
    if (this.phase === 'result') return this.snapshot(now, occupancy);
    if (now < this.unlockAt) return this.snapshot(now, occupancy);
    if (this.phase === 'locked') this.phase = 'control';
    // Never turn time spent behind the initial lock into capture or score.
    const deltaMs = clamp(
      now - Math.max(previousUpdateAt, this.unlockAt),
      0,
      1_000,
    );

    const present = [Number(occupancy[0]) > 0, Number(occupancy[1]) > 0];
    this.contested = present[0] && present[1];

    if (this.owner != null) {
      this.scores[this.owner] = clamp(
        this.scores[this.owner] + deltaMs / 1_000 * this.rules.scorePerSecond,
        0,
        this.rules.scoreToWin,
      );
    }

    if (!this.contested) {
      const capturingTeam = present[0] ? 0 : present[1] ? 1 : null;
      if (capturingTeam === this.owner) {
        this.captureTeam = null;
        this.captureProgress = 0;
      } else if (capturingTeam != null) {
        if (this.captureTeam !== capturingTeam) {
          this.captureTeam = capturingTeam;
          this.captureProgress = 0;
        }
        this.captureProgress = clamp(
          this.captureProgress + deltaMs / this.rules.captureMs * 100,
          0,
          100,
        );
        if (this.captureProgress >= 100) {
          this.owner = capturingTeam;
          this.captureTeam = null;
          this.captureProgress = 0;
          this.overtime = false;
          this.overtimeGraceEndsAt = 0;
        }
      }
    }

    const threatenedOwner = this.owner;
    const overtimeThreat =
      threatenedOwner != null &&
      this.scores[threatenedOwner] >= this.rules.overtimeThreshold &&
      present[1 - threatenedOwner];
    if (overtimeThreat) {
      this.overtime = true;
      this.overtimeGraceEndsAt = 0;
    } else if (this.overtime) {
      if (!this.overtimeGraceEndsAt) {
        this.overtimeGraceEndsAt = now + this.rules.overtimeGraceMs;
      }
      if (now >= this.overtimeGraceEndsAt) {
        this.overtime = false;
        this.overtimeGraceEndsAt = 0;
      }
    }

    if (
      this.owner != null &&
      this.scores[this.owner] >= this.rules.scoreToWin &&
      !this.overtime &&
      !present[1 - this.owner]
    ) {
      this.winner = this.owner;
      this.phase = 'result';
    }

    return this.snapshot(now, occupancy);
  }

  snapshot(now = Date.now(), occupancy = [0, 0]) {
    return {
      phase: this.phase,
      unlockRemaining: Math.max(0, this.unlockAt - now),
      owner: this.owner,
      captureTeam: this.captureTeam,
      captureProgress: Math.round(this.captureProgress * 10) / 10,
      scores: this.scores.map((score) => Math.round(score * 10) / 10),
      occupancy: [Number(occupancy[0]) || 0, Number(occupancy[1]) || 0],
      contested: this.contested,
      overtime: this.overtime,
      overtimeGraceRemaining: this.overtimeGraceEndsAt
        ? Math.max(0, this.overtimeGraceEndsAt - now)
        : 0,
      winner: this.winner,
    };
  }
}
