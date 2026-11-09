import { describe, expect, it } from "vitest";
import { consumeOverride, POINTER_ANGLE, removeParticipantById, segmentIndexAtPointer, targetRotation, weightedIndexForRoll } from "./engine";
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
