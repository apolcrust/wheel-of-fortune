import type { Participant } from "./types";

const TAU = Math.PI * 2;
export const POINTER_ANGLE = 0;

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
