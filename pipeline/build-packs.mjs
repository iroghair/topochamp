// Builds the map packs (public/packs/*.json) and their index from the downloaded sources.
//
//   node pipeline/build-packs.mjs                 → all packs
//   node pipeline/build-packs.mjs world europe NLD → only these packs (index lists all)
//
// A pack holds everything the game needs for one region: the map geometry as TopoJSON
// and a list of items (countries, provinces, cities, rivers, seas, …) that can be asked.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import mapshaper from 'mapshaper';
import { feature as topoFeature } from 'topojson-client';
import { geoConicConformal, geoDistance, geoPath } from 'd3-geo';
import { CACHE_DIR, GEONAMES, LAYERS, OUT_DIR } from './config.mjs';
import {
  CONTINENTS,
  COUNTRY_MERGES,
  COUNTRY_VIEWS,
  EXTRA_ALIASES,
  NAME_FIXES_NL,
  COUNTRY_PARTS,
  GROUP_TYPE,
  PRIMARY_CAPITAL,
  PROVINCE_GROUPING,
  REGION_NAMES,
  RIVER_NAMES_NL,
  WORLD,
} from './tables.mjs';

const PACK_VERSION = 1;
const EARTH_RADIUS_KM = 6371;

// How much detail each kind of pack keeps (Natural Earth scalerank: lower = more important).
// `river`/`lake` apply in and near the view; `bgRiver`/`bgLake` to the surroundings, so the
// background map also shows the big rivers and lakes of neighbouring countries.
const LIMITS = {
  world: { river: 3, riverEurope: -1, bgRiver: 3, lake: 1, bgLake: 1, sea: 1, region: 2, foreignCityRank: 2, geonamesPop: Infinity },
  continent: { river: 8, riverEurope: -1, bgRiver: 4, lake: 4, bgLake: 2, sea: 5, region: 5, foreignCityRank: 3, geonamesPop: 100_000 },
  country: { river: 99, riverEurope: 99, bgRiver: 5, lake: 99, bgLake: 3, sea: 99, region: 99, foreignCityRank: 99, geonamesPop: 1000 },
};
const MAX_GEONAMES_PER_PACK = 3000;

/* ───────────── geometry helpers ───────────── */

function eachPosition(c, fn) {
  if (typeof c[0] === 'number') fn(c);
  else for (const x of c) eachPosition(x, fn);
}

function bboxOf(geom) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  if (!geom) return b;
  eachPosition(geom.coordinates, ([x, y]) => {
    if (x < b[0]) b[0] = x;
    if (y < b[1]) b[1] = y;
    if (x > b[2]) b[2] = x;
    if (y > b[3]) b[3] = y;
  });
  return b;
}

const expandBox = (b, f) => {
  const dx = (b[2] - b[0]) * f;
  const dy = (b[3] - b[1]) * f;
  return [b[0] - dx, b[1] - dy, b[2] + dx, b[3] + dy];
};
const intersectBox = (a, b) => [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
const unionBox = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
const intersects = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
const inBox = ([x, y], b) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const kmBetween = (a, b) => geoDistance(a, b) * EARTH_RADIUS_KM;
const diagKm = (b) => kmBetween([b[0], b[1]], [b[2], b[3]]);
const round4 = (v) => Math.round(v * 1e4) / 1e4;

function boxGapKm(a, b) {
  const lat = (a[1] + a[3] + b[1] + b[3]) / 4;
  const dx = Math.max(0, a[0] - b[2], b[0] - a[2]) * Math.cos((lat * Math.PI) / 180);
  const dy = Math.max(0, a[1] - b[3], b[1] - a[3]);
  return Math.hypot(dx, dy) * 111.2;
}

const polygonsOf = (geom) =>
  !geom ? [] : geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];

function partArea(rings) {
  const ring = rings[0];
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  const lat = (bboxOf({ coordinates: ring })[1] + bboxOf({ coordinates: ring })[3]) / 2;
  return Math.abs(a / 2) * Math.cos((lat * Math.PI) / 180);
}

function ringContains(ring, [x, y]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const partContains = (rings, pt) => ringContains(rings[0], pt) && !rings.slice(1).some((h) => ringContains(h, pt));
const geomContains = (geom, pt) => polygonsOf(geom).some((rings) => partContains(rings, pt));

function segmentDistance([px, py], [ax, ay], [bx, by], k) {
  const x = (px - ax) * k;
  const y = py - ay;
  const dx = (bx - ax) * k;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? clamp((x * dx + y * dy) / len, 0, 1) : 0;
  return Math.hypot(x - t * dx, y - t * dy);
}

// A point well inside the largest part of an area, used to place labels and markers.
function labelPoint(geom) {
  const parts = polygonsOf(geom);
  if (!parts.length) return null;
  let best = parts[0];
  let bestArea = -1;
  for (const p of parts) {
    const a = partArea(p);
    if (a > bestArea) [best, bestArea] = [p, a];
  }
  const b = bboxOf({ coordinates: best });
  const k = Math.cos((((b[1] + b[3]) / 2) * Math.PI) / 180);
  const edgeDistance = (pt) => {
    let d = Infinity;
    for (const ring of best) for (let i = 1; i < ring.length; i++) d = Math.min(d, segmentDistance(pt, ring[i - 1], ring[i], k));
    return d;
  };
  let bestPt = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
  let bestD = -1;
  let [cx, cy, w, h] = [bestPt[0], bestPt[1], b[2] - b[0], b[3] - b[1]];
  for (let round = 0; round < 3; round++) {
    const n = 14;
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= n; j++) {
        const pt = [cx - w / 2 + (w * i) / n, cy - h / 2 + (h * j) / n];
        if (!partContains(best, pt)) continue;
        const d = edgeDistance(pt);
        if (d > bestD) [bestD, bestPt] = [d, pt];
      }
    }
    [cx, cy, w, h] = [bestPt[0], bestPt[1], w / 3, h / 3];
  }
  return bestPt;
}

