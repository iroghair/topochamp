<script lang="ts">
  import { downloadBackup, restoreBackup, shareLink } from '../lib/backup';
  import { fmt, packName, tr } from '../lib/i18n.svelte';
  import { DEFAULT_LIST, getList, listsForPack, resolveEntries, type ListEntry } from '../lib/lists.svelte';
  import { loadIndex, loadPack, type LoadedPack } from '../lib/packs';
  import { currentPlayer, getProgress } from '../lib/players.svelte';
  import { MASTERED_BOX } from '../lib/scheduler';
  import { settings } from '../lib/settings.svelte';
  import { normalize } from '../lib/text';
  import { directionOf, type Level, type PackIndexEntry, type QuestionKind } from '../lib/types';
  import Players from './Players.svelte';

  interface Props {
    onstart: (pack: LoadedPack, entries: ListEntry[]) => void;
    oneditlist: (pack: LoadedPack, listId: string | null, prefill: 'default' | 'empty') => void;
  }
  let { onstart, oneditlist }: Props = $props();

  let index: PackIndexEntry[] = $state([]);
  let pack: LoadedPack | null = $state(null);
  let loadError = $state('');
  let search = $state('');
  let reloadKey = $state(0);

  loadIndex()
    .then((i) => (index = i.packs))
    .catch((e) => (loadError = String(e.message ?? e)));

  $effect(() => {
    const id = settings.packId;
    void reloadKey;
    pack = null;
    loadError = '';
    loadPack(id)
      .then((p) => {
        if (settings.packId === id) pack = p;
      })
      .catch((e) => (loadError = String(e.message ?? e)));
  });

  const continents = $derived(index.filter((p) => p.kind === 'continent'));
  const countries = $derived(
    index
      .filter((p) => p.kind === 'country')
      .filter((p) => !search.trim() || normalize(packName(p)).includes(normalize(search)) || normalize(p.en).includes(normalize(search)))
      .sort((a, b) => packName(a).localeCompare(packName(b), settings.lang)),
  );
  const selectedEntry = $derived(index.find((p) => p.id === settings.packId));

  const savedLists = $derived(listsForPack(settings.packId));
  const listId = $derived(settings.listByPack[settings.packId] ?? DEFAULT_LIST);
  const entries = $derived(pack ? resolveEntries(listId, pack) : []);

  // How many places of the list the current player has mastered, for the chosen question kinds.
  const mastered = $derived.by(() => {
    const playerId = currentPlayer().id;
    const dirs = [...new Set(settings.kinds.map(directionOf))];
    return entries.filter((e) => dirs.every((d) => getProgress(playerId, d, e.id).box >= MASTERED_BOX)).length;
  });

  function selectPack(id: string) {
    settings.packId = id;
  }

  function selectList(id: string) {
    settings.listByPack[settings.packId] = id;
  }

  const levels: { id: Level; icon: string }[] = [
    { id: 'easy', icon: '🙂' },
    { id: 'middle', icon: '🤔' },
    { id: 'hard', icon: '🔥' },
  ];
  const kinds: { id: QuestionKind; label: () => string }[] = [
    { id: 'where', label: () => tr().kindWhere },
    { id: 'choice4', label: () => tr().kindChoice4 },
    { id: 'choice8', label: () => tr().kindChoice8 },
    { id: 'type', label: () => tr().kindType },
  ];

  function toggleKind(id: QuestionKind) {
    if (settings.kinds.includes(id)) {
      if (settings.kinds.length > 1) settings.kinds = settings.kinds.filter((k) => k !== id);
    } else settings.kinds = [...settings.kinds, id];
  }

  const canStart = $derived(!!pack && entries.length > 0);

  let shareNote = $state('');
  async function share() {
    const list = getList(listId);
    if (!list) return;
    const link = await shareLink(list);
    try {
      await navigator.clipboard.writeText(link);
      shareNote = tr().linkCopied;
      setTimeout(() => (shareNote = ''), 4000);
    } catch {
      prompt(tr().copyThisLink, link);
    }
  }

  async function restore(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !confirm(tr().restoreConfirm)) return;
    try {
      await restoreBackup(file);
      location.reload();
    } catch {
      alert(tr().restoreError);
    }
  }
</script>

