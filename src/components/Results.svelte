<script lang="ts">
  import confetti from 'canvas-confetti';
  import { onMount } from 'svelte';
  import { fmt, tr } from '../lib/i18n.svelte';
  import type { ListEntry } from '../lib/lists.svelte';
  import { getProgress } from '../lib/players.svelte';
  import { grade, stars } from '../lib/points';
  import { MASTERED_BOX } from '../lib/scheduler';
  import type { GameSession } from '../lib/session.svelte';
  import { settings } from '../lib/settings.svelte';
  import { playFanfare } from '../lib/sound';
  import { directionOf, type Item } from '../lib/types';
  import Stars from './Stars.svelte';

  interface Props {
    session: GameSession;
    onagain: () => void;
    onpractise: (entries: ListEntry[]) => void;
    onmenu: () => void;
  }
  let { session, onagain, onpractise, onmenu }: Props = $props();

  const answers = $derived(session.answers);
  const correctCount = $derived(answers.filter((a) => a.correct).length);
  const starTotal = $derived(answers.reduce((s, a) => s + stars(a.base), 0));
  const isTest = $derived(session.config.type === 'test');
  const mark = $derived(grade(answers.map((a) => a.base)));

  const toPractise: Item[] = $derived.by(() => {
    // Places answered wrong (or skipped), once each, in the order they were asked.
    const mistakes: Item[] = [];
    for (const a of answers) {
      if (!a.correct && !mistakes.some((m) => m.id === a.question.item.id)) mistakes.push(a.question.item);
    }
    if (isTest) return mistakes;
    // In practice, a later correct answer for the same place takes it off the list.
    return mistakes.filter((m) => !answers.filter((a) => a.question.item.id === m.id).at(-1)?.correct);
  });

  const mastered = $derived.by(() => {
    const dirs = [...new Set(session.config.kinds.map(directionOf))];
    return session.listItems.filter((i) => dirs.every((d) => getProgress(session.config.playerId, d, i.id).box >= MASTERED_BOX)).length;
  });

  onMount(() => {
    const great = isTest ? mark >= 8 : answers.length > 0 && correctCount / answers.length >= 0.8;
    if (great) {
      if (settings.sound) playFanfare();
      confetti({ particleCount: 180, spread: 100, origin: { y: 0.6 }, disableForReducedMotion: true });
    }
  });

  function practiseMistakes() {
    const names = new Map(session.config.entries.map((e) => [e.id, e.name]));
    onpractise(toPractise.map((i) => ({ id: i.id, name: names.get(i.id) })));
  }
</script>

<div class="results">
  <h1>{tr().results}</h1>

  <div class="summary card">
    {#if isTest}
      <div class="grade" class:pass={mark >= 5.5}>
        <span class="muted">{tr().yourGrade}</span>
        <strong>{mark.toLocaleString(settings.lang, { minimumFractionDigits: 1 })}</strong>
      </div>
    {/if}
    <div class="numbers">
      <div>
        <span class="muted">{tr().totalPoints}</span>
        <strong class="big">⭐ {session.score.toLocaleString(settings.lang)}</strong>
      </div>
      <div>
        <span class="muted">{fmt(tr().correctCount, { c: correctCount, n: answers.length })}</span>
        <Stars count={Math.round((starTotal / Math.max(1, answers.length * 3)) * 3)} />
      </div>
      {#if session.bestStreak >= 2}
        <div>
          <span class="muted">{tr().streakBonus}</span>
          <strong class="big">🔥 {session.bestStreak}</strong>
        </div>
      {/if}
    </div>
    <div class="mastery">
      <span>{fmt(tr().mastered, { m: mastered, n: session.listItems.length })}</span>
      <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax={session.listItems.length} aria-valuenow={mastered}>
        <div class="fill" style="width: {(100 * mastered) / Math.max(1, session.listItems.length)}%"></div>
      </div>
    </div>
  </div>

  <div class="card practise">
    {#if toPractise.length}
      <h2>{tr().toPractise}</h2>
      <ul>
        {#each toPractise as item (item.id)}
          <li>{session.labelOf(item)} <span class="muted">· {tr().types[item.t]}</span></li>
        {/each}
      </ul>
      <button class="btn accent" onclick={practiseMistakes}>🎯 {tr().practiseMistakes}</button>
    {:else}
      <h2>{tr().allCorrect}</h2>
    {/if}
  </div>

  <div class="actions">
    <button class="btn primary big" onclick={onagain}>🔁 {tr().playAgain}</button>
    <button class="btn big" onclick={onmenu}>{tr().toMenu}</button>
  </div>
</div>

<style>
  .results {
    max-width: 720px;
    margin: 0 auto;
    padding: 24px 16px 48px;
    display: grid;
    gap: 16px;
  }
  h1 {
    margin: 0;
    color: var(--brand);
    text-align: center;
  }
  h2 {
    margin: 0 0 8px;
    font-size: 1.15rem;
  }
  .summary {
    display: grid;
    gap: 16px;
  }
  .grade {
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .grade strong {
    font-size: 4rem;
    line-height: 1;
    color: var(--bad);
  }
  .grade.pass strong {
    color: var(--good-edge);
  }
  .numbers {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-around;
    gap: 16px;
    text-align: center;
  }
  .numbers > div {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }
  .big {
    font-size: 1.8rem;
  }
  .mastery {
    display: grid;
    gap: 6px;
  }
  .bar {
    height: 14px;
    border-radius: 999px;
    background: var(--surface-2);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: linear-gradient(90deg, var(--good), var(--good-edge));
    border-radius: 999px;
    transition: width 0.6s;
  }
  ul {
    margin: 0 0 12px;
    padding-left: 20px;
    columns: 2;
  }
  li {
    break-inside: avoid;
    padding: 2px 0;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    justify-content: center;
  }
  @media (max-width: 480px) {
    ul {
      columns: 1;
    }
  }
</style>
