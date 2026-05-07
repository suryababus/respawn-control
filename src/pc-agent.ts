import { db } from "./firebase";
import {
  doc,
  setDoc,
  onSnapshot,
  updateDoc,
  collection,
  Timestamp,
  deleteField,
} from "firebase/firestore";
import { scanInstalledGames, DetectedGame } from "./game-scanner";
import os from "os";
import { exec } from "child_process";

// Use hostname as the PC identifier. Override via env if needed.
const PC_ID = process.env.PC_ID || os.hostname();
const PC_NAME = process.env.PC_NAME || PC_ID;

export type PcDoc = {
  id: string;
  name: string;
  status: "offline" | "online" | "available" | "running";
  lastHeartbeatAt: Timestamp;
  installedGames: DetectedGame[];
  currentSession?: {
    sessionId: string;
    gameId: string;
    gameName: string;
    durationMinutes: number;
    startedAt: Timestamp;
    remainingSeconds: number;
  } | null;
};

export type SessionCommand = {
  type: "START_SESSION" | "ADD_TIME" | "END_SESSION" | "PAUSE" | "RESUME";
  sessionId?: string;
  gameId?: string;
  gameName?: string;
  launchCommand?: string;
  durationMinutes?: number;
  addMinutes?: number;
  timestamp: Timestamp;
};

let heartbeatInterval: NodeJS.Timeout | null = null;
let unsubscribeCommand: (() => void) | null = null;

// Callbacks that main.ts will register
let onStartSession: ((cmd: SessionCommand) => void) | null = null;
let onAddTime: ((cmd: SessionCommand) => void) | null = null;
let onEndSession: (() => void) | null = null;
let onPause: (() => void) | null = null;
let onResume: (() => void) | null = null;

export function registerCallbacks(callbacks: {
  onStartSession: (cmd: SessionCommand) => void;
  onAddTime: (cmd: SessionCommand) => void;
  onEndSession: () => void;
  onPause: () => void;
  onResume: () => void;
}) {
  onStartSession = callbacks.onStartSession;
  onAddTime = callbacks.onAddTime;
  onEndSession = callbacks.onEndSession;
  onPause = callbacks.onPause;
  onResume = callbacks.onResume;
}

function pcDocRef() {
  return doc(db, "pcs", PC_ID);
}

function commandDocRef() {
  return doc(db, "pcs", PC_ID, "control", "command");
}

export async function registerPc(): Promise<void> {
  const games = scanInstalledGames();
  console.log(`[agent] Detected ${games.length} installed games`);

  const pcData: PcDoc = {
    id: PC_ID,
    name: PC_NAME,
    status: "available",
    lastHeartbeatAt: Timestamp.now(),
    installedGames: games,
    currentSession: null,
  };

  await setDoc(pcDocRef(), pcData, { merge: true });
  console.log(`[agent] Registered PC: ${PC_ID}`);
}

export function startHeartbeat(): void {
  heartbeatInterval = setInterval(async () => {
    try {
      await updateDoc(pcDocRef(), {
        lastHeartbeatAt: Timestamp.now(),
      });
    } catch (err) {
      console.error("[agent] Heartbeat failed:", err);
    }
  }, 30_000); // Every 30 seconds
}

export function listenForCommands(): void {
  unsubscribeCommand = onSnapshot(commandDocRef(), (snapshot) => {
    if (!snapshot.exists()) return;

    const cmd = snapshot.data() as SessionCommand;
    console.log(`[agent] Received command: ${cmd.type}`);

    switch (cmd.type) {
      case "START_SESSION":
        onStartSession?.(cmd);
        break;
      case "ADD_TIME":
        onAddTime?.(cmd);
        break;
      case "END_SESSION":
        onEndSession?.();
        break;
      case "PAUSE":
        onPause?.();
        break;
      case "RESUME":
        onResume?.();
        break;
    }
  });
}

export async function updateSessionStatus(
  sessionId: string,
  remainingSeconds: number,
  status: "running" | "paused"
): Promise<void> {
  try {
    await updateDoc(pcDocRef(), {
      status: status === "running" ? "running" : "running", // PC is still "running" even if paused
      "currentSession.remainingSeconds": remainingSeconds,
    });
  } catch (err) {
    console.error("[agent] Failed to update session status:", err);
  }
}

export async function markSessionEnded(): Promise<void> {
  try {
    await updateDoc(pcDocRef(), {
      status: "available",
      currentSession: null,
    });
  } catch (err) {
    console.error("[agent] Failed to mark session ended:", err);
  }
}

export async function markSessionStarted(
  sessionId: string,
  gameId: string,
  gameName: string,
  durationMinutes: number
): Promise<void> {
  try {
    await updateDoc(pcDocRef(), {
      status: "running",
      currentSession: {
        sessionId,
        gameId,
        gameName,
        durationMinutes,
        startedAt: Timestamp.now(),
        remainingSeconds: durationMinutes * 60,
      },
    });
  } catch (err) {
    console.error("[agent] Failed to mark session started:", err);
  }
}

export async function setOffline(): Promise<void> {
  try {
    await updateDoc(pcDocRef(), {
      status: "offline",
      currentSession: null,
    });
  } catch (err) {
    console.error("[agent] Failed to set offline:", err);
  }
}

export function launchGame(launchCommand?: string): void {
  if (!launchCommand) return;

  console.log(`[agent] Launching: ${launchCommand}`);

  // steam:// URLs and exe paths both work with `start`
  if (launchCommand.startsWith("steam://") || launchCommand.includes("://")) {
    exec(`start "" "${launchCommand}"`);
  } else {
    exec(`"${launchCommand}"`);
  }
}

export function cleanup(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  if (unsubscribeCommand) {
    unsubscribeCommand();
    unsubscribeCommand = null;
  }
}

export { PC_ID };
