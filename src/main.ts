import { app, BrowserWindow, ipcMain, screen } from "electron";
import path from "path";
import {
  registerPc,
  startHeartbeat,
  listenForCommands,
  registerCallbacks,
  updateSessionStatus,
  markSessionEnded,
  markSessionStarted,
  setOffline,
  launchGame,
  cleanup,
  SessionCommand,
} from "./pc-agent";

// --- Configuration ---
const ADMIN_PIN = "1234";

let overlayWindow: BrowserWindow | null = null;
let lockWindow: BrowserWindow | null = null;

let remainingSeconds = 0;
let timerInterval: NodeJS.Timeout | null = null;
let isPaused = false;
let currentSessionId: string | null = null;

// --- Window Management ---

function createOverlayWindow() {
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.workAreaSize;

  overlayWindow = new BrowserWindow({
    width: 280,
    height: 70,
    x: Math.floor(width / 2 - 140),
    y: height - 90,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.loadFile(path.join(__dirname, "..", "src", "renderer", "overlay.html"));
  overlayWindow.hide(); // Hidden until a session starts
}

function createLockWindow() {
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.size;

  lockWindow = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
    frame: false,
    fullscreen: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    closable: false,
    minimizable: false,
    kiosk: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  lockWindow.loadFile(path.join(__dirname, "..", "src", "renderer", "lock.html"));
  lockWindow.setAlwaysOnTop(true, "screen-saver");
}

function showLockScreen() {
  overlayWindow?.hide();
  createLockWindow();
}

function hideLockScreen() {
  if (lockWindow) {
    lockWindow.destroy();
    lockWindow = null;
  }
}

// --- Timer ---

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function sendTickToOverlay() {
  const timeStr = formatTime(remainingSeconds);
  const warning =
    remainingSeconds <= 60 ? "critical" : remainingSeconds <= 300 ? "warning" : "normal";
  overlayWindow?.webContents.send("timer:tick", { timeStr, warning, remainingSeconds });
}

function startTimer(durationSeconds: number) {
  stopTimer();
  remainingSeconds = durationSeconds;
  isPaused = false;

  overlayWindow?.show();
  sendTickToOverlay();

  timerInterval = setInterval(() => {
    if (isPaused) return;

    remainingSeconds--;
    sendTickToOverlay();

    // Sync to Firestore every 10 seconds
    if (currentSessionId && remainingSeconds % 10 === 0) {
      updateSessionStatus(currentSessionId, remainingSeconds, "running");
    }

    if (remainingSeconds <= 0) {
      stopTimer();
      onSessionExpired();
    }
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function addTime(extraSeconds: number) {
  remainingSeconds += extraSeconds;
  sendTickToOverlay();
}

function pauseTimer() {
  isPaused = true;
  if (currentSessionId) {
    updateSessionStatus(currentSessionId, remainingSeconds, "paused");
  }
}

function resumeTimer() {
  isPaused = false;
  if (currentSessionId) {
    updateSessionStatus(currentSessionId, remainingSeconds, "running");
  }
}

async function onSessionExpired() {
  overlayWindow?.webContents.send("timer:expired");
  currentSessionId = null;
  await markSessionEnded();
  showLockScreen();
}

async function endSession() {
  stopTimer();
  currentSessionId = null;
  overlayWindow?.hide();
  await markSessionEnded();
  showLockScreen();
}

// --- Firebase Command Handlers ---

async function handleStartSession(cmd: SessionCommand) {
  const sessionId = cmd.sessionId || `session-${Date.now()}`;
  const durationMinutes = cmd.durationMinutes || 60;

  currentSessionId = sessionId;

  // Hide lock screen if showing
  hideLockScreen();

  // Launch the game
  launchGame(cmd.launchCommand);

  // Start the timer
  startTimer(durationMinutes * 60);

  // Update Firestore
  await markSessionStarted(sessionId, cmd.gameId || "", cmd.gameName || "", durationMinutes);

  console.log(`[main] Session started: ${sessionId} — ${durationMinutes}min — ${cmd.gameName}`);
}

function handleAddTime(cmd: SessionCommand) {
  const extraMinutes = cmd.addMinutes || 0;
  if (extraMinutes > 0) {
    addTime(extraMinutes * 60);
    console.log(`[main] Added ${extraMinutes} minutes`);
  }
}

function handleEndSession() {
  console.log("[main] Session ended by remote command");
  endSession();
}

function handlePause() {
  console.log("[main] Session paused");
  pauseTimer();
}

function handleResume() {
  console.log("[main] Session resumed");
  resumeTimer();
}

// --- IPC Handlers ---

ipcMain.handle("unlock", (_event, pin: string) => {
  if (pin === ADMIN_PIN) {
    hideLockScreen();
    // Don't auto-start a new session — wait for mobile app command
    return { success: true };
  }
  return { success: false, error: "Wrong PIN" };
});

ipcMain.handle("get-initial-time", () => {
  return {
    timeStr: formatTime(remainingSeconds),
    warning: "normal",
    remainingSeconds,
  };
});

// --- App Lifecycle ---

app.whenReady().then(async () => {
  createOverlayWindow();

  // Show lock screen initially — PC is locked until mobile app starts a session
  showLockScreen();

  // Register command callbacks
  registerCallbacks({
    onStartSession: handleStartSession,
    onAddTime: handleAddTime,
    onEndSession: handleEndSession,
    onPause: handlePause,
    onResume: handleResume,
  });

  // Connect to Firebase
  try {
    await registerPc();
    startHeartbeat();
    listenForCommands();
    console.log("[main] Firebase agent connected");
  } catch (err) {
    console.error("[main] Firebase connection failed:", err);
  }

  app.on("before-quit", async (e) => {
    if (lockWindow) {
      e.preventDefault();
      return;
    }
    cleanup();
    await setOffline();
  });
});

app.on("window-all-closed", () => {
  // Keep app running
});