// The point halfway along the longest line of a (multi)line geometry.
function lineMidpoint(geom) {
  const lines = geom.type === 'LineString' ? [geom.coordinates] : geom.coordinates;
  let best = null;
  let bestLen = -1;
  for (const line of lines) {
    let len = 0;
    for (let i = 1; i < line.length; i++) len += kmBetween(line[i - 1], line[i]);
    if (len > bestLen) [best, bestLen] = [line, len];
  }
  let walked = 0;
  for (let i = 1; i < best.length; i++) {
    walked += kmBetween(best[i - 1], best[i]);
    if (walked >= bestLen / 2) return best[i];
  }
  return best[0];
}

// The main territory of a country: its largest part plus the parts close to it, so that
// far-away overseas territories (French Guiana, Caribbean Netherlands) stay off the map.
function mainTerritoryView(features) {
  const parts = features
    .flatMap((f) => polygonsOf(f.geometry))
    .map((p) => ({ bbox: bboxOf({ coordinates: p[0] }), area: partArea(p) }))
    .sort((a, b) => b.area - a.area);
  let view = parts[0].bbox;
  const reach = Math.max(600, 0.6 * diagKm(view));
  let rest = parts.slice(1);
  let grew = true;
  while (grew) {
    grew = false;
    rest = rest.filter((p) => {
      if (boxGapKm(p.bbox, view) > reach) return true;
      view = unionBox(view, p.bbox);
      grew = true;
      return false;
    });
  }
  return view;
}

// The projection the game uses for a view (see src/lib/projection.ts).
function viewProjection(view) {
  const [w, s, e, n] = view;
  return geoConicConformal()
    .parallels([s + (n - s) / 6, n - (n - s) / 6])
    .rotate([-(w + e) / 2, 0]);
}

function edgePoints([w, s, e, n], steps = 24) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const x = w + ((e - w) * i) / steps;
    const y = s + ((n - s) * i) / steps;
    pts.push([x, s], [x, n], [w, y], [e, y]);
  }
  return pts;
}

// The area cut out of the source data: everything visible when the view is fitted to a
// screen between square (1:1) and wide landscape (2.1:1), so the map fills the screen.
// Near the poles every longitude is "visible", so polar points don't widen the frame.
function clipFrame(view) {
  const points = { type: 'MultiPoint', coordinates: edgePoints(view) };
  const proj = viewProjection(view).fitExtent([[0, 0], [1000, 1000]], points);
  const [[x0, y0], [x1, y1]] = geoPath(proj).bounds(points);
  const [w, h, cx, cy] = [x1 - x0, y1 - y0, (x0 + x1) / 2, (y0 + y1) / 2];
  const W = Math.max(w, h * 2.1) * 1.08;
  const H = Math.max(h, w / 0.9) * 1.08;
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  const n = 40;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      const ll = proj.invert([cx - W / 2 + (W * i) / n, cy - H / 2 + (H * j) / n]);
      if (!ll || !Number.isFinite(ll[0]) || !Number.isFinite(ll[1])) continue;
      box[1] = Math.min(box[1], ll[1]);
      box[3] = Math.max(box[3], ll[1]);
      if (Math.abs(ll[1]) > 80) continue;
      box[0] = Math.min(box[0], ll[0]);
      box[2] = Math.max(box[2], ll[0]);
    }
  }
  return [clamp(box[0], -180, 180), clamp(box[1], -85, 85), clamp(box[2], -180, 180), clamp(box[3], -85, 85)];
}

/* ───────────── text helpers ───────────── */

const SPECIAL_LETTERS = { ł: 'l', ø: 'o', æ: 'ae', œ: 'oe', ß: 'ss', đ: 'd', ı: 'i', þ: 'th' };

function normalize(s) {
  return s
    .toLowerCase()
    .replace(/[łøæœßđıþ]/g, (c) => SPECIAL_LETTERS[c])
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

const LATIN = /^[\p{Script=Latin}\p{M}0-9 '’.\-()]+$/u;

function aliases(candidates, names, max = 10) {
  const seen = new Set(names.filter(Boolean).map(normalize));
  const out = [];
  for (const raw of candidates) {
    if (!raw || typeof raw !== 'string') continue;
    for (const a of raw.split('|').map((s) => s.trim())) {
      // Skip codes (AMS, NL416) and lowercase romanizations of other scripts (deng hai er de).
      if (a.length < 2 || !LATIN.test(a) || /^[A-Z]{2,4}$/.test(a) || /\d/.test(a) || !/\p{Lu}/u.test(a)) continue;
      const n = normalize(a);
      if (!n || seen.has(n)) continue;
      seen.add(n);
      out.push(a);
      if (out.length >= max) return out;
    }
  }
  return out;
}

const titleCase = (s) =>
  s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s\-.(])(\p{L})/gu, (m, p, c) => p + c.toUpperCase()) : s;

