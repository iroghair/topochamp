<script lang="ts">
  import { inBox } from '../lib/geo';
  import { fmt, itemName, packName, tr } from '../lib/i18n.svelte';
  import { DEFAULT_LIST, deleteList, getList, saveList, type ListEntry } from '../lib/lists.svelte';
  import { customName, matchLines, NameIndex, parseList, type LineResult } from '../lib/matching';
  import { searchOnline, type OnlinePlace } from '../lib/nominatim';
  import { addCustomItems, defaultItemIds, type LoadedPack } from '../lib/packs';
  import { newId } from '../lib/storage';
  import { settings } from '../lib/settings.svelte';
  import type { Item, ItemType, LonLat } from '../lib/types';
  import { untrack } from 'svelte';
  import MapView, { type MapPick } from './MapView.svelte';

  interface Props {
    pack: LoadedPack;
    listId: string | null;
    /** For a new list: start from the map's default list or from nothing. */
    prefill: 'default' | 'empty';
    onclose: () => void;
  }
  let { pack, listId, prefill, onclose }: Props = $props();

  // The editor works on a copy of the list, made once when it opens.
  const { existing, index, initialName, initialEntries, initialCustom } = untrack(() => {
    const existing = listId ? getList(listId) : undefined;
    return {
      existing,
      index: new NameIndex(pack),
      initialCustom: (existing?.custom ?? []).map((c) => ({ ...c })),
      initialName: existing?.name ?? fmt(tr().myList, { region: packName(pack.file) }),
      initialEntries: existing
        ? existing.entries.map((e) => ({ ...e }))
        : prefill === 'default'
          ? defaultItemIds(pack).map((id) => ({ id }))
          : [],
    };
  });
  let name = $state(initialName);
  let entries: ListEntry[] = $state(initialEntries);
  /** Places not in the map data: looked up online or pointed out on the map. */
  let custom: Item[] = $state(initialCustom);
  let pasteText = $state('');

  interface PendingRow {
    key: string;
    r: LineResult;
    online?: OnlinePlace[] | 'loading' | 'error';
  }
  let pending: PendingRow[] = $state([]);
  let placing: { key: string; name: string; type: ItemType } | null = $state(null);
  let query = $state('');
  let hoverId: string | null = $state(null);
  let renaming: string | null = $state(null);

  const ids = $derived(new Set(entries.map((e) => e.id)));
  const searchResults = $derived(query.trim().length >= 2 ? index.search(query, 10) : []);

  const TYPE_ORDER: ItemType[] = ['country', 'part', 'province', 'city', 'river', 'sea', 'lake', 'mountains', 'island', 'region'];
  const groups = $derived(
    TYPE_ORDER.map((t) => ({
      t,
      rows: entries.map((e) => ({ entry: e, item: pack.items.get(e.id)! })).filter((r) => r.item && r.item.t === t),
    })).filter((g) => g.rows.length),
  );

  const displayName = (e: ListEntry, item: Item) => e.name ?? itemName(item);
  const parentName = (item: Item) => {
    const parent = item.p ? pack.items.get(item.p) : undefined;
    return parent ? itemName(parent) : '';
  };

  function add(item: Item, nameOnSheet?: string) {
    if (ids.has(item.id)) return;
    entries.push(nameOnSheet ? { id: item.id, name: nameOnSheet } : { id: item.id });
  }

  function remove(id: string) {
    entries = entries.filter((e) => e.id !== id);
  }

  function addPasted() {
    const results = matchLines(parseList(pasteText), index);
    for (const r of results) if (r.status === 'found') add(r.match.item, customName(r.line.text, r.match));
    pending = [...pending, ...results.filter((r) => r.status !== 'found').map((r) => ({ key: newId(), r }))];
    pasteText = '';
  }

  function resolve(row: PendingRow, item: Item | null) {
    if (item) {
      const cand = row.r.status === 'ambiguous' ? row.r.options.find((o) => o.item.id === item.id) : undefined;
      add(item, cand ? customName(row.r.line.text, cand) : undefined);
    }
    pending = pending.filter((p) => p.key !== row.key);
    if (placing?.key === row.key) placing = null;
  }

  /* Places that are not in the map data. */

  function addCustom(row: PendingRow, type: ItemType, [x, y]: LonLat, src: 'osm' | 'manual', geo?: OnlinePlace['geo']) {
    const item: Item = { id: `x:${newId()}`, t: type, nl: row.r.line.text, x, y, src, ...(geo ? { geo } : {}) };
    custom.push(item);
    addCustomItems(pack, [item]);
    resolve(row, item);
  }

  async function lookUp(row: PendingRow) {
    row.online = 'loading';
    try {
      row.online = await searchOnline(row.r.line.text, pack.file.view, settings.lang);
    } catch {
      row.online = 'error';
    }
  }

  function onMapPick(pick: MapPick) {
    if (!placing) return;
    const row = pending.find((p) => p.key === placing!.key);
    if (row) addCustom(row, placing.type, pick.lonlat, 'manual');
    placing = null;
  }

  const PLACE_TYPES: ItemType[] = ['city', 'island', 'lake', 'sea', 'river', 'mountains', 'region'];

  function addFromSearch(item: Item) {
    add(item);
    query = '';
  }

  /* Quick add: whole groups of places from the map. */
  const inView = (i: Item) => inBox([i.x, i.y], pack.file.view);
  const quickGroups = $derived.by(() => {
    const all = pack.file.items.filter(inView);
    const out: { key: string; label: string; items: Item[] }[] = [];
    for (const t of TYPE_ORDER) {
      if (t === 'city') {
        const capitals = all.filter((i) => i.t === 'city' && (i.cap || i.cap2) && i.d);
        if (capitals.length) out.push({ key: 'capitals', label: tr().capitals, items: capitals });
        const biggest = all
          .filter((i) => i.t === 'city')
          .sort((a, b) => (b.pop ?? 0) - (a.pop ?? 0))
          .slice(0, 20);
        if (biggest.length) out.push({ key: 'biggest', label: fmt(tr().biggestCities, { n: biggest.length }), items: biggest });
        continue;
      }
      let items = all.filter((i) => i.t === t);
      if (t === 'country') items = items.filter((i) => !i.terr);
      if (t === 'river') items = items.filter((i) => (i.rank ?? 99) <= (pack.file.kind === 'country' ? 8 : 6));
      if (items.length && items.length <= 80) out.push({ key: t, label: tr().typesPlural[t], items });
    }
    return out;
  });

  function quickAdd(items: Item[]) {
    for (const i of items) add(i);
  }

  function clearAll() {
    if (confirm(tr().confirmClear)) entries = [];
  }

  function save() {
    const saved = saveList({
      id: existing?.id,
      name: name.trim() || fmt(tr().myList, { region: packName(pack.file) }),
      packId: pack.file.id,
      entries: $state.snapshot(entries),
      custom: $state.snapshot(custom.filter((c) => ids.has(c.id))),
    });
    settings.listByPack[pack.file.id] = saved.id;
    onclose();
  }

  function removeList() {
    if (!existing || !confirm(tr().confirmDelete)) return;
    deleteList(existing.id);
    settings.listByPack[pack.file.id] = DEFAULT_LIST;
    onclose();
  }

  function setName(e: ListEntry, item: Item, value: string) {
    const v = value.trim();
    e.name = v && v !== itemName(item) ? v : undefined;
    renaming = null;
  }
