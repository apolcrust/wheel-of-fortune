import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type * as XLSX from "xlsx";
import {
  Check, CircleHelp, Clock3, Download, FileSpreadsheet, Fullscreen, History, Keyboard,
  ListPlus, LoaderCircle, LockKeyhole, Plus, RotateCcw, Search, Settings2, ShieldCheck,
  Sparkles, Trash2, Trophy, Upload, Volume2, VolumeX, X,
} from "lucide-react";
import { pickRandomIndex, removeParticipantById, targetRotation, POINTER_ANGLE } from "./engine";
import { loadData, saveData, validateData } from "./storage";
import type { AppData, Participant, WheelSettings, Winner } from "./types";
import { DEFAULT_DATA, DEFAULT_SETTINGS } from "./types";
import { Wheel, type WheelHandle } from "./Wheel";
import { useOperatorShortcut } from "./operatorShortcut";
import { supabase, supabaseConfigurationError } from "./supabaseClient";
import { findDuplicateParticipantIds, normalizeParticipantName, removeDuplicateParticipants } from "./participants";
import type { Session } from "@supabase/supabase-js";

type Dialog = "participants" | "import" | "settings" | "history" | null;
type Toast = { id: number; message: string; tone: "success" | "error" };

function makeParticipant(name: string, weight = 1): Participant {
  return { id: crypto.randomUUID(), name: name.trim(), weight };
}

function playTone(frequency: number, duration: number, volume: number) {
  const AudioContextConstructor = window.AudioContext;
  if (!AudioContextConstructor) throw new Error("Audio is not supported by this browser.");
  const context = new AudioContextConstructor();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(Math.max(0.001, volume * 0.11), context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + duration);
  oscillator.onended = () => void context.close();
}

function keyLabel(code: string) {
  return code.startsWith("Key") ? code.slice(3) : code.startsWith("Digit") ? code.slice(5) : code;
}

function winnerObservation(winner: Winner | undefined) {
  return winner ? {
    key: `${winner.spinNumber}:${winner.participant.id}:${winner.timestamp}`,
    timestamp: winner.timestamp,
  } : null;
}

function WinnerAnnouncement({ winner, confetti, autoRemove, onClose }: {
  winner: Winner;
  confetti: boolean;
  autoRemove: boolean;
  onClose: () => void;
}) {
  return <div className="modal-backdrop winner-backdrop" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    {confetti && <div className="confetti" aria-hidden="true">{Array.from({ length: 44 }, (_, index) =>
      <i key={index} style={{ left: `${(index * 37) % 100}%`, backgroundColor: `hsl(${(index * 47) % 360} 65% 65%)`,
        animationDuration: `${2.4 + (index % 10) * 0.17}s`, animationDelay: `${-(index % 18) * 0.23}s`,
        transform: `rotate(${index * 31}deg)` }} />)}</div>}
    <section className="winner-modal" role="dialog" aria-modal="true" aria-labelledby="winner-heading">
      <button className="modal-close" aria-label="Close winner announcement" onClick={onClose}><X size={19} /></button>
      <div className="winner-icon"><Trophy size={28} /></div><div className="eyebrow">THE WHEEL HAS SPOKEN</div>
      <h2 id="winner-heading">Congratulations!</h2><p className="winner-name">{winner.participant.name}</p>

      {autoRemove && <p className="winner-removed"> Has been removed from the wheel</p>}
      <button className="button button-primary winner-continue" onClick={onClose}><Check size={16} /> Continue</button>
    </section>
  </div>;
}

