<script lang="ts">
  import Game from './components/Game.svelte';
  import Home from './components/Home.svelte';
  import ListEditor from './components/ListEditor.svelte';
  import Results from './components/Results.svelte';
  import { sharedListFromHash } from './lib/backup';
  import { fmt, tr } from './lib/i18n.svelte';
  import { saveList, type ListEntry } from './lib/lists.svelte';
  import type { LoadedPack } from './lib/packs';
  import { currentPlayer } from './lib/players.svelte';
  import { GameSession } from './lib/session.svelte';
  import { settings } from './lib/settings.svelte';

  type Screen =
    | { name: 'home' }
    | { name: 'game' }
    | { name: 'results' }
    | { name: 'lists'; pack: LoadedPack; listId: string | null; prefill: 'default' | 'empty' };

  let screen: Screen = $state({ name: 'home' });
  let session: GameSession | null = $state(null);
  let lastStart: { pack: LoadedPack; entries: ListEntry[] } | null = null;

  $effect(() => {
    document.documentElement.lang = settings.lang;
  });

  // Opening a shared link (#list=…) offers to add the list. The link may also be pasted
  // into a tab where the game is already open, which only changes the hash.
  function importSharedList() {
    if (!location.hash.startsWith('#list=')) return;
    sharedListFromHash(location.hash)
      .then((shared) => {
        history.replaceState(null, '', location.pathname + location.search);
        if (!shared) throw new Error('invalid');
        if (!confirm(fmt(tr().importListConfirm, { name: shared.name, n: shared.entries.length }))) return;
        const saved = saveList({ name: shared.name, packId: shared.packId, entries: shared.entries, custom: shared.custom });
        settings.packId = shared.packId;
        settings.listByPack[shared.packId] = saved.id;
        screen = { name: 'home' };
      })
      .catch(() => alert(tr().importListError));
  }
  importSharedList();

  function start(pack: LoadedPack, entries: ListEntry[]) {
    lastStart = { pack, entries };
    session = new GameSession({
      pack,
      entries,
      level: settings.level,
      kinds: [...settings.kinds],
      type: settings.sessionType,
      length: settings.length,
      spelling: settings.spelling,
      showRivers: settings.showRivers,
      showLakes: settings.showLakes,
      playerId: currentPlayer().id,
      lang: settings.lang,
      typeName: (t) => tr().types[t],
    });
    screen = { name: 'game' };
  }
</script>

<svelte:window onhashchange={importSharedList} />

{#if screen.name === 'home'}
  <Home onstart={start} oneditlist={(pack, listId, prefill) => (screen = { name: 'lists', pack, listId, prefill })} />
{:else if screen.name === 'lists'}
  <ListEditor pack={screen.pack} listId={screen.listId} prefill={screen.prefill} onclose={() => (screen = { name: 'home' })} />
{:else if screen.name === 'game' && session}
  <Game {session} onend={() => (screen = { name: 'results' })} />
{:else if screen.name === 'results' && session}
  <Results
    {session}
    onagain={() => lastStart && start(lastStart.pack, lastStart.entries)}
    onpractise={(entries) => lastStart && start(lastStart.pack, entries)}
    onmenu={() => (screen = { name: 'home' })}
  />
{/if}
