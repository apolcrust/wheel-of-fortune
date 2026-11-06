import { DEFAULT_DATA, type AppData } from "./types";

const DATABASE = "fortune-wheel";
const STORE = "session";
const KEY = "current";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local storage."));
  });
}

export async function loadData(): Promise<AppData> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY);
      request.onsuccess = () => resolve(request.result ? validateData(request.result) : structuredClone(DEFAULT_DATA));
      request.onerror = () => reject(request.error ?? new Error("Could not load saved data."));
    });
  } finally {
    db.close();
  }
}

export async function saveData(data: AppData): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put(data, KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not save your changes."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Saving your changes was aborted."));
    });
  } finally {
    db.close();
  }
}

export function validateData(value: unknown): AppData {
  if (!value || typeof value !== "object") throw new Error("The backup file does not contain valid session data.");
  const candidate = value as Partial<AppData>;
  if (!Array.isArray(candidate.participants) || !Array.isArray(candidate.winners)) {
    throw new Error("The backup must include participant and winner lists.");
  }
  const validParticipant = (participant: unknown) =>
    !!participant && typeof participant === "object" &&
    typeof (participant as AppData["participants"][number]).id === "string" &&
    !!(participant as AppData["participants"][number]).name.trim() &&
    Number.isFinite((participant as AppData["participants"][number]).weight) &&
    (participant as AppData["participants"][number]).weight > 0;
  if (!candidate.participants.every(validParticipant)) {
    throw new Error("The backup contains an invalid participant.");
  }
  if (!candidate.winners.every((winner) => {
    if (!winner || typeof winner !== "object") return false;
    const entry = winner as AppData["winners"][number];
    return validParticipant(entry.participant) && Number.isInteger(entry.spinNumber) &&
      typeof entry.timestamp === "string" && ["random", "weighted", "controlled"].includes(entry.mode);
  })) {
    throw new Error("The backup contains an invalid winner record.");
  }
  const settings = { ...DEFAULT_DATA.settings, ...(candidate.settings ?? {}) };
  if (typeof settings.title !== "string" || !Number.isFinite(settings.duration) ||
      settings.duration < 1 || settings.duration > 30 || !Number.isFinite(settings.rotations) ||
      settings.rotations < 1 || settings.rotations > 20 || !Array.isArray(settings.colors) ||
      settings.colors.length === 0 || !settings.colors.every((color) => typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color)) ||
      typeof settings.shortcut !== "string" || !settings.shortcut ||
      !["background", "textColor", "borderColor"].every((key) =>
        typeof settings[key as keyof typeof settings] === "string" &&
        /^#[0-9a-f]{6}$/i.test(settings[key as keyof typeof settings] as string)) ||
      !["autoRemove", "sound", "confetti"].every((key) =>
        typeof settings[key as keyof typeof settings] === "boolean")) {
    throw new Error("The backup contains invalid wheel settings.");
  }
  const ids = new Set(candidate.participants.map((participant) => participant.id));
  if (ids.size !== candidate.participants.length) throw new Error("The backup contains duplicate participant IDs.");
  const overrideId = candidate.overrideParticipantId;
  if (typeof overrideId === "string" && !ids.has(overrideId)) {
    throw new Error("The backup one-time pick is not an active participant.");
  }
  return {
    participants: candidate.participants,
    winners: candidate.winners,
    settings,
    overrideParticipantId: typeof overrideId === "string" ? overrideId : null,
    overrideActivated: candidate.overrideActivated === true && typeof overrideId === "string" && ids.has(overrideId),
  };
}