const slug = (s) => normalize(s) || 'x';

function compact(item) {
  const out = {};
  for (const [k, v] of Object.entries(item)) {
    if (v === undefined || v === null || (Array.isArray(v) && !v.length)) continue;
    out[k] = typeof v === 'number' && (k === 'x' || k === 'y') ? round4(v) : v;
  }
  if (out.en === out.nl) delete out.en; // the game falls back to the Dutch name
  return out;
}

/* ───────────── source data ───────────── */

const load = (file) => {
  const fc = JSON.parse(readFileSync(join(CACHE_DIR, file), 'utf8'));
  const features = fc.features.filter((f) => f.geometry);
  for (const f of features) f.bbox = bboxOf(f.geometry);
  return features;
};

console.time('load sources');
const src = Object.fromEntries(Object.entries(LAYERS).map(([key, file]) => [key, load(file)]));
const geonames = loadGeoNames();
console.timeEnd('load sources');

function loadGeoNames() {
  const KEEP = new Set(['PPL', 'PPLA', 'PPLA2', 'PPLA3', 'PPLA4', 'PPLC', 'PPLG', 'PPLL', 'PPLS', 'PPLF', 'PPLR']);
  const zip = unzipSync(readFileSync(join(CACHE_DIR, GEONAMES.cities)));
  const text = strFromU8(zip[GEONAMES.cities.replace('.zip', '.txt')]);
  const out = [];
  for (const line of text.split('\n')) {
    const c = line.split('\t');
    if (c.length < 15 || !KEEP.has(c[7])) continue;
    out.push({ gid: +c[0], name: c[1], alt: c[3] ? c[3].split(',') : [], lat: +c[4], lon: +c[5], code: c[7], cc: c[8], pop: +c[14] });
  }
  return out;
}

/* ───────────── countries ───────────── */

const COUNTRY_TYPES = new Set(['Sovereign country', 'Country', 'Disputed', 'Sovereignty']);
const NOT_DEFAULT = new Set(['SOL', 'CYN']);

// 'country' = sovereign state, 'territory' = dependency or similar, null = not askable.
function countryKind(p) {
  if (COUNTRY_MERGES[p.ADM0_A3]) return null;
  if (COUNTRY_TYPES.has(p.TYPE) && p.HOMEPART === 1) return 'country';
  if (p.ADM0_A3 === 'PSX') return 'country';
  if (['Dependency', 'Country', 'Disputed'].includes(p.TYPE) || p.ADM0_A3 === 'SAH') return 'territory';
  return null;
}

const countryId = (a3) => 'c:' + (COUNTRY_MERGES[a3] ?? a3);

function continentOf(p) {
  if (p.CONTINENT !== 'Seven seas (open ocean)') return p.CONTINENT;
  if (p.REGION_UN === 'Americas') return p.SUBREGION === 'South America' ? 'South America' : 'North America';
  return p.REGION_UN;
}

const countryByA3 = new Map(src.countries.map((f) => [f.properties.ADM0_A3, f]));
const a3ByIso2 = new Map();
for (const f of src.countries) {
  const iso2 = f.properties.ISO_A2_EH;
  if (iso2 && iso2 !== '-99' && countryKind(f.properties) === 'country') a3ByIso2.set(iso2, f.properties.ADM0_A3);
}

function countryItem(f) {
  const p = f.properties;
  const kind = countryKind(p);
  if (!kind) return null;
  const id = countryId(p.ADM0_A3);
  const en = p.NAME_EN || p.NAME;
  const nl = p.NAME_NL || en;
  return {
    id,
    t: 'country',
    nl,
    en,
    a: aliases([p.NAME, p.NAME_LONG, p.ADMIN, p.NAME_ALT, p.BRK_NAME, p.FORMAL_EN, ...(EXTRA_ALIASES[id] ?? [])], [nl, en]),
    x: p.LABEL_X,
    y: p.LABEL_Y,
    terr: kind === 'territory' ? 1 : undefined,
  };
}

/* ───────────── provinces ───────────── */

function provinceItem(f) {
  const p = f.properties;
  const en = p.name_en || p.name;
  const nl = p.name_nl || en;
  return {
    id: 'p:' + p.adm1_code,
    t: 'province',
    nl,
    en,
    a: aliases([p.name, p.name_alt, p.name_local, p.gn_name, p.woe_name], [nl, en]),
    x: p.longitude,
    y: p.latitude,
    p: countryId(p.adm0_a3),
  };
}

/* ───────────── places ───────────── */

const SKIP_PLACE_CLASSES = new Set(['Scientific station', 'Meteorological Station', 'Historic place']);
const NE_CAPITAL_RANK = { 'Admin-1 capital': 3, 'Admin-1 region capital': 3, 'Admin-0 capital alt': 2, 'Admin-0 capital': 1 };
const GN_CAPITAL_RANK = { PPLA: 3, PPLG: 2, PPLC: 1 };

