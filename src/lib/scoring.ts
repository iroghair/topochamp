// Scoring rules for "Where is it?" questions (PLAN.md, section 2.5).
import { contains, haversineKm, nearestOnLines, type Nearest } from './geo';
import type { Item, LonLat, Shape } from './types';

export const RULES = {
  /** Full points within this fraction of the map diagonal. */
  fullFrac: 0.02,
  /** Zero points beyond this fraction. */
  zeroFrac: 0.15,
  /** Counts as correct within this fraction (points and lines). */
  okFrac: 0.05,
  /** A click this close to the edge of an area still counts as inside. */
  edgePx: 8,
  /** How far from a dot, ring or river line a click still hits it. */
  snapPxMouse: 14,
  snapPxTouch: 24,
};

export function pointsForDistance(km: number, diagKm: number, rules = RULES): number {
  const full = rules.fullFrac * diagKm;
  const zero = rules.zeroFrac * diagKm;
  if (km <= full) return 100;
  if (km >= zero) return 0;
  return Math.round((100 * (zero - km)) / (zero - full));
}

export type TargetShape = 'point' | 'line' | 'area';

export function targetShape(item: Item, shape: Shape | undefined): TargetShape {
  if (item.t === 'city' || item.pt || !shape) return 'point';
  if (item.t === 'river') return 'line';
  return 'area';
}

/** A place with the geometry the scoring needs. */
export interface Placed {
  item: Item;
  shape?: Shape;
}

export interface WhereInput {
  target: Placed;
  click: LonLat;
  /** Kilometres per screen pixel at the click, at the current zoom. */
  kmPerPx: number;
  diagKm: number;
  /**
   * Markers drawn on the map of the same type as the target, that a click can hit:
   * city dots, rings around tiny areas, river lines. Includes the target when it is drawn.
   */
  markers: Placed[];
  /** Other places on the list of the same type, for the "closer to another place" rule. */
  rivals: Placed[];
  /** The named area under a point, to tell what was clicked ("That's Belgium"). */
  areaAt?: (pt: LonLat) => Item | undefined;
  touch?: boolean;
}

export interface WhereResult {
  base: number;
  correct: boolean;
  distanceKm: number;
  /** What the player clicked instead of the target, if anything. */
  clickedId?: string;
  /** The point of the target closest to the click, for drawing the feedback line. */
  nearest: LonLat;
}

/** Distance from a point to a place: to the dot, the river line or the area's edge. */
export function distanceTo(p: Placed, pt: LonLat): Nearest {
  const kind = targetShape(p.item, p.shape);
  if (kind === 'point' || !p.shape) return { km: haversineKm(pt, [p.item.x, p.item.y]), point: [p.item.x, p.item.y] };
  return nearestOnLines(p.shape.feature.geometry, pt);
}

export function scoreWhere(input: WhereInput, rules = RULES): WhereResult {
  const { target, click, kmPerPx, diagKm } = input;
  const kind = targetShape(target.item, target.shape);
  const toTarget = distanceTo(target, click);
  const points = (km: number) => pointsForDistance(km, diagKm, rules);

  // Areas: anywhere inside counts, also just over the edge.
  if (kind === 'area' && target.shape) {
    if (contains(target.shape.feature.geometry, click) || toTarget.km <= rules.edgePx * kmPerPx) {
      return { base: 100, correct: true, distanceKm: 0, nearest: toTarget.point };
    }
  }

  // A click on a drawn marker (dot, ring, river line) snaps to it.
  const snapKm = (input.touch ? rules.snapPxTouch : rules.snapPxMouse) * kmPerPx;
  let snapped: { p: Placed; km: number } | null = null;
  for (const m of input.markers) {
    const km = distanceTo(m, click).km;
    if (km <= snapKm && (!snapped || km < snapped.km)) snapped = { p: m, km };
  }
  if (snapped) {
    if (snapped.p.item.id === target.item.id) return { base: 100, correct: true, distanceKm: 0, nearest: toTarget.point };
    return { base: points(toTarget.km), correct: false, distanceKm: toTarget.km, clickedId: snapped.p.item.id, nearest: toTarget.point };
  }

  if (kind === 'area') {
    const clicked = input.areaAt?.(click);
    return {
      base: points(toTarget.km),
      correct: false,
      distanceKm: toTarget.km,
      clickedId: clicked && clicked.id !== target.item.id ? clicked.id : undefined,
      nearest: toTarget.point,
    };
  }

  // Points and lines. When the target is drawn, missing its marker is a miss.
  const targetDrawn = input.markers.some((m) => m.item.id === target.item.id);
  let closestRival: { p: Placed; km: number } | null = null;
  for (const r of input.rivals) {
    if (r.item.id === target.item.id) continue;
    const km = distanceTo(r, click).km;
    if (!closestRival || km < closestRival.km) closestRival = { p: r, km };
  }
  const rivalCloser = closestRival !== null && closestRival.km < toTarget.km;
  const correct = !targetDrawn && toTarget.km <= rules.okFrac * diagKm && !rivalCloser;
  return {
    base: points(toTarget.km),
    correct,
    distanceKm: toTarget.km,
    clickedId: rivalCloser && closestRival!.km <= rules.okFrac * diagKm ? closestRival!.p.item.id : undefined,
    nearest: toTarget.point,
  };
}
