// Loading map packs and turning them into ready-to-use shapes.
import { feature, mesh, neighbors } from 'topojson-client';
import type { Feature, Geometry, MultiLineString } from 'geojson';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { bboxOf } from './geo';
import type { Item, Layer, PackFile, PackIndex, Shape } from './types';

export interface LoadedPack {
  file: PackFile;
  items: Map<string, Item>;
  shapes: Map<string, Shape>;
  layers: Record<Layer, Feature<Geometry>[]>;
  /** Borders between the region's units (countries or provinces). */
  innerBorders: MultiLineString;
  /** Outline of the region: coastlines plus the border with the rest of the world. */
  outline: MultiLineString;
  /** Colour number (0 … TONES-1) per unit, different for neighbours. */
  unitTones: Map<string, number>;
}

/** Number of light tones used to colour the units (see --map-tone-* in app.css). */
export const TONES = 6;

const base = import.meta.env.BASE_URL;
const cache = new Map<string, Promise<LoadedPack>>();
let indexPromise: Promise<PackIndex> | null = null;

export function loadIndex(): Promise<PackIndex> {
  indexPromise ??= fetch(`${base}packs/index.json`).then((r) => {
    if (!r.ok) throw new Error(`Could not load the list of maps (${r.status})`);
    return r.json();
  });
  return indexPromise;
}

export function loadPack(id: string): Promise<LoadedPack> {
  let p = cache.get(id);
  if (!p) {
    p = fetch(`${base}packs/${id}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`Could not load map "${id}" (${r.status})`);
        return r.json() as Promise<PackFile>;
      })
      .then(preparePack);
    p.catch(() => cache.delete(id));
    cache.set(id, p);
  }
  return p;
}

export function preparePack(file: PackFile): LoadedPack {
  const layers: Record<Layer, Feature<Geometry>[]> = { units: [], others: [], parts: [], lakes: [], rivers: [], seas: [], regions: [] };
  const shapes = new Map<string, Shape>();
  const read = (topo: Topology, name: Layer) => {
    const obj = topo.objects[name] as GeometryCollection | undefined;
    if (!obj) return;
    const fc = feature(topo, obj) as unknown as { features: Feature<Geometry>[] };
    for (const f of fc.features) {
      if (!f.geometry) continue;
      layers[name].push(f);
      shapes.set(String(f.id), { layer: name, feature: f, bbox: bboxOf(f.geometry) });
    }
  };
  for (const name of ['units', 'others', 'parts', 'lakes', 'rivers'] as const) read(file.topo, name);
  read(file.seas, 'seas');
  read(file.regions, 'regions');

  const units = file.topo.objects.units as GeometryCollection | undefined;
  const empty: MultiLineString = { type: 'MultiLineString', coordinates: [] };
  return {
    file,
    items: new Map(file.items.map((i) => [i.id, i])),
    shapes,
    layers,
    innerBorders: units ? mesh(file.topo, units, (a, b) => a !== b) : empty,
    outline: units ? dropFrameEdges(mesh(file.topo, units, (a, b) => a === b), file.clip) : empty,
    unitTones: units ? toneUnits(units) : new Map(),
  };
}

/**
 * Gives each unit a tone so that neighbours (sharing a border) never have the same one:
 * the units with the most neighbours first, each taking the least used free tone.
 */
function toneUnits(units: GeometryCollection): Map<string, number> {
  const geoms = units.geometries;
  const nb = neighbors(geoms);
  const order = geoms.map((_, i) => i).sort((a, b) => nb[b].length - nb[a].length || a - b);
  const tone = new Array<number>(geoms.length).fill(-1);
  const used = new Array<number>(TONES).fill(0);
  for (const i of order) {
    const taken = new Set(nb[i].map((j) => tone[j]));
    let best = -1;
    for (let t = 0; t < TONES; t++) if (!taken.has(t) && (best < 0 || used[t] < used[best])) best = t;
    tone[i] = best >= 0 ? best : i % TONES;
    used[tone[i]]++;
  }
  return new Map(geoms.map((g, i) => [String(g.id), tone[i]]));
}

/** Removes the straight cuts along the edge of the data, which are not real coastlines. */
function dropFrameEdges(lines: MultiLineString, [w, s, e, n]: PackFile['clip']): MultiLineString {
  const eps = Math.max(e - w, n - s) * 1e-4;
  const near = (a: number, b: number) => Math.abs(a - b) < eps;
  const sameEdge = ([x1, y1]: number[], [x2, y2]: number[]) =>
    (near(x1, w) && near(x2, w)) || (near(x1, e) && near(x2, e)) || (near(y1, s) && near(y2, s)) || (near(y1, n) && near(y2, n));
  const out: number[][][] = [];
  for (const line of lines.coordinates) {
    let run: number[][] = [line[0]];
    for (let i = 1; i < line.length; i++) {
      if (sameEdge(line[i - 1], line[i])) {
        if (run.length > 1) out.push(run);
        run = [line[i]];
      } else run.push(line[i]);
    }
    if (run.length > 1) out.push(run);
  }
  return { type: 'MultiLineString', coordinates: out };
}

/**
 * Adds custom places from a learning list (looked up online or placed by hand) to a
 * loaded pack, with their shape when they have one.
 */
export function addCustomItems(pack: LoadedPack, items: Item[]): void {
  for (const item of items) {
    pack.items.set(item.id, item);
    if (!item.geo || pack.shapes.has(item.id)) continue;
    const layer: Layer = item.t === 'river' ? 'rivers' : item.t === 'lake' ? 'lakes' : item.t === 'sea' ? 'seas' : 'regions';
    const feature: Feature<Geometry> = { type: 'Feature', id: item.id, properties: {}, geometry: item.geo };
    pack.layers[layer].push(feature);
    pack.shapes.set(item.id, { layer, feature, bbox: bboxOf(item.geo) });
  }
}

/** Items that are part of the default learning list for this pack. */
export const defaultItemIds = (pack: LoadedPack): string[] => pack.file.items.filter((i) => i.d).map((i) => i.id);
