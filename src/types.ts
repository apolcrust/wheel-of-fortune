export type SelectionMode = "random" | "weighted" | "controlled";

export interface Participant {
  id: string;
  name: string;
  weight: number;
}

export interface Winner {
  participant: Participant;
  spinNumber: number;
  timestamp: string;
  mode: SelectionMode;
}

export interface WheelSettings {
  title: string;
  duration: number;
  rotations: number;
  autoRemove: boolean;
  sound: boolean;
  confetti: boolean;
  shortcut: string;
  colors: string[];
  background: string;
  textColor: string;
  borderColor: string;
}

export interface AppData {
  participants: Participant[];
  winners: Winner[];
  settings: WheelSettings;
  overrideParticipantId: string | null;
  overrideActivated: boolean;
}

export const DEFAULT_SETTINGS: WheelSettings = {
  title: "THE GRAND DRAW",
  duration: 7,
  rotations: 6,
  autoRemove: true,
  sound: true,
  confetti: true,
  shortcut: "KeyO",
  colors: ["#bd8e39", "#28242b", "#8d382e", "#35303a", "#c79b50", "#493238", "#7d5b35", "#322c34"],
  background: "#151318",
  textColor: "#fff8e9",
  borderColor: "#e5c27c",
};

export const DEFAULT_DATA: AppData = {
  participants: [],
  winners: [],
  settings: DEFAULT_SETTINGS,
  overrideParticipantId: null,
  overrideActivated: false,
};
