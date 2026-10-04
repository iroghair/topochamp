import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { preparePack } from '../src/lib/packs';
import { pointsForDistance, scoreWhere, type Placed, type WhereInput } from '../src/lib/scoring';
import type { Item, PackFile } from '../src/lib/types';

const nld = preparePack(JSON.parse(readFileSync('public/packs/NLD.json', 'utf8')) as PackFile);
const byName = (name: string, t?: string): Item => {
  const item = nld.file.items.find((i) => i.nl === name && (!t || i.t === t));
  if (!item) throw new Error(`no item ${name}`);
  return item;
};
const placed = (item: Item): Placed => ({ item, shape: nld.shapes.get(item.id) });

const D = nld.file.diagKm;
const base = (target: Item, click: [number, number], extra: Partial<WhereInput> = {}): WhereInput => ({
  target: placed(target),
  click,
  kmPerPx: 0.5,
  diagKm: D,
  markers: [],
  rivals: [],
  ...extra,
});

describe('distance points', () => {
  it('gives full points close by, none far away and a linear slope between', () => {
    expect(pointsForDistance(0, 400)).toBe(100);
    expect(pointsForDistance(8, 400)).toBe(100); // 2 %
    expect(pointsForDistance(60, 400)).toBe(0); // 15 %
    expect(pointsForDistance(34, 400)).toBe(50); // halfway between 8 and 60
  });
});

describe('areas', () => {
  const utrechtProvince = byName('Utrecht', 'province');

  it('counts anywhere inside the province as correct', () => {
    const r = scoreWhere(base(utrechtProvince, [5.25, 52.05]));
    expect(r).toMatchObject({ base: 100, correct: true, distanceKm: 0 });
  });

  it('gives partial points outside, and names what was clicked', () => {
    const r = scoreWhere(base(utrechtProvince, [4.9, 52.37], { areaAt: (pt) => nld.items.get('p:NLD-3486') })); // Amsterdam
    expect(r.correct).toBe(false);
    expect(r.base).toBeGreaterThan(0);
    expect(r.base).toBeLessThan(100);
    expect(r.distanceKm).toBeGreaterThan(5);
    expect(r.clickedId).toBe('p:NLD-3486');
  });

  it('accepts a click just over the edge', () => {
    const r = scoreWhere(base(utrechtProvince, [4.9, 52.37], { kmPerPx: 100 }));
    expect(r.correct).toBe(true);
  });
});

describe('cities without dots (middle / hard)', () => {
  const zwolle = byName('Zwolle');
  const assen = byName('Assen');
  const rivals = [placed(zwolle), placed(assen)];

  it('is correct close to the city', () => {
    const r = scoreWhere(base(zwolle, [6.1, 52.52], { rivals }));
    expect(r.correct).toBe(true);
    expect(r.distanceKm).toBeLessThan(5);
  });

  it('is wrong beyond the "correct" distance, with partial points', () => {
    const r = scoreWhere(base(zwolle, [6.35, 52.7], { rivals }));
    expect(r.distanceKm).toBeGreaterThan(0.05 * D);
    expect(r.correct).toBe(false);
    expect(r.base).toBeGreaterThan(0);
  });

  it('is wrong when the click is closer to another city on the list', () => {
    // Between Zwolle and Assen but nearer to Assen, within the "correct" radius of neither rule.
    const deventer = byName('Deventer');
    const apeldoorn = byName('Apeldoorn');
    const click: [number, number] = [6.04, 52.23]; // near Apeldoorn/Deventer
    const r = scoreWhere(base(deventer, click, { rivals: [placed(deventer), placed(apeldoorn)] }));
    const toApeldoorn = Math.hypot(click[0] - apeldoorn.x, click[1] - apeldoorn.y);
    const toDeventer = Math.hypot(click[0] - deventer.x, click[1] - deventer.y);
    expect(toApeldoorn < toDeventer).toBe(true);
    expect(r.correct).toBe(false);
    expect(r.clickedId).toBe(apeldoorn.id);
  });
});

describe('cities with dots (easy)', () => {
  const denHaag = byName('Den Haag');
  const rotterdam = byName('Rotterdam');
  const markers = [placed(denHaag), placed(rotterdam)];

  it('is correct when the right dot is clicked', () => {
    const r = scoreWhere(base(denHaag, [denHaag.x + 0.01, denHaag.y], { markers, kmPerPx: 0.2 }));
    expect(r).toMatchObject({ base: 100, correct: true });
  });

  it('gives partial points for a wrong dot and says which one', () => {
    const r = scoreWhere(base(denHaag, [rotterdam.x, rotterdam.y], { markers, kmPerPx: 0.2 }));
    expect(r.correct).toBe(false);
    expect(r.clickedId).toBe(rotterdam.id);
    expect(r.base).toBeGreaterThan(0);
    expect(r.base).toBeLessThan(100);
  });

  it('is wrong when no dot is hit', () => {
    const r = scoreWhere(base(denHaag, [denHaag.x + 0.08, denHaag.y + 0.05], { markers, kmPerPx: 0.2 }));
    expect(r.correct).toBe(false);
  });

  it('snaps further on touch screens', () => {
    const click: [number, number] = [denHaag.x + 0.06, denHaag.y]; // ~4 km = 20 px at 0.2 km/px
    expect(scoreWhere(base(denHaag, click, { markers, kmPerPx: 0.2 })).correct).toBe(false);
    expect(scoreWhere(base(denHaag, click, { markers, kmPerPx: 0.2, touch: true })).correct).toBe(true);
  });
});

describe('rivers', () => {
  const ijssel = byName('IJssel', 'river');

  it('measures the distance to the river line', () => {
    const r = scoreWhere(base(ijssel, [6.1, 52.3], { rivals: [placed(ijssel)] }));
    expect(r.correct).toBe(true);
  });
});
