// Game options, remembered between visits.
import { readJson, writeJson } from './storage';
import type { Spelling } from './text';
import type { Lang, Level, QuestionKind, SessionType } from './types';

export interface Settings {
  lang: Lang;
  packId: string;
  /** Selected learning list per pack ('default' = the pack's own list). */
  listByPack: Record<string, string>;
  level: Level;
  kinds: QuestionKind[];
  sessionType: SessionType;
  length: 10 | 20 | 30;
  spelling: Spelling;
  /** 'auto' moves on after a few seconds, 'manual' waits for the Next button. */
  feedback: 'auto' | 'manual';
  /** Draw rivers and lakes on the map. Separate from whether they are asked (that is the list). */
  showRivers: boolean;
  showLakes: boolean;
  /** Fill countries/provinces with light tones (not on Hard: that would show the borders). */
  colorUnits: boolean;
  sound: boolean;
}

const DEFAULTS: Settings = {
  lang: 'nl',
  packId: 'NLD',
  listByPack: {},
  level: 'easy',
  kinds: ['where'],
  sessionType: 'practice',
  length: 20,
  spelling: 'lenient',
  feedback: 'auto',
  showRivers: true,
  showLakes: true,
  colorUnits: true,
  sound: true,
};

export const settings: Settings = $state({ ...DEFAULTS, ...readJson<Partial<Settings>>('settings', {}) });

$effect.root(() => {
  $effect(() => writeJson('settings', $state.snapshot(settings)));
});
