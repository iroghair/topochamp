import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defaultItemIds, preparePack } from '../src/lib/packs';
import { GameSession, type SessionConfig } from '../src/lib/session.svelte';
import type { PackFile } from '../src/lib/types';

const pack = preparePack(JSON.parse(readFileSync('public/packs/NLD.json', 'utf8')) as PackFile);
const entries = defaultItemIds(pack).map((id) => ({ id }));

function seeded(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const config = (over: Partial<SessionConfig> = {}): SessionConfig => ({
  pack,
  entries,
  level: 'middle',
  kinds: ['where'],
  type: 'practice',
  length: 10,
  spelling: 'lenient',
  showRivers: true,
  showLakes: true,
  playerId: `test-${Math.random()}`,
  lang: 'nl',
  typeName: (t) => t,
  rng: seeded(),
  ...over,
});

/** Clicks right on the place: its dot, or its label point for areas. */
const clickOn = (s: GameSession) => {
  const item = s.current!.item;
  return s.answerWhere({ lonlat: [item.x, item.y], kmPerPx: 0.3, touch: false, ringed: new Set() });
};

describe('the default Dutch list', () => {
  it('has the 12 provinces, their capitals and Amsterdam', () => {
    const items = entries.map((e) => pack.items.get(e.id)!);
    expect(items.filter((i) => i.t === 'province')).toHaveLength(12);
    const cities = items.filter((i) => i.t === 'city').map((i) => i.nl);
    expect(cities).toHaveLength(13);
    expect(cities).toEqual(expect.arrayContaining(['Amsterdam', 'Den Haag', 'Lelystad', "'s-Hertogenbosch", 'Middelburg']));
  });

  it('adds the type to names that appear twice', () => {
    const s = new GameSession(config());
    const groningen = entries.map((e) => pack.items.get(e.id)!).filter((i) => i.nl === 'Groningen');
    expect(groningen.map((i) => s.labelOf(i)).sort()).toEqual(['Groningen (city)', 'Groningen (province)']);
  });
});

describe('a practice round', () => {
  it('scores correct answers with growing streaks and ends after the chosen length', () => {
    const s = new GameSession(config());
    for (let i = 0; i < 10; i++) {
      expect(s.phase).toBe('question');
      const a = clickOn(s)!;
      expect(a.correct).toBe(true);
      expect(a.base).toBe(100);
      expect(a.factors.difficulty).toBe(1.5);
      s.continue();
    }
    expect(s.phase).toBe('done');
    expect(s.streak).toBe(10);
    expect(s.answers.at(-1)!.factors.streak).toBeCloseTo(1.9);
  });

  it('lets you skip twice, without points, and asks the place again later', () => {
    const s = new GameSession(config({ length: 12 }));
    const skipped = s.current!.item.id;
    const a = s.skip()!;
    expect(a).toMatchObject({ skipped: true, base: 0, total: 0, correct: false });
    s.continue();
    expect(s.skip()).not.toBeNull();
    s.continue();
    expect(s.skipsLeft).toBe(0);
    expect(s.skip()).toBeNull();
    const asked: string[] = [];
    while (s.phase !== 'done') {
      asked.push(s.current!.item.id);
      clickOn(s);
      s.continue();
    }
    expect(asked).toContain(skipped);
  });

  it('resets the streak after a wrong answer', () => {
    const s = new GameSession(config());
    clickOn(s);
    s.continue();
    clickOn(s);
    s.continue();
    expect(s.streak).toBe(2);
    s.answerWhere({ lonlat: [-30, 10], kmPerPx: 0.3, touch: false, ringed: new Set() });
    expect(s.streak).toBe(0);
    expect(s.lastAnswer!.base).toBe(0);
  });
});

describe('a test run', () => {
  it('asks every place exactly once, without skips', () => {
    const s = new GameSession(config({ type: 'test' }));
    expect(s.total).toBe(entries.length);
    expect(s.skipsLeft).toBe(0);
    const asked = new Set<string>();
    while (s.phase !== 'done') {
      asked.add(s.current!.item.id);
      clickOn(s);
      s.continue();
    }
    expect(asked.size).toBe(entries.length);
  });
});

describe('"What is this?" questions', () => {
  it('offers 4 or 8 options of the same type, including the answer', () => {
    for (const kind of ['choice4', 'choice8'] as const) {
      const s = new GameSession(config({ kinds: [kind] }));
      for (let i = 0; i < 10; i++) {
        const q = s.current!;
        expect(q.options).toHaveLength(kind === 'choice4' ? 4 : 8);
        expect(q.options.map((o) => o.id)).toContain(q.item.id);
        expect(new Set(q.options.map((o) => o.t === 'city'))).toEqual(new Set([q.item.t === 'city']));
        s.answerChoice(q.item);
        s.continue();
      }
    }
  });

  it('accepts typed names with a typo in lenient mode', () => {
    const s = new GameSession(config({ kinds: ['type'] }));
    const name = s.nameOf(s.current!.item);
    const typo = name.slice(0, -1) + (name.endsWith('x') ? 'y' : 'x');
    const a = s.answerTyped(typo)!;
    expect(a.correct).toBe(true);
    expect(a.base).toBe(75);
    expect(a.match?.kind).toBe('typo');
  });
});

describe('rivers drawn on the map', () => {
  const river = (name: string) => pack.file.items.find((i) => i.t === 'river' && i.nl === name)!;
  const ijssel = river('IJssel');
  const waal = river('Waal');
  // All points of a river, whether it is one line or several.
  const points = (id: string): [number, number][] => {
    const g = pack.shapes.get(id)!.feature.geometry;
    if (g.type === 'LineString') return g.coordinates as [number, number][];
    if (g.type === 'MultiLineString') return g.coordinates.flat() as [number, number][];
    throw new Error(`unexpected ${g.type}`);
  };
  // The westernmost point of the Waal, far from the IJssel.
  const waalPoint = points(waal.id).reduce((a, b) => (b[0] < a[0] ? b : a));
  const ijsselOnly = [{ id: ijssel.id }];

  it('snaps a click to any drawn river, also one that is not on the list', () => {
    const s = new GameSession(config({ entries: ijsselOnly, level: 'hard' }));
    const a = s.answerWhere({ lonlat: waalPoint, kmPerPx: 0.3, touch: false, ringed: new Set() })!;
    expect(a.correct).toBe(false);
    expect(a.where?.clickedId).toBe(waal.id);
  });

  it('is correct when the drawn river itself is clicked', () => {
    const s = new GameSession(config({ entries: ijsselOnly, level: 'hard' }));
    const onIjssel = points(ijssel.id)[Math.floor(points(ijssel.id).length / 2)];
    expect(s.answerWhere({ lonlat: onIjssel, kmPerPx: 0.3, touch: false, ringed: new Set() })!.base).toBe(100);
  });

  it('scores by distance when rivers are not drawn', () => {
    const s = new GameSession(config({ entries: ijsselOnly, level: 'easy', showRivers: false }));
    const a = s.answerWhere({ lonlat: waalPoint, kmPerPx: 0.3, touch: false, ringed: new Set() })!;
    expect(a.correct).toBe(false);
    expect(a.where?.clickedId).toBeUndefined();
    expect(a.where!.distanceKm).toBeGreaterThan(20);
  });
});