const nePlaces = src.places.filter((f) => !SKIP_PLACE_CLASSES.has(f.properties.FEATURECLA));
const neCapitalOf = new Map(); // NE_ID → country id
{
  const byCountry = new Map();
  for (const f of nePlaces) {
    const p = f.properties;
    if (p.FEATURECLA !== 'Admin-0 capital') continue;
    const list = byCountry.get(p.ADM0_A3) ?? [];
    list.push(p);
    byCountry.set(p.ADM0_A3, list);
  }
  for (const [a3, list] of byCountry) {
    const primary = list.find((p) => p.NAME === PRIMARY_CAPITAL[a3]) ?? list.sort((a, b) => b.POP_MAX - a.POP_MAX)[0];
    neCapitalOf.set(primary.NE_ID, countryId(a3));
  }
}

function neCityItem(f) {
  const p = f.properties;
  const en = p.NAME_EN || p.NAME;
  const nl = p.NAME_NL || en;
  return {
    id: p.GEONAMESID > 0 ? `t:${p.GEONAMESID}` : `t:ne${p.NE_ID}`,
    t: 'city',
    nl,
    en,
    a: aliases([p.NAME, p.NAMEASCII, p.NAMEALT, p.NAMEPAR, p.LS_NAME], [nl, en]),
    x: f.geometry.coordinates[0],
    y: f.geometry.coordinates[1],
    pop: p.POP_MAX > 0 ? p.POP_MAX : undefined,
    p: countryId(p.ADM0_A3),
    cap: neCapitalOf.get(p.NE_ID),
    _rank: NE_CAPITAL_RANK[p.FEATURECLA] ?? 0,
    _classes: [p.FEATURECLA],
    _gid: p.GEONAMESID > 0 ? p.GEONAMESID : undefined,
  };
}

function gnCityItem(g) {
  return {
    id: `t:${g.gid}`,
    t: 'city',
    nl: g.name,
    en: g.name,
    a: aliases(g.alt, [g.name], g.pop >= 50_000 ? 8 : 3),
    x: g.lon,
    y: g.lat,
    pop: g.pop || undefined,
    p: a3ByIso2.has(g.cc) ? countryId(a3ByIso2.get(g.cc)) : undefined,
    _rank: GN_CAPITAL_RANK[g.code] ?? 0,
    _classes: [g.code],
    _gid: g.gid,
  };
}

// Merges Natural Earth places with GeoNames places, preferring Natural Earth's names
// (which include proper Dutch exonyms) and adding GeoNames' alternative names.
function mergeCities(neItems, gnList) {
  const byGid = new Map(neItems.filter((c) => c._gid).map((c) => [c._gid, c]));
  const byName = new Map();
  for (const c of neItems) for (const n of [c.nl, c.en]) byName.set(normalize(n), c);
  const out = [...neItems];
  for (const g of gnList) {
    let match = byGid.get(g.gid);
    if (!match) {
      const same = byName.get(normalize(g.name));
      if (same && kmBetween([same.x, same.y], [g.lon, g.lat]) < 15) match = same;
    }
    if (match) {
      match.a = aliases([...match.a, g.name, ...g.alt], [match.nl, match.en]);
      match._rank = Math.max(match._rank, GN_CAPITAL_RANK[g.code] ?? 0);
      match._classes.push(g.code);
      if (g.pop > (match.pop ?? 0)) match.pop = g.pop;
      continue;
    }
    out.push(gnCityItem(g));
  }
  return out;
}

/* ───────────── rivers, lakes, seas, landscape regions ───────────── */

// Whether a feature of this rank belongs in the pack: in or near the view (`frame`) up to
// `maxRank`, or anywhere in the clip frame up to `bgRank`.
const inPack = (f, frame, clip, maxRank, bgRank) => {
  const rank = f.properties.scalerank ?? 99;
  return (rank <= maxRank && intersects(f.bbox, frame)) || (rank <= bgRank && intersects(f.bbox, clip));
};

function riverFeatures(limits, frame, clip) {
  const pick = (list, maxRank, bgRank, europe) =>
    list
      .filter((f) => f.properties.name && f.properties.featurecla !== 'Lake Centerline')
      .filter((f) => inPack(f, frame, clip, maxRank, bgRank))
      .map((f) => ({ f, europe }));
  const segments = [...pick(src.rivers, limits.river, limits.bgRiver, false), ...pick(src.riversEurope, limits.riverEurope, -1, true)];

  // Group segments with the same name, then split groups into connected pieces so that
  // two different rivers that happen to share a name become separate items.
  const groups = new Map();
  for (const s of segments) {
    const p = s.f.properties;
    const key = slug(p.name_en || p.name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  const out = [];
  for (const [key, segs] of groups) {
    const parent = segs.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const ends = segs.map(({ f }) => {
      const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
      return lines.flatMap((l) => [l[0], l[l.length - 1]]);
    });
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        if (ends[i].some((a) => ends[j].some((b) => kmBetween(a, b) < 5))) parent[find(i)] = find(j);
      }
    }
    const pieces = new Map();
    segs.forEach((s, i) => {
      const root = find(i);
      if (!pieces.has(root)) pieces.set(root, []);
      pieces.get(root).push(s);
    });
    // Short loose fragments (under 20 km) belong to the main river of that name.
    const lengthKm = (piece) =>
      piece.reduce((sum, { f }) => {
        const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
        return sum + lines.reduce((t, l) => t + l.slice(1).reduce((u, pt, i) => u + kmBetween(l[i], pt), 0), 0);
      }, 0);
    let sorted = [...pieces.values()].map((piece) => ({ piece, km: lengthKm(piece) })).sort((a, b) => b.km - a.km);
    if (sorted.length > 1) {
      const fragments = sorted.slice(1).filter((x) => x.km < 20);
      sorted[0].piece.push(...fragments.flatMap((x) => x.piece));
      sorted = sorted.filter((x) => !fragments.includes(x));
    }
    sorted.map((x) => x.piece).forEach((piece, n) => {
      const p = piece.find((s) => s.f.properties.name_nl)?.f.properties ?? piece[0].f.properties;
      const en = p.name_en || p.name;
      const nl = p.name_nl || RIVER_NAMES_NL[en] || RIVER_NAMES_NL[p.name] || p.name;
      const lines = piece.flatMap(({ f }) => (f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates));
      const rank = Math.min(...piece.map(({ f }) => f.properties.scalerank ?? 99));
      out.push({
        item: { id: `r:${key}${n ? '-' + n : ''}`, t: 'river', nl, en, a: aliases([p.name, p.name_alt], [nl, en]), rank },
        geometry: { type: 'MultiLineString', coordinates: lines },
      });
    });
  }
  return out;
}

