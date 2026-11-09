import { describe, expect, it } from "vitest";
import {
  consumeOverride,
  FAST_PHASE_SECONDS,
  highlightBounds,
  highlightedSegmentIndices,
  POINTER_ANGLE,
  removeParticipantById,
  segmentIndexAtPointer,
  SLOW_PHASE_SECONDS,
  SPIN_DURATION_SECONDS,
  targetRotation,
  weightedIndexForRoll,
  wheelSpinProgress,
  WINNER_HIGHLIGHT,
  winnerIndexAtRotation,
} from "./engine";
import type { Participant } from "./types";

const participants: Participant[] = [
  { id: "a", name: "Ada", weight: 1 },
  { id: "b", name: "Ben", weight: 3 },
];

describe("weighted selection", () => {
  it("maps random rolls to the correct weight intervals", () => {
    expect(weightedIndexForRoll(participants, 0)).toBe(0);
    expect(weightedIndexForRoll(participants, 0.249)).toBe(0);
    expect(weightedIndexForRoll(participants, 0.25)).toBe(1);
    expect(weightedIndexForRoll(participants, 0.999)).toBe(1);
  });

  it("rejects invalid weights and rolls", () => {
    expect(() => weightedIndexForRoll([], 0)).toThrow();
    expect(() => weightedIndexForRoll(participants, 1)).toThrow();
    expect(() => weightedIndexForRoll([{ ...participants[0], weight: 0 }], 0.5)).toThrow();
  });
});

describe("wheel alignment", () => {
  it("spins for 5 seconds: 3 fast, then 2 slowing", () => {
    expect(FAST_PHASE_SECONDS).toBe(3);
    expect(SLOW_PHASE_SECONDS).toBe(2);
    expect(SPIN_DURATION_SECONDS).toBe(5);
  });

  it("holds a constant fast speed for the first 3 s, then decelerates smoothly to a stop", () => {
    const at = (seconds: number) => wheelSpinProgress(seconds / SPIN_DURATION_SECONDS);
    const speed = (seconds: number, step = 1e-4) => (at(seconds + step) - at(seconds - step)) / (2 * step);

    expect(wheelSpinProgress(0)).toBe(0);
    expect(wheelSpinProgress(1)).toBe(1);
    expect(wheelSpinProgress(-1)).toBe(0);
    expect(wheelSpinProgress(2)).toBe(1);

    // Fast phase: perfectly linear, so the speed is the same at every moment.
    expect(at(1.5)).toBeCloseTo(at(3) / 2, 10);
    expect(speed(0.5)).toBeCloseTo(speed(2.5), 6);

    // Hand-over at 3 s has no jump in position or speed.
    expect(speed(3 - 1e-3)).toBeCloseTo(speed(3 + 1e-3), 2);

    // Slow phase: speed only ever falls, and is ~0 at the end (no abrupt stop).
    let previous = speed(3.05);
    for (let seconds = 3.2; seconds <= 4.9; seconds += 0.1) {
      const current = speed(seconds);
      expect(current).toBeLessThan(previous);
      previous = current;
    }
    expect(speed(4.99, 1e-3)).toBeLessThan(speed(0.5) * 0.001);

    // Never moves backwards.
    for (let step = 1; step <= 1000; step += 1) {
      expect(wheelSpinProgress(step / 1000)).toBeGreaterThanOrEqual(wheelSpinProgress((step - 1) / 1000));
    }
  });

  it.each([1, 2, 17, 100])("stops at the center of the requested segment for %i entries", (count) => {
    const index = count - 1;
    const rotation = targetRotation(2.3, index, count, 5, -Math.PI / 2);
    const pointerPosition = ((-Math.PI / 2 - (-Math.PI / 2 + rotation)) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    const slice = (Math.PI * 2) / count;
    const segmentStart = index * slice;
    const segmentCenter = segmentStart + slice / 2;
    const error = Math.abs(((pointerPosition - segmentCenter + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    expect(error).toBeLessThan(1e-10);
  });

  it.each([1, 2, 17, 100])("stops the requested segment under the right-side pointer for %i entries", (count) => {
    const index = count - 1;
    const rotation = targetRotation(2.3, index, count, 5, POINTER_ANGLE);
    expect(segmentIndexAtPointer(rotation, count, POINTER_ANGLE)).toBe(index);
  });

  it("reports the segment passing through the fixed pointer as the wheel rotates", () => {
    expect(segmentIndexAtPointer(Math.PI / 2, 4, POINTER_ANGLE)).toBe(0);
    expect(segmentIndexAtPointer(-Math.PI / 4, 4, POINTER_ANGLE)).toBe(1);
  });

  it("rejects an invalid selected segment", () => {
    expect(() => targetRotation(0, 3, 3, 4)).toThrow();
  });
});

describe("winner and highlighted triangle synchronization", () => {
  const counts = [1, 2, 3, 5, 8, 17, 100];

  it("centres the three triangles evenly on the pointer", () => {
    const bounds = highlightBounds();
    expect(bounds).toHaveLength(3);
    expect(bounds[WINNER_HIGHLIGHT].offset).toBe(0);
    expect(bounds[0].offset).toBeCloseTo(-bounds[2].offset, 12);
    expect(bounds[0].end).toBeCloseTo(bounds[1].start, 12);
    expect(bounds[1].end).toBeCloseTo(bounds[2].start, 12);
  });

  it.each(counts)("announces the middle-triangle participant for %i entries, over many spins", (count) => {
    let rotation = 0;
    for (let spin = 0; spin < 60; spin += 1) {
      const index = (spin * 7 + 3) % count;
      rotation = targetRotation(rotation % (Math.PI * 2), index, count, 3 + (spin % 5), POINTER_ANGLE);
      const shown = highlightedSegmentIndices(rotation, count);
      expect(winnerIndexAtRotation(rotation, count)).toBe(index);
      expect(shown[WINNER_HIGHLIGHT]).toBe(index);
      expect(shown[0]).toBe(segmentIndexAtPointer(rotation, count, POINTER_ANGLE + highlightBounds()[0].offset));
      expect(shown[2]).toBe(segmentIndexAtPointer(rotation, count, POINTER_ANGLE + highlightBounds()[2].offset));
    }
  });

  it("shows the neighbours that really sit 60 degrees either side of the winner", () => {
    const count = 12; // 30 degree segments: the side triangles are two segments away
    const rotation = targetRotation(0, 4, count, 5, POINTER_ANGLE);
    const shown = highlightedSegmentIndices(rotation, count);
    expect(shown[WINNER_HIGHLIGHT]).toBe(4);
    expect(shown[0]).toBe(2);
    expect(shown[2]).toBe(6);
  });

  it("keeps the winner stable when the roster order changes", () => {
    const names = ["a", "b", "c", "d", "e"];
    const reordered = ["c", "e", "a", "d", "b"];
    for (const roster of [names, reordered]) {
      const rotation = targetRotation(1.1, roster.indexOf("d"), roster.length, 4, POINTER_ANGLE);
      expect(roster[winnerIndexAtRotation(rotation, roster.length)]).toBe("d");
    }
  });
});

describe("winner handling", () => {
  it("removes a participant by unique ID", () => {
    expect(removeParticipantById(participants, "a")).toEqual([participants[1]]);
    expect(removeParticipantById(participants, "missing")).toEqual(participants);
  });

  it("consumes only the matching one-time override", () => {
    expect(consumeOverride("a", "a")).toBeNull();
    expect(consumeOverride("a", "b")).toBe("a");
    expect(consumeOverride(null, "a")).toBeNull();
  });
});
