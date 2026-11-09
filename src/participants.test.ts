import { describe, expect, it } from "vitest";
import { findDuplicateParticipantIds, normalizeParticipantName, removeDuplicateParticipants } from "./participants";
import type { Participant } from "./types";

const participants: Participant[] = [
  { id: "first", name: "  Alex Kim ", weight: 1 },
  { id: "second", name: "alex kim", weight: 2 },
  { id: "third", name: "Taylor", weight: 1 },
];

describe("participant duplicate handling", () => {
  it("normalizes names by trimming whitespace and ignoring case", () => {
    expect(normalizeParticipantName("  Alex Kim ")).toBe("alex kim");
  });

  it("identifies each repeated entry after the first", () => {
    expect(findDuplicateParticipantIds(participants)).toEqual(new Set(["second"]));
  });

  it("keeps the first participant and preserves the order of unique names", () => {
    expect(removeDuplicateParticipants(participants)).toEqual([participants[0], participants[2]]);
  });
});