</script>

<div class="editor">
  <header class="bar">
    <button class="btn ghost" onclick={onclose}>← {tr().back}</button>
    <label class="name">
      <span class="visually-hidden">{tr().listName}</span>
      <input type="text" bind:value={name} placeholder={tr().listNamePlaceholder} maxlength="60" />
    </label>
    <button class="btn primary" onclick={save} disabled={!entries.length}>💾 {tr().saveList}</button>
  </header>

  <div class="columns">
    <section class="left">
      <div class="card">
        <h2>{tr().pasteTitle}</h2>
        <p class="muted small">{tr().pasteHint}</p>
        <textarea bind:value={pasteText} rows="7" placeholder={'Amsterdam\nRotterdam\nGroningen (provincie)\n…'}></textarea>
        <button class="btn primary" onclick={addPasted} disabled={!pasteText.trim()}>{tr().addPasted}</button>
      </div>

      {#if pending.length}
        <div class="card attention">
          <h2>⚠️ {tr().needsAttention}</h2>
          {#each pending as row (row.key)}
            {@const r = row.r}
            <div class="pending">
              {#if r.status === 'ambiguous'}
                <p>{fmt(tr().whichOne, { name: r.line.text })}</p>
                <div class="chips">
                  {#each r.options as o (o.item.id)}
                    <button class="chip" onclick={() => resolve(row, o.item)} onmouseenter={() => (hoverId = o.item.id)} onmouseleave={() => (hoverId = null)}>
                      {itemName(o.item)} <small class="muted">· {tr().types[o.item.t]}{parentName(o.item) ? ', ' + parentName(o.item) : ''}</small>
                    </button>
                  {/each}
                  <button class="chip" onclick={() => resolve(row, null)}>{tr().ignore}</button>
                </div>
              {:else if r.status === 'missing'}
                <p>{fmt(tr().notFound, { name: r.line.text })} {#if r.suggestions.length}{tr().didYouMean}{/if}</p>
                <div class="chips">
                  {#each r.suggestions as sug (sug.id)}
                    <button class="chip" onclick={() => resolve(row, sug)} onmouseenter={() => (hoverId = sug.id)} onmouseleave={() => (hoverId = null)}>
                      {itemName(sug)} <small class="muted">· {tr().types[sug.t]}</small>
                    </button>
                  {/each}
                </div>
                {#if Array.isArray(row.online)}
                  {#if row.online.length}
                    <ul class="online">
                      {#each row.online as place, j (j)}
                        <li>
                          <button onclick={() => addCustom(row, place.type, [place.lon, place.lat], 'osm', place.geo)}>
                            <strong>{place.name}</strong> <small class="muted">· {tr().types[place.type]} · {place.label}</small>
                          </button>
                        </li>
                      {/each}
                    </ul>
                  {:else}
                    <p class="muted small">{tr().nothingOnline}</p>
                  {/if}
                {:else if row.online === 'error'}
                  <p class="muted small">{tr().onlineError}</p>
                {/if}
                <div class="chips">
                  {#if row.online === undefined || row.online === 'error'}
                    <button class="chip" onclick={() => lookUp(row)}>{tr().searchOnline}</button>
                  {:else if row.online === 'loading'}
                    <span class="chip">{tr().searching}</span>
                  {/if}
                  <button
                    class="chip"
                    aria-pressed={placing?.key === row.key}
                    onclick={() => (placing = placing?.key === row.key ? null : { key: row.key, name: r.line.text, type: r.line.type ?? 'city' })}
                  >
                    {tr().placeOnMap}
                  </button>
                  <button class="chip" onclick={() => resolve(row, null)}>{tr().ignore}</button>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}

      <div class="card">
        <h2>{tr().quickAdd}</h2>
        <div class="search">
          <input type="search" bind:value={query} placeholder={tr().searchAdd} autocomplete="off" aria-label={tr().searchAdd} />
          {#if searchResults.length}
            <ul class="results">
              {#each searchResults as item (item.id)}
                <li>
                  <button
                    onclick={() => addFromSearch(item)}
                    disabled={ids.has(item.id)}
                    onmouseenter={() => (hoverId = item.id)}
                    onmouseleave={() => (hoverId = null)}
                  >
                    <strong>{itemName(item)}</strong>
                    <small class="muted">{tr().types[item.t]}{parentName(item) ? ' · ' + parentName(item) : ''}</small>
                    {#if ids.has(item.id)}<span class="tick">✓</span>{/if}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
        <div class="chips quick">
          {#each quickGroups as g (g.key)}
            <button class="chip" onclick={() => quickAdd(g.items)}>{fmt(tr().addAll, { what: g.label, n: g.items.length })}</button>
          {/each}
        </div>
      </div>
    </section>

    <section class="right">
      <div class="preview card" class:placing={!!placing}>
        <MapView
          {pack}
          level="easy"
          listIds={ids}
          showRivers={settings.showRivers}
          showLakes={settings.showLakes}
          colorUnits={settings.colorUnits}
          highlightId={hoverId}
          interactive={!!placing}
          onpick={onMapPick}
          labelOf={(i) => itemName(i)}
        />
        {#if placing}
          <div class="place-banner">
            <strong>{fmt(tr().clickOnMap, { name: placing.name })}</strong>
            <div class="chips">
              <span class="muted">{tr().kindOfPlace}</span>
              {#each PLACE_TYPES as t (t)}
                <button class="chip" aria-pressed={placing.type === t} onclick={() => placing && (placing.type = t)}>{tr().types[t]}</button>
              {/each}
            </div>
          </div>
        {/if}
      </div>
      {#if custom.some((c) => c.src === 'osm' && ids.has(c.id))}
        <p class="muted credit">{tr().osmCredit}</p>
      {/if}

      <div class="card entries">
        <div class="entries-head">
          <h2>{tr().inList}: {entries.length}</h2>
          {#if entries.length}<button class="btn ghost small-btn" onclick={clearAll}>{tr().clearAll}</button>{/if}
        </div>
        {#if !entries.length}
          <p class="muted">{tr().emptyList}</p>
        {/if}
        {#each groups as g (g.t)}
          <h3>{tr().typesPlural[g.t]} <span class="muted">({g.rows.length})</span></h3>
          <ul class="rows">
            {#each g.rows as { entry, item } (entry.id)}
              <li onmouseenter={() => (hoverId = item.id)} onmouseleave={() => (hoverId = null)}>
                {#if renaming === entry.id}
                  <!-- svelte-ignore a11y_autofocus -->
                  <input
                    type="text"
                    value={displayName(entry, item)}
                    aria-label={tr().spellingOnSheet}
                    autofocus
                    onblur={(e) => setName(entry, item, e.currentTarget.value)}
                    onkeydown={(e) => e.key === 'Enter' && setName(entry, item, e.currentTarget.value)}
                  />
                {:else}
                  <button class="row-name" onclick={() => (renaming = entry.id)} title={tr().spellingOnSheet}>
                    {displayName(entry, item)}
                    {#if entry.name}<small class="muted">({itemName(item)})</small>{/if}
                  </button>
                {/if}
                {#if parentName(item)}<small class="muted parent">{parentName(item)}</small>{/if}
                <button class="remove" onclick={() => remove(entry.id)} aria-label={tr().remove} title={tr().remove}>✕</button>
              </li>
            {/each}
          </ul>
        {/each}
      </div>

      {#if existing}
        <button class="btn ghost danger" onclick={removeList}>🗑 {tr().deleteList}</button>
      {/if}
    </section>
  </div>
</div>

<style>
  .editor {
    min-height: 100%;
  }
  .bar {
    position: sticky;
    top: 0;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    background: var(--surface);
    box-shadow: var(--shadow-sm);
  }
  .name {
    flex: 1;
  }
  .name input {
    font-size: 1.15rem;
    font-weight: 700;
  }
  .columns {
    display: grid;
    grid-template-columns: minmax(300px, 420px) 1fr;
    gap: 16px;
    max-width: 1300px;
    margin: 0 auto;
    padding: 16px;
    align-items: start;
  }
  .left,
  .right {
    display: grid;
    gap: 16px;
  }
  h2 {
    margin: 0 0 8px;
    font-size: 1.1rem;
  }
  h3 {
    margin: 14px 0 6px;
    font-size: 1rem;
  }
  .small {
    font-size: 0.85rem;
    margin: 0 0 8px;
  }
  textarea {
    width: 100%;
    border-radius: 12px;
    border: 2px solid var(--line);
    padding: 10px;
    font: inherit;
    resize: vertical;
    margin-bottom: 8px;
  }
  textarea:focus {
    border-color: var(--brand);
    outline: none;
  }
  .attention {
    border: 2px solid var(--answer-edge);
    background: #fffaf0;
  }
  .pending + .pending {
    border-top: 1px solid var(--line);
  }
  .pending p {
    margin: 8px 0 6px;
    font-weight: 600;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chips small {
    font-weight: 500;
  }
  .quick {
    margin-top: 12px;
  }
  .search {
    position: relative;
  }
  .results {
    list-style: none;
    margin: 4px 0 0;
    padding: 4px;
    border: 1px solid var(--line);
    border-radius: 12px;
    max-height: 320px;
    overflow-y: auto;
  }
  .results button {
    display: flex;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    text-align: left;
    padding: 8px 10px;
    border: 0;
    border-radius: 8px;
    background: transparent;
  }
  .results button:hover:not(:disabled) {
    background: var(--brand-soft);
  }
  .results button:disabled {
    opacity: 0.6;
  }
  .tick {
    margin-left: auto;
    color: var(--good-edge);
  }
  .preview {
    position: relative;
    padding: 0;
    overflow: hidden;
    height: 360px;
  }
  .preview.placing {
    outline: 3px solid var(--accent);
    height: 460px;
  }
  .place-banner {
    position: absolute;
    left: 8px;
    right: 8px;
    top: 8px;
    padding: 10px 12px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.95);
    box-shadow: var(--shadow-sm);
    display: grid;
    gap: 6px;
  }
  .place-banner .chips {
    align-items: center;
  }
  .place-banner .chip {
    min-height: 32px;
    padding: 2px 10px;
  }
  .credit {
    font-size: 0.75rem;
    margin: -8px 0 0;
  }
  .online {
    list-style: none;
    margin: 4px 0 8px;
    padding: 0;
    display: grid;
    gap: 4px;
  }
  .online button {
    width: 100%;
    text-align: left;
    padding: 8px 10px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--surface);
  }
  .online button:hover {
    background: var(--brand-soft);
  }
  .entries-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .small-btn {
    min-height: 36px;
    padding: 6px 10px;
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 4px 12px;
  }
  .rows li {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    border-radius: 8px;
  }
  .rows li:hover {
    background: var(--surface-2);
  }
  .row-name {
    border: 0;
    background: transparent;
    padding: 2px 0;
    text-align: left;
    font-weight: 600;
  }
  .rows input {
    min-height: 32px;
    padding: 2px 8px;
  }
  .parent {
    font-size: 0.8rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .remove {
    margin-left: auto;
    border: 0;
    background: transparent;
    color: var(--ink-soft);
    width: 32px;
    height: 32px;
    border-radius: 8px;
    flex-shrink: 0;
  }
  .remove:hover {
    background: var(--bad-soft);
    color: var(--bad);
  }
  .danger {
    color: var(--bad);
    justify-self: start;
  }
  @media (max-width: 860px) {
    .columns {
      grid-template-columns: 1fr;
    }
    .bar {
      flex-wrap: wrap;
    }
  }
</style>
