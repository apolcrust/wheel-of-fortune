import type { Participant } from "./types";

export function normalizeParticipantName(name: string) {
  return name.trim().toLocaleLowerCase();
}

export function findDuplicateParticipantIds(participants: Participant[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const participant of participants) {
    const name = normalizeParticipantName(participant.name);
    if (seen.has(name)) duplicates.add(participant.id);
    else seen.add(name);
  }
  return duplicates;
}

export function removeDuplicateParticipants(participants: Participant[]) {
  const seen = new Set<string>();
  return participants.filter((participant) => {
    const name = normalizeParticipantName(participant.name);
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}