function lakeFeatures(limits, frame, clip) {
  return [...src.lakes, ...src.lakesEurope]
    .filter((f) => f.properties.name && inPack(f, frame, clip, limits.lake, limits.bgLake))
    .map((f) => {
      const p = f.properties;
      const en = p.name_en || p.name;
      return {
        item: { id: `l:${p.ne_id}`, t: 'lake', nl: p.name_nl || en, en, a: aliases([p.name, p.name_alt], [p.name_nl, en]), rank: p.scalerank },
        geometry: f.geometry,
      };
    });
}

const SKIP_MARINE = new Set(['river', 'reef']);

function seaFeatures(limits, frame) {
  return src.marine
    .filter((f) => f.properties.name && !SKIP_MARINE.has(f.properties.featurecla))
    .filter((f) => (f.properties.scalerank ?? 99) <= limits.sea && intersects(f.bbox, frame))
    .map((f) => {
      const p = f.properties;
      const en = titleCase(p.name_en || p.name);
      return {
        item: { id: `s:${p.ne_id}`, t: 'sea', nl: p.name_nl || en, en, a: aliases([titleCase(p.name), p.namealt], [p.name_nl, en]) },
        geometry: f.geometry,
      };
    });
}

const REGION_TYPES = { 'Range/mtn': 'mountains', Island: 'island', 'Island group': 'island' };

function regionFeatures(limits, frame, withContinents) {
  return src.geoRegions
    .filter((f) => {
      const p = f.properties;
      if (p.FEATURECLA === 'Dragons-be-here') return false;
      if (p.FEATURECLA === 'Continent') return withContinents;
      return (p.SCALERANK ?? 99) <= limits.region && intersects(f.bbox, frame);
    })
    .map((f) => {
      const p = f.properties;
      const en = titleCase(p.NAME_EN || p.NAME);
      const nl = NAME_FIXES_NL[p.NAME] || p.NAME_NL || en;
      return {
        item: { id: `g:${p.NE_ID}`, t: REGION_TYPES[p.FEATURECLA] ?? 'region', nl, en, a: aliases([titleCase(p.NAME), p.NAMEALT], [nl, en]) },
        geometry: f.geometry,
      };
    });
}

/* ───────────── pack assembly ───────────── */

const fc = (features) => ({ type: 'FeatureCollection', features });
const feat = (id, geometry) => ({ type: 'Feature', properties: { id }, geometry });

// Drops polygon parts too small to see at the pack's scale, but always keeps the largest
// part so that small countries (Maldives, Nauru) don't disappear.
function pruneParts(geometry, minKm2) {
  const parts = polygonsOf(geometry);
  if (parts.length < 2) return geometry;
  const areas = parts.map((p) => partArea(p) * 111.2 ** 2);
  const largest = areas.indexOf(Math.max(...areas));
  const kept = parts.filter((_, i) => i === largest || areas[i] >= minKm2);
  return { type: 'MultiPolygon', coordinates: kept };
}

// Converts layers of features into one TopoJSON topology, clipped to the frame and
// simplified so that the detail matches the map scale. `detail` > 1 makes it coarser.
async function buildTopology(layers, clip, viewDiagKm, detail = 1) {
  const intervalM = Math.max(30, Math.round(((viewDiagKm * 1000) / 4000) * detail));
  const minPartKm2 = (intervalM * 5) ** 2 / 1e6;
  const inputs = {};
  const names = [];
  for (const [name, features] of Object.entries(layers)) {
    if (!features.length) continue;
    const pruned = features.map((f) => ({ ...f, geometry: pruneParts(f.geometry, minPartKm2) }));
    inputs[`${name}.json`] = fc(pruned);
    names.push(`${name}.json`);
  }
  if (!names.length) return { type: 'Topology', arcs: [], objects: {} };
  const clipDiagM = diagKm(clip) * 1000;
  const quantization = clamp(Math.round(clipDiagM / (intervalM * 0.5)), 1e4, 1e5);
  const cmd = [
    `-i ${names.join(' ')} combine-files`,
    `-clip bbox=${clip.join(',')} target=*`,
    ...['units', 'others', 'parts'].filter((n) => inputs[`${n}.json`]).map((n) => `-dissolve id target=${n}`),
    `-simplify interval=${intervalM} keep-shapes target=*`,
    `-o format=topojson quantization=${quantization} target=* out.json`,
  ].join(' ');
  const out = await mapshaper.applyCommands(cmd, inputs);
  const topo = JSON.parse(out['out.json']);
  for (const obj of Object.values(topo.objects)) {
    obj.geometries = obj.geometries.filter((g) => g.type && (g.arcs?.length ?? 0) > 0);
    for (const g of obj.geometries) {
      g.id = g.properties.id;
      delete g.properties;
    }
  }
  return topo;
}

