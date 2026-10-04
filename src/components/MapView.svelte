<script lang="ts" module>
  import type { LonLat } from '../lib/types';

  export interface MapFeedback {
    targetId: string;
    status: 'correct' | 'wrong' | 'skipped';
    click?: LonLat;
    nearest?: LonLat;
    clickedId?: string;
  }

  export interface MapPick {
    lonlat: LonLat;
    kmPerPx: number;
    touch: boolean;
  }
</script>

<script lang="ts">
  import { geoPath, type GeoPermissibleObjects } from 'd3-geo';
  import { select } from 'd3-selection';
  import 'd3-transition';
  import { zoom, zoomIdentity, type D3ZoomEvent, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
  import { onMount, untrack } from 'svelte';
  import { haversineKm } from '../lib/geo';
  import { tr } from '../lib/i18n.svelte';
  import { TONES, type LoadedPack } from '../lib/packs';
  import { frameShape, makeProjection, maxZoom } from '../lib/projection';
  import type { Item, Level } from '../lib/types';

  interface Props {
    pack: LoadedPack;
    level: Level;
    /** Places on the learning list; only these get dots and rings. */
    listIds: Set<string>;
    /** Draw rivers and lakes (all of them, whether they are asked or not; major lakes always). */
    showRivers?: boolean;
    showLakes?: boolean;
    /** Fill units with light tones (ignored on Hard, where it would show the borders). */
    colorUnits?: boolean;
    /** The place asked in a "What is this?" question. */
    highlightId?: string | null;
    feedback?: MapFeedback | null;
    interactive?: boolean;
    onpick?: (pick: MapPick) => void;
    /** Areas drawn with a ring because they are too small to see (output). */
    ringed?: Set<string>;
    labelOf: (item: Item) => string;
    /** Changing this resets the zoom (e.g. a new question). */
    resetKey?: unknown;
  }

  let {
    pack,
    level,
    listIds,
    showRivers = true,
    showLakes = true,
    colorUnits = true,
    highlightId = null,
    feedback = null,
    interactive = true,
    onpick,
    ringed = $bindable(new Set<string>()),
    labelOf,
    resetKey,
  }: Props = $props();

  /** Natural Earth scale rank up to which a lake is drawn even when lakes are switched off. */
  const MAJOR_LAKE_RANK = 2;

  let width = $state(0);
  let height = $state(0);
  let svgEl: SVGSVGElement;
  let transform: ZoomTransform = $state(zoomIdentity);
  let zoomer: ZoomBehavior<SVGSVGElement, unknown> | null = null;

  const projection = $derived(width > 0 && height > 0 ? makeProjection(pack.file, width, height) : null);
  const path = $derived(projection ? geoPath(projection).digits(1) : null);
  const k = $derived(transform.k);

  const d = (obj: GeoPermissibleObjects | undefined | null): string => (obj && path ? (path(obj) ?? '') : '');
  const shapeD = (id: string): string => d(pack.shapes.get(id)?.feature);
  const at = (ll: LonLat): [number, number] => projection?.(ll) ?? [NaN, NaN];

  const seaD = $derived(d(frameShape(pack.file) as GeoPermissibleObjects));
  const othersD = $derived(path ? pack.layers.others.map((f) => d(f)).join('') : '');
  const unitsD = $derived(path ? pack.layers.units.map((f) => d(f)).join('') : '');
  const toned = $derived(colorUnits && level !== 'hard');
  // One path per tone keeps the number of elements small.
  const tonePaths = $derived.by(() => {
    if (!toned || !path) return [];
    const byTone: string[] = Array(TONES).fill('');
    for (const f of pack.layers.units) byTone[pack.unitTones.get(String(f.id)) ?? 0] += d(f);
    return byTone.map((dd, tone) => ({ tone, d: dd }));
  });
  const innerD = $derived(d(pack.innerBorders));
  const outlineD = $derived(d(pack.outline));

  const listItems = $derived([...listIds].map((id) => pack.items.get(id)).filter((i): i is Item => !!i));
  // listIds is read so that custom rivers and lakes added to a list show up right away.
  const rivers = $derived(
    showRivers && listIds
      ? pack.layers.rivers.map((f) => {
          const id = String(f.id);
          return { id, d: shapeD(id), major: (pack.items.get(id)?.rank ?? 99) <= 4 };
        })
      : [],
  );
  // Major lakes (IJsselmeer, Lake Geneva) are part of the coastline and always drawn.
  const lakes = $derived(
    listIds
      ? pack.layers.lakes
          .filter((f) => showLakes || (pack.items.get(String(f.id))?.rank ?? 99) <= MAJOR_LAKE_RANK)
          .map((f) => ({ id: String(f.id), d: d(f) }))
      : [],
  );
  const dots = $derived(level === 'easy' ? listItems.filter((i) => i.t === 'city').map((i) => ({ id: i.id, p: at([i.x, i.y]) })) : []);

  /** Listed areas that are too small to see get a ring (and always when they are points). */
  const tiny = $derived.by(() => {
    const set = new Set<string>();
    if (!path) return set;
    for (const i of listItems) {
      if (i.t === 'city' || i.t === 'river') continue;
      const s = pack.shapes.get(i.id);
      if (i.pt || !s) {
        set.add(i.id);
        continue;
      }
      const [[x0, y0], [x1, y1]] = path.bounds(s.feature);
      if (Math.max(x1 - x0, y1 - y0) < 8) set.add(i.id);
    }
    return set;
  });
  $effect(() => {
    ringed = tiny;
  });
  const rings = $derived(level === 'easy' ? [...tiny].map((id) => pack.items.get(id)!).map((i) => ({ id: i.id, p: at([i.x, i.y]) })) : []);

  /* ───── zoom ───── */

  onMount(() => {
    zoomer = zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, maxZoom(pack.file)])
      .clickDistance(6)
      .on('zoom', (e: D3ZoomEvent<SVGSVGElement, unknown>) => {
        transform = e.transform;
      });
    const sel = select(svgEl);
    sel.call(zoomer).on('dblclick.zoom', null);
    return () => {
      sel.on('.zoom', null);
    };
  });

  $effect(() => {
    if (!zoomer || !width || !height) return;
    zoomer.extent([
      [0, 0],
      [width, height],
    ]);
    // Panning stays within the map as fitted: no wandering off.
    zoomer.translateExtent([
      [0, 0],
      [width, height],
    ]);
  });

  function applyTransform(t: ZoomTransform, animate = true) {
    if (!zoomer) return;
    const sel = select(svgEl);
    if (animate) sel.transition().duration(450).call(zoomer.transform, t);
    else sel.call(zoomer.transform, t);
  }

  export function resetZoom(animate = true) {
    applyTransform(zoomIdentity, animate);
  }

  function zoomBy(factor: number) {
    if (!zoomer) return;
    select(svgEl).transition().duration(250).call(zoomer.scaleBy, factor);
  }

  /** Zooms in on a point, keeping the view inside the map. */
  function focusOn([x, y]: [number, number], scale: number) {
    const s = Math.min(scale, maxZoom(pack.file));
    const tx = Math.min(0, Math.max(width - width * s, width / 2 - x * s));
    const ty = Math.min(0, Math.max(height - height * s, height / 2 - y * s));
    applyTransform(zoomIdentity.translate(tx, ty).scale(s));
  }

  $effect(() => {
    void resetKey;
    untrack(() => resetZoom());
  });

  // A tiny place in a "What is this?" question: zoom in so it can be seen.
  $effect(() => {
    const id = highlightId;
    if (!id || !projection) return;
    untrack(() => {
      const item = pack.items.get(id);
      if (item && tiny.has(id)) focusOn(at([item.x, item.y]), 4);
    });
  });

  // Make sure the answer is visible during feedback.
  $effect(() => {
    const fb = feedback;
    if (!fb || !projection) return;
    untrack(() => {
      const item = pack.items.get(fb.targetId);
      if (!item) return;
      const [x, y] = transform.apply(at([item.x, item.y]));
      if (x < 0 || y < 0 || x > width || y > height) resetZoom();
    });
  });

  // Development hook for automated tests: where a lon/lat is on screen.
  $effect(() => {
    if (!import.meta.env.DEV || !projection) return;
    const w = window as unknown as { __topochamp?: Record<string, unknown> };
    w.__topochamp = {
      ...w.__topochamp,
      screenPoint: (ll: LonLat) => {
        const rect = svgEl.getBoundingClientRect();
        const [x, y] = transform.apply(at(ll));
        return [rect.left + x, rect.top + y];
      },
    };
  });

  /* ───── clicks ───── */

  function handleClick(e: MouseEvent) {
    if (!interactive || !projection || !onpick) return;
    const rect = svgEl.getBoundingClientRect();
    const [x, y] = transform.invert([e.clientX - rect.left, e.clientY - rect.top]);
    const ll = projection.invert?.([x, y]);
    const ll2 = projection.invert?.([x + 1 / transform.k, y]);
    if (!ll || !Number.isFinite(ll[0]) || !Number.isFinite(ll[1])) return;
    const kmPerPx = ll2 ? haversineKm([ll[0], ll[1]], [ll2[0], ll2[1]]) : 1;
    const pointerType = (e as PointerEvent).pointerType;
    onpick({ lonlat: [ll[0], ll[1]], kmPerPx, touch: pointerType === 'touch' || pointerType === 'pen' });
  }

  /* ───── highlight & feedback ───── */

  type Mark = { id: string; item: Item; kind: 'point' | 'line' | 'area'; d: string; p: [number, number]; ring: boolean };

  function mark(id: string | null | undefined): Mark | null {
    if (!id) return null;
    const item = pack.items.get(id);
    if (!item) return null;
    const ring = tiny.has(id);
    const kind = item.t === 'city' || item.pt || !pack.shapes.has(id) ? 'point' : item.t === 'river' ? 'line' : 'area';
    return { id, item, kind, d: kind === 'point' ? '' : shapeD(id), p: at([item.x, item.y]), ring };
  }

  const highlight = $derived(path ? mark(highlightId) : null);
  const target = $derived(path && feedback ? mark(feedback.targetId) : null);
  const clicked = $derived(path && feedback?.clickedId ? mark(feedback.clickedId) : null);
  const clickPt = $derived(feedback?.click && projection ? at(feedback.click) : null);
  const nearestPt = $derived(feedback?.nearest && projection ? at(feedback.nearest) : null);
  const showLine = $derived(feedback && feedback.status !== 'correct' && clickPt && nearestPt);
