<script lang="ts">
  import confetti from 'canvas-confetti';
  import { onDestroy } from 'svelte';
  import { fmt, tr } from '../lib/i18n.svelte';
  import { stars } from '../lib/points';
  import type { Answer, GameSession } from '../lib/session.svelte';
  import { settings } from '../lib/settings.svelte';
  import { playAlmost, playCorrect, playWrong } from '../lib/sound';
  import { spellingDiff } from '../lib/text';
  import MapView, { type MapFeedback, type MapPick } from './MapView.svelte';
  import Stars from './Stars.svelte';

  interface Props {
    session: GameSession;
    onend: () => void;
  }
  let { session, onend }: Props = $props();

  let ringed = $state(new Set<string>());
  let typed = $state('');
  let timer: ReturnType<typeof setTimeout> | null = null;
  let autoMs = $state(0);
  let inputEl: HTMLInputElement | undefined = $state();

  const q = $derived(session.current);
  const answer = $derived(session.lastAnswer);
  const inFeedback = $derived(session.phase === 'feedback' && !!answer);
  const isWhat = $derived(!!q && q.kind !== 'where');
  const hasPanel = $derived(session.config.kinds.some((k) => k !== 'where'));

  const mapFeedback: MapFeedback | null = $derived.by(() => {
    if (!inFeedback || !answer) return null;
    const status = answer.skipped ? 'skipped' : answer.correct ? 'correct' : 'wrong';
    return {
      targetId: answer.question.item.id,
      status,
      click: answer.click,
      nearest: answer.where?.nearest,
      clickedId: answer.where?.clickedId ?? (answer.chosen && !answer.correct ? answer.chosen.id : undefined),
    };
  });

  $effect(() => {
    if (session.phase === 'done') onend();
  });

  // Development hook for automated tests: the running session.
  $effect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __topochamp?: Record<string, unknown> };
    w.__topochamp = { ...w.__topochamp, session };
  });

  // Focus the text field for typing questions.
  $effect(() => {
    if (q?.kind === 'type' && session.phase === 'question') {
      typed = '';
      queueMicrotask(() => inputEl?.focus());
    }
  });

  function clearTimer() {
    if (timer) clearTimeout(timer);
    timer = null;
    autoMs = 0;
  }
  onDestroy(clearTimer);

  function afterAnswer(a: Answer | null) {
    if (!a) return;
    if (settings.sound) {
      if (a.correct) playCorrect(session.streak);
      else if (!a.skipped && a.base >= 40) playAlmost();
      else if (!a.skipped) playWrong();
    }
    if (a.correct && a.base >= 70) {
      confetti({
        particleCount: Math.min(40 + session.streak * 12, 160),
        spread: 70,
        startVelocity: 35,
        origin: { y: 0.75 },
        disableForReducedMotion: true,
      });
    }
    if (settings.feedback === 'auto') {
      autoMs = a.correct ? 2000 : 4000;
      timer = setTimeout(next, autoMs);
    }
  }

  function next() {
    clearTimer();
    session.continue();
  }

  function onpick(pick: MapPick) {
    if (session.phase === 'feedback') {
      if (settings.feedback === 'auto') next();
      return;
    }
    if (q?.kind !== 'where') return;
    afterAnswer(session.answerWhere({ ...pick, ringed }));
  }

  function choose(id: string) {
    const item = q?.options.find((o) => o.id === id);
    if (item) afterAnswer(session.answerChoice(item));
  }

  function submitTyped(e: SubmitEvent) {
    e.preventDefault();
    if (typed.trim()) afterAnswer(session.answerTyped(typed));
  }

  function skip() {
    afterAnswer(session.skip());
  }

  function stop() {
    clearTimer();
    session.stop();
  }

  function onkeydown(e: KeyboardEvent) {
    if (inFeedback && (e.key === ' ' || e.key === 'Enter')) {
      e.preventDefault();
      next();
      return;
    }
    if (session.phase === 'question' && q?.options.length && /^[1-8]$/.test(e.key) && document.activeElement?.tagName !== 'INPUT') {
      const opt = q.options[Number(e.key) - 1];
      if (opt) choose(opt.id);
    }
  }

  const headline = (a: Answer): { text: string; tone: string } => {
    if (a.skipped) return { text: tr().skipped, tone: 'skipped' };
    if (a.correct) return { text: tr().correct[a.question.index % tr().correct.length], tone: 'good' };
    if (a.base >= 40) return { text: tr().almost, tone: 'almost' };
    return { text: tr().wrong, tone: 'bad' };
  };

  const factorChips = (a: Answer) =>
    [
      { icon: '⚡', label: tr().timeBonus, value: a.factors.time },
      { icon: '🔥', label: tr().streakBonus, value: a.factors.streak },
      { icon: '💪', label: tr().difficultyBonus, value: a.factors.difficulty },
    ].filter((f) => f.value !== 1 && a.base > 0);

  const fmtFactor = (v: number) => '×' + (Math.round(v * 100) / 100).toLocaleString(settings.lang);
  const km = (v: number) => (v < 10 ? Math.round(v * 10) / 10 : Math.round(v)).toLocaleString(settings.lang);
