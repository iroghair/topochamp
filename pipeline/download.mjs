// Downloads the source data used to build map packs into pipeline/cache/.
// Natural Earth is public domain; GeoNames is CC BY 4.0.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE_DIR, GEONAMES, GEONAMES_BASE, LAYERS, NE_BASE } from './config.mjs';

mkdirSync(CACHE_DIR, { recursive: true });

const sources = [
  ...Object.values(LAYERS).map((file) => [NE_BASE + file, file]),
  ...Object.values(GEONAMES).map((file) => [GEONAMES_BASE + file, file]),
];

for (const [url, file] of sources) {
  const target = join(CACHE_DIR, file);
  if (existsSync(target)) {
    console.log(`✓ ${file} (cached)`);
    continue;
  }
  process.stdout.write(`↓ ${file} … `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed for ${file}: ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(target, buf);
  console.log(`${(buf.length / 1e6).toFixed(1)} MB`);
}
