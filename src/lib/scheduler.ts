// Choosing the next question: Leitner boxes with weighted random draws (PLAN.md, 2.8).

export interface ItemProgress {
  /** 0 = never asked, 1 = wrong recently, 2–5 = answered correctly more and more often. */
  box: number;
  attempts: number;
  correct: number;
  /** Timestamp (ms) of the last answer. */
  last: number;
}

export const NEW_PROGRESS: ItemProgress = { box: 0, attempts: 0, correct: 0, last: 0 };

/** Draw weight per box: wrong answers come back most, mastered places now and then. */
export const BOX_WEIGHTS = [8, 16, 8, 4, 2, 1];

/** From this box on a place counts as mastered. */
export const MASTERED_BOX = 4;

export function updateProgress(p: ItemProgress, correct: boolean, now = Date.now()): ItemProgress {
  return {
    box: correct ? Math.min(5, Math.max(p.box, 1) + 1) : 1,
    attempts: p.attempts + 1,
    correct: p.correct + (correct ? 1 : 0),
    last: now,
  };
}

export type Rng = () => number;

/** Picks the next item for a practice session. */
export class PracticeScheduler {
  private recent: string[] = [];
  private retries: { id: string; due: number }[] = [];
  private readonly cooldown: number;

  constructor(
    private readonly ids: string[],
    private readonly boxOf: (id: string) => number,
    private readonly rng: Rng = Math.random,
  ) {
    this.cooldown = Math.min(3, Math.floor(ids.length / 2));
  }

  /** The item for question number `index` (0-based). */
  next(index: number): string {
    const blocked = new Set(this.recent.slice(-this.cooldown));
    const dueIdx = this.retries.findIndex((r) => r.due <= index && !blocked.has(r.id));
    let id: string;
    if (dueIdx >= 0) {
      id = this.retries[dueIdx].id;
      this.retries.splice(dueIdx, 1);
    } else {
      const pool = this.ids.filter((i) => !blocked.has(i));
      const candidates = pool.length ? pool : this.ids;
      const weights = candidates.map((i) => BOX_WEIGHTS[this.boxOf(i)] ?? 1);
      let r = this.rng() * weights.reduce((a, b) => a + b, 0);
      id = candidates[candidates.length - 1];
      for (let i = 0; i < candidates.length; i++) {
        r -= weights[i];
        if (r < 0) {
          id = candidates[i];
          break;
        }
      }
    }
    this.recent.push(id);
    return id;
  }

  /** After a wrong (or skipped) answer the place is asked once more, 3–5 questions later. */
  scheduleRetry(id: string, index: number): void {
    this.retries = this.retries.filter((r) => r.id !== id);
    this.retries.push({ id, due: index + 3 + Math.floor(this.rng() * 3) });
  }
}

export function shuffle<T>(list: T[], rng: Rng = Math.random): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
