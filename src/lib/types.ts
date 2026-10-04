import type { Topology } from 'topojson-specification';
import type { Feature, Geometry } from 'geojson';

export type Lang = 'nl' | 'en';

/** 'part' is a part of a country, such as Vlaanderen or Schotland. */
export type ItemType = 'country' | 'part' | 'province' | 'city' | 'river' | 'sea' | 'lake' | 'mountains' | 'island' | 'region';

/** A place that can be asked, as stored in a map pack. */
export interface Item {
  id: string;
  t: ItemType;
  nl: string;
  /** English name; missing when equal to the Dutch name. */
  en?: string;
  /** Alternative names accepted when typing or matching a pasted list. */
  a?: string[];
  /** Label point (lon/lat): a city's position, or a point inside an area. */
  x: number;
  y: number;
  pop?: number;
  /** Parent item id (the province or country it lies in). */
  p?: string;
  /** Capital of this country or province. */
  cap?: string;
  cap2?: string;
  /** Part of the default learning list. */
  d?: 1;
  /** Dependency or similar territory rather than a sovereign state. */
  terr?: 1;
  /** An area that is too small to draw at this scale; treated as a point. */
  pt?: 1;
  /** River importance (Natural Earth scale rank; lower is bigger). */
  rank?: number;
  /** Custom places only: where the place came from, and its shape if it has one. */
  src?: 'osm' | 'manual';
  geo?: Geometry;
}

export type PackKind = 'world' | 'continent' | 'country';

/** A map pack as stored in public/packs/<id>.json. */
export interface PackFile {
  v: number;
  id: string;
  kind: PackKind;
  nl: string;
  en: string;
  /** The part of the world the map is fitted to: [west, south, east, north]. */
  view: [number, number, number, number];
  /** The area the data was cut to. */
  clip: [number, number, number, number];
  /** Diagonal of the view in km; the yardstick for distance scoring. */
  diagKm: number;
  continent?: string;
  items: Item[];
  topo: Topology;
  seas: Topology;
  regions: Topology;
}

export interface PackIndexEntry {
  id: string;
  kind: PackKind;
  nl: string;
  en: string;
  continent?: string;
}

export interface PackIndex {
  v: number;
  attribution: string;
  packs: PackIndexEntry[];
}

export type Layer = 'units' | 'others' | 'parts' | 'lakes' | 'rivers' | 'seas' | 'regions';

export interface Shape {
  layer: Layer;
  feature: Feature<Geometry>;
  bbox: [number, number, number, number];
}

export type Level = 'easy' | 'middle' | 'hard';

/** "Where is it?" (click) or one of the "What is this?" variants. */
export type QuestionKind = 'where' | 'choice4' | 'choice8' | 'type';

export type Direction = 'where' | 'what';

export const directionOf = (kind: QuestionKind): Direction => (kind === 'where' ? 'where' : 'what');

export type SessionType = 'practice' | 'test';

export type LonLat = [number, number];