</script>

<div class="map" class:interactive bind:clientWidth={width} bind:clientHeight={height}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <svg bind:this={svgEl} {width} {height} onclick={handleClick} role="img" aria-label={pack.file.nl}>
    <g transform={transform.toString()}>
      <path class="sea" d={seaD} />
      <path class="other" d={othersD} />
      {#if toned}
        {#each tonePaths as t (t.tone)}
          <path class="unit tone-{t.tone}" d={t.d} />
        {/each}
      {:else}
        <path class="unit" d={unitsD} />
      {/if}
      {#each lakes as lake (lake.id)}
        <path class="lake" d={lake.d} />
      {/each}

      {#if highlight && highlight.kind === 'area'}
        <path class="hl-area hl-{highlight.item.t}" d={highlight.d} />
      {/if}
      {#if clicked && clicked.kind === 'area' && feedback?.status === 'wrong'}
        <path class="fb-clicked-area" d={clicked.d} />
      {/if}
      {#if target && target.kind === 'area'}
        <path class="fb-area fb-{feedback?.status}" d={target.d} />
      {/if}

      {#if level !== 'hard'}
        <path class="borders" d={innerD} />
      {/if}
      <path class="outline" d={outlineD} />

      {#each rivers as river (river.id)}
        <path class="river" class:major={river.major} d={river.d} />
      {/each}
      {#if highlight && highlight.kind === 'line'}
        <path class="hl-line" d={highlight.d} />
      {/if}
      {#if clicked && clicked.kind === 'line'}
        <path class="fb-clicked-line" d={clicked.d} />
      {/if}
      {#if target && target.kind === 'line'}
        <path class="fb-line fb-{feedback?.status}" d={target.d} />
      {/if}

      {#each rings as r (r.id)}
        <circle class="ring" cx={r.p[0]} cy={r.p[1]} r={10 / k} />
      {/each}
      {#each dots as dot (dot.id)}
        <circle class="dot" cx={dot.p[0]} cy={dot.p[1]} r={4.5 / k} />
      {/each}

      {#if highlight && (highlight.kind === 'point' || highlight.ring)}
        <g class="pulse">
          <circle class="hl-point" cx={highlight.p[0]} cy={highlight.p[1]} r={(highlight.kind === 'point' && !highlight.ring ? 7 : 12) / k} />
        </g>
      {/if}

      {#if showLine && clickPt && nearestPt}
        <line class="fb-distance" x1={clickPt[0]} y1={clickPt[1]} x2={nearestPt[0]} y2={nearestPt[1]} />
      {/if}
      {#if clicked && clicked.kind === 'point'}
        <circle class="fb-clicked-point" cx={clicked.p[0]} cy={clicked.p[1]} r={(clicked.ring ? 11 : 6) / k} />
      {/if}
      {#if target && (target.kind === 'point' || target.ring)}
        <g class="pulse">
          <circle class="fb-point fb-{feedback?.status}" cx={target.p[0]} cy={target.p[1]} r={(target.ring ? 12 : 7) / k} />
        </g>
      {/if}
      {#if clickPt}
        <g class="fb-click fb-{feedback?.status}" transform="translate({clickPt[0]},{clickPt[1]}) scale({1 / k})">
          <line x1="-7" y1="-7" x2="7" y2="7" />
          <line x1="-7" y1="7" x2="7" y2="-7" />
        </g>
      {/if}

      {#if clicked && feedback?.status === 'wrong'}
        <text class="label label-clicked" x={clicked.p[0]} y={clicked.p[1] - 12 / k} font-size={14 / k} stroke-width={4 / k}>{labelOf(clicked.item)}</text>
      {/if}
      {#if target}
        <text
          class="label label-target"
          x={target.p[0]}
          y={target.p[1] - (target.kind === 'area' && !target.ring ? 0 : 13 / k)}
          font-size={17 / k}
          stroke-width={5 / k}
        >
          {labelOf(target.item)}
        </text>
      {/if}
    </g>
  </svg>

  <div class="zoom-controls">
    <button type="button" onclick={() => zoomBy(1.6)} aria-label={tr().zoomIn} title={tr().zoomIn}>+</button>
    <button type="button" onclick={() => zoomBy(1 / 1.6)} aria-label={tr().zoomOut} title={tr().zoomOut}>−</button>
    <button type="button" onclick={() => resetZoom()} aria-label={tr().zoomReset} title={tr().zoomReset}>⤢</button>
  </div>
</div>

<style>
  .map {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--map-sea);
  }
  svg {
    display: block;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
  }
  .interactive svg {
    cursor: crosshair;
  }
  path,
  line,
  circle {
    vector-effect: non-scaling-stroke;
  }
  .sea {
    fill: var(--map-sea);
  }
  .other {
    fill: var(--map-other);
  }
  .unit {
    fill: var(--map-land);
  }
  .tone-0 {
    fill: var(--map-tone-0);
  }
  .tone-1 {
    fill: var(--map-tone-1);
  }
  .tone-2 {
    fill: var(--map-tone-2);
  }
  .tone-3 {
    fill: var(--map-tone-3);
  }
  .tone-4 {
    fill: var(--map-tone-4);
  }
  .tone-5 {
    fill: var(--map-tone-5);
  }
  .lake {
    fill: var(--map-sea);
    stroke: var(--map-river);
    stroke-width: 0.8;
  }
  .borders {
    fill: none;
    stroke: var(--map-border);
    stroke-width: 1;
    stroke-linejoin: round;
  }
  .outline {
    fill: none;
    stroke: var(--map-coast);
    stroke-width: 1.3;
    stroke-linejoin: round;
  }
  .river {
    fill: none;
    stroke: var(--map-river);
    stroke-width: 0.9;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .river.major {
    stroke-width: 1.5;
  }
  .dot {
    fill: var(--map-dot);
    stroke: #fff;
    stroke-width: 1.5;
  }
  .ring {
    fill: none;
    stroke: var(--map-border);
    stroke-width: 1.5;
    stroke-dasharray: 3 2;
  }
  .hl-area {
    fill: var(--hl);
    fill-opacity: 0.75;
    stroke: var(--hl-edge);
    stroke-width: 2;
  }
  .hl-area.hl-sea,
  .hl-area.hl-lake {
    fill: var(--hl-water);
  }
  .hl-line {
    fill: none;
    stroke: var(--hl-edge);
    stroke-width: 6;
    stroke-linecap: round;
  }
  .hl-point {
    fill: var(--hl);
    stroke: var(--hl-edge);
    stroke-width: 2.5;
  }
  .pulse {
    transform-box: fill-box;
    transform-origin: center;
    animation: pulse 1.1s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      transform: scale(1.35);
    }
  }
  .fb-area {
    fill-opacity: 0.6;
    stroke-width: 2.5;
  }
  .fb-correct {
    fill: var(--good);
    stroke: var(--good-edge);
  }
  .fb-wrong,
  .fb-skipped {
    fill: var(--answer);
    stroke: var(--answer-edge);
  }
  .fb-line {
    fill: none !important;
    stroke-width: 6;
    stroke-linecap: round;
  }
  .fb-line.fb-correct {
    stroke: var(--good-edge);
  }
  .fb-line.fb-wrong,
  .fb-line.fb-skipped {
    stroke: var(--answer-edge);
  }
  .fb-point {
    stroke-width: 2.5;
  }
  .fb-clicked-area {
    fill: var(--bad);
    fill-opacity: 0.35;
    stroke: var(--bad);
    stroke-width: 1.5;
  }
  .fb-clicked-line {
    fill: none;
    stroke: var(--bad);
    stroke-width: 4;
    opacity: 0.7;
  }
  .fb-clicked-point {
    fill: var(--bad);
    stroke: #fff;
    stroke-width: 2;
  }
  .fb-distance {
    stroke: var(--ink);
    stroke-width: 2;
    stroke-dasharray: 6 4;
  }
  .fb-click line {
    stroke-width: 3.5;
    stroke-linecap: round;
  }
  .fb-click.fb-correct line {
    stroke: var(--good-edge);
  }
  .fb-click.fb-wrong line,
  .fb-click.fb-skipped line {
    stroke: var(--bad);
  }
  .label {
    font-weight: 700;
    text-anchor: middle;
    dominant-baseline: auto;
    paint-order: stroke;
    stroke: #fff;
    stroke-linejoin: round;
    pointer-events: none;
  }
  .label-target {
    fill: var(--ink);
  }
  .label-clicked {
    fill: var(--bad);
  }
  .zoom-controls {
    position: absolute;
    right: 12px;
    bottom: 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .zoom-controls button {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--ink);
    font-size: 22px;
    line-height: 1;
    box-shadow: var(--shadow-sm);
    cursor: pointer;
  }
  .zoom-controls button:hover {
    background: var(--surface-2);
  }
</style>