async function buildPack({ id, kind, nl, en, view, units, others, unitItems, otherItems, cities, defaults, parts = [], extra = {} }) {
  const limits = LIMITS[kind];
  const clip = id === 'world' ? view : clipFrame(view);
  const viewDiag = diagKm(view);
  // Places that can be asked lie in or near the view; the rest of the clip frame is
  // background land only.
  const itemFrame = id === 'world' ? view : intersectBox(expandBox(view, 0.2), clip);

  const rivers = riverFeatures(limits, itemFrame, clip);
  const lakes = lakeFeatures(limits, itemFrame, clip);
  const seas = seaFeatures(limits, itemFrame);
  const regions = regionFeatures(limits, itemFrame, kind === 'world');

  // The base map (land, borders, lakes, rivers), the seas and the landscape regions are
  // separate topologies: seas and regions are only drawn when asked, so they can be
  // coarser, and keeping them apart avoids cutting coastlines into many small arcs.
  const topo = await buildTopology(
    {
      units: units.map((f) => feat(f.id, f.geometry)),
      others: others.map((f) => feat(f.id, f.geometry)),
      // Parts of countries (Vlaanderen, Schotland): only drawn when asked; sharing the
      // topology keeps their borders identical to the countries'.
      parts: parts.flatMap((p) => p.features.map((f) => feat(p.item.id, f.geometry))),
      lakes: lakes.map((x) => feat(x.item.id, x.geometry)),
      rivers: rivers.map((x) => feat(x.item.id, x.geometry)),
    },
    clip,
    viewDiag,
  );
  const seaTopo = await buildTopology({ seas: seas.map((x) => feat(x.item.id, x.geometry)) }, clip, viewDiag, 3);
  const regionTopo = await buildTopology({ regions: regions.map((x) => feat(x.item.id, x.geometry)) }, clip, viewDiag, 3);

  // Items with geometry are kept only if their geometry survived clipping; their label
  // point is recomputed from the clipped shape when the source one fell outside.
  const shapes = new Map();
  for (const t of [topo, seaTopo, regionTopo]) {
    for (const [name, obj] of Object.entries(t.objects)) {
      for (const f of topoFeature(t, obj).features) shapes.set(f.id, { layer: name, geometry: f.geometry });
    }
  }
  const items = [];
  const seen = new Set();
  const add = (item) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    items.push(item);
  };
  const withShape = (item) => {
    const shape = shapes.get(item.id);
    if (!shape) return null;
    if (item.t === 'river') [item.x, item.y] = lineMidpoint(shape.geometry);
    else if (item.x === undefined || !inBox([item.x, item.y], clip) || !geomContains(shape.geometry, [item.x, item.y])) {
      const pt = labelPoint(shape.geometry);
      if (pt) [item.x, item.y] = pt;
    }
    return item;
  };

  // Countries too small to survive at this scale (Vatican City on the Europe map) are
  // kept as point targets.
  const asPoint = (item) => (inBox([item.x, item.y], itemFrame) ? { ...item, pt: 1 } : null);
  for (const item of unitItems) {
    const kept = withShape(item) ?? asPoint(item);
    if (kept) add({ ...kept, d: defaults.has(item.id) ? 1 : undefined });
  }
  for (const c of cities) if (inBox([c.x, c.y], itemFrame)) add({ ...c, d: defaults.has(c.id) ? 1 : undefined });
  for (const x of [...parts, ...rivers, ...seas, ...lakes, ...regions]) if (withShape(x.item)) add(x.item);
  for (const item of otherItems) {
    const kept = withShape(item) ?? asPoint(item);
    if (kept) add(kept);
  }

  const pack = {
    v: PACK_VERSION,
    id,
    kind,
    nl,
    en,
    view,
    clip,
    diagKm: Math.round(viewDiag),
    ...extra,
    items: items.map(({ _rank, _gid, _classes, ...rest }) => compact(rest)),
    topo,
    seas: seaTopo,
    regions: regionTopo,
  };
  const json = JSON.stringify(pack);
  writeFileSync(join(OUT_DIR, `${id}.json`), json);
  const counts = {};
  for (const i of pack.items) counts[i.t] = (counts[i.t] ?? 0) + 1;
  console.log(
    `${id.padEnd(16)} ${(json.length / 1024).toFixed(0).padStart(5)} KB  default ${String(defaults.size).padStart(3)}  ` +
      Object.entries(counts)
        .map(([t, n]) => `${t} ${n}`)
        .join(', '),
  );
  return { id, kind, nl, en, ...extra };
}

