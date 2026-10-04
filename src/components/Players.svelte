<script lang="ts">
  import { tr } from '../lib/i18n.svelte';
  import { addPlayer, AVATARS, currentPlayer, players, removePlayer, updatePlayer } from '../lib/players.svelte';

  let editing: { id: string | null; name: string; avatar: string } | null = $state(null);

  function startAdd() {
    editing = { id: null, name: '', avatar: AVATARS[players.list.length % AVATARS.length] };
  }

  function startEdit() {
    const p = currentPlayer();
    editing = { id: p.id, name: p.name, avatar: p.avatar };
  }

  function save(e: SubmitEvent) {
    e.preventDefault();
    if (!editing) return;
    if (editing.id) updatePlayer(editing.id, editing.name, editing.avatar);
    else addPlayer(editing.name, editing.avatar);
    editing = null;
  }

  function remove() {
    if (editing?.id) removePlayer(editing.id);
    editing = null;
  }
</script>

<div class="players">
  {#each players.list as p (p.id)}
    <button class="chip player" aria-pressed={players.currentId === p.id} onclick={() => (players.currentId = p.id)}>
      <span class="avatar" aria-hidden="true">{p.avatar}</span>{p.name}
    </button>
  {/each}
  <button class="chip" onclick={startAdd} aria-label={tr().addPlayer} title={tr().addPlayer}>＋</button>
  <button class="chip" onclick={startEdit} aria-label={tr().edit} title={tr().edit}>✏️</button>
</div>

{#if editing}
  <form class="edit" onsubmit={save}>
    <label>
      <span class="visually-hidden">{tr().playerName}</span>
      <!-- svelte-ignore a11y_autofocus -->
      <input type="text" bind:value={editing.name} placeholder={tr().playerName} maxlength="20" autofocus />
    </label>
    <div class="avatars" role="radiogroup">
      {#each AVATARS as a (a)}
        <button type="button" class="avatar-btn" role="radio" aria-checked={editing.avatar === a} onclick={() => editing && (editing.avatar = a)}>{a}</button>
      {/each}
    </div>
    <div class="actions">
      <button type="submit" class="btn primary">{tr().save}</button>
      <button type="button" class="btn ghost" onclick={() => (editing = null)}>{tr().cancel}</button>
      {#if editing.id && players.list.length > 1}
        <button type="button" class="btn ghost danger" onclick={remove}>{tr().delete}</button>
      {/if}
    </div>
  </form>
{/if}

<style>
  .players {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .avatar {
    font-size: 1.3rem;
  }
  .edit {
    margin-top: 12px;
    display: grid;
    gap: 10px;
  }
  .avatars {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .avatar-btn {
    width: 44px;
    height: 44px;
    font-size: 1.5rem;
    border-radius: 12px;
    border: 2px solid var(--line);
    background: var(--surface);
  }
  .avatar-btn[aria-checked='true'] {
    border-color: var(--brand);
    background: var(--brand-soft);
  }
  .actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .danger {
    color: var(--bad);
  }
</style>
