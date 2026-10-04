# TopoChamp

A browser game for practising school topography: pick a region and the list of places
from the school sheet, then answer "Where is it?" (click on the map) and "What is this?"
(choose or type the name). Places answered wrong come back more often.

The game rules and the development plan are in [PLAN.md](PLAN.md).

## Running it

You need [Node.js](https://nodejs.org/) 20 or newer.

```sh
npm install
npm run dev        # http://localhost:5173
```

The map packs in `public/packs/` are already built, so the game works straight away.

## Building the map data

The map packs are made from open data by the scripts in `pipeline/`:

```sh
npm run data:download          # downloads Natural Earth and GeoNames (~120 MB) into pipeline/cache/
npm run data:build             # builds all packs (a few minutes)
npm run data:build -- NLD europe world   # or only some packs
```

Hand-maintained corrections (Dutch river names, capitals, map views for countries the
automatic detection gets wrong, …) are in `pipeline/tables.mjs`.

## Checks

```sh
npm test           # unit tests (scoring, repetition, name matching, …)
npm run test:e2e   # plays a round in a real browser (Playwright)
npm run check      # type check
```

## Publishing

`npm run build` creates a static site in `dist/` that works from any web host or folder
(all paths are relative). It works offline after the first visit and can be installed
on a tablet's home screen.

For GitHub Pages: push the repository to GitHub, then under *Settings → Pages* choose
*GitHub Actions* as the source. The workflow in `.github/workflows/deploy.yml` builds and
publishes the site on every push to `main`.

## Project structure

```
pipeline/            download + build scripts for the map packs
public/packs/        generated map packs (one JSON file per region) and index.json
src/lib/             game logic: scoring, repetition, matching, storage, …
src/components/      screens: Home, ListEditor, Game, Results, MapView
tests/               unit tests (Vitest) and tests/e2e (Playwright)
```

Everything a player does (profiles, lists, progress, settings) is stored in the browser's
local storage; there is no server.

## Data and licences

- Map data: [Natural Earth](https://www.naturalearthdata.com/) — public domain.
- Towns and villages: [GeoNames](https://www.geonames.org/) — CC BY 4.0.
- Places looked up while editing a list: [OpenStreetMap](https://www.openstreetmap.org/copyright)
  via Nominatim — © OpenStreetMap contributors, ODbL.
