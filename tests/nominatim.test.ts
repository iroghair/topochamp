import { geoArea } from 'd3-geo';
import type { Polygon } from 'geojson';
import { describe, expect, it } from 'vitest';
import { placeType, rewind, simplifyGeometry } from '../src/lib/nominatim';

describe('shapes from OpenStreetMap', () => {
  // Texel-sized square, counter-clockwise as in RFC 7946 GeoJSON.
  const ccw: Polygon = {
    type: 'Polygon',
    coordinates: [
      [
        [4.7, 53.0],
        [4.9, 53.0],
        [4.9, 53.2],
        [4.7, 53.2],
        [4.7, 53.0],
      ],
    ],
  };

  it('turns outer rings around for d3, so only the shape is filled', () => {
    expect(geoArea(ccw)).toBeGreaterThan(12); // d3 reads it as "the world minus the square"
    expect(geoArea(rewind(ccw))).toBeLessThan(0.001);
    expect(geoArea(rewind(rewind(ccw)))).toBeLessThan(0.001); // already right: unchanged
  });

  it('simplifies big shapes', () => {
    const ring = Array.from({ length: 5001 }, (_, i) => {
      const a = (i / 5000) * 2 * Math.PI;
      return [5 + Math.cos(a) * (1 + 0.001 * Math.sin(a * 200)), 52 + Math.sin(a)];
    });
    const out = simplifyGeometry({ type: 'Polygon', coordinates: [ring] }) as Polygon;
    expect(out.coordinates[0].length).toBeLessThanOrEqual(1500);
    expect(out.coordinates[0].length).toBeGreaterThan(20);
  });

  it('maps OpenStreetMap categories to place types', () => {
    expect(placeType('place', 'island')).toBe('island');
    expect(placeType('place', 'village')).toBe('city');
    expect(placeType('waterway', 'river')).toBe('river');
    expect(placeType('natural', 'water')).toBe('lake');
    expect(placeType('natural', 'strait')).toBe('sea');
    expect(placeType('boundary', 'administrative', 'municipality')).toBe('city');
    expect(placeType('natural', 'heath')).toBe('region');
  });
});
