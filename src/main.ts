import { app, BrowserWindow, ipcMain, screen, globalShortcut } from "electron";
import path from "path";

// --- Configuration ---
const ADMIN_PIN = "1234"; // POC: plaintext pin. Production: hashed.
const DEFAULT_SESSION_SECONDS = 60; // 1 minute for POC demo. Change as needed.

let overlayWindow: BrowserWindow | null = null;
let lockWindow: BrowserWindow | null = null;

let remainingSeconds = DEFAULT_SESSION_SECONDS;
let timerInterval: NodeJS.Timeout | null = null;
let isPaused = false;

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

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function startTimer() {
  remainingSeconds = DEFAULT_SESSION_SECONDS;
  isPaused = false;

  timerInterval = setInterval(() => {
    if (isPaused) return;

    remainingSeconds--;

    const timeStr = formatTime(remainingSeconds);
    const warning =
      remainingSeconds <= 60 ? "critical" : remainingSeconds <= 300 ? "warning" : "normal";

    overlayWindow?.webContents.send("timer:tick", { timeStr, warning, remainingSeconds });

    if (remainingSeconds <= 0) {
      clearInterval(timerInterval!);
      timerInterval = null;
      onSessionExpired();
    }
  }, 1000);
}

function onSessionExpired() {
  overlayWindow?.webContents.send("timer:expired");

  // Hide overlay and show lock screen
  overlayWindow?.hide();
  createLockWindow();
}

function unlockAndReset() {
  if (lockWindow) {
    lockWindow.destroy();
    lockWindow = null;
  }
  overlayWindow?.show();
  startTimer();
}

// --- IPC Handlers ---

ipcMain.handle("unlock", (_event, pin: string) => {
  if (pin === ADMIN_PIN) {
    unlockAndReset();
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

// --- App lifecycle ---

app.whenReady().then(() => {
  createOverlayWindow();
  startTimer();

  // Prevent Cmd+Q / Alt+F4 from quitting during lock
  app.on("before-quit", (e) => {
    if (lockWindow) {
      e.preventDefault();
    }
  });
});

app.on("window-all-closed", () => {
  // Keep app running
});
