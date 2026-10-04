// Geometry for scoring: containment and distances in km, on lon/lat coordinates.
import type { Geometry, Position } from 'geojson';
import type { LonLat } from './types';

const EARTH_RADIUS_KM = 6371;
const KM_PER_DEGREE = 111.195;
const RAD = Math.PI / 180;

export function haversineKm([lon1, lat1]: LonLat, [lon2, lat2]: LonLat): number {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

const wrapLon = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/** Local flat coordinates (km) around an origin; accurate enough for scoring. */
function toLocal([lon, lat]: Position, [lon0, lat0]: LonLat, k: number): [number, number] {
  return [wrapLon(lon - lon0) * k * KM_PER_DEGREE, (lat - lat0) * KM_PER_DEGREE];
}

function polygonsOf(geom: Geometry): Position[][][] {
  if (geom.type === 'Polygon') return [geom.coordinates];
  if (geom.type === 'MultiPolygon') return geom.coordinates;
  if (geom.type === 'GeometryCollection') return geom.geometries.flatMap(polygonsOf);
  return [];
}

function linesOf(geom: Geometry): Position[][] {
  switch (geom.type) {
    case 'LineString':
      return [geom.coordinates];
    case 'MultiLineString':
      return geom.coordinates;
    case 'Polygon':
      return geom.coordinates;
    case 'MultiPolygon':
      return geom.coordinates.flat();
    case 'GeometryCollection':
      return geom.geometries.flatMap(linesOf);
    default:
      return [];
  }
}

function ringContains(ring: Position[], [x, y]: LonLat): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Whether the point lies inside the area (even-odd rule, so ring direction doesn't matter). */
export function contains(geom: Geometry, pt: LonLat): boolean {
  return polygonsOf(geom).some((rings) => ringContains(rings[0], pt) && !rings.slice(1).some((h) => ringContains(h, pt)));
}

export interface Nearest {
  km: number;
  point: LonLat;
}

/** Closest point on the outline of an area, or on a line, with its distance in km. */
export function nearestOnLines(geom: Geometry, pt: LonLat): Nearest {
  const k = Math.cos(pt[1] * RAD);
  let best: Nearest = { km: Infinity, point: pt };
  for (const line of linesOf(geom)) {
    let prev = toLocal(line[0], pt, k);
    if (line.length === 1 && Math.hypot(...prev) < best.km) best = { km: Math.hypot(...prev), point: line[0] as LonLat };
    for (let i = 1; i < line.length; i++) {
      const cur = toLocal(line[i], pt, k);
      const dx = cur[0] - prev[0];
      const dy = cur[1] - prev[1];
      const len = dx * dx + dy * dy;
      const t = len ? Math.max(0, Math.min(1, -(prev[0] * dx + prev[1] * dy) / len)) : 0;
      const x = prev[0] + t * dx;
      const y = prev[1] + t * dy;
      const d = Math.hypot(x, y);
      if (d < best.km) {
        const [lon0, lat0] = line[i - 1];
        const [lon1, lat1] = line[i];
        best = { km: d, point: [lon0 + t * wrapLon(lon1 - lon0), lat0 + t * (lat1 - lat0)] };
      }
      prev = cur;
    }
  }
  return best;
}

export function bboxOf(geom: Geometry): [number, number, number, number] {
  const b: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const line of linesOf(geom)) {
    for (const [x, y] of line) {
      if (x < b[0]) b[0] = x;
      if (y < b[1]) b[1] = y;
      if (x > b[2]) b[2] = x;
      if (y > b[3]) b[3] = y;
    }
  }
  return b;
}

export const inBox = ([x, y]: LonLat, b: [number, number, number, number], margin = 0): boolean =>
  x >= b[0] - margin && x <= b[2] + margin && y >= b[1] - margin && y <= b[3] + margin;