/* ───────────── pack definitions ───────────── */

const isLand = (f) => f.properties.ADM0_A3 !== 'ATA';
const withId = (f, id) => ({ id, geometry: f.geometry, properties: f.properties, bbox: f.bbox });

async function worldPack() {
  const view = WORLD.view;
  const units = src.countries.filter(isLand).map((f) => withId(f, countryId(f.properties.ADM0_A3)));
  const unitItems = src.countries.map(countryItem).filter(Boolean);
  const cities = nePlaces
    .filter((f) => f.properties.SCALERANK <= LIMITS.world.foreignCityRank || neCapitalOf.has(f.properties.NE_ID))
    .map(neCityItem);
  const defaults = defaultCountriesAndCapitals(unitItems, cities);
  return buildPack({ id: 'world', kind: 'world', nl: WORLD.nl, en: WORLD.en, view, units, others: [], unitItems, otherItems: [], cities, defaults });
}

async function continentPack(cont) {
  const view = cont.view;
  const clip = clipFrame(view);
  const inContinent = (f) => continentOf(f.properties) === cont.ne && intersects(f.bbox, view);
  const units = src.countries.filter((f) => isLand(f) && inContinent(f)).map((f) => withId(f, countryId(f.properties.ADM0_A3)));
  const unitIds = new Set(units.map((u) => u.id));
  const others = src.countries
    .filter((f) => isLand(f) && !unitIds.has(countryId(f.properties.ADM0_A3)) && intersects(f.bbox, clip))
    .map((f) => withId(f, countryId(f.properties.ADM0_A3)));
  const unitItems = units.map((f) => countryItem(f)).filter(Boolean);
  const otherItems = others.map((f) => countryItem(f)).filter(Boolean);

  const ne = nePlaces
    .filter((f) => {
      const p = f.properties;
      const inUnits = unitIds.has(countryId(p.ADM0_A3));
      return inUnits ? inBox(f.geometry.coordinates, clip) : p.SCALERANK <= LIMITS.continent.foreignCityRank && inBox(f.geometry.coordinates, clip);
    })
    .map(neCityItem);
  const unitIso2 = new Set([...a3ByIso2].filter(([, a3]) => unitIds.has(countryId(a3))).map(([iso2]) => iso2));
  const gn = geonames
    .filter((g) => unitIso2.has(g.cc) && g.pop >= LIMITS.continent.geonamesPop && inBox([g.lon, g.lat], view))
    .sort((a, b) => b.pop - a.pop)
    .slice(0, MAX_GEONAMES_PER_PACK);
  const cities = mergeCities(ne, gn);
  const defaults = defaultCountriesAndCapitals(unitItems, cities);
  const parts = Object.keys(COUNTRY_PARTS)
    .filter((a3) => unitIds.has('c:' + a3))
    .flatMap((a3) => countryParts(a3, view));
  return buildPack({ id: cont.id, kind: 'continent', nl: cont.nl, en: cont.en, view, units, others, unitItems, otherItems, cities, defaults, parts });
}

function defaultCountriesAndCapitals(unitItems, cities) {
  const defaults = new Set();
  for (const item of unitItems) {
    if (item.terr || NOT_DEFAULT.has(item.id.slice(2))) continue;
    defaults.add(item.id);
  }
  for (const c of cities) if (c.cap && defaults.has(c.cap)) defaults.add(c.id);
  return defaults;
}

async function countryPack(a3) {
  const country = countryByA3.get(a3);
  const p = country.properties;
  const view = COUNTRY_VIEWS[a3] ?? mainTerritoryView([country]);
  const clip = clipFrame(view);
  const provinces = src.provinces.filter((f) => f.properties.adm0_a3 === a3 && intersects(f.bbox, view));
  const groupField = PROVINCE_GROUPING[a3];
  const groupId = (f) => `p:${a3}-${slug(f.properties[groupField])}`;
  // Grouped provinces share an id, so they are merged into one region when building the map.
  const units = provinces.map((f) => withId(f, groupField ? groupId(f) : 'p:' + f.properties.adm1_code));
  const others = src.countries
    .filter((f) => isLand(f) && f.properties.ADM0_A3 !== a3 && countryId(f.properties.ADM0_A3) !== 'c:' + a3 && intersects(f.bbox, clip))
    .map((f) => withId(f, countryId(f.properties.ADM0_A3)));
  const unitItems = groupField ? regionItems(provinces, groupField, groupId) : provinces.map(provinceItem);
  const otherItems = others.map((f) => countryItem(f)).filter(Boolean);

  const ne = nePlaces.filter((f) => inBox(f.geometry.coordinates, clip)).map(neCityItem);
  const gn = geonames
    .filter((g) => g.cc === p.ISO_A2_EH && g.pop >= LIMITS.country.geonamesPop && inBox([g.lon, g.lat], view))
    .sort((a, b) => b.pop - a.pop)
    .slice(0, MAX_GEONAMES_PER_PACK);
  const cities = mergeCities(ne, gn);

  // Link the country's cities to the province they lie in, and find province capitals.
  const best = new Map(); // province id → [rank, pop, city]
  for (const c of cities) {
    if (c.p && c.p !== 'c:' + a3) continue;
    const prov = units.find((u) => inBox([c.x, c.y], u.bbox) && geomContains(u.geometry, [c.x, c.y])) ?? nearestUnit(units, [c.x, c.y], 15);
    if (!prov) continue;
    c.p = prov.id;
    const rank = groupField ? regionCapitalRank(c) : c._rank;
    if (rank > 0) {
      const cur = best.get(prov.id);
      if (!cur || rank > cur[0] || (rank === cur[0] && (c.pop ?? 0) > cur[1])) best.set(prov.id, [rank, c.pop ?? 0, c]);
    }
  }
  const defaults = new Set(unitItems.map((i) => i.id));
  for (const [provId, [, , city]] of best) {
    if (!city.cap) city.cap = provId;
    else city.cap2 = provId; // national capital that is also a province capital
    defaults.add(city.id);
  }
  for (const c of cities) if (c.cap === 'c:' + a3) defaults.add(c.id);

  const en = p.NAME_EN || p.NAME;
  const parts = COUNTRY_PARTS[a3] && COUNTRY_PARTS[a3] !== groupField ? countryParts(a3, view) : [];
  return buildPack({
    id: a3,
    kind: 'country',
    nl: p.NAME_NL || en,
    en,
    view,
    units,
    others,
    unitItems,
    otherItems,
    cities,
    defaults,
    parts,
    extra: { continent: CONTINENTS.find((c) => c.ne === continentOf(p))?.id },
  });
}

