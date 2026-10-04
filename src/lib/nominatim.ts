// Looking up places that are not in the map data, with OpenStreetMap's Nominatim.
// Only used while editing a list, at most one request per second (Nominatim usage policy).
import type { Geometry, Position } from 'geojson';
import type { ItemType, Lang } from './types';

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const MAX_POINTS = 1500;

export interface OnlinePlace {
  name: string;
  /** Longer description, e.g. "Texel, Noord-Holland, Nederland". */
  label: string;
  type: ItemType;
  lon: number;
  lat: number;
  geo?: Geometry;
}

interface NominatimResult {
  lat: string;
  lon: string;
  name: string;
  display_name: string;
  category: string;
  type: string;
  addresstype?: string;
  geojson?: Geometry;
}

let lastRequest = 0;

export async function searchOnline(query: string, view: [number, number, number, number], lang: Lang): Promise<OnlinePlace[]> {
  const wait = lastRequest + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequest = Date.now();
  const [w, s, e, n] = view;
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: '6',
    'accept-language': lang,
    polygon_geojson: '1',
    polygon_threshold: String(Math.max(e - w, n - s) / 2000),
    viewbox: `${w},${n},${e},${s}`,
    bounded: '1',
  });
  const res = await fetch(`${ENDPOINT}?${params}`);
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const results = (await res.json()) as NominatimResult[];
  return results.map(toPlace);
}

export function placeType(category: string, type: string, addresstype = ''): ItemType {
  if (category === 'waterway') return 'river';
  if (category === 'water') return type === 'river' ? 'river' : 'lake';
  if (category === 'place') {
    if (['island', 'islet', 'archipelago'].includes(type)) return 'island';
    if (type === 'sea' || type === 'ocean') return 'sea';
    if (['state', 'province'].includes(type)) return 'province';
    if (['region', 'county', 'locality'].includes(type)) return 'region';
    return 'city';
  }
  if (category === 'natural') {
    if (['water', 'lake', 'reservoir'].includes(type)) return 'lake';
    if (['bay', 'strait', 'sea', 'coastline', 'shoal'].includes(type)) return 'sea';
    if (['peak', 'volcano', 'mountain_range', 'ridge', 'hill'].includes(type)) return 'mountains';
    if (type === 'island') return 'island';
    return 'region';
  }
  if (category === 'boundary') {
    if (['city', 'town', 'village', 'municipality', 'hamlet'].includes(addresstype)) return 'city';
    if (['state', 'province'].includes(addresstype)) return 'province';
    return 'region';
  }
  return 'region';
}

function toPlace(r: NominatimResult): OnlinePlace {
  const type = placeType(r.category, r.type, r.addresstype);
  const g = r.geojson;
  let geo: Geometry | undefined;
  // Cities are dots, as on a school map. Areas and rivers keep their shape.
  if (type !== 'city' && g) {
    if ((g.type === 'Polygon' || g.type === 'MultiPolygon') && type !== 'river') geo = rewind(simplifyGeometry(g));
    else if ((g.type === 'LineString' || g.type === 'MultiLineString') && type === 'river') geo = simplifyGeometry(g);
  }
  return { name: r.name || r.display_name.split(',')[0], label: r.display_name, type, lon: +r.lon, lat: +r.lat, geo };
}

/* ───── geometry clean-up ───── */

const round = (p: Position): Position => [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4];

function countPoints(g: Geometry): number {
  switch (g.type) {
    case 'LineString':
      return g.coordinates.length;
    case 'MultiLineString':
    case 'Polygon':
      return g.coordinates.reduce((n, l) => n + l.length, 0);
    case 'MultiPolygon':
      return g.coordinates.reduce((n, p) => n + p.reduce((m, l) => m + l.length, 0), 0);
    default:
      return 1;
  }
}

/** Douglas–Peucker on lon/lat, enough to keep stored shapes small. */
function simplifyLine(line: Position[], tolerance: number): Position[] {
  if (line.length <= 4) return line.map(round);
  const keep = new Uint8Array(line.length);
  keep[0] = keep[line.length - 1] = 1;
  const stack: [number, number][] = [[0, line.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    const [ax, ay] = line[a];
    const [bx, by] = line[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = line[i];
      const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
      const d = Math.hypot(px - ax - t * dx, py - ay - t * dy);
      if (d > maxD) [maxD, idx] = [d, i];
    }
    if (idx >= 0 && maxD > tolerance) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return line.filter((_, i) => keep[i]).map(round);
}

export function simplifyGeometry(g: Geometry): Geometry {
  let tolerance = 0;
  let out = g;
  while (countPoints(out) > MAX_POINTS) {
    tolerance = tolerance ? tolerance * 2 : 0.0005;
    out = mapLines(g, (l) => simplifyLine(l, tolerance));
  }
  return tolerance ? out : mapLines(g, (l) => l.map(round));
}

function mapLines(g: Geometry, fn: (l: Position[]) => Position[]): Geometry {
  switch (g.type) {
    case 'LineString':
      return { type: 'LineString', coordinates: fn(g.coordinates) };
    case 'MultiLineString':
      return { type: 'MultiLineString', coordinates: g.coordinates.map(fn) };
    case 'Polygon':
      return { type: 'Polygon', coordinates: g.coordinates.map(fn) };
    case 'MultiPolygon':
      return { type: 'MultiPolygon', coordinates: g.coordinates.map((p) => p.map(fn)) };
    default:
      return g;
  }
}

/** Positive for clockwise rings (with north up). */
function clockwiseArea(ring: Position[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[i][0] - ring[j][0]) * (ring[i][1] + ring[j][1]);
  return a / 2;
}

/**
 * GeoJSON from OpenStreetMap has counter-clockwise outer rings; the map drawing (d3)
 * needs clockwise ones, or it fills the whole world except the shape.
 */
export function rewind(g: Geometry): Geometry {
  const fix = (rings: Position[][]) =>
    rings.map((ring, i) => {
      const clockwise = clockwiseArea(ring) > 0;
      return (i === 0) === clockwise ? ring : [...ring].reverse();
    });
  if (g.type === 'Polygon') return { type: 'Polygon', coordinates: fix(g.coordinates) };
  if (g.type === 'MultiPolygon') return { type: 'MultiPolygon', coordinates: g.coordinates.map(fix) };
  return g;
}
