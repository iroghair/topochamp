import { describe, expect, it } from 'vitest';
import { grade, stars, streakFactor, timeFactor, totalPoints } from '../src/lib/points';
import { BOX_WEIGHTS, NEW_PROGRESS, PracticeScheduler, updateProgress } from '../src/lib/scheduler';
import { matchAnswer, normalize, spellingDiff } from '../src/lib/text';

/** Deterministic random numbers for repeatable tests. */
function seeded(seed = 42) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe('points and multipliers', () => {
  it('rewards speed only for correct answers', () => {
    expect(timeFactor(2, 'where')).toBe(1.5);
    expect(timeFactor(5, 'where')).toBe(1.25);
    expect(timeFactor(9, 'where')).toBe(1.1);
    expect(timeFactor(30, 'where')).toBe(1);
    expect(timeFactor(10, 'type')).toBe(1.25); // typing gets twice as long
    expect(totalPoints(50, false, { seconds: 1, streak: 0, level: 'easy', kind: 'where' }).factors.time).toBe(1);
  });

  it('grows the streak bonus up to double', () => {
    expect(streakFactor(1)).toBe(1);
    expect(streakFactor(2)).toBeCloseTo(1.1);
    expect(streakFactor(11)).toBeCloseTo(2);
    expect(streakFactor(50)).toBeCloseTo(2);
  });

  it('multiplies by level and question kind', () => {
    const r = totalPoints(100, true, { seconds: 30, streak: 1, level: 'hard', kind: 'type' });
    expect(r.factors.difficulty).toBe(3);
    expect(r.total).toBe(300);
  });

  it('gives stars and a 1–10 grade from the base points', () => {
    expect([stars(100), stars(75), stars(40), stars(39)]).toEqual([3, 2, 1, 0]);
    expect(grade([100, 100])).toBe(10);
    expect(grade([0, 0])).toBe(1);
    expect(grade([100, 0])).toBe(5.5);
  });
});

describe('Leitner boxes', () => {
  it('moves up on correct answers and back to box 1 on mistakes', () => {
    let p = NEW_PROGRESS;
    p = updateProgress(p, true);
    expect(p.box).toBe(2);
    p = updateProgress(updateProgress(updateProgress(updateProgress(p, true), true), true), true);
    expect(p.box).toBe(5);
    p = updateProgress(p, false);
    expect(p.box).toBe(1);
    expect(p.attempts).toBe(6);
    expect(p.correct).toBe(5);
  });

  it('asks places answered wrong much more often than mastered ones', () => {
    // A long list, so the "no repeat within 3 questions" rule doesn't cap the frequency.
    const ids = ['wrong', ...Array.from({ length: 59 }, (_, i) => `mastered${i}`)];
    const s = new PracticeScheduler(ids, (id) => (id === 'wrong' ? 1 : 5), seeded());
    const counts: Record<string, number> = {};
    for (let i = 0; i < 6000; i++) {
      const id = s.next(i);
      counts[id] = (counts[id] ?? 0) + 1;
    }
    const masteredAvg = (6000 - counts.wrong) / 59;
    // The cooldown lowers the ratio below the raw weight ratio (16:1).
    expect(counts.wrong / masteredAvg).toBeGreaterThan((BOX_WEIGHTS[1] / BOX_WEIGHTS[5]) * 0.4);
  });

  it('does not repeat a place within the next questions', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const s = new PracticeScheduler(ids, () => 0, seeded(7));
    const asked = Array.from({ length: 200 }, (_, i) => s.next(i));
    for (let i = 3; i < asked.length; i++) expect(asked.slice(i - 3, i)).not.toContain(asked[i]);
  });

  it('asks a wrong answer again 3–5 questions later', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    const s = new PracticeScheduler(ids, () => 5, seeded(3));
    const first = s.next(0);
    s.scheduleRetry(first, 0);
    const later = Array.from({ length: 7 }, (_, i) => s.next(i + 1));
    const at = later.indexOf(first) + 1;
    expect(at).toBeGreaterThanOrEqual(4);
    expect(at).toBeLessThanOrEqual(6);
  });
});

describe('typed answers', () => {
  it('ignores case, accents, spaces, hyphens and apostrophes', () => {
    expect(normalize("'s-Hertogenbosch")).toBe(normalize('s hertogenbosch'));
    expect(matchAnswer('s hertogenbosch', ["'s-Hertogenbosch"], 'lenient').kind).toBe('exact');
    expect(matchAnswer('Wisla', ['Wisła'], 'lenient').kind).toBe('exact');
  });

  it('accepts other names', () => {
    expect(matchAnswer('Den Bosch', ["'s-Hertogenbosch", 'Den Bosch'], 'lenient')).toEqual({ kind: 'exact', name: 'Den Bosch' });
  });

  it('allows small typos in lenient mode only', () => {
    expect(matchAnswer('Amsterdan', ['Amsterdam'], 'lenient')).toEqual({ kind: 'typo', name: 'Amsterdam', typos: 1 });
    expect(matchAnswer('Amstredan', ['Amsterdam'], 'lenient').kind).toBe('typo'); // swapped letters count once
    expect(matchAnswer('Asen', ['Assen'], 'lenient').kind).toBe('typo');
    expect(matchAnswer('Asn', ['Assen'], 'lenient').kind).toBe('wrong');
    expect(matchAnswer('Amsterdan', ['Amsterdam'], 'strict').kind).toBe('wrong');
    expect(matchAnswer('amsterdam', ['Amsterdam'], 'strict').kind).toBe('exact');
    expect(matchAnswer('s-Hertogenbosch', ["'s-Hertogenbosch"], 'strict').kind).toBe('wrong');
  });

  it('marks the wrong and missing letters', () => {
    const parts = spellingDiff('Amsterdan', 'Amsterdam');
    expect(parts).toEqual([
      { text: 'Amsterda', kind: 'ok' },
      { text: 'n', kind: 'wrong' },
      { text: 'm', kind: 'missing' },
    ]);
  });
});
