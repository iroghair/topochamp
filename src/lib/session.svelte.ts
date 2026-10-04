// One round of the game: asking questions, scoring answers and keeping progress.
import { contains, inBox } from './geo';
import type { ListEntry } from './lists.svelte';
import type { LoadedPack } from './packs';
import { getProgress, recordAnswer } from './players.svelte';
import { totalPoints, type Factors } from './points';
import { acceptedNames, choiceOptions, makeLabelOf, makeNameOf, type NameOf } from './questions';
import { PracticeScheduler, shuffle, type Rng } from './scheduler';
import { scoreWhere, targetShape, type Placed, type WhereResult } from './scoring';
import { matchAnswer, type MatchResult, type Spelling } from './text';
import {
  directionOf,
  type Item,
  type ItemType,
  type Lang,
  type Level,
  type LonLat,
  type QuestionKind,
  type SessionType,
} from './types';

export const SKIPS_PER_SESSION = 2;
/** Points for a typed answer with a typo, in lenient spelling mode. */
export const TYPO_POINTS = 75;

export interface SessionConfig {
  pack: LoadedPack;
  entries: ListEntry[];
  level: Level;
  kinds: QuestionKind[];
  type: SessionType;
  length: number;
  spelling: Spelling;
  /** Rivers and lakes drawn on the map (a click on a drawn river snaps to it). */
  showRivers: boolean;
  showLakes: boolean;
  playerId: string;
  lang: Lang;
  typeName: (t: ItemType) => string;
  rng?: Rng;
}

export interface Question {
  index: number;
  item: Item;
  kind: QuestionKind;
  /** The name as shown in the question, with a type hint when the name is ambiguous. */
  label: string;
  options: Item[];
  startedAt: number;
}

export interface Answer {
  question: Question;
  base: number;
  total: number;
  factors: Factors;
  correct: boolean;
  skipped: boolean;
  seconds: number;
  click?: LonLat;
  where?: WhereResult;
  chosen?: Item;
  typed?: string;
  match?: MatchResult;
}

export interface WhereClick {
  lonlat: LonLat;
  kmPerPx: number;
  touch: boolean;
  /** Areas drawn with a ring because they are tiny on screen. */
  ringed: Set<string>;
}

export class GameSession {
  readonly config: SessionConfig;
  readonly pack: LoadedPack;
  readonly listItems: Item[];
  readonly listIds: Set<string>;
  readonly nameOf: NameOf;
  readonly labelOf: NameOf;
  readonly total: number;

  phase: 'question' | 'feedback' | 'done' = $state('question');
  current: Question | null = $state(null);
  lastAnswer: Answer | null = $state(null);
  answers: Answer[] = $state([]);
  score = $state(0);
  streak = $state(0);
  bestStreak = $state(0);
  skipsLeft = $state(SKIPS_PER_SESSION);

  private readonly rng: Rng;
  private readonly scheduler: PracticeScheduler | null;
  private readonly testQueue: string[];

  constructor(config: SessionConfig) {
    this.config = config;
    this.pack = config.pack;
    this.rng = config.rng ?? Math.random;
    this.listItems = config.entries.map((e) => this.pack.items.get(e.id)).filter((i): i is Item => !!i);
    this.listIds = new Set(this.listItems.map((i) => i.id));
    const custom = new Map(config.entries.filter((e) => e.name).map((e) => [e.id, e.name!]));
    this.nameOf = makeNameOf(custom, config.lang);
    this.labelOf = makeLabelOf(this.listItems, this.nameOf, config.typeName);

    const ids = this.listItems.map((i) => i.id);
    if (config.type === 'test') {
      this.scheduler = null;
      this.testQueue = shuffle(ids, this.rng);
      this.total = ids.length;
      this.skipsLeft = 0;
    } else {
      // The box decides how often a place comes back; with mixed question kinds the
      // direction that most needs practice counts (box 1 = wrong recently, the highest weight).
      const dirs = [...new Set(config.kinds.map(directionOf))];
      const boxOf = (id: string) => {
        const boxes = dirs.map((d) => this.boxFor(d, id));
        return boxes.includes(1) ? 1 : Math.min(...boxes);
      };
      this.scheduler = new PracticeScheduler(ids, boxOf, this.rng);
      this.testQueue = [];
      this.total = config.length;
    }
    this.nextQuestion();
  }

  private boxFor(dir: 'where' | 'what', id: string): number {
    return getProgress(this.config.playerId, dir, id).box;
  }

  get index(): number {
    return this.answers.length;
  }

  nextQuestion(): void {
    if (this.index >= this.total || !this.listItems.length) {
      this.phase = 'done';
      this.current = null;
      return;
    }
    const id = this.scheduler ? this.scheduler.next(this.index) : this.testQueue[this.index];
    const item = this.pack.items.get(id)!;
    const kinds = this.config.kinds.length ? this.config.kinds : (['where'] as QuestionKind[]);
    const kind = kinds[Math.floor(this.rng() * kinds.length)];
    const options =
      kind === 'choice4' || kind === 'choice8'
        ? choiceOptions(item, kind === 'choice4' ? 4 : 8, this.listItems, this.pack, this.labelOf, this.rng)
        : [];
    this.current = { index: this.index, item, kind, label: this.labelOf(item), options, startedAt: performance.now() };
    this.lastAnswer = null;
    this.phase = 'question';
  }

