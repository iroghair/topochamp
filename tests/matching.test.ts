import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { customName, matchLines, NameIndex, parseList } from '../src/lib/matching';
import { preparePack } from '../src/lib/packs';
import type { PackFile } from '../src/lib/types';

const load = (id: string) => preparePack(JSON.parse(readFileSync(`public/packs/${id}.json`, 'utf8')) as PackFile);
const nld = new NameIndex(load('NLD'));
const europe = new NameIndex(load('europe'));

describe('parsing a pasted list', () => {
  it('splits lines, strips numbering and reads type hints', () => {
    expect(parseList('1. Amsterdam\n- Rotterdam\n\n• Groningen (provincie)\tUtrecht (stad); Rijn')).toEqual([
      { text: 'Amsterdam' },
      { text: 'Rotterdam' },
      { text: 'Groningen', type: 'province' },
      { text: 'Utrecht', type: 'city' },
      { text: 'Rijn' },
    ]);
  });

  it('keeps brackets that are not a type hint', () => {
    expect(parseList('Bergen (NH)')).toEqual([{ text: 'Bergen (NH)' }]);
  });

  it('reads another name in brackets', () => {
    expect(parseList('Ural (Oeral)')).toEqual([{ text: 'Ural', alt: 'Oeral' }]);
  });
});

describe('matching names to places', () => {
  it('finds a typical Dutch topography list', () => {
    const sheet = `Groningen
Leeuwarden
Assen
Zwolle
Lelystad
Enschede
Den Helder
Den Bosch
Vlissingen
Urk
IJssel
Waal
Noordzee
Waddenzee
IJsselmeer`;
    const results = matchLines(parseList(sheet), nld);
    const missing = results.filter((r) => r.status === 'missing').map((r) => r.line.text);
    expect(missing).toEqual([]);
    const found = Object.fromEntries(results.filter((r) => r.status === 'found').map((r) => [r.line.text, r.match.item]));
    expect(found['Den Bosch'].nl).toBe("'s-Hertogenbosch");
    expect(found['IJssel'].t).toBe('river');
    expect(found['IJsselmeer'].t).toBe('lake');
    expect(found['Noordzee'].t).toBe('sea');
  });

  it('asks when a name fits two places, unless it is pasted twice', () => {
    const once = matchLines(parseList('Groningen'), nld);
    expect(once[0].status).toBe('ambiguous');

    const twice = matchLines(parseList('Groningen\nGroningen'), nld);
    expect(twice.map((r) => r.status)).toEqual(['found', 'found']);
    const types = twice.map((r) => (r.status === 'found' ? r.match.item.t : '')).sort();
    expect(types).toEqual(['city', 'province']);

    const hinted = matchLines(parseList('Groningen (provincie)'), nld);
    expect(hinted[0].status === 'found' && hinted[0].match.item.t).toBe('province');
  });

  it('picks the much bigger town when two towns share a name', () => {
    const r = matchLines(parseList('Hengelo'), nld)[0];
    expect(r.status).toBe('found');
    if (r.status === 'found') {
      expect(r.match.item.pop).toBeGreaterThan(50_000);
      expect(r.others.length).toBeGreaterThan(0);
    }
  });

  it('corrects small spelling mistakes and Dutch names for foreign places', () => {
    const [a, b, c] = matchLines(parseList('Amsterdm\nParijs\nKeulen'), europe);
    expect(a.status === 'found' && a.match.item.nl).toBe('Amsterdam');
    expect(b.status === 'found' && b.match.item.en).toBe('Paris');
    expect(c.status === 'found' && c.match.item.nl).toBe('Keulen');
  });

  it('finds a Dutch Europe list with parts of countries, rivers and regions', () => {
    const sheet = 'Schelde\nVlaanderen\nWallonie\nArdennen\nSchotland\nEngeland\nVerenigd Koninkrijk\nCyprus\nLuxemburg (land)\nLuxemburg (stad)';
    const results = matchLines(parseList(sheet), europe);
    const found = results.map((r) => (r.status === 'found' ? `${r.match.item.nl} (${r.match.item.t})` : r.status));
    expect(found).toEqual([
      'Schelde (river)',
      'Vlaanderen (part)',
      'Wallonië (part)',
      'Ardennen (mountains)',
      'Schotland (part)',
      'Engeland (part)',
      'Verenigd Koninkrijk (country)',
      'Cyprus (country)',
      'Luxemburg (country)',
      'Luxemburg (city)',
    ]);
  });

  it('offers both places when the name in brackets fits two', () => {
    const r = matchLines(parseList('Ural (Oeral)'), europe)[0];
    expect(r.status).toBe('ambiguous');
    if (r.status === 'ambiguous') expect(r.options.map((o) => o.item.t).sort()).toEqual(['mountains', 'river']);
  });

  it('reports names it cannot find', () => {
    const r = matchLines(parseList('Atlantis'), nld)[0];
    expect(r.status).toBe('missing');
  });

  it('keeps the sheet spelling only for other names', () => {
    const [denBosch, amsterdm] = matchLines(parseList('Den Bosch\nAmsterdm'), nld);
    expect(denBosch.status === 'found' && customName('Den Bosch', denBosch.match)).toBe('Den Bosch');
    expect(amsterdm.status === 'found' && customName('Amsterdm', amsterdm.match)).toBeUndefined();
  });
});

describe('searching', () => {
  it('suggests places while typing', () => {
    const names = nld.search('zwo').map((i) => i.nl);
    expect(names[0]).toBe('Zwolle');
  });
});
