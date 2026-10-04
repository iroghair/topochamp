# TopoChamp: Game Rules & Development Plan

**Status:** approved 2026-10-04. Phases 0–6 are built; phase 7 is partly done (offline/PWA and a
deploy workflow are ready, not yet published). See [section 7](#7-implementation-status) for
what was built, deviations from this plan and known limitations.

---

## 1. Goal

Turn the school topography sheet (a list of names plus a map) into a fun browser game for practice.
A player picks a region and the exact list of places from their test. They then answer two kinds of questions:

- **"Where is it?"**: click the place on the map.
- **"What is this?"**: name the place that is highlighted.

The game remembers which places the player got wrong and asks those more often.

---

## 2. Game rules

### 2.1 Setup flow

1. **Player:** pick a profile. Each child has their own progress.
2. **Region:** World, a continent, or a country.
3. **Learning list:**
   - **Default list**, generated from the region:
     - Country: its provinces/states and their capitals, plus the national capital.
     - Continent: its countries and their capitals.
     - World: all countries and their capitals. Can be filtered by continent.
   - **Custom list:** paste the names from the school sheet, one per line, or edit the default list. You can remove items, add items, or add other types (rivers, seas, …).
     Save the list under a name (e.g. "Chapter 3 – Europe") so you can use it again.
4. **Game options:** mode, level and session type (all described below).

### 2.2 Item types

| Type | Shape on map | Examples |
|---|---|---|
| Country | area | Ireland, France |
| Part of a country ("landsdeel") | area | Vlaanderen, Wallonië, Schotland, Engeland |
| Province / state | area | Utrecht, Bavaria, Texas |
| City | point | Paris, Zwolle |
| River | line | Rhine, Danube |
| Lake / sea / bay | area | North Sea, Lake Geneva |
| Mountain range / landscape region | area | Alps, Sahara |
| Island | area | Texel, Sicily |

- **Spelling:** a place is always shown with the spelling used in the learning list, which is the spelling on the school sheet.
- **Same name, two items:** if a name is on the list twice (e.g. Groningen the city and Groningen the province), the question adds the type: "Groningen (city)".

### 2.3 Levels (how the map looks)

| Shown on the map | Easy | Middle | Hard |
|---|---|---|---|
| Land and sea (plain colours) | ✔ | ✔ | ✔ |
| Coastline | ✔ | ✔ | ✔ |
| Outer border of the region (needed for landlocked countries such as Switzerland) | ✔ | ✔ | ✔ |
| Internal borders (countries / provinces) | ✔ | ✔ | – |
| Countries / provinces coloured in light tones (setting, on by default; neighbours always differ) | ✔ | ✔ | – |
| Rivers (setting, on by default) | ✔ | ✔ | ✔ |
| Lakes (setting, on by default; large lakes such as the IJsselmeer always) | ✔ | ✔ | ✔ |
| Dots for cities on the list | ✔ | – | – |
| Labels / names | – | – | – |

Rules for every level:
- **Rivers and lakes are part of the map's look**, not of the question list. Two separate settings ("Show
  rivers", "Show lakes") switch them on or off; whether a river or lake is *asked* depends only on the
  learning list. A click on any drawn river counts as a click on that river ("That's the Moselle").
  To make river questions harder, switch rivers off. *(Changed after play-testing, 2026-10-04.)*
- **Only places on the list get a dot or ring.** Cities and tiny areas that are not on the list are not marked.
- **Land outside the region** is plain grey and can't be clicked. The sea is soft blue.
- **No labels** are shown while a question is open. Names only appear in the feedback after an answer.
- **Zoom and pan** work on every level: mouse wheel, pinch, or drag. A reset button returns to the full map. This should be restricted to reasonable amounts of zoom, not allowing users to zoom in excessively and playing around (becoming distracted).
- **Tiny areas** (Luxembourg, Malta, Vatican City) get a small ring on Easy so they are visible and clickable.
- **No time limit.**

### 2.4 Modes

| Mode | Question | How to answer | Difficulty |
|---|---|---|---|
| **Where is it?** | "Paris" | Click on the map | depends on level |
| **What is this? – choose 4** | The place is highlighted | Pick 1 of 4 names | easier |
| **What is this? – choose 8** | The place is highlighted | Pick 1 of 8 names | medium |
| **What is this? – type** | The place is highlighted | Type the name | harder |
| **Mixed** | Picks a random type of question each time from the ones selected | | |

How the place is highlighted in "What is this?":
- an area is filled with colour (and the map zooms in if it is tiny)
- a city is a pulsing dot
- a river is a thick coloured line

### 2.5 Scoring: "Where is it?"

Each question gives **0–100 points**. Each answer is also marked **correct or wrong**, and that mark decides how often the place is repeated (2.8).

**Areas** (country, province, sea, lake, region, island):
- **Click inside the area:** 100 points, correct. A click within about 8 px of the edge also counts, which helps with tiny areas.
- **Click outside the area:** partial points, depending on the distance to the area's edge (see the distance formula below). The answer is wrong.
  The feedback says what was clicked: "That's Belgium."

**Cities on Easy** (the dots are visible): a click snaps to the nearest dot.
- **Right dot:** 100 points, correct.
- **Wrong dot:** partial points by the distance formula, but wrong. The feedback says "That's Rotterdam." *(Decision 5.)*
- **No dot hit:** partial points by the distance formula. The answer is wrong.

**Cities on Middle and Hard** (no dots): points by the distance formula. The answer is correct only if both of these hold:
- the click is within the "correct" distance, and
- the click is closer to the target than to any other city on the list.

The second rule makes the tolerance smaller where many cities are close together.

**Rivers:** points by the distance from the click to the river line, using the same formula and correctness rule as cities.

**Distance formula.** D is the diagonal of the region's map in km.

| Distance from target | Points |
|---|---|
| ≤ 2 % of D | 100 |
| between 2 % and 15 % of D | linear from 100 down to 0 |
| ≥ 15 % of D | 0 |
| **≤ 5 % of D** | **counts as correct** (where the type allows it) |

Examples:

| Region | Full points within | Correct within | Zero points beyond |
|---|---|---|---|
| Netherlands (D ≈ 400 km) | 8 km | 20 km | 60 km |
| Europe (D ≈ 5,000 km) | 100 km | 250 km | 750 km |

The percentages are starting values and will be tuned by play-testing.

- **Multipliers**
- **Time multiplier:** points can be multiplied based on how quickly the player answers.
  *As built:* correct answers within 3 s ×1.5, within 6 s ×1.25, within 10 s ×1.1 (typing gets twice as long).
- **Streak multiplier:** consecutive correct answers increase the points awarded.
  *As built:* +10 % for each correct answer in a row, up to ×2. A wrong answer or a skip ends the streak.
  - There should be an option to skip a question, which is available 2 times per session, giving the player no points but do give the answer. Repeat the same question later on again.
    *As built:* skipping counts as "wrong" for the repetition boxes, so the place comes back more often. Not available in a test run.
- **Difficulty multiplier:** harder questions can have higher multipliers.
  *As built:* level (easy ×1, middle ×1.5, hard ×2) × question kind (click or choose-4 ×1, choose-8 ×1.25, type ×1.5).
- Stars and the test-run grade use the points *before* multipliers, so they measure knowledge only.

### 2.6 Scoring: "What is this?"

**Multiple choice:** right answer 100 points, wrong answer 0.
- **Wrong options** are always the same type as the answer (cities with cities, countries with countries). They are taken from the list. If the list is too short, more options are added from the region.
- **Choose 4:** the wrong options are random.
- **Choose 8:** half of the wrong options are places near the answer, so it is harder.

**Typing:**
- **Ignored when comparing:** capitals, accents, spaces, hyphens and apostrophes. So `s hertogenbosch` matches `'s-Hertogenbosch`. 
- **Other names:** known alternative names are accepted, e.g. Den Haag / 's-Gravenhage, Den Bosch.
- **Spelling setting:**
  - **Fuzzy matching:** the system will attempt to match answers even if there are minor mistakes, but it will highlight when a mistake was made. If not possible or enabled:
    - **Lenient (default):** 1 typo is allowed in short names and 2 in long names. A typo answer gets 75 points and counts as correct, and the right spelling is shown. Swapping two neighbouring letters counts as one typo; wrong and missing letters are highlighted.
    - **Strict:** the name must be exact apart from capitals. Use this when spelling counts on the test.

### 2.7 Feedback after each answer

- **The answer:** the target lights up green with its name. Use confetti to celebrate correct answers.
- **The click:** the spot where the player clicked is marked. After a miss, a line runs from the click to the target, with the distance ("23 km off") and the name of what was clicked.
- **Points and stars:** 100 points = ★★★, ≥ 70 = ★★, ≥ 40 = ★.
- **How long it shows:** about 2 s after a correct answer and about 4 s after a wrong one. Click, tap or press space to go on sooner.
  A setting can switch this to "wait for the Next button".

### 2.8 Sessions and repetition

**Session types:**
- **Practice (default):** 10, 20 or 30 questions. Places are chosen using the repetition rules below.
- **Test run:** every place on the list is asked exactly once, in random order, with no repeats. The session ends with the total score and a grade from 1 to 10, like the real school test. *(See open question 7.)*

**Repetition (Leitner boxes).** This is stored per player and per place, and is kept between sessions.
- **Separate progress per direction:** "where is it?" and "what is this?" are different skills, so each has its own progress.
- **Boxes:** every place is in a box from 0 to 5. Box 0 means never asked.
- **Moving between boxes:** a correct answer moves the place up one box (max 5). A wrong answer puts it back in box 1.
- **Choosing the next question:** a random draw where each box has a weight:

  | Box | 1 (wrong recently) | 0 (new) | 2 | 3 | 4 | 5 (mastered) |
  |---|---|---|---|---|---|---|
  | Weight | 16 | 8 | 8 | 4 | 2 | 1 |

  So a place answered wrong recently comes up about 16× as often as a mastered one. Mastered places still come back now and then.
- **No immediate repeats:** a place is not asked again within the next 3 questions (fewer when the list is short).
- **Quick retry:** a place answered wrong is asked once more, 3–5 questions later in the same session.
- **End-of-session screen** shows:
  - the score and stars
  - "places to practise" (the ones answered wrong)
  - a progress bar, e.g. "12 of 24 mastered"

### 2.9 Players and data

- **Profiles:** one per child (name and emoji avatar), each with its own progress.
- **Storage:** everything is stored in the browser. There are no accounts and no server.
- **Export / import:** save a backup file, or share a learning list as a file or link (e.g. with classmates).

---

## 3. Map data

### Source

**Natural Earth** (naturalearthdata.com, public domain). It has these layers:
- countries
- provinces/states
- populated places, marked as national or provincial capital
- rivers, lakes and coastlines
- seas and bays
- geographic regions (mountain ranges, deserts, …)

It has names in many languages, including Dutch and English.

### Approach: map packs prepared in advance

A data script runs **once at build time**:
1. It downloads Natural Earth.
2. It cuts it into small **map packs**, one per region (TopoJSON, simplified for the map's scale).
3. It writes a **gazetteer**: a lookup table of names, types, capitals and parent regions.

The game then **downloads only the pack for the selected region** and caches it, so it works offline after the first use.

- *Why not download Natural Earth in the browser?* The raw files are several to tens of MB each. A region pack is about 100–500 KB.
- *Why not use online map tiles (Google / OpenStreetMap)?* They are full of labels and detail, which is exactly the distraction we want to avoid.

### Limits and fallbacks

- **Missing small towns.** Natural Earth has about 7,000 cities worldwide. That is enough for capitals and large cities, but a country-level sheet may list smaller towns that are not in it.
  When a name from a custom list isn't found, there are two ways to add it:
  1. **Look it up online** with OpenStreetMap Nominatim. It is free, but needs attribution and allows at most 1 request per second. It is only used while editing a list, and the player confirms the result on the map.
  2. **Place it by hand** by clicking the spot on the map.

  Places found this way are saved in the list, so each one is looked up only once.
- **Provinces at a different level.** For some countries, Natural Earth's "provinces" are not the level schools use. France has departments instead of its 13 regions; the UK has councils. These are grouped into the school level where needed, checked country by country.
- **Overseas territories and huge countries.** French Guiana (part of France) and Russia on the Europe map are cut off at the edge of the region's map.

---

## 4. Technical design

| Part | Choice |
|---|---|
| App type | Static web app with no backend. Hosted anywhere static (GitHub Pages, Netlify), or run locally with `npm run dev`. |
| Language / build | TypeScript + Vite |
| UI | Svelte (small and simple) |
| Map | d3-geo, d3-zoom and topojson-client, drawn as SVG. The map projection is fitted to the region: the Natural Earth projection for World, conic conformal for continents and countries. |
| Click detection | Clicks are checked in geographic coordinates, not by which shape was hit, so a click in the sea still gets a distance score. The click position is converted to lon/lat (`projection.invert`). Areas are checked with `geoContains`. Distances to points and lines are measured on the globe. |
| Storage | localStorage for profiles, lists and progress (all small). |
| Offline | A service worker caches the app and the map packs (PWA, installable on a tablet). |
| Tests | Vitest for scoring, the repetition scheduler, name matching and list matching. One Playwright test plays a full round in the browser. |

### Project structure

```
topochamp/
├─ PLAN.md
├─ pipeline/        # Node scripts: download Natural Earth → build map packs + gazetteer
├─ public/packs/    # generated: world.json, continent-europe.json, country-NLD.json, …
├─ src/
│  ├─ map/          # projection, level styles, rendering, zoom, click detection
│  ├─ game/         # question picker (Leitner), scoring, answer matching, sessions
│  ├─ data/         # pack loading, gazetteer, list matching, Nominatim lookup
│  ├─ store/        # profiles, lists, progress, export/import
│  └─ ui/           # screens: player, region, list editor, game, results, settings
└─ tests/
```

### Data model (sketch)

```ts
Item         { id, type, names: { nl, en, local }, aliases: string[], geometryRef,
               parentId?, capitalOf?, population? }
LearningList { id, name, regionId, entries: { itemId, displayName }[] }   // custom places become Items too
Progress     { playerId, itemId, direction: 'where' | 'what', box: 0..5,
               attempts, correct, lastSeen }
```

Progress is stored per place, not per list. So if a child has learned Paris in a Europe list, that also counts in a World list.

---

## 5. Development phases

Each phase ends with something you can play or check.

| # | Phase | Contents | Done when |
|---|---|---|---|
| 0 | **Foundation & data proof** | Project setup (Vite/TS/Svelte, tests). A pipeline that builds packs for 1 test country (e.g. the Netherlands, to be confirmed), Europe and World. Check name fields (Dutch/English), province capitals and file sizes. | Each pack is < 500 KB and contains the expected places, e.g. 12 Dutch provinces with capitals, and all European countries with capitals. |
| 1 | **Map rendering** | Draw a pack in the 3 level styles. Zoom, pan and reset. Responsive layout, touch support. | The country, Europe and World maps look right on all 3 levels, on a laptop and on a tablet. |
| 2 | **Core game: "Where is it?"** | Default list, random questions, click detection, scoring (2.5), feedback (2.7), end screen. | A 20-question round on Europe can be played on every level. Scoring has unit tests. |
| 3 | **Regions & learning lists** | Region picker (World, continents, any country). Default lists. List editor: paste names, tolerant name matching, choosing between same-name matches (Groningen city or province?), add/remove, filter by type, save/rename/delete lists. | Pasting a real school sheet gives the correct list. We test this with one of the kids' sheets. |
| 4 | **Players & repetition** | Profiles, Leitner scheduler (2.8), saving progress, progress display, Test run session. | Wrong answers visibly come back more often. Progress survives a page reload. The scheduler has unit tests. |
| 5 | **"What is this?" modes** | Highlight drawing per type, multiple choice with 4 or 8 options, typing with name matching and the spelling setting, Mixed mode. | All modes can be played on all levels. |
| 6 | **Beyond Natural Earth** | Nominatim lookup and placing by hand for unknown names. Rivers, seas, mountains and islands work fully. Province grouping and overseas cut-off per country. | A list with small towns and rivers can be fully set up and played. |
| 7 | **Polish & release** | Kid-friendly look, sounds (can be muted), animations, offline/PWA, export/import, share link, deployment. | The kids play it on their own devices. |

Phases 0–2 give a first playable version ("Where is it?" on Europe). We can show it to the kids early and tune the levels and scoring based on how they play.

---

## 6. Decisions

Answered 2026-10-04 (the answers are in italics). Language default chosen: Dutch.

1. **Language.** Which language should place names and the menus use? For example Dutch (Parijs, Duitsland, Rijn) or English (Paris, Germany, Rhine). This also decides which spellings count in typing mode.
   *Menus and names in both languages with a switch; you pick the default.*
2. **Devices.** Laptop with mouse, tablet, phone, or a mix?
   *Laptop and tablet both work well; phone works but is not a priority.*
3. **Where it runs.** Only locally on your computer, or online on free static hosting so the kids can use any device?
   *Online (GitHub Pages).*
4. **The "etc." on the sheet.** Besides countries, provinces and cities, which types are needed first: rivers, seas, lakes, mountain ranges, islands, landscape regions?
   *Rivers and seas in phase 3, the rest in phase 6.*
5. **Wrong city dot on Easy.** 0 points (proposal), or partial points by distance?
   *Partial points by distance.*
6. **Typing spelling.** Lenient by default with a strict option. OK?
   *Lenient by default, strict option available.*
7. **Test run with a 1–10 grade.** Wanted?
   *Yes, for initial feedback.*
8. **Rivers on Easy/Middle.** Only rivers on the list (proposal), or also big rivers as background?
   *Only rivers on the list by default. Choice for showing big rivers as background available.*
9.  **Test country.** Which country should phase 0 use for the country-level pack? The Netherlands is the placeholder.
   *The Netherlands by default.*

---

## 7. Implementation status

*Last updated 2026-10-04.*

| # | Phase | Status |
|---|---|---|
| 0 | Foundation & data proof | ✅ Done. 197 packs: World, 6 continents, 190 countries (11 MB gzipped in total; Netherlands 50 KB, Europe 270 KB). |
| 1 | Map rendering | ✅ Done. 3 levels, zoom limited to ×5 (country) / ×8 (continent, world), pan stays within the map, touch and mouse. |
| 2 | Core game: "Where is it?" | ✅ Done, including multipliers, skips, confetti and sounds. |
| 3 | Regions & learning lists | ✅ Done. List editor with paste, matching, choices for ambiguous names, quick-add groups, search, own spelling per place. |
| 4 | Players & repetition | ✅ Done. Profiles, Leitner boxes per player/place/direction, progress bars, test run with grade. |
| 5 | "What is this?" modes | ✅ Done. Choose 4 / 8, typing with spelling feedback, mixing. |
| 6 | Beyond Natural Earth | ✅ Mostly done. Online lookup (OpenStreetMap) and pointing out places by hand; provinces merged into school regions for France, Italy, Spain, UK and a few others. |
| 7 | Polish & release | 🟡 Mostly. Works offline and can be installed (PWA); backup file (export/import); sharing a list as a link; GitHub Pages workflow ready. Not yet published. |

**Checks:** 57 unit tests (scoring, repetition, matching, sessions, typing, sharing, colouring), 4 browser tests
(a full round, a wrong answer, switching language, opening a shared list), type check clean, works offline.

### Deviations from the plan

- **Extra data source: GeoNames** (CC BY 4.0) for towns down to 1,000 inhabitants. Natural Earth has only
  14 Dutch places and is missing Lelystad, so country maps needed more. Natural Earth names are still
  preferred because they include Dutch exonyms (Keulen, Parijs).
- **Provinces merged into regions** for France (13 regions), Italy (20), Spain (16, the Canary Islands are left off the map), UK (England, Scotland,
  Wales, Northern Ireland), Slovenia, Latvia, Uganda and the Philippines, with Dutch names and regional capitals.
- **Tiny countries become points** at scales where they disappear (Vatican City on the Europe map): they
  are asked and drawn as a dot with a ring.
- **"Wrong dot" on Easy** gives partial points (decision 5), but still counts as wrong for the repetition.
- **Pasted spelling:** the sheet's spelling is kept when it is a different name for the place ("Den Bosch");
  differences in accents or punctuation, and typos, get the map's official spelling.
- **"What is this?" answer buttons** stay visible during feedback (green = right, red = chosen) so the map
  doesn't jump.
- **Feedback panel** sits in the bottom-left corner on wide screens, so the region stays visible.
- **Rivers and lakes are shown by default on every level**, with separate settings, independent of the
  learning list (replaces "rivers and lakes on the list, not on Hard"). Packs also contain the big rivers
  and lakes of the surrounding countries, so the background doesn't look empty.
- **Colouring countries/provinces** in six light tones (setting, on by default). Not on Hard, where the
  colours would show the borders.
- **Parts of countries** ("landsdeel": Vlaanderen, Wallonië, Brussels Hoofdstedelijk Gewest; Engeland,
  Schotland, Wales, Noord-Ierland) on the Europe map and the Belgian map. Continent maps also got more
  mid-sized rivers (Schelde, Maas) and landscapes (Ardennen, Centraal Massief, Kreta).
- **Pasted lists:** a name in brackets is read as another name ("Ural (Oeral)"), and a country wins over an
  island of the same name (Cyprus). Places that are not in the data at all, such as the Ruhrgebied, are
  found with the online lookup in the list editor.

### Known limitations

- Countries crossing the 180° meridian (eastern Russia, Fiji, the Pacific part of Oceania) are cut at 180°.
- USA: contiguous states only (Alaska and Hawaii would need insets).
- For merged regions (e.g. England) the game still says "provincie".
- Places pointed out by hand are points; places found online keep their shape (islands, lakes, rivers).
- Some Natural Earth Dutch names may still be odd; corrections go in `pipeline/tables.mjs`.

### Next steps

1. Play-test with the kids; tune the distance percentages (section 2.5) and the timing.
2. Publish on GitHub Pages (needs a GitHub repository).
3. Fix the known limitations above where they matter for the kids' lists.