// For coastal towns whose point lies just outside the simplified coastline.
function nearestUnit(units, pt, maxKm) {
  let best = null;
  let bestKm = maxKm;
  const k = Math.cos((pt[1] * Math.PI) / 180);
  for (const u of units) {
    if (!inBox(pt, [u.bbox[0] - 0.3, u.bbox[1] - 0.3, u.bbox[2] + 0.3, u.bbox[3] + 0.3])) continue;
    for (const rings of polygonsOf(u.geometry)) {
      for (const ring of rings) {
        for (let i = 1; i < ring.length; i++) {
          const d = segmentDistance(pt, ring[i - 1], ring[i], k) * 111.2;
          if (d < bestKm) [best, bestKm] = [u, d];
        }
      }
    }
  }
  return best;
}

// Items for provinces merged into regions; their label point is computed from the
// merged shape.
function regionItems(provinces, field, groupId) {
  const items = new Map();
  for (const f of provinces) {
    const id = groupId(f);
    if (items.has(id)) continue;
    const local = f.properties[field];
    const [nl, en] = REGION_NAMES[local] ?? [local, local];
    const a3 = f.properties.adm0_a3;
    items.set(id, { id, t: GROUP_TYPE[a3] ?? 'province', nl, en, a: aliases([local], [nl, en]), p: countryId(a3) });
  }
  return [...items.values()];
}

// Parts of a country (Vlaanderen, Wallonië; England, Scotland, …) made of its provinces.
function countryParts(a3, view) {
  const field = COUNTRY_PARTS[a3];
  const provinces = src.provinces.filter((f) => f.properties.adm0_a3 === a3 && intersects(f.bbox, view));
  const groupId = (f) => `p:${a3}-${slug(f.properties[field])}`;
  return regionItems(provinces, field, groupId).map((item) => ({
    item: { ...item, t: 'part' },
    features: provinces.filter((f) => groupId(f) === item.id),
  }));
}

// For merged regions, the department/province capitals don't count: only regional
// capitals, or the national capital when it lies in the region.
function regionCapitalRank(c) {
  if (c._classes.some((k) => k === 'PPLA' || k === 'Admin-1 region capital')) return 3;
  if (c._classes.some((k) => k === 'PPLC' || k === 'Admin-0 capital')) return 2;
  return 0;
}

/* ───────────── main ───────────── */

const countryCodes = src.countries
  .filter((f) => countryKind(f.properties) === 'country')
  .map((f) => f.properties.ADM0_A3)
  .filter((a3) => src.provinces.filter((f) => f.properties.adm0_a3 === a3).length >= 3)
  .sort();

const wanted = new Set(process.argv.slice(2));
const want = (id) => !wanted.size || wanted.has(id);

mkdirSync(OUT_DIR, { recursive: true });
const index = [];
const indexFile = join(OUT_DIR, 'index.json');
const previous = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, 'utf8')).packs : [];
const keep = (id) => previous.find((e) => e.id === id);

console.time('build');
if (want('world')) index.push(await worldPack());
else if (keep('world')) index.push(keep('world'));
for (const cont of CONTINENTS) {
  if (want(cont.id)) index.push(await continentPack(cont));
  else if (keep(cont.id)) index.push(keep(cont.id));
}
for (const a3 of countryCodes) {
  if (want(a3)) {
    try {
      index.push(await countryPack(a3));
    } catch (err) {
      console.error(`✗ ${a3}: ${err.message}`);
    }
  } else if (keep(a3)) index.push(keep(a3));
}
console.timeEnd('build');

writeFileSync(
  indexFile,
  JSON.stringify({
    v: PACK_VERSION,
    attribution: 'Natural Earth (public domain) · GeoNames (CC BY 4.0)',
    packs: index,
  }),
);
console.log(`index: ${index.length} packs`);