function App() {
  const basePath = import.meta.env.BASE_URL.replace(/\/+$/, "");
  const currentPath = window.location.pathname.replace(/\/+$/, "");
  const searchParams = new URLSearchParams(window.location.search);
  const eventId = searchParams.get("event");
  const isOperator = currentPath === "/operator" ||
    (searchParams.get("view") === "operator" && currentPath === basePath);
  const [data, setData] = useState<AppData>(DEFAULT_DATA);
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(!!supabase);
  const [authEmail, setAuthEmail] = useState("");
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [eventOwnerId, setEventOwnerId] = useState<string | null>(null);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [lastWinner, setLastWinner] = useState<Winner | null>(null);
  const [stoppedWinner, setStoppedWinner] = useState<Participant | null>(null);
  const [search, setSearch] = useState("");
  const [newName, setNewName] = useState("");
  const [importBook, setImportBook] = useState<XLSX.WorkBook | null>(null);
  const [importFileName, setImportFileName] = useState("");
  const [sheetRows, setSheetRows] = useState<Record<string, unknown[][]>>({});
  const [sheetName, setSheetName] = useState("");
  const [columnIndex, setColumnIndex] = useState(0);
  const [hasHeader, setHasHeader] = useState(true);
  const [importAction, setImportAction] = useState<"append" | "replace">("append");
  const [keepDuplicates, setKeepDuplicates] = useState(false);
  const backupInput = useRef<HTMLInputElement>(null);
  const [capturingShortcut, setCapturingShortcut] = useState(false);
  const [customPalette, setCustomPalette] = useState("");
  const [overrideSearch, setOverrideSearch] = useState("");
  const [importPending, setImportPending] = useState(false);
  const wheelRef = useRef<WheelHandle>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const toastSequence = useRef(0);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const tabId = useRef(crypto.randomUUID());
  const receivedDataRef = useRef<AppData | null>(null);
  const receivedBroadcastRef = useRef(false);
  const latestWinnerObservationRef = useRef<ReturnType<typeof winnerObservation>>(null);
  const [operationPending, setOperationPending] = useState(false);

  const notify = useCallback((message: string, tone: Toast["tone"] = "success") => {
    const id = ++toastSequence.current;
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4000);
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthLoading(false);
    });
    supabase.auth.getSession().then(({ data: result, error }) => {
      if (error) throw error;
      if (active) {
        setSession(result.session);
        setAuthLoading(false);
      }
    }).catch((error: unknown) => {
      if (active) {
        setStorageError(error instanceof Error ? error.message : "Could not check the operator sign-in session.");
        setAuthLoading(false);
      }
    });
    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!("BroadcastChannel" in window)) return;
    const channel = new BroadcastChannel("fortune-wheel-session");
    channelRef.current = channel;
    channel.onmessage = (event: MessageEvent<
      | { sender: string; type: "data"; data: AppData }
      | { sender: string; type: "spin"; busy: boolean }
    >) => {
      if (event.data.sender === tabId.current) return;
      if (event.data.type === "spin") {
        setRemoteBusy(event.data.busy);
        if (event.data.busy) setStoppedWinner(null);
      } else {
        const receivedData = event.data.data;
        const latestWinner = receivedData.winners[0];
        const nextObservation = winnerObservation(latestWinner);
        const previousObservation = latestWinnerObservationRef.current;
        if (latestWinner && nextObservation?.key !== previousObservation?.key &&
            (!previousObservation || Date.parse(latestWinner.timestamp) > Date.parse(previousObservation.timestamp))) {
          setStoppedWinner(latestWinner.participant);
        }
        latestWinnerObservationRef.current = nextObservation;
        receivedBroadcastRef.current = true;
        receivedDataRef.current = receivedData;
        setData((current) => JSON.stringify(current) === JSON.stringify(receivedData) ? current : receivedData);
      }
    };
    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (supabase) {
      if (!eventId || (isOperator && authLoading) || (isOperator && !session)) {
        setReady(true);
        return () => { active = false; };
      }
      setReady(false);
      void (async () => {
        try {
          const { data: row, error } = await supabase.from("wheel_events")
            .select("id, owner_id, data, is_spinning")
            .eq("id", eventId)
            .maybeSingle();
          if (error) throw error;
          if (!row) throw new Error("This shared wheel event was not found or is no longer available.");
          const remoteData = validateData(row.data, "shared event");
          if (active) {
            latestWinnerObservationRef.current = winnerObservation(remoteData.winners[0]);
            receivedDataRef.current = remoteData;
            setData(remoteData);
            setCustomPalette(remoteData.settings.colors.join(", "));
            setEventOwnerId(row.owner_id);
            setRemoteBusy(row.is_spinning);
            setStorageError("");
            setReady(true);
          }
        } catch (error) {
          if (active) {
            setStorageError(error instanceof Error ? error.message : "Could not load the shared wheel event.");
            setReady(true);
          }
        }
      })();
      return () => { active = false; };
    }

    loadData().then((stored) => {
      if (active) {
        if (!receivedBroadcastRef.current) {
          latestWinnerObservationRef.current = winnerObservation(stored.winners[0]);
          receivedDataRef.current = stored;
          setData(stored);
          setCustomPalette(stored.settings.colors.join(", "));
        }
        setReady(true);
      }
    }).catch((error: unknown) => {
      if (active) {
        const message = error instanceof Error ? error.message : "Local storage could not be opened.";
        setStorageError(message);
      }
    });
    return () => { active = false; };
  }, [eventId, isOperator, authLoading, session?.user.id]);

  useEffect(() => {
    const remoteClient = supabase;
    if (!remoteClient || !eventId || !ready || !eventOwnerId) return;
    const channel = remoteClient.channel(`wheel-event-${eventId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "wheel_events",
        filter: `id=eq.${eventId}`,
      }, (payload) => {
        if (payload.eventType === "DELETE") return;
        const row = payload.new as { owner_id: string; data: unknown; is_spinning: boolean };
        if (!("data" in row) || row.data === undefined) {
          void (async () => {
            const { data: refreshedRow, error } = await remoteClient.from("wheel_events")
              .select("id, owner_id, data, is_spinning")
              .eq("id", eventId)
              .maybeSingle();
            if (error) throw error;
            if (!refreshedRow) throw new Error("This shared wheel event was not found or is no longer available.");
            const remoteData = validateData(refreshedRow.data, "shared event");
            latestWinnerObservationRef.current = winnerObservation(remoteData.winners[0]);
            receivedDataRef.current = remoteData;
            setData((current) => JSON.stringify(current) === JSON.stringify(remoteData) ? current : remoteData);
            setEventOwnerId(refreshedRow.owner_id);
            setRemoteBusy(refreshedRow.is_spinning);
            setStorageError("");
          })().catch((error: unknown) => {
            setStorageError(error instanceof Error ? error.message : "The shared wheel could not be refreshed.");
          });
          return;
        }
        try {
          const remoteData = validateData(row.data, "shared event");
          const latestWinner = remoteData.winners[0];
          const nextObservation = winnerObservation(latestWinner);
          const previousObservation = latestWinnerObservationRef.current;
          if (row.is_spinning) {
            setStoppedWinner(null);
          } else if (latestWinner && nextObservation?.key !== previousObservation?.key &&
              (!previousObservation || Date.parse(latestWinner.timestamp) > Date.parse(previousObservation.timestamp))) {
            setStoppedWinner(latestWinner.participant);
          }
          latestWinnerObservationRef.current = nextObservation;
          receivedDataRef.current = remoteData;
          setData((current) => JSON.stringify(current) === JSON.stringify(remoteData) ? current : remoteData);
          setEventOwnerId(row.owner_id);
          setRemoteBusy(row.is_spinning);
          setStorageError("");
        } catch (error) {
          setStorageError(error instanceof Error ? error.message : "The shared wheel data is invalid.");
        }
      }).subscribe((status, error) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setStorageError(error?.message ?? "Live updates could not connect. Refresh to try again.");
        }
      });
    return () => { void remoteClient.removeChannel(channel); };
  }, [eventId, ready, eventOwnerId]);

  useEffect(() => {
    if (!ready) return;
    const receivedRemoteData = receivedDataRef.current === data;
    if (receivedRemoteData) {
      receivedDataRef.current = null;
    }
    if (!receivedRemoteData) receivedDataRef.current = null;
    if (!supabase) {
      saveQueue.current = saveQueue.current.catch(() => undefined).then(async () => {
        await saveData(data);
        channelRef.current?.postMessage({ sender: tabId.current, type: "data", data });
      }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Your changes could not be saved.";
        setStorageError(message);
      });
    }
    const remoteClient = supabase;
    if (remoteClient && eventId && isOperator && session?.user.id === eventOwnerId && !receivedRemoteData) {
      const saveTimer = window.setTimeout(() => {
        void (async () => {
          try {
            const { data: result, error } = await remoteClient.from("wheel_events")
              .update({ data, updated_at: new Date().toISOString() })
              .eq("id", eventId)
              .eq("owner_id", session.user.id)
              .select("id")
              .maybeSingle();
            if (error) throw error;
            if (!result) throw new Error("This account is not allowed to update this wheel event.");
            setStorageError("");
          } catch (error) {
            setStorageError(error instanceof Error ? error.message : "The shared wheel could not be saved.");
          }
        })();
      }, 250);
      return () => window.clearTimeout(saveTimer);
    }
  }, [data, ready, eventId, isOperator, session?.user.id, eventOwnerId]);

  useEffect(() => {
    if (!capturingShortcut) return;
    const capture = (event: KeyboardEvent) => {
      if (busy) {
        setCapturingShortcut(false);
        return;
      }
      if (event.key === "Escape") {
        setCapturingShortcut(false);
        return;
      }
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        notify("Use an unmodified letter or number key for the operator shortcut.", "error");
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (!/^Key[A-Z]$/.test(event.code) && !/^Digit[0-9]$/.test(event.code)) {
        notify("Use an unmodified letter or number key for the operator shortcut.", "error");
        return;
      }
      setData((current) => ({ ...current, settings: { ...current.settings, shortcut: event.code } }));
      setCapturingShortcut(false);
      notify(`Override shortcut set to ${keyLabel(event.code)}.`);
    };
    window.addEventListener("keydown", capture, true);
    return () => window.removeEventListener("keydown", capture, true);
  }, [capturingShortcut, busy, notify]);

  const eligibleOverride = !!data.overrideParticipantId &&
    data.participants.some((participant) => participant.id === data.overrideParticipantId);
  const filteredOverrideParticipants = useMemo(() => {
    const query = overrideSearch.trim().toLocaleLowerCase();
    return data.participants
      .map((participant, index) => ({ participant, index }))
      .filter(({ participant }) => participant.name.toLocaleLowerCase().includes(query));
  }, [data.participants, overrideSearch]);
  const selectedOverrideParticipant = data.participants.find((person) => person.id === data.overrideParticipantId);
  const duplicateParticipantIds = useMemo(() => findDuplicateParticipantIds(data.participants), [data.participants]);
  const newNameAlreadyExists = !isOperator && data.participants.some(
    (person) => normalizeParticipantName(person.name) === normalizeParticipantName(newName),
  );
  const spinLocked = busy || remoteBusy || importPending;
  const activateOverride = useCallback(() => {
    if (!eligibleOverride || spinLocked) return;
    setData((current) => ({ ...current, overrideActivated: true }));
    notify("One-time pick activated. It will be used for the next spin.");
  }, [eligibleOverride, spinLocked, notify]);
  const operatorShortcut = useCallback(() => {
    if (!isOperator) return;
    activateOverride();
  }, [isOperator, activateOverride]);
  useOperatorShortcut(isOperator ? data.settings.shortcut : "", spinLocked, eligibleOverride, operatorShortcut);

  const updateSettings = (update: Partial<WheelSettings>) => {
    setData((current) => ({ ...current, settings: { ...current.settings, ...update } }));
  };

  const startSpin = async () => {
    if (spinLocked || isOperator) return;
    if (data.participants.length === 0) {
      notify("Add participants before spinning the wheel.", "error");
      return;
    }
    const override = data.overrideActivated
      ? data.participants.findIndex((person) => person.id === data.overrideParticipantId)
      : -1;
    if (data.overrideActivated && override < 0) {
      setData((current) => ({ ...current, overrideActivated: false }));
      notify("The selected one-time participant is no longer eligible.", "error");
      return;
    }
    setBusy(true);
    setStoppedWinner(null);
    if (!supabase) channelRef.current?.postMessage({ sender: tabId.current, type: "spin", busy: true });
    setLastWinner(null);
    try {
      let mode: Winner["mode"];
      let index: number;
      let spinId: string | null = null;
      if (supabase && eventId) {
        const { data: result, error } = await supabase.rpc("begin_wheel_spin", { p_event_id: eventId });
        if (error) throw error;
        if (!result || typeof result !== "object") throw new Error("The shared wheel returned an invalid spin selection.");
        const selection = result as { spinId?: unknown; participantId?: unknown; mode?: unknown };
        if (typeof selection.spinId !== "string" ||
            typeof selection.participantId !== "string" ||
            (selection.mode !== "random" && selection.mode !== "controlled")) {
          throw new Error("The shared wheel returned an invalid spin selection.");
        }
        spinId = selection.spinId;
        index = data.participants.findIndex((person) => person.id === selection.participantId);
        if (index < 0) throw new Error("The selected participant is no longer on the wheel. Refresh and try again.");
        mode = selection.mode;
        setRemoteBusy(true);
      } else {
        mode = override >= 0 ? "controlled" : "random";
        index = override >= 0 ? override : pickRandomIndex(data.participants);
      }
      const selected = data.participants[index];
      if (data.settings.sound) {
        try { playTone(220, 0.18, 0.45); }
        catch (error) { notify(error instanceof Error ? error.message : "Spin sound could not be played.", "error"); }
      }
      const start = wheelRef.current?.rotation ?? 0;
      await wheelRef.current?.spinTo(targetRotation(
        start,
        index,
        data.participants.length,
        data.settings.rotations,
        POINTER_ANGLE,
      ), data.settings.duration * 1000);
      if (supabase && eventId && spinId) {
        const { data: completedData, error } = await supabase.rpc("finish_wheel_spin", {
          p_event_id: eventId,
          p_spin_id: spinId,
        });
        if (error) throw error;
        const completed = validateData(completedData, "shared event");
        receivedDataRef.current = completed;
        setData(completed);
        setLastWinner(completed.winners[0] ?? null);
        setStoppedWinner(completed.winners[0]?.participant ?? null);
        latestWinnerObservationRef.current = winnerObservation(completed.winners[0]);
        setRemoteBusy(false);
        if (completed.settings.sound) {
          try { playTone(660, 0.55, 0.85); }
          catch (error) { notify(error instanceof Error ? error.message : "Winner sound could not be played.", "error"); }
        }
        return;
      }
      const record: Winner = {
        participant: selected,
        spinNumber: data.winners.length + 1,
        timestamp: new Date().toISOString(),
        mode,
      };
      setStoppedWinner(record.participant);
      latestWinnerObservationRef.current = winnerObservation(record);
      setData((state) => ({
        ...state,
        participants: state.settings.autoRemove ? removeParticipantById(state.participants, selected.id) : state.participants,
        winners: [record, ...state.winners],
        overrideParticipantId: mode === "controlled" ? null : state.overrideParticipantId,
        overrideActivated: mode === "controlled" ? false : state.overrideActivated,
      }));
      setLastWinner(record);
      if (data.settings.sound) {
        try { playTone(660, 0.55, 0.85); }
        catch (error) { notify(error instanceof Error ? error.message : "Winner sound could not be played.", "error"); }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "The wheel could not complete its spin.";
      notify(message, "error");
    } finally {
      setBusy(false);
      if (!supabase) channelRef.current?.postMessage({ sender: tabId.current, type: "spin", busy: false });
    }
  };

  const updateSharedParticipants = async (
    action: "add" | "remove" | "deduplicate",
    participantId?: string,
    name?: string,
  ) => {
    if (!supabase || !eventId) throw new Error("Shared participant management is unavailable for this event.");
    setImportPending(true);
    try {
      const { data: result, error } = await supabase.rpc("manage_wheel_participants", {
        p_event_id: eventId,
        p_action: action,
        p_participant_id: participantId ?? null,
        p_name: name ?? null,
      });
      if (error) throw error;
      const updated = validateData(result, "shared event");
      receivedDataRef.current = updated;
      setData(updated);
    } finally {
      setImportPending(false);
    }
  };

  const addParticipant = async () => {
    if (spinLocked) return;
    const name = newName.trim();
    if (!name) return;
    if (!isOperator && newNameAlreadyExists) {
      notify("That participant name is already on the wheel.", "error");
      return;
    }
    if (!isOperator && supabase && eventId) {
      try {
        await updateSharedParticipants("add", undefined, name);
      } catch (error) {
        notify(error instanceof Error ? error.message : "The participant could not be added.", "error");
        return;
      }
    } else {
      setData((current) => ({ ...current, participants: [...current.participants, makeParticipant(name)] }));
    }
    setNewName("");
    notify(`${name} added to the wheel.`);
  };

  const removeParticipant = async (id: string) => {
    if (spinLocked) return;
    if (!isOperator && supabase && eventId) {
      try {
        await updateSharedParticipants("remove", id);
      } catch (error) {
        notify(error instanceof Error ? error.message : "The participant could not be removed.", "error");
      }
      return;
    }
    setData((current) => ({
      ...current,
      participants: current.participants.filter((person) => person.id !== id),
      overrideParticipantId: current.overrideParticipantId === id ? null : current.overrideParticipantId,
      overrideActivated: current.overrideParticipantId === id ? false : current.overrideActivated,
    }));
  };

  const removeDuplicateParticipantsFromList = async () => {
    const duplicateCount = duplicateParticipantIds.size;
    if (spinLocked || duplicateCount === 0) return;
    if (!isOperator && supabase && eventId) {
      try {
        await updateSharedParticipants("deduplicate");
      } catch (error) {
        notify(error instanceof Error ? error.message : "Duplicate participants could not be removed.", "error");
        return;
      }
    } else {
      setData((current) => {
        const participants = removeDuplicateParticipants(current.participants);
        const keptIds = new Set(participants.map((person) => person.id));
        const overrideRemoved = current.overrideParticipantId !== null && !keptIds.has(current.overrideParticipantId);
        return {
          ...current,
          participants,
          overrideParticipantId: overrideRemoved ? null : current.overrideParticipantId,
          overrideActivated: overrideRemoved ? false : current.overrideActivated,
        };
      });
    }
    notify(`Removed ${duplicateCount} duplicate participant entr${duplicateCount === 1 ? "y" : "ies"}.`);
  };

  const verifyParticipantNames = () => {
    if (duplicateParticipantIds.size === 0) {
      notify("Verified: no duplicate participant names found.");
    } else {
      notify(`Found ${duplicateParticipantIds.size} duplicate participant entr${duplicateParticipantIds.size === 1 ? "y" : "ies"}.`, "error");
    }
  };

  const loadWorkbook = async (file: File) => {
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      if (workbook.SheetNames.length === 0) throw new Error("This file does not contain a worksheet.");
      const rows = Object.fromEntries(workbook.SheetNames.map((name) => [
        name,
        XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, defval: "", raw: false }) as unknown[][],
      ]));
      setImportBook(workbook);
      setImportFileName(file.name);
      setSheetRows(rows);
      setSheetName(workbook.SheetNames[0]);
      setColumnIndex(0);
      setImportAction("append");
      setKeepDuplicates(isOperator);
      setDialog("import");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not read this spreadsheet.", "error");
    }
  };

  const importRows = useMemo(() => {
    if (!importBook || !sheetName) return { columns: [] as string[], names: [] as string[], empty: 0, missing: 0 };
    const rows = sheetRows[sheetName] ?? [];
    const first = rows[0] ?? [];
    const columns = first.map((value, index) => {
      const label = String(value ?? "").trim();
      return label || `Column ${index + 1}`;
    });
    const start = hasHeader ? 1 : 0;
    const dataRows = rows.slice(start);
    const nonEmptyRows = dataRows.filter((row) => row.some((value) => String(value ?? "").trim()));
    const names = nonEmptyRows
      .map((row) => String(row[columnIndex] ?? "").trim())
      .filter(Boolean);
    return { columns, names, empty: dataRows.length - nonEmptyRows.length, missing: nonEmptyRows.length - names.length };
  }, [sheetRows, sheetName, columnIndex, hasHeader]);
  const importDuplicateCount = useMemo(() => {
    const seen = new Set(importAction === "append"
      ? data.participants.map((participant) => normalizeParticipantName(participant.name))
      : []);
    let duplicates = 0;
    for (const name of importRows.names) {
      const normalized = normalizeParticipantName(name);
      if (seen.has(normalized)) duplicates += 1;
      else seen.add(normalized);
    }
    return duplicates;
  }, [data.participants, importAction, importRows.names]);

  const confirmImport = async () => {
    if (spinLocked) return;
    let names = importRows.names;
    const preserveDuplicates = isOperator && keepDuplicates;
    if (!preserveDuplicates) {
      const seen = new Set(importAction === "append"
        ? data.participants.map((participant) => normalizeParticipantName(participant.name))
        : []);
      names = names.filter((name) => {
        const key = normalizeParticipantName(name);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    if (names.length === 0) {
      notify("No new participants were added because every name already exists.", "error");
      return;
    }
    const incoming = names.map((name) => makeParticipant(name));
    setImportPending(true);
    try {
      if (supabase && eventId) {
        const { data: result, error } = await supabase.rpc("import_wheel_participants", {
          p_event_id: eventId,
          p_names: names,
          p_action: importAction,
          p_keep_duplicates: preserveDuplicates,
        });
        if (error) throw error;
        const updated = validateData(result, "shared event");
        receivedDataRef.current = updated;
        setData(updated);
      } else {
        setData((current) => ({
          ...current,
          participants: importAction === "replace" ? incoming : [...current.participants, ...incoming],
          overrideParticipantId: importAction === "replace" ? null : current.overrideParticipantId,
          overrideActivated: importAction === "replace" ? false : current.overrideActivated,
        }));
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "The spreadsheet participants could not be imported.", "error");
      return;
    } finally {
      setImportPending(false);
    }
    const skipped = importRows.names.length - names.length;
    notify(`Imported ${incoming.length} participant${incoming.length === 1 ? "" : "s"}${skipped ? `; skipped ${skipped} duplicate name${skipped === 1 ? "" : "s"}` : ""}.`);
    setDialog(null);
    setImportBook(null);
    setImportFileName("");
  };

  const updateParticipant = (id: string, changes: Partial<Participant>) => {
    if (spinLocked) return;
    setData((current) => ({
      ...current,
      participants: current.participants.map((person) => person.id === id ? { ...person, ...changes } : person),
    }));
  };

  const exportParticipants = async () => {
    const XLSX = await import("xlsx");
    const sheet = XLSX.utils.json_to_sheet(data.participants.map(({ id, name }) => ({ ID: id, Name: name })));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Participants");
    XLSX.writeFile(book, "fortune-wheel-participants.xlsx");
  };

  const exportHistory = async () => {
    const XLSX = await import("xlsx");
    const sheet = XLSX.utils.json_to_sheet(data.winners.map(({ participant, spinNumber, timestamp, mode }) => ({
      Name: participant.name, "Participant ID": participant.id, "Spin number": spinNumber,
      Date: new Date(timestamp).toLocaleString(), Mode: mode,
    })));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Winner history");
    XLSX.writeFile(book, "fortune-wheel-history.xlsx");
  };

  const exportBackup = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "fortune-wheel-backup.json";
    link.click();
    URL.revokeObjectURL(link.href);
    notify("Session backup downloaded.");
  };

  const importBackup = async (file: File) => {
    if (spinLocked) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const restored = validateData(parsed);
      if (!window.confirm("Replace your current participants, settings, and winner history with this backup?")) return;
      setData(restored);
      setLastWinner(null);
      setCustomPalette(restored.settings.colors.join(", "));
      notify("Backup restored.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "The backup could not be restored.", "error");
    }
  };

  const resetSession = () => {
    if (spinLocked) return;
    if (!window.confirm("Reset participants, winner history, and wheel settings? This cannot be undone.")) return;
    setData(structuredClone(DEFAULT_DATA));
    setLastWinner(null);
    setCustomPalette(DEFAULT_SETTINGS.colors.join(", "));
    notify("Session reset.");
  };

  const restoreWinner = (id: string) => {
    if (spinLocked) return;
    const record = data.winners.find((entry) => entry.participant.id === id);
    if (!record || data.participants.some((person) => person.id === id)) return;
    setData((current) => ({ ...current, participants: [...current.participants, record.participant] }));
    notify(`${record.participant.name} restored to the wheel.`);
  };

  const sendMagicLink = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase || !authEmail.trim()) return;
    setOperationPending(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: authEmail.trim(),
        options: { emailRedirectTo: window.location.href },
      });
      if (error) throw error;
      setMagicLinkSent(true);
    } catch (error) {
      notify(error instanceof Error ? error.message : "The sign-in email could not be sent.", "error");
    } finally {
      setOperationPending(false);
    }
  };

  const createSharedEvent = async () => {
    if (!supabase || !session) return;
    setOperationPending(true);
    try {
      const { data: row, error } = await supabase.from("wheel_events")
        .insert({ owner_id: session.user.id, data: structuredClone(DEFAULT_DATA) })
        .select("id")
        .single();
      if (error) throw error;
      const url = new URL(import.meta.env.BASE_URL, window.location.origin);
      url.searchParams.set("view", "operator");
      url.searchParams.set("event", row.id);
      window.location.assign(url);
    } catch (error) {
      notify(error instanceof Error ? error.message : "The shared event could not be created.", "error");
    } finally {
      setOperationPending(false);
    }
  };

  const signOutOperator = async () => {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) notify(error.message, "error");
    else setSession(null);
  };

  const sharedUrl = (operatorView: boolean) => {
    const url = new URL(import.meta.env.BASE_URL, window.location.origin);
    if (eventId) url.searchParams.set("event", eventId);
    if (operatorView) url.searchParams.set("view", "operator");
    return url.toString();
  };

  const copySharedLink = async (operatorView: boolean) => {
    try {
      await navigator.clipboard.writeText(sharedUrl(operatorView));
      notify(`${operatorView ? "Operator" : "Audience"} link copied.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not copy the audience link.", "error");
    }
  };

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Fullscreen mode could not be changed.", "error");
    }
  };

  const filteredWinners = data.winners.filter((record) =>
    record.participant.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));

  if (supabaseConfigurationError) {
    return <main className="cloud-shell"><section className="cloud-panel">
      <div className="brand-mark"><CircleHelp size={20} /></div>
      <div className="eyebrow">APP CONFIGURATION</div>
      <h1>Supabase setup needs attention</h1>
      <p role="alert">{supabaseConfigurationError}</p>
    </section></main>;
  }
  if (supabase && isOperator && authLoading) {
    return <main className="loading-screen"><LoaderCircle className="spin-loader" /><span>Checking operator sign-in…</span></main>;
  }
  if (supabase && isOperator && !session) {
    return <main className="cloud-shell"><section className="cloud-panel">
      <div className="brand-mark"><LockKeyhole size={20} /></div>
      <div className="eyebrow">OPERATOR ACCESS</div>
      <h1>Sign in to manage your wheel</h1>
      {magicLinkSent ? <p>Check your inbox for a secure sign-in link. Open it on this device to continue.</p> :
        <form className="cloud-form" onSubmit={(event) => void sendMagicLink(event)}>
          <label className="setting-field"><span>Email address</span><input type="email" autoComplete="email" required value={authEmail}
            onChange={(event) => setAuthEmail(event.target.value)} placeholder="you@example.com" /></label>
          <button className="button button-primary" disabled={operationPending || !authEmail.trim()}>
            {operationPending ? "Sending link…" : "Email me a sign-in link"}
          </button>
        </form>}
      {storageError && <p className="cloud-error" role="alert">{storageError}</p>}
      <a className="cloud-back-link" href={import.meta.env.BASE_URL}>Return to audience screen</a>
    </section></main>;
  }
  if (supabase && isOperator && session && !eventId) {
    return <main className="cloud-shell"><section className="cloud-panel">
      <div className="brand-mark"><Sparkles size={20} /></div>
      <div className="eyebrow">SHARED EVENT</div>
      <h1>Create a wheel event</h1>
      <p>Create an event to get a shareable audience link. This signed-in account will own its operator controls.</p>
      {storageError && <p className="cloud-error" role="alert">{storageError}</p>}
      <button className="button button-primary" disabled={operationPending} onClick={() => void createSharedEvent()}>
        {operationPending ? "Creating event…" : "Create event"}
      </button>
      <button className="text-button cloud-signout" onClick={() => void signOutOperator()}>Sign out ({session.user.email})</button>
    </section></main>;
  }
  if (supabase && !isOperator && !eventId) {
    return <main className="cloud-shell"><section className="cloud-panel">
      <div className="brand-mark"><Sparkles size={20} /></div>
      <div className="eyebrow">AUDIENCE SCREEN</div>
      <h1>Open a shared wheel</h1>
      <p>Use the audience link shared by the event operator to join the live wheel.</p>
    </section></main>;
  }
  if (supabase && eventId && ready && !eventOwnerId) {
    return <main className="cloud-shell"><section className="cloud-panel">
      <div className="brand-mark"><CircleHelp size={20} /></div>
      <div className="eyebrow">SHARED EVENT</div>
      <h1>Could not open this wheel</h1>
      <p role="alert">{storageError || "The event is unavailable. Check the link and try again."}</p>
      <a className="button button-outline" href={import.meta.env.BASE_URL}>Return to home</a>
    </section></main>;
  }
  if (supabase && isOperator && eventOwnerId && eventOwnerId !== session?.user.id) {
    return <main className="cloud-shell"><section className="cloud-panel">
      <div className="brand-mark"><LockKeyhole size={20} /></div>
      <div className="eyebrow">OPERATOR ACCESS</div>
      <h1>This event belongs to another account</h1>
      <p>Sign in with the account that created this wheel event.</p>
      <button className="button button-outline" onClick={() => void signOutOperator()}>Sign out</button>
    </section></main>;
  }

  if (storageError && !ready) {
    return <main className="fatal-screen"><ShieldCheck size={42} /><h1>Could not open saved session</h1>
      <p>{storageError} The saved session may be invalid, or IndexedDB may be unavailable in this browser.</p>
      <button className="button button-primary" onClick={() => window.location.reload()}>Try again</button>
    </main>;
  }
  if (!ready) return <main className="loading-screen"><LoaderCircle className="spin-loader" /><span>Opening your wheel…</span></main>;

  if (!isOperator) {
    return <main className="public-shell">
      {storageError && <div className="storage-warning" role="alert">{storageError}</div>}
      <header className="public-topbar">
        <div className="brand">
          <span className="brand-mark"><Sparkles size={20} /></span>
          <span>FORTUNE<span className="brand-muted"> / WHEEL</span></span>
        </div>
        <div className="public-top-actions">
          {!supabase && <button className="button button-outline" disabled={spinLocked} onClick={() => setDialog("settings")}><Settings2 size={16} /> Settings</button>}
          <button className="icon-button" title="Fullscreen" aria-label="Fullscreen" onClick={() => void toggleFullscreen()}>
            <Fullscreen size={18} />
          </button>
        </div>
      </header>
      <section className="public-heading">
        <div className="eyebrow"><span className="live-dot" /> LIVE DRAW EXPERIENCE</div>
        <h1>{data.settings.title || "THE GRAND DRAW"}</h1>
        <p>Every name has a chance. Let the wheel decide.</p>
      </section>
      <section className="public-content">
        <div className="public-game">
          <div className="wheel-stage">
            <div className="wheel-halo" />
            <div className="pointer" aria-hidden="true"><span /></div>
            <Wheel ref={wheelRef} participants={data.participants} settings={data.settings}
              stoppedWinner={busy || remoteBusy ? null : stoppedWinner} />
          </div>
          <button className="spin-button" disabled={spinLocked || data.participants.length === 0} onClick={() => void startSpin()}>
            {spinLocked ? <><LoaderCircle className="button-spinner" size={19} /> SPINNING</> : <><Sparkles size={18} /> SPIN THE WHEEL</>}
          </button>
          <div className="spin-caption"><LockKeyhole size={13} /> {spinLocked ? "Selection locked until the wheel stops" : "FAIR PLAY · ONE SPIN AT A TIME"}</div>
          <div className="public-stats"><span><strong>{data.participants.length}</strong> participants</span><i />
            <span><strong>{data.winners.length}</strong> winners drawn</span></div>
          {data.winners[0] && <div className="public-latest">
            <Trophy size={15} /><span>Latest winner: <strong>{data.winners[0].participant.name}</strong></span>
          </div>}
        </div>
        <aside className="public-details">
          <section className="public-detail-card">
            <div className="public-card-heading"><div><span className="card-overline">ON THE WHEEL</span><h2>Participants</h2></div>
              <span className="public-count">{data.participants.length}</span></div>
            {data.participants.length === 0 ? <p className="public-empty-copy">Add names to see them here and on the wheel.</p> :
              <ul className="public-participant-list">{data.participants.map((person, index) => <li key={person.id}>
                <span className="participant-color" style={{ background: data.settings.colors[index % data.settings.colors.length] }} />
                <span>{person.name}</span><small>{person.weight > 1 ? `×${person.weight}` : ""}</small>
              </li>)}</ul>}
            <div className="public-participant-actions">
              <button className="button button-quiet public-detail-action" disabled={spinLocked} onClick={() => setDialog("participants")}><ListPlus size={15} /> Manage participants</button>
            </div>
          </section>
          <section className="public-detail-card">
            <div className="public-card-heading"><div><span className="card-overline">DRAW RECORD</span><h2>Winner history</h2></div>
              <span className="public-count">{data.winners.length}</span></div>
            {data.winners.length === 0 ? <p className="public-empty-copy">Winners will appear here after the first spin.</p> :
              <ul className="public-winner-list">{data.winners.slice(0, 5).map((winner) => <li key={`${winner.spinNumber}-${winner.participant.id}`}>
                <div><strong>{winner.participant.name}</strong><small>#{String(winner.spinNumber).padStart(2, "0")} · {new Date(winner.timestamp).toLocaleString()}</small></div>
                
              </li>)}</ul>}
            {data.winners.length > 5 && <button className="button button-quiet public-detail-action" onClick={() => setDialog("history")}><History size={15} /> View all winners</button>}
          </section>
        </aside>
      </section>
      <footer className="public-footer">YOUR EVENT. YOUR MOMENT.</footer>
      {lastWinner && <WinnerAnnouncement winner={lastWinner} confetti={data.settings.confetti}
        autoRemove={data.settings.autoRemove} onClose={() => setLastWinner(null)} />}
      {dialog && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}>
        <section className={`dialog ${dialog === "participants" || dialog === "history" ? "dialog-wide" : ""}`} role="dialog" aria-modal="true">
          <header className="dialog-header"><div><span className="eyebrow">FORTUNE / WHEEL</span>
            <h2>{dialog === "participants" ? "Participants" : dialog === "import" ? "Import spreadsheet" : dialog === "settings" ? "Wheel settings" : "Winner history"}</h2></div>
            <button className="icon-button" aria-label="Close dialog" onClick={() => setDialog(null)}><X size={18} /></button>
          </header>
          {dialog === "participants" && <div className="dialog-content">
            <div className="add-participant">
              <input value={newName} disabled={spinLocked} maxLength={100} placeholder="Add a participant name…" onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") void addParticipant(); }} />
              <button className="button button-primary" onClick={() => void addParticipant()} disabled={spinLocked || !newName.trim() || newNameAlreadyExists}><Plus size={16} /> Add</button>
            </div>
            {newNameAlreadyExists && <p className="duplicate-input-note" role="alert">That name is already on the wheel.</p>}
            <div className="list-toolbar"><span>{data.participants.length} active participant{data.participants.length === 1 ? "" : "s"}</span>
              <div className="participant-file-actions">
                <label className={`button button-outline file-button${spinLocked ? " is-disabled" : ""}`}><Upload size={14} /> Import Excel
                  <input type="file" accept=".xlsx,.xls,.csv" disabled={spinLocked} aria-label="Import participants from an Excel file" onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void loadWorkbook(file);
                    event.target.value = "";
                  }} />
                </label>
                <button className="text-button" onClick={() => void exportParticipants()} disabled={!data.participants.length}><Download size={14} /> Export</button>
              </div>
            </div>
            <div className={`duplicate-check${duplicateParticipantIds.size ? " has-duplicates" : ""}`} role="status">
              <span><ShieldCheck size={16} />{duplicateParticipantIds.size
                ? `${duplicateParticipantIds.size} duplicate participant entr${duplicateParticipantIds.size === 1 ? "y" : "ies"} found`
                : "No duplicate participant names detected"}</span>
              <div>
                <button className="text-button" type="button" onClick={verifyParticipantNames}><Check size={14} /> Verify names</button>
                <button className="text-button" type="button" disabled={spinLocked || duplicateParticipantIds.size === 0}
                  onClick={() => void removeDuplicateParticipantsFromList()}><Trash2 size={14} /> Remove duplicates</button>
              </div>
            </div>
            {data.participants.length === 0 ? <div className="empty-state"><FileSpreadsheet size={22} /><p>No participants yet. Add names or import a spreadsheet.</p></div> :
              <div className="participant-list">{data.participants.map((person, index) => <div className="participant-row" key={person.id}>
                <span className="row-index">{String(index + 1).padStart(2, "0")}</span>
                <span className="participant-row-name">{person.name}</span>
                <button className="icon-button danger-icon" aria-label={`Remove ${person.name}`} disabled={spinLocked} onClick={() => void removeParticipant(person.id)}><Trash2 size={15} /></button>
              </div>)}</div>}
            <p className="dialog-note">New participant names are checked against the current list, ignoring letter case.</p>
          </div>}
          {dialog === "import" && <div className="dialog-content">
            {!importBook ? <div className="empty-state"><Upload size={22} /><p>Select an XLSX, XLS, or CSV file to begin.</p></div> : <>
              <div className="file-summary"><FileSpreadsheet size={19} /><strong>{importFileName || importBook.Props?.Title || "Spreadsheet loaded"}</strong><span>{importBook.SheetNames.length} sheet{importBook.SheetNames.length === 1 ? "" : "s"}</span></div>
              {importBook.SheetNames.length > 1 && <label className="setting-field"><span>Worksheet</span><select value={sheetName} onChange={(event) => { setSheetName(event.target.value); setColumnIndex(0); }}>
                {importBook.SheetNames.map((name) => <option key={name}>{name}</option>)}</select></label>}
              <label className="setting-field"><span>Name column</span><select value={columnIndex} onChange={(event) => setColumnIndex(Number(event.target.value))}>
                {(importRows.columns.length ? importRows.columns : ["No columns found"]).map((label, index) => <option key={`${label}-${index}`} value={index}>{label}</option>)}</select></label>
              <label className="check-setting"><input type="checkbox" checked={hasHeader} onChange={(event) => setHasHeader(event.target.checked)} /><span>First row contains column headers</span></label>
              <div className="import-preview"><div className="preview-heading"><span>PREVIEW</span><strong>{importRows.names.length} names · {importRows.empty} blank rows · {importRows.missing} rows without a name</strong></div>
                {importRows.names.length === 0 ? <p>No names found in the selected column.</p> : <div className="preview-names">{importRows.names.slice(0, 12).map((name, index) => <span key={`${name}-${index}`}>{name}</span>)}{importRows.names.length > 12 && <span>+{importRows.names.length - 12} more</span>}</div>}
                {importDuplicateCount > 0 && <p className="duplicate-note">{importDuplicateCount} repeated name{importDuplicateCount === 1 ? "" : "s"} detected. Repeated names will be skipped.</p>}
              </div>
              <fieldset className="import-choice"><legend>Import action</legend>
                <label><input type="radio" name="import-action" checked={importAction === "append"} onChange={() => setImportAction("append")} /> Add to current participants</label>
                <label><input type="radio" name="import-action" checked={importAction === "replace"} onChange={() => setImportAction("replace")} /> Replace current participants</label>
              </fieldset>
              <div className="dialog-actions"><button className="button button-outline" onClick={() => setDialog(null)}>Cancel</button>
                <button className="button button-primary" onClick={() => void confirmImport()} disabled={spinLocked || !importRows.names.length}><Upload size={15} /> Import {importRows.names.length} names</button></div>
            </>}
          </div>}
          {dialog === "settings" && <div className="dialog-content settings-content">
            <fieldset className="settings-fields" disabled={spinLocked}>
              <label className="setting-field"><span>Wheel title</span><input maxLength={60} value={data.settings.title} onChange={(event) => updateSettings({ title: event.target.value })} /></label>
              <label className="setting-field"><span>Wheel colors <small>comma-separated hex values</small></span><input value={customPalette}
                onChange={(event) => setCustomPalette(event.target.value)} onBlur={() => {
                  const colors = customPalette.split(",").map((color) => color.trim()).filter((color) => /^#[0-9a-f]{6}$/i.test(color));
                  if (!colors.length) { setCustomPalette(data.settings.colors.join(", ")); notify("Enter at least one valid six-digit hex color.", "error"); }
                  else updateSettings({ colors });
                }} placeholder="#bd8e39, #28242b, #8d382e" /></label>
              <div className="color-swatches">{data.settings.colors.map((color) => <span key={color} title={color} style={{ background: color }} />)}</div>
              <div className="wheel-color-settings">
                <label><span>Hub / empty wheel</span><input aria-label="Hub and empty wheel color" type="color" value={data.settings.background} onChange={(event) => updateSettings({ background: event.target.value })} /></label>
                <label><span>Segment text</span><input aria-label="Segment text color" type="color" value={data.settings.textColor} onChange={(event) => updateSettings({ textColor: event.target.value })} /></label>
                <label><span>Segment borders</span><input aria-label="Segment border color" type="color" value={data.settings.borderColor} onChange={(event) => updateSettings({ borderColor: event.target.value })} /></label>
              </div>
              <label className="check-setting"><input type="checkbox" checked={data.settings.sound} onChange={(event) => updateSettings({ sound: event.target.checked })} /><span>Enable spin and winner sounds</span></label>
              <button className="button button-primary settings-done" onClick={() => setDialog(null)}><Check size={15} /> Done</button>
            </fieldset>
          </div>}
          {dialog === "history" && <div className="dialog-content">
            <div className="history-toolbar"><label className="search-field"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search winners…" /><span>⌕</span></label>
              <button className="button button-outline" onClick={() => void exportHistory()} disabled={!data.winners.length}><Download size={14} /> Export Excel</button></div>
            {filteredWinners.length === 0 ? <div className="empty-state"><Trophy size={22} /><p>{data.winners.length ? "No winners match your search." : "Winner history will appear here after the first spin."}</p></div> :
              <div className="history-list">{filteredWinners.map((record) => <div className="history-row" key={`${record.spinNumber}-${record.participant.id}`}>
                <span className="history-number">#{String(record.spinNumber).padStart(2, "0")}</span>
                <div className="history-person"><strong>{record.participant.name}</strong><span>{new Date(record.timestamp).toLocaleString()}</span></div>
              </div>)}</div>}
            <div className="dialog-actions history-actions"><button className="button button-outline" onClick={() => setDialog(null)}>Close</button></div>
          </div>}
        </section>
      </div>}
      <div className="toast-stack" aria-live="polite">{toasts.map((toast) => <div className={`toast toast-${toast.tone}`} key={toast.id}>
        {toast.tone === "success" ? <Check size={16} /> : <CircleHelp size={16} />}{toast.message}
      </div>)}</div>
    </main>;
  }

  return (
    <main className="app-shell">
      {storageError && <div className="storage-warning" role="alert">{storageError}</div>}
      <header className="topbar">
        <a className="brand" href={import.meta.env.BASE_URL}>
          <span className="brand-mark"><Sparkles size={20} /></span><span>FORTUNE<span className="brand-muted"> / WHEEL</span></span>
        </a>
        <div className="topbar-actions">
          {supabase && eventId && <>
            <button className="button button-outline" onClick={() => void copySharedLink(false)}><Download size={15} /> Copy audience link</button>
            <button className="button button-outline" onClick={() => void copySharedLink(true)}><Download size={15} /> Copy operator link</button>
          </>}
          <button className="button button-outline" onClick={() => window.open(supabase && eventId ? sharedUrl(false) : import.meta.env.BASE_URL, "_blank", "noopener,noreferrer")}>Open audience screen</button>
          {supabase && session && <button className="text-button" onClick={() => void signOutOperator()}>Sign out</button>}
          <button className="icon-button" title={data.settings.sound ? "Mute sounds" : "Enable sounds"} aria-label="Toggle sound"
            onClick={() => updateSettings({ sound: !data.settings.sound })}>
            {data.settings.sound ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>
          <button className="icon-button" title="Fullscreen" aria-label="Fullscreen" onClick={() => void toggleFullscreen()}><Fullscreen size={18} /></button>
          <button className="button button-outline" disabled={spinLocked} onClick={() => setDialog("settings")}><Settings2 size={16} /> Settings</button>
        </div>
      </header>

      <section className="hero-heading">
        <div className="eyebrow"><span className="live-dot" /> LIVE DRAW EXPERIENCE</div>
        <h1>{data.settings.title || "THE GRAND DRAW"}</h1>
        <p>Every name has a chance. Let the wheel decide.</p>
      </section>

      <section className="game-layout">
        <div className="wheel-column">
          <div className="wheel-stage">
            <div className="wheel-halo" />
            <div className="pointer" aria-hidden="true"><span /></div>
            <Wheel ref={wheelRef} participants={data.participants} settings={data.settings}
              stoppedWinner={busy || remoteBusy ? null : stoppedWinner} />
          </div>
          <div className="spin-controls">
            <button className="spin-button" disabled={spinLocked || data.participants.length === 0}>
              <LockKeyhole size={16} /> Spin from audience screen
            </button>
            <div className="spin-caption">OPEN THE AUDIENCE SCREEN TO START A SPIN</div>
          </div>
        </div>

        <aside className="side-panel">
          <div className="panel-card draw-card">
            <div className="card-overline"><span>DRAW CONTROL</span><span>OPERATOR</span></div>
            <div className="normal-draw-label"><span>NORMAL DRAW</span><strong>Random winner</strong></div>
            <div className={`override-status ${data.overrideActivated ? "is-armed" : ""}`}>
              <Keyboard size={16} /><div><strong>{data.overrideActivated ? "One-time pick armed" : "One-time pick ready"}</strong>
                <span>{data.overrideParticipantId
                  ? `${selectedOverrideParticipant?.name ?? "Unavailable"}${data.overrideActivated ? " · will be selected on the next spin" : " · activate below to use on the next spin"}`
                  : "Search and select a participant below"}</span></div>
              {data.overrideActivated && <button className="text-button" disabled={spinLocked} onClick={() => {
                setData((current) => ({ ...current, overrideActivated: false }));
                notify("One-time pick cancelled.");
              }}>Cancel</button>}
            </div>
            <label className="field-label override-label" htmlFor="override-person">PREDETERMINED WINNER</label>
            <label className="override-search">
              <Search size={16} aria-hidden="true" />
              <input id="override-person" type="search" value={overrideSearch} disabled={spinLocked || data.participants.length === 0}
                onChange={(event) => setOverrideSearch(event.target.value)} placeholder="Search participants…" aria-label="Search participants for predetermined winner" />
            </label>
            {data.participants.length === 0 ? <p className="override-empty">Add participants before choosing a one-time pick.</p> :
              filteredOverrideParticipants.length === 0 ? <p className="override-empty">No participants match “{overrideSearch.trim()}”.</p> :
                <div className="override-participant-list" role="listbox" aria-label="Predetermined winner">
                  {filteredOverrideParticipants.map(({ participant, index }) => {
                    const selected = participant.id === data.overrideParticipantId;
                    return <button className={`override-participant${selected ? " is-selected" : ""}`} type="button" role="option"
                      aria-selected={selected} key={participant.id} disabled={spinLocked} onClick={() => setData((current) => ({
                        ...current,
                        overrideParticipantId: participant.id,
                        overrideActivated: false,
                      }))}>
                      <span className="override-participant-index">{index + 1}</span>
                      <span className="override-participant-name">{participant.name}</span>
                      {participant.weight > 1 && <small>×{participant.weight}</small>}
                      {selected && <Check size={16} aria-hidden="true" />}
                    </button>;
                  })}
                </div>}
            <button className="button button-primary arm-button" type="button" disabled={spinLocked || !eligibleOverride || data.overrideActivated}
              onClick={activateOverride}>
              <Check size={15} />{data.overrideActivated ? "One-time pick is armed" : "Activate one-time pick"}
            </button>
            <div className="mode-note"><LockKeyhole size={13} /> Audience results identify operator-selected winners.</div>
          </div>

          <div className="panel-card stats-card">
            <div className="stat-block"><span>ON THE WHEEL</span><strong>{data.participants.length}</strong><small>eligible participants</small></div>
            <div className="stat-divider" />
            <div className="stat-block"><span>WINNERS DRAWN</span><strong>{data.winners.length}</strong><small>this session</small></div>
          </div>

          <div className="panel-card recent-card">
            <div className="recent-header"><div><span className="card-overline">RECENT WINNER</span><div className="recent-name">{data.winners[0]?.participant.name ?? "No winner yet"}</div></div>
              <div className="trophy-mark"><Trophy size={18} /></div></div>
            {data.winners[0] && <div className="recent-meta">
              <span><Clock3 size={13} /> {new Date(data.winners[0].timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              <span className={`mode-pill mode-${data.winners[0].mode}`}>
                {data.winners[0].mode === "controlled" ? "OPERATOR PICK" : `${data.winners[0].mode.toUpperCase()} DRAW`}
              </span>
            </div>}
            <button className="button button-quiet history-link" disabled={spinLocked} onClick={() => setDialog("history")}><History size={15} /> View winner history</button>
          </div>
        </aside>
      </section>

      <section className="utility-row">
        <div className="participant-summary"><div className="avatar-stack">
          {data.participants.slice(0, 4).map((person, index) => <span key={person.id} style={{ background: data.settings.colors[index % data.settings.colors.length] }}>{person.name.charAt(0).toUpperCase()}</span>)}
        </div><span><strong>{data.participants.length} names</strong> ready to play</span></div>
        <div className="utility-actions">
          <button className="button button-outline" disabled={spinLocked} onClick={() => setDialog("participants")}><ListPlus size={16} /> Participants</button>
          <label className={`button button-outline file-button${spinLocked ? " is-disabled" : ""}`}><Upload size={15} /> Import Excel
            <input type="file" accept=".xlsx,.xls,.csv" disabled={spinLocked} onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void loadWorkbook(file);
              event.target.value = "";
            }} />
          </label>
          <button className="button button-quiet" onClick={exportParticipants} disabled={!data.participants.length}><Download size={15} /> Export</button>
        </div>
      </section>

      <footer className="page-footer"><span>YOUR EVENT. YOUR MOMENT.</span><span>Session saved locally on this device <span className="saved-dot" /></span></footer>

      {lastWinner && <WinnerAnnouncement winner={lastWinner} confetti={data.settings.confetti}
        autoRemove={data.settings.autoRemove} onClose={() => setLastWinner(null)} />}

      {dialog && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}>
        <section className={`dialog ${dialog === "participants" || dialog === "history" ? "dialog-wide" : ""}`} role="dialog" aria-modal="true">
          <header className="dialog-header"><div><span className="eyebrow">FORTUNE / WHEEL</span>
            <h2>{dialog === "participants" ? "Participants" : dialog === "import" ? "Import spreadsheet" : dialog === "settings" ? "Wheel settings" : "Winner history"}</h2></div>
            <button className="icon-button" aria-label="Close dialog" onClick={() => { setDialog(null); setCapturingShortcut(false); }}><X size={18} /></button>
          </header>

          {dialog === "participants" && <div className="dialog-content">
            <div className="add-participant">
              <input value={newName} disabled={spinLocked} maxLength={100} placeholder="Add a participant name…" onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") void addParticipant(); }} />
              <button className="button button-primary" onClick={() => void addParticipant()} disabled={spinLocked || !newName.trim() || newNameAlreadyExists}><Plus size={16} /> Add</button>
            </div>
            <div className="list-toolbar"><span>{data.participants.length} active participant{data.participants.length === 1 ? "" : "s"}</span>
              <div className="participant-file-actions">
                <label className={`button button-outline file-button${spinLocked ? " is-disabled" : ""}`}><Upload size={14} /> Import Excel
                  <input type="file" accept=".xlsx,.xls,.csv" disabled={spinLocked} aria-label="Import participants from an Excel file" onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void loadWorkbook(file);
                    event.target.value = "";
                  }} />
                </label>
                <button className="text-button" onClick={() => void exportParticipants()} disabled={!data.participants.length}><Download size={14} /> Export</button>
              </div>
            </div>
            <div className={`duplicate-check${duplicateParticipantIds.size ? " has-duplicates" : ""}`} role="status">
              <span><ShieldCheck size={16} />{duplicateParticipantIds.size
                ? `${duplicateParticipantIds.size} duplicate participant entr${duplicateParticipantIds.size === 1 ? "y" : "ies"} found`
                : "No duplicate participant names detected"}</span>
              <div>
                <button className="text-button" type="button" onClick={verifyParticipantNames}><Check size={14} /> Verify names</button>
                <button className="text-button" type="button" disabled={spinLocked || duplicateParticipantIds.size === 0}
                  onClick={() => void removeDuplicateParticipantsFromList()}><Trash2 size={14} /> Remove duplicates</button>
              </div>
            </div>
            {data.participants.length === 0 ? <div className="empty-state"><FileSpreadsheet size={22} /><p>No participants yet. Add names or import a spreadsheet.</p></div> :
              <div className="participant-list">{data.participants.map((person, index) => <div className="participant-row" key={person.id}>
                <span className="row-index">{String(index + 1).padStart(2, "0")}</span>
                {isOperator ? <input aria-label={`Participant ${index + 1} name`} value={person.name} disabled={spinLocked}
                  onChange={(event) => updateParticipant(person.id, { name: event.target.value })} /> :
                  <span className="participant-row-name">{person.name}</span>}
                <button className="icon-button danger-icon" aria-label={`Remove ${person.name}`} disabled={spinLocked} onClick={() => void removeParticipant(person.id)}><Trash2 size={15} /></button>
              </div>)}</div>}
            <p className="dialog-note">{isOperator
              ? "Names are identified by participant ID. Use the duplicate check to verify or clean repeated names."
              : "Add participants by name or spreadsheet. New names are checked against the current list, ignoring letter case."}</p>
          </div>}

          {dialog === "import" && <div className="dialog-content">
            {!importBook ? <div className="empty-state"><Upload size={22} /><p>Select an XLSX, XLS, or CSV file to begin.</p></div> : <>
              <div className="file-summary"><FileSpreadsheet size={19} /><strong>{importBook.Props?.Title || "Spreadsheet loaded"}</strong><span>{importBook.SheetNames.length} sheet{importBook.SheetNames.length === 1 ? "" : "s"}</span></div>
              {importBook.SheetNames.length > 1 && <label className="setting-field"><span>Worksheet</span><select value={sheetName} onChange={(event) => { setSheetName(event.target.value); setColumnIndex(0); }}>
                {importBook.SheetNames.map((name) => <option key={name}>{name}</option>)}</select></label>}
              <label className="setting-field"><span>Name column</span><select value={columnIndex} onChange={(event) => setColumnIndex(Number(event.target.value))}>
                {(importRows.columns.length ? importRows.columns : ["No columns found"]).map((label, index) => <option key={`${label}-${index}`} value={index}>{label}</option>)}</select></label>
              <label className="check-setting"><input type="checkbox" checked={hasHeader} onChange={(event) => setHasHeader(event.target.checked)} /><span>First row contains column headers</span></label>
              {isOperator && <label className="check-setting"><input type="checkbox" checked={keepDuplicates} onChange={(event) => setKeepDuplicates(event.target.checked)} /><span>Keep duplicate names as separate entries</span></label>}
              <div className="import-preview"><div className="preview-heading"><span>PREVIEW</span><strong>{importRows.names.length} names · {importRows.empty} blank rows · {importRows.missing} rows without a name</strong></div>
                {importRows.names.length === 0 ? <p>No names found in the selected column.</p> :
                  <div className="preview-names">{importRows.names.slice(0, 12).map((name, index) => <span key={`${name}-${index}`}>{name}</span>)}{importRows.names.length > 12 && <span>+{importRows.names.length - 12} more</span>}</div>}
                {importDuplicateCount > 0 && <p className="duplicate-note">{importDuplicateCount} repeated name{importDuplicateCount === 1 ? "" : "s"} detected. {isOperator && keepDuplicates ? "They will be kept as separate participants." : "Repeated names will be skipped."}</p>}
              </div>
              <fieldset className="import-choice"><legend>Import action</legend>
                <label><input type="radio" name="import-action" checked={importAction === "append"} onChange={() => setImportAction("append")} /> Add to current participants</label>
                <label><input type="radio" name="import-action" checked={importAction === "replace"} onChange={() => setImportAction("replace")} /> Replace current participants</label>
              </fieldset>
              <div className="dialog-actions"><button className="button button-outline" onClick={() => setDialog(null)}>Cancel</button>
                <button className="button button-primary" onClick={confirmImport} disabled={spinLocked || !importRows.names.length}><Upload size={15} /> Import {importRows.names.length} names</button></div>
            </>}
          </div>}

          {dialog === "settings" && <div className="dialog-content settings-content">
            <fieldset className="settings-fields" disabled={spinLocked}>
            <label className="setting-field"><span>Event title</span><input maxLength={60} value={data.settings.title} onChange={(event) => updateSettings({ title: event.target.value })} /></label>
            <div className="settings-grid">
              <label className="setting-field"><span>Spin duration (seconds)</span><input type="number" min="1" max="30" value={data.settings.duration}
                onChange={(event) => updateSettings({ duration: Math.min(30, Math.max(1, Number(event.target.value) || 1)) })} /></label>
              <label className="setting-field"><span>Full rotations</span><input type="number" min="1" max="20" value={data.settings.rotations}
                onChange={(event) => updateSettings({ rotations: Math.min(20, Math.max(1, Number(event.target.value) || 1)) })} /></label>
            </div>
            <label className="setting-field"><span>Wheel colors <small>comma-separated hex values</small></span><input value={customPalette}
              onChange={(event) => setCustomPalette(event.target.value)} onBlur={() => {
                const colors = customPalette.split(",").map((color) => color.trim()).filter((color) => /^#[0-9a-f]{6}$/i.test(color));
                if (!colors.length) { setCustomPalette(data.settings.colors.join(", ")); notify("Enter at least one valid six-digit hex color.", "error"); }
                else updateSettings({ colors });
              }} placeholder="#bd8e39, #28242b, #8d382e" /></label>
            <div className="color-swatches">{data.settings.colors.map((color) => <span key={color} title={color} style={{ background: color }} />)}</div>
            <div className="wheel-color-settings">
              <label><span>Hub / empty wheel</span><input aria-label="Hub and empty wheel color" type="color" value={data.settings.background} onChange={(event) => updateSettings({ background: event.target.value })} /></label>
              <label><span>Segment text</span><input aria-label="Segment text color" type="color" value={data.settings.textColor} onChange={(event) => updateSettings({ textColor: event.target.value })} /></label>
              <label><span>Segment borders</span><input aria-label="Segment border color" type="color" value={data.settings.borderColor} onChange={(event) => updateSettings({ borderColor: event.target.value })} /></label>
            </div>
            <label className="check-setting"><input type="checkbox" checked={data.settings.autoRemove} onChange={(event) => updateSettings({ autoRemove: event.target.checked })} /><span>Remove each winner from the active wheel</span></label>
            <label className="check-setting"><input type="checkbox" checked={data.settings.sound} onChange={(event) => updateSettings({ sound: event.target.checked })} /><span>Enable spin and winner sounds</span></label>
            <label className="check-setting"><input type="checkbox" checked={data.settings.confetti} onChange={(event) => updateSettings({ confetti: event.target.checked })} /><span>Celebrate winners with confetti</span></label>
            <div className="shortcut-setting"><div><strong>Desktop shortcut (optional)</strong><span>You can also activate a one-time pick with the button on the draw controls.</span></div>
              <button className="button button-outline shortcut-button" onClick={() => setCapturingShortcut(true)}>
                {capturingShortcut ? "Press a letter or number…" : <><Keyboard size={15} /> {keyLabel(data.settings.shortcut)}</>}
              </button></div>
            <div className="security-note"><LockKeyhole size={15} /><span>Data stays in this browser. As a client-only app, it cannot enforce administrator access or protect against changes made by someone with device access.</span></div>
            <div className="backup-actions"><button className="button button-outline" onClick={exportBackup}><Download size={15} /> Backup</button>
              <button className="button button-outline" onClick={() => backupInput.current?.click()}><Upload size={15} /> Restore backup</button>
              <input ref={backupInput} className="hidden-input" type="file" accept=".json,application/json" onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importBackup(file);
                event.target.value = "";
              }} />
              <button className="button button-danger" onClick={resetSession}><RotateCcw size={14} /> Reset session</button></div>
            <button className="button button-primary settings-done" onClick={() => setDialog(null)}><Check size={15} /> Done</button>
            </fieldset>
          </div>}

          {dialog === "history" && <div className="dialog-content">
            <div className="history-toolbar"><label className="search-field"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search winners…" /><span>⌕</span></label>
              <button className="button button-outline" onClick={exportHistory} disabled={!data.winners.length}><Download size={14} /> Export Excel</button></div>
            {filteredWinners.length === 0 ? <div className="empty-state"><Trophy size={22} /><p>{data.winners.length ? "No winners match your search." : "Winner history will appear here after the first spin."}</p></div> :
              <div className="history-list">{filteredWinners.map((record) => {
                const isActive = data.participants.some((person) => person.id === record.participant.id);
                return <div className="history-row" key={`${record.spinNumber}-${record.participant.id}`}>
                  <span className="history-number">#{String(record.spinNumber).padStart(2, "0")}</span>
                  <div className="history-person"><strong>{record.participant.name}</strong><span>{new Date(record.timestamp).toLocaleString()}</span></div>
                  <span className={`mode-pill mode-${record.mode}`}>{record.mode}</span>
                  {!isActive && <button className="icon-button restore-icon" disabled={spinLocked} title="Restore to wheel" aria-label={`Restore ${record.participant.name}`} onClick={() => restoreWinner(record.participant.id)}><RotateCcw size={15} /></button>}
                </div>;
              })}</div>}
            <div className="dialog-actions history-actions">
              <button className="button button-danger" disabled={spinLocked || !data.winners.length} onClick={() => {
                if (window.confirm("Clear all winner history? Participants already removed from the wheel will remain removed.")) {
                  setData((current) => ({ ...current, winners: [] }));
                  notify("Winner history cleared.");
                }
              }}><Trash2 size={14} /> Clear history</button>
              <button className="button button-outline" onClick={() => setDialog(null)}>Close</button>
            </div>
          </div>}
        </section>
      </div>}

      <div className="toast-stack" aria-live="polite">{toasts.map((toast) => <div className={`toast toast-${toast.tone}`} key={toast.id}>
        {toast.tone === "success" ? <Check size={16} /> : <CircleHelp size={16} />}{toast.message}
      </div>)}</div>
    </main>
  );
}

export default App;