  /* ───── "Where is it?" ───── */

  /**
   * What is drawn on the map that a click on the target can hit: all drawn rivers for a
   * river; on Easy the dots of listed cities, or the rings of tiny listed areas.
   */
  markersFor(target: Item, ringed: Set<string>): Placed[] {
    const shapeKind = targetShape(target, this.pack.shapes.get(target.id));
    if (shapeKind === 'line') {
      if (!this.config.showRivers) return [];
      return this.pack.layers.rivers
        .map((f) => this.pack.items.get(String(f.id)))
        .filter((item): item is Item => !!item)
        .map((item) => ({ item, shape: this.pack.shapes.get(item.id) }));
    }
    if (this.config.level !== 'easy') return [];
    return this.listItems
      .filter((i) => i.t === target.t && (i.t === 'city' || !!i.pt || ringed.has(i.id)))
      .map((item) => ({ item, shape: this.pack.shapes.get(item.id) }));
  }

  /**
   * The named place under a point: a listed area, a lake, else the country or province.
   * With `parts`, a part of a country (Engeland) comes before the country itself.
   */
  areaAt(pt: LonLat, parts = false): Item | undefined {
    const hit = (id: string) => {
      const s = this.pack.shapes.get(id);
      return !!s && inBox(pt, s.bbox) && contains(s.feature.geometry, pt);
    };
    for (const i of this.listItems) if (!['city', 'river'].includes(i.t) && !i.pt && hit(i.id)) return i;
    for (const layer of parts ? (['lakes', 'parts', 'units', 'others'] as const) : (['lakes', 'units', 'others'] as const)) {
      for (const f of this.pack.layers[layer]) {
        const id = String(f.id);
        if (hit(id) && this.pack.items.has(id)) return this.pack.items.get(id);
      }
    }
    return undefined;
  }

  answerWhere(click: WhereClick): Answer | null {
    const q = this.current;
    if (!q || this.phase !== 'question' || q.kind !== 'where') return null;
    const target: Placed = { item: q.item, shape: this.pack.shapes.get(q.item.id) };
    const result = scoreWhere({
      target,
      click: click.lonlat,
      kmPerPx: click.kmPerPx,
      diagKm: this.pack.file.diagKm,
      markers: this.markersFor(q.item, click.ringed),
      rivals: this.listItems.filter((i) => i.t === q.item.t).map((item) => ({ item, shape: this.pack.shapes.get(item.id) })),
      areaAt: (pt) => this.areaAt(pt, q.item.t === 'part'),
      touch: click.touch,
    });
    return this.finishAnswer({ base: result.base, correct: result.correct, click: click.lonlat, where: result });
  }

  /* ───── "What is this?" ───── */

  answerChoice(chosen: Item): Answer | null {
    const q = this.current;
    if (!q || this.phase !== 'question' || !q.options.length) return null;
    const correct = chosen.id === q.item.id;
    return this.finishAnswer({ base: correct ? 100 : 0, correct, chosen });
  }

  answerTyped(typed: string): Answer | null {
    const q = this.current;
    if (!q || this.phase !== 'question' || q.kind !== 'type') return null;
    const strict = this.config.spelling === 'strict';
    const match = matchAnswer(typed, acceptedNames(q.item, this.nameOf(q.item), this.config.lang, strict), this.config.spelling);
    const base = match.kind === 'exact' ? 100 : match.kind === 'typo' ? TYPO_POINTS : 0;
    return this.finishAnswer({ base, correct: match.kind !== 'wrong', typed, match });
  }

  /* ───── skipping, stopping ───── */

  /** Shows the answer without points; the place comes back later in the round. */
  skip(): Answer | null {
    if (!this.current || this.phase !== 'question' || this.skipsLeft <= 0) return null;
    this.skipsLeft--;
    return this.finishAnswer({ base: 0, correct: false, skipped: true });
  }

  stop(): void {
    this.phase = 'done';
    this.current = null;
  }

  continue(): void {
    if (this.phase === 'feedback') this.nextQuestion();
  }

  private finishAnswer(a: Pick<Answer, 'base' | 'correct'> & Partial<Answer>): Answer {
    const q = this.current!;
    const seconds = (performance.now() - q.startedAt) / 1000;
    this.streak = a.correct ? this.streak + 1 : 0;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    const { total, factors } = totalPoints(a.base, a.correct, {
      seconds,
      streak: this.streak,
      level: this.config.level,
      kind: q.kind,
    });
    const answer: Answer = { skipped: false, ...a, question: q, total, factors, seconds };
    this.score += total;
    this.answers.push(answer);
    this.lastAnswer = answer;
    recordAnswer(this.config.playerId, directionOf(q.kind), q.item.id, a.correct);
    if (!a.correct) this.scheduler?.scheduleRetry(q.item.id, q.index);
    this.phase = 'feedback';
    return answer;
  }
}
