import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const CACHE_DIR = join(here, 'cache');
export const OUT_DIR = join(here, '..', 'public', 'packs');

// Natural Earth (public domain), from the natural-earth-vector GitHub mirror.
export const NE_BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';
export const LAYERS = {
  countries: 'ne_10m_admin_0_countries_lakes.geojson',
  provinces: 'ne_10m_admin_1_states_provinces_lakes.geojson',
  places: 'ne_10m_populated_places.geojson',
  rivers: 'ne_10m_rivers_lake_centerlines.geojson',
  riversEurope: 'ne_10m_rivers_europe.geojson',
  lakes: 'ne_10m_lakes.geojson',
  lakesEurope: 'ne_10m_lakes_europe.geojson',
  marine: 'ne_10m_geography_marine_polys.geojson',
  geoRegions: 'ne_10m_geography_regions_polys.geojson',
};

// GeoNames (CC BY 4.0): towns with at least 1,000 inhabitants, for places Natural Earth lacks.
export const GEONAMES_BASE = 'https://download.geonames.org/export/dump/';
export const GEONAMES = {
  cities: 'cities1000.zip',
};
