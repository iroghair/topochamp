// Points, multipliers, stars and grades (PLAN.md, sections 2.5–2.8).
import type { Level, QuestionKind } from './types';

export const LEVEL_FACTOR: Record<Level, number> = { easy: 1, middle: 1.5, hard: 2 };
export const KIND_FACTOR: Record<QuestionKind, number> = { where: 1, choice4: 1, choice8: 1.25, type: 1.5 };

/** Bonus for answering quickly. Typing gets twice as long. Only for correct answers. */
export function timeFactor(seconds: number, kind: QuestionKind): number {
  const s = kind === 'type' ? seconds / 2 : seconds;
  if (s <= 3) return 1.5;
  if (s <= 6) return 1.25;
  if (s <= 10) return 1.1;
  return 1;
}

/** Bonus for consecutive correct answers: +10 % per answer in the streak, up to double. */
export function streakFactor(streak: number): number {
  return 1 + 0.1 * Math.min(Math.max(streak - 1, 0), 10);
}

export interface Factors {
  time: number;
  streak: number;
  difficulty: number;
}

export function totalPoints(
  base: number,
  correct: boolean,
  opts: { seconds: number; streak: number; level: Level; kind: QuestionKind },
): { total: number; factors: Factors } {
  const factors: Factors = {
    time: correct ? timeFactor(opts.seconds, opts.kind) : 1,
    streak: correct ? streakFactor(opts.streak) : 1,
    difficulty: LEVEL_FACTOR[opts.level] * KIND_FACTOR[opts.kind],
  };
  return { total: Math.round(base * factors.time * factors.streak * factors.difficulty), factors };
}

export function stars(base: number): 0 | 1 | 2 | 3 {
  if (base >= 100) return 3;
  if (base >= 70) return 2;
  if (base >= 40) return 1;
  return 0;
}

/** Dutch school grade from 1 to 10, one decimal, from the base points (without bonuses). */
export function grade(bases: number[]): number {
  if (!bases.length) return 1;
  const avg = bases.reduce((a, b) => a + b, 0) / bases.length;
  return Math.round((1 + (9 * avg) / 100) * 10) / 10;
}
