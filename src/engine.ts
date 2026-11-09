import type { Participant } from "./types";

const TAU = Math.PI * 2;
export const POINTER_ANGLE = 0;

// Spin timing: a constant fast rotation, then a smooth slow-motion stop.
export const FAST_PHASE_SECONDS = 3;
export const SLOW_PHASE_SECONDS = 2;
export const SPIN_DURATION_SECONDS = FAST_PHASE_SECONDS + SLOW_PHASE_SECONDS;

// The three highlighted triangles tile the half-wheel centred on the pointer.
// The middle one is centred exactly on the pointer, so it is the winning slot.
export const HIGHLIGHT_COUNT = 3;
export const HIGHLIGHT_HALF_ANGLE = Math.PI / 2;
export const WINNER_HIGHLIGHT = Math.floor(HIGHLIGHT_COUNT / 2);

export interface HighlightBounds {
  start: number;
  end: number;
  offset: number;
}

/** Angular bounds of each highlighted triangle, relative to the pointer. */
export function highlightBounds(): HighlightBounds[] {
  const slice = (HIGHLIGHT_HALF_ANGLE * 2) / HIGHLIGHT_COUNT;
  return Array.from({ length: HIGHLIGHT_COUNT }, (_, index) => {
    const offset = (index - (HIGHLIGHT_COUNT - 1) / 2) * slice;
    return { start: offset - slice / 2, end: offset + slice / 2, offset };
  });
}

/**
 * Speed is constant for FAST_PHASE_SECONDS, then follows a cubic ease-out over
 * SLOW_PHASE_SECONDS. The cruise distance is chosen so the speed is identical at
 * the hand-over (no jerk) and falls to exactly zero at the end (no abrupt stop).
 */
export function wheelSpinProgress(progress: number): number {
  const clampedProgress = Math.min(1, Math.max(0, progress));
  const decelerationStart = FAST_PHASE_SECONDS / SPIN_DURATION_SECONDS;
  const decelerationDuration = 1 - decelerationStart;
  const cruiseDistance = (3 * decelerationStart) / (1 + 2 * decelerationStart);

  if (clampedProgress <= decelerationStart) {
    return (clampedProgress / decelerationStart) * cruiseDistance;
  }

  const decelerationProgress = (clampedProgress - decelerationStart) / decelerationDuration;
  const remainingDistance = 1 - cruiseDistance;
  return cruiseDistance + remainingDistance * (1 - (1 - decelerationProgress) ** 3);
}

export function secureRandomInt(maxExclusive: number): number {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive < 1) {
    throw new RangeError("The participant count must be a positive safe integer.");
  }
  const range = 0x1_0000_0000;
  if (maxExclusive > range) throw new RangeError("The participant count exceeds the secure random range.");
  const limit = Math.floor(range / maxExclusive) * maxExclusive;
  const value = new Uint32Array(1);
  do {
    crypto.getRandomValues(value);
  } while (value[0] >= limit);
  return value[0] % maxExclusive;
}

export function pickRandomIndex(participants: readonly Participant[]): number {
  if (participants.length === 0) throw new RangeError("There are no eligible participants.");
  return secureRandomInt(participants.length);
}

export function pickWeightedIndex(participants: readonly Participant[]): number {
  if (participants.length === 0) throw new RangeError("There are no eligible participants.");
  const total = participants.reduce((sum, participant) => {
    if (!Number.isFinite(participant.weight) || participant.weight <= 0) {
      throw new RangeError("Every participant must have a positive, finite weight.");
    }
    return sum + participant.weight;
  }, 0);
  if (!Number.isFinite(total) || total <= 0) throw new RangeError("The total weight is invalid.");

  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  return weightedIndexForRoll(participants, random[0] / 0x1_0000_0000);
}

export function weightedIndexForRoll(participants: readonly Participant[], roll: number): number {
  if (participants.length === 0) throw new RangeError("There are no eligible participants.");
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) throw new RangeError("The weighted roll must be between zero and one.");
  const total = participants.reduce((sum, participant) => {
    if (!Number.isFinite(participant.weight) || participant.weight <= 0) {
      throw new RangeError("Every participant must have a positive, finite weight.");
    }
    return sum + participant.weight;
  }, 0);
  if (!Number.isFinite(total) || total <= 0) throw new RangeError("The total weight is invalid.");
  let threshold = roll * total;
  for (let index = 0; index < participants.length; index += 1) {
    threshold -= participants[index].weight;
    if (threshold < 0) return index;
  }
  return participants.length - 1;
}

export function removeParticipantById(participants: readonly Participant[], id: string): Participant[] {
  return participants.filter((participant) => participant.id !== id);
}

export function consumeOverride(overrideId: string | null, selectedId: string): string | null {
  return overrideId === selectedId ? null : overrideId;
}

export function targetRotation(
  current: number,
  index: number,
  count: number,
  rotations: number,
  pointerAngle = POINTER_ANGLE,
): number {
  if (count < 1 || index < 0 || index >= count) throw new RangeError("The selected wheel segment is invalid.");
  const slice = TAU / count;
  const desired = ((pointerAngle + Math.PI / 2 - (index + 0.5) * slice) % TAU + TAU) % TAU;
  const remainder = ((current % TAU) + TAU) % TAU;
  const alignment = (desired - remainder + TAU) % TAU;
  return current + Math.max(1, rotations) * TAU + alignment;
}

export function segmentIndexAtPointer(
  rotation: number,
  count: number,
  pointerAngle = POINTER_ANGLE,
): number {
  if (!Number.isInteger(count) || count < 1) throw new RangeError("The wheel must have at least one segment.");
  if (!Number.isFinite(rotation) || !Number.isFinite(pointerAngle)) {
    throw new RangeError("The wheel rotation and pointer angle must be finite.");
  }
  const slice = TAU / count;
  const offset = ((pointerAngle + Math.PI / 2 - rotation) % TAU + TAU) % TAU;
  return Math.min(count - 1, Math.floor(offset / slice));
}

/** The winning segment: the one under the pointer at this rotation. */
export function winnerIndexAtRotation(rotation: number, count: number): number {
  return segmentIndexAtPointer(rotation, count, POINTER_ANGLE);
}

/** Segment shown in each highlighted triangle (the middle one is the winner). */
export function highlightedSegmentIndices(rotation: number, count: number): number[] {
  return highlightBounds().map((bounds) =>
    segmentIndexAtPointer(rotation, count, POINTER_ANGLE + bounds.offset),
  );
}