<div class="home">
  <header class="top">
    <div class="brand">
      <span class="logo" aria-hidden="true">🗺️</span>
      <div>
        <h1>{tr().appName}</h1>
        <p class="muted">{tr().tagline}</p>
      </div>
    </div>
    <div class="lang" role="group" aria-label={tr().language}>
      <button class="chip" aria-pressed={settings.lang === 'nl'} onclick={() => (settings.lang = 'nl')}>NL</button>
      <button class="chip" aria-pressed={settings.lang === 'en'} onclick={() => (settings.lang = 'en')}>EN</button>
    </div>
  </header>

  <main class="grid">
    <section class="card players">
      <h2>{tr().player}</h2>
      <Players />
    </section>

    <section class="card region">
      <h2>{tr().region}{#if selectedEntry}: <span class="selected-name">{packName(selectedEntry)}</span>{/if}</h2>
      <div class="chips">
        <button class="chip" aria-pressed={settings.packId === 'world'} onclick={() => selectPack('world')}>🌍 {tr().world}</button>
        {#each continents as c (c.id)}
          <button class="chip" aria-pressed={settings.packId === c.id} onclick={() => selectPack(c.id)}>{packName(c)}</button>
        {/each}
      </div>
      <label class="visually-hidden" for="country-search">{tr().searchCountry}</label>
      <input id="country-search" type="search" placeholder={tr().searchCountry} bind:value={search} autocomplete="off" />
      <div class="country-list" role="listbox" aria-label={tr().countries}>
        {#each countries as c (c.id)}
          <button role="option" aria-selected={settings.packId === c.id} class:selected={settings.packId === c.id} onclick={() => selectPack(c.id)}>
            {packName(c)}
          </button>
        {/each}
      </div>
    </section>

    <section class="card list">
      <h2>{tr().list}</h2>
      {#if loadError}
        <p class="error">{fmt(tr().loadError, { msg: loadError })}</p>
        <button class="btn" onclick={() => reloadKey++}>{tr().retry}</button>
      {:else if !pack}
        <p class="muted">{tr().loading}</p>
      {:else}
        <div class="chips">
          <button class="chip" aria-pressed={listId === DEFAULT_LIST} onclick={() => selectList(DEFAULT_LIST)}>
            {tr().defaultList}
          </button>
          {#each savedLists as l (l.id)}
            <button class="chip" aria-pressed={listId === l.id} onclick={() => selectList(l.id)}>{l.name}</button>
          {/each}
        </div>
        <p class="muted count">{fmt(tr().itemsCount, { n: entries.length })}</p>
        {#if entries.length}
          <div class="mastery" title={fmt(tr().mastered, { m: mastered, n: entries.length })}>
            <div class="bar"><div class="fill" style="width: {(100 * mastered) / entries.length}%"></div></div>
            <small class="muted">{currentPlayer().avatar} {fmt(tr().mastered, { m: mastered, n: entries.length })}</small>
          </div>
        {/if}
        <div class="row">
          <button class="btn" onclick={() => pack && oneditlist(pack, listId === DEFAULT_LIST ? null : listId, 'default')}>
            ✏️ {tr().editList}
          </button>
          <button class="btn ghost" onclick={() => pack && oneditlist(pack, null, 'empty')}>＋ {tr().newList}</button>
          {#if listId !== DEFAULT_LIST}
            <button class="btn ghost" onclick={share}>{tr().shareList}</button>
          {/if}
        </div>
        {#if shareNote}<p class="note" role="status">{shareNote}</p>{/if}
      {/if}
    </section>

    <section class="card level">
      <h2>{tr().level}</h2>
      <div class="tiles">
        {#each levels as l (l.id)}
          <button class="tile" aria-pressed={settings.level === l.id} onclick={() => (settings.level = l.id)}>
            <span class="tile-icon" aria-hidden="true">{l.icon}</span>
            <strong>{tr()[l.id]}</strong>
            <small class="muted">{tr()[`${l.id}Hint`]}</small>
          </button>
        {/each}
      </div>
    </section>

    <section class="card kinds">
      <h2>{tr().questions}</h2>
      <div class="chips">
        {#each kinds as kd (kd.id)}
          <button class="chip" aria-pressed={settings.kinds.includes(kd.id)} onclick={() => toggleKind(kd.id)}>{kd.label()}</button>
        {/each}
      </div>
      <p class="muted small">{tr().kindsHint}</p>
    </section>

    <section class="card session">
      <h2>{tr().session}</h2>
      <div class="tiles two">
        <button class="tile" aria-pressed={settings.sessionType === 'practice'} onclick={() => (settings.sessionType = 'practice')}>
          <span class="tile-icon" aria-hidden="true">🎯</span>
          <strong>{tr().practice}</strong>
          <small class="muted">{tr().practiceHint}</small>
        </button>
        <button class="tile" aria-pressed={settings.sessionType === 'test'} onclick={() => (settings.sessionType = 'test')}>
          <span class="tile-icon" aria-hidden="true">📝</span>
          <strong>{tr().test}</strong>
          <small class="muted">{tr().testHint}</small>
        </button>
      </div>
      {#if settings.sessionType === 'practice'}
        <div class="chips lengths">
          {#each [10, 20, 30] as const as n (n)}
            <button class="chip" aria-pressed={settings.length === n} onclick={() => (settings.length = n)}>{fmt(tr().questionsCount, { n })}</button>
          {/each}
        </div>
      {/if}
    </section>

    <details class="card settings">
      <summary><h2>⚙️ {tr().settings}</h2></summary>
      <fieldset>
        <legend>{tr().spelling}</legend>
        <label><input type="radio" name="spelling" value="lenient" bind:group={settings.spelling} /> {tr().lenient}</label>
        <label><input type="radio" name="spelling" value="strict" bind:group={settings.spelling} /> {tr().strict}</label>
      </fieldset>
      <fieldset>
        <legend>{tr().feedbackMode}</legend>
        <label><input type="radio" name="feedback" value="auto" bind:group={settings.feedback} /> {tr().feedbackAuto}</label>
        <label><input type="radio" name="feedback" value="manual" bind:group={settings.feedback} /> {tr().feedbackManual}</label>
      </fieldset>
      <fieldset>
        <legend>{tr().mapLayers}</legend>
        <label><input type="checkbox" bind:checked={settings.showRivers} /> {tr().showRivers}</label>
        <label><input type="checkbox" bind:checked={settings.showLakes} /> {tr().showLakes}</label>
        <label><input type="checkbox" bind:checked={settings.colorUnits} /> {tr().colorUnits}</label>
        <p class="muted small">{tr().colorUnitsHint}</p>
        <p class="muted small">{tr().mapLayersHint}</p>
      </fieldset>
      <label class="check"><input type="checkbox" bind:checked={settings.sound} /> {tr().sound}</label>
      <div class="backup">
        <p class="muted small">{tr().backupHint}</p>
        <div class="row">
          <button class="btn" onclick={downloadBackup}>{tr().backup}</button>
          <label class="btn">
            {tr().restore}
            <input type="file" accept="application/json,.json" class="visually-hidden" onchange={restore} />
          </label>
        </div>
      </div>
    </details>
  </main>

  <footer class="start-bar">
    <button class="btn primary big start" disabled={!canStart} onclick={() => pack && onstart(pack, entries)}>
      {tr().start}
    </button>
  </footer>
  <p class="attribution muted">{tr().attribution}</p>
</div>

<style>
  .home {
    max-width: 1100px;
    margin: 0 auto;
    padding: 16px 16px 120px;
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 16px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .logo {
    font-size: 44px;
  }
  h1 {
    margin: 0;
    font-size: 2rem;
    color: var(--brand);
    letter-spacing: -0.5px;
  }
  .brand p {
    margin: 0;
  }
  .lang {
    display: flex;
    gap: 6px;
  }
  h2 {
    margin: 0 0 12px;
    font-size: 1.1rem;
  }
  .selected-name {
    color: var(--brand);
  }
  /* Cards flow down the columns in setup order, without gaps. */
  .grid {
    columns: 3 300px;
    column-gap: 16px;
  }
  .grid > :global(*) {
    display: block;
    break-inside: avoid;
    margin-bottom: 16px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 12px;
  }
  .country-list {
    margin-top: 8px;
    max-height: 260px;
    overflow-y: auto;
    border: 1px solid var(--line);
    border-radius: 12px;
  }
  .country-list button {
    display: block;
    width: 100%;
    text-align: left;
    padding: 9px 12px;
    border: 0;
    border-bottom: 1px solid var(--surface-2);
    background: transparent;
  }
  .country-list button:hover {
    background: var(--surface-2);
  }
  .country-list button.selected {
    background: var(--brand-soft);
    font-weight: 700;
  }
  .count {
    margin: 0 0 8px;
  }
  .mastery {
    display: grid;
    gap: 4px;
    margin-bottom: 12px;
  }
  .bar {
    height: 10px;
    border-radius: 999px;
    background: var(--surface-2);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: linear-gradient(90deg, var(--good), var(--good-edge));
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }
  .tiles.two {
    grid-template-columns: repeat(2, 1fr);
  }
  .tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 12px 8px;
    border-radius: 14px;
    border: 2px solid var(--line);
    background: var(--surface);
    text-align: center;
  }
  .tile[aria-pressed='true'] {
    border-color: var(--brand);
    background: var(--brand-soft);
  }
  .tile-icon {
    font-size: 28px;
  }
  .tile small {
    font-size: 0.8rem;
    line-height: 1.25;
  }
  .lengths {
    margin-top: 12px;
    margin-bottom: 0;
  }
  .small {
    font-size: 0.85rem;
    margin: 0;
  }
  .settings summary {
    cursor: pointer;
    list-style: none;
  }
  .settings summary h2 {
    display: inline;
  }
  fieldset {
    border: 0;
    padding: 0;
    margin: 12px 0;
  }
  legend {
    font-weight: 700;
    margin-bottom: 4px;
  }
  fieldset label,
  .check {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 36px;
  }
  .error {
    color: var(--bad);
  }
  .note {
    margin: 8px 0 0;
    color: var(--good-edge);
    font-weight: 700;
  }
  .backup {
    margin-top: 12px;
    border-top: 1px solid var(--line);
    padding-top: 12px;
  }
  .backup .small {
    margin-bottom: 8px;
  }
  .start-bar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    justify-content: center;
    padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
    background: linear-gradient(to top, var(--bg) 60%, transparent);
  }
  .start {
    min-width: min(360px, 100%);
  }
  .attribution {
    font-size: 0.75rem;
    text-align: center;
    margin-top: 24px;
  }
  @media (max-width: 560px) {
    .tiles {
      grid-template-columns: 1fr;
    }
    .tile {
      flex-direction: row;
      text-align: left;
    }
    .tiles.two {
      grid-template-columns: 1fr;
    }
  }
</style>
