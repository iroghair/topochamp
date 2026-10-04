// Map projections fitted to a pack's view.
import { geoConicConformal, geoNaturalEarth1, type GeoProjection } from 'd3-geo';
import type { Geometry, MultiPoint, Polygon } from 'geojson';
import type { PackFile } from './types';

type Box = [number, number, number, number];

/** Points along the edges of a lon/lat box, so curved edges are fitted correctly. */
function edgePoints([w, s, e, n]: Box, steps = 24): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const x = w + ((e - w) * i) / steps;
    const y = s + ((n - s) * i) / steps;
    pts.push([x, s], [x, n], [w, y], [e, y]);
  }
  return pts;
}

export function makeProjection(file: PackFile, width: number, height: number, padding = 12): GeoProjection {
  const [w, s, e, n] = file.view;
  const projection =
    file.kind === 'world'
      ? geoNaturalEarth1()
      : geoConicConformal()
          .parallels([s + (n - s) / 6, n - (n - s) / 6])
          .rotate([-(w + e) / 2, 0]);
  const target: MultiPoint = { type: 'MultiPoint', coordinates: edgePoints(file.view) };
  return projection.fitExtent(
    [
      [padding, padding],
      [Math.max(padding + 1, width - padding), Math.max(padding + 1, height - padding)],
    ],
    target,
  );
}

/** The area the map data covers, drawn as sea; outside it is the page background. */
export function frameShape(file: PackFile): Geometry | { type: 'Sphere' } {
  if (file.kind === 'world') return { type: 'Sphere' };
  const [w, s, e, n] = file.clip;
  const ring: [number, number][] = [];
  const steps = 32;
  // Clockwise (d3's convention for the inside of a spherical polygon).
  for (let i = 0; i <= steps; i++) ring.push([w, s + ((n - s) * i) / steps]);
  for (let i = 1; i <= steps; i++) ring.push([w + ((e - w) * i) / steps, n]);
  for (let i = 1; i <= steps; i++) ring.push([e, n - ((n - s) * i) / steps]);
  for (let i = 1; i <= steps; i++) ring.push([e - ((e - w) * i) / steps, s]);
  const polygon: Polygon = { type: 'Polygon', coordinates: [ring] };
  return polygon;
}

export function maxZoom(file: PackFile): number {
  return file.kind === 'country' ? 5 : 8;
}