</script>

<svelte:window {onkeydown} />

<div class="game">
  <header class="bar">
    <button class="btn ghost stop" onclick={stop} aria-label={tr().stop} title={tr().stop}>✕</button>
    <div class="prompt" aria-live="polite">
      {#if q}
        {#if q.kind === 'where'}
          <span class="ask">{tr().whereIs}</span> <strong class="name">{q.label}</strong><span class="ask">?</span>
        {:else}
          <strong class="name">{tr().whatIsThis[q.item.t]}</strong>
        {/if}
      {/if}
    </div>
    <div class="stats">
      <span class="progress">{fmt(tr().question, { i: Math.min(session.index + (inFeedback ? 0 : 1), session.total), n: session.total })}</span>
      <span class="score" title={tr().points}>⭐ {session.score.toLocaleString(settings.lang)}</span>
      {#if session.streak >= 2}
        <span class="streak" title={tr().streak}>🔥 {session.streak}</span>
      {/if}
    </div>
  </header>

  <div class="map-area">
    <MapView
      pack={session.pack}
      level={session.config.level}
      listIds={session.listIds}
      showRivers={session.config.showRivers}
      showLakes={session.config.showLakes}
      colorUnits={settings.colorUnits}
      highlightId={isWhat && !inFeedback ? q?.item.id : null}
      feedback={mapFeedback}
      interactive={session.phase === 'question' && q?.kind === 'where'}
      {onpick}
      bind:ringed
      labelOf={session.labelOf}
      resetKey={q?.index}
    />

    {#if session.phase === 'question' && session.skipsLeft > 0}
      <button class="btn skip" onclick={skip} title={fmt(tr().skipsLeft, { n: session.skipsLeft })}>
        ⏭ {tr().skip} <span class="skip-count">{session.skipsLeft}</span>
      </button>
    {/if}

    {#if inFeedback && answer}
      {@const h = headline(answer)}
      <div class="feedback {h.tone}" role="status">
        <div class="fb-top">
          <strong class="fb-headline">{h.text}</strong>
          {#if !answer.skipped}
            <Stars count={stars(answer.base)} />
            <span class="fb-points">+{answer.total.toLocaleString(settings.lang)}</span>
          {/if}
        </div>
        {#if factorChips(answer).length}
          <div class="fb-factors">
            {#each factorChips(answer) as f (f.label)}
              <span class="factor">{f.icon} {f.label} {fmtFactor(f.value)}</span>
            {/each}
          </div>
        {/if}
        <div class="fb-details">
          {#if answer.match?.kind === 'typo' && answer.typed}
            <p>
              {tr().typoNote}
              <span class="diff">
                {#each spellingDiff(answer.typed, answer.match.name) as part, i (i)}
                  <span class="d-{part.kind}">{part.text}</span>
                {/each}
              </span>
            </p>
          {:else if !answer.correct && answer.question.kind !== 'where'}
            <p>{tr().answerWas} <strong>{session.nameOf(answer.question.item)}</strong></p>
          {/if}
          {#if answer.where && !answer.correct && !answer.skipped}
            {#if answer.where.clickedId && session.pack.items.get(answer.where.clickedId)}
              {@const clicked = session.pack.items.get(answer.where.clickedId)!}
              <!-- Without dots a click can only be "closer to" another city. -->
              {@const text = clicked.t === 'city' && session.config.level !== 'easy' ? tr().closerTo : tr().thatIs}
              <p>{fmt(text, { name: session.labelOf(clicked) })}</p>
            {/if}
            {#if answer.where.distanceKm > 0}
              <p class="muted">{fmt(tr().kmOff, { km: km(answer.where.distanceKm) })}</p>
            {/if}
          {/if}
        </div>
        <button class="btn primary next" onclick={next}>{tr().next} →</button>
        {#if autoMs}
          {#key answer}
            <div class="auto-bar" style="animation-duration: {autoMs}ms"></div>
          {/key}
        {/if}
      </div>
    {/if}
  </div>

  {#if q && hasPanel}
    <!-- Always there when the round has "What is this?" questions, so the map keeps its size. -->
    <div class="answer-panel">
      {#if q.kind === 'where'}
        <p class="panel-hint">👆 {tr().kindWhereHint}</p>
      {:else if q.kind === 'type'}
        <form class="type-form" onsubmit={submitTyped}>
          <input
            bind:this={inputEl}
            type="text"
            bind:value={typed}
            placeholder={tr().typeHere}
            autocomplete="off"
            autocapitalize="words"
            spellcheck="false"
            aria-label={tr().typeHere}
            disabled={inFeedback}
            class:good={inFeedback && answer?.correct}
            class:bad={inFeedback && !answer?.correct}
          />
          <button class="btn primary" type="submit" disabled={inFeedback || !typed.trim()}>{tr().check}</button>
        </form>
      {:else}
        <div class="options" class:eight={q.options.length > 4}>
          {#each q.options as opt, i (opt.id)}
            <button
              class="btn option"
              class:good={inFeedback && opt.id === q.item.id}
              class:bad={inFeedback && opt.id === answer?.chosen?.id && !answer?.correct}
              disabled={inFeedback}
              onclick={() => choose(opt.id)}
            >
              <span class="key" aria-hidden="true">{i + 1}</span>
              {session.labelOf(opt)}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .game {
    display: flex;
    flex-direction: column;
    height: 100%;
    height: 100dvh;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    z-index: 2;
  }
  .stop {
    font-size: 1.2rem;
  }
  .prompt {
    flex: 1;
    font-size: clamp(1.15rem, 2.6vw, 1.8rem);
    text-align: center;
    min-width: 0;
  }
  .ask {
    color: var(--ink-soft);
  }
  .name {
    color: var(--brand);
  }
  .stats {
    display: flex;
    gap: 10px;
    align-items: center;
    font-weight: 700;
    white-space: nowrap;
  }
  .progress {
    color: var(--ink-soft);
    font-weight: 600;
  }
  .streak {
    color: var(--accent);
  }
  .map-area {
    position: relative;
    flex: 1;
    min-height: 0;
  }
  .skip {
    position: absolute;
    left: 12px;
    bottom: 12px;
  }
  .skip-count {
    background: var(--surface-2);
    border-radius: 999px;
    padding: 0 8px;
    font-size: 0.85rem;
  }
  .feedback {
    position: absolute;
    left: 50%;
    bottom: 12px;
    transform: translateX(-50%);
    width: min(520px, calc(100% - 24px));
    padding: 14px 16px 16px;
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: var(--shadow);
    border-top: 6px solid var(--line);
    overflow: hidden;
    animation: pop 0.2s ease-out;
  }
  @keyframes pop {
    from {
      transform: translate(-50%, 12px);
      opacity: 0;
    }
  }
  .feedback.good {
    border-top-color: var(--good-edge);
  }
  .feedback.almost {
    border-top-color: var(--accent);
  }
  .feedback.bad {
    border-top-color: var(--bad);
  }
  .feedback.skipped {
    border-top-color: var(--answer-edge);
  }
  .fb-top {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .fb-headline {
    font-size: 1.4rem;
  }
  .good .fb-headline {
    color: var(--good-edge);
  }
  .almost .fb-headline {
    color: var(--accent);
  }
  .bad .fb-headline {
    color: var(--bad);
  }
  .fb-points {
    margin-left: auto;
    font-size: 1.3rem;
    font-weight: 800;
    color: var(--brand);
  }
  .fb-factors {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 6px;
  }
  .factor {
    font-size: 0.85rem;
    font-weight: 700;
    background: var(--surface-2);
    border-radius: 999px;
    padding: 2px 10px;
  }
  .fb-details p {
    margin: 6px 0 0;
  }
  .diff {
    font-weight: 800;
    font-size: 1.1rem;
  }
  .d-wrong {
    color: var(--bad);
    text-decoration: line-through;
  }
  .d-missing {
    color: var(--good-edge);
    background: var(--good-soft);
    border-radius: 3px;
    text-decoration: underline;
  }
  .next {
    margin-top: 12px;
    width: 100%;
  }
  .auto-bar {
    position: absolute;
    left: 0;
    bottom: 0;
    height: 4px;
    width: 100%;
    background: var(--brand);
    transform-origin: left;
    animation: shrink linear forwards;
  }
  @keyframes shrink {
    from {
      transform: scaleX(1);
    }
    to {
      transform: scaleX(0);
    }
  }
  .answer-panel {
    padding: 10px 12px calc(10px + env(safe-area-inset-bottom));
    background: var(--surface);
    box-shadow: 0 -2px 8px rgba(20, 40, 70, 0.08);
    z-index: 2;
  }
  .panel-hint {
    margin: 0;
    min-height: 52px;
    display: grid;
    place-items: center;
    color: var(--ink-soft);
    font-weight: 700;
  }
  .options {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
    max-width: 900px;
    margin: 0 auto;
  }
  .options.eight {
    grid-template-columns: repeat(4, 1fr);
  }
  .option {
    justify-content: flex-start;
    min-height: 52px;
    font-size: 1.05rem;
    text-align: left;
  }
  .option:disabled,
  .type-form input:disabled {
    opacity: 1;
  }
  .option.good,
  .type-form input.good {
    background: var(--good-soft);
    border-color: var(--good-edge);
    color: var(--good-edge);
  }
  .option.bad,
  .type-form input.bad {
    background: var(--bad-soft);
    border-color: var(--bad);
    color: var(--bad);
  }
  .key {
    display: inline-grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 6px;
    background: var(--surface-2);
    color: var(--ink-soft);
    font-size: 0.8rem;
    flex-shrink: 0;
  }
  .type-form {
    display: flex;
    gap: 8px;
    max-width: 600px;
    margin: 0 auto;
  }
  .type-form input {
    font-size: 1.2rem;
  }
  /* On wide screens the panel sits in the bottom-left corner, which is usually sea or a
     neighbouring country, so the region itself stays visible. */
  @media (min-width: 900px) {
    .feedback {
      left: 12px;
      transform: none;
      width: 380px;
      animation-name: pop-corner;
    }
  }
  @keyframes pop-corner {
    from {
      transform: translateY(12px);
      opacity: 0;
    }
  }
  @media (max-width: 700px) {
    .options.eight {
      grid-template-columns: repeat(2, 1fr);
    }
    .stats .progress {
      display: none;
    }
    .option {
      min-height: 46px;
    }
  }
</style>
