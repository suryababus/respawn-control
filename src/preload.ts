import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("api", {
  onTimerTick: (callback: (data: { timeStr: string; warning: string; remainingSeconds: number }) => void) => {
    ipcRenderer.on("timer:tick", (_event, data) => callback(data));
  },
  onTimerExpired: (callback: () => void) => {
    ipcRenderer.on("timer:expired", () => callback());
  },
  unlock: (pin: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke("unlock", pin);
  },
  getInitialTime: (): Promise<{ timeStr: string; warning: string; remainingSeconds: number }> => {
    return ipcRenderer.invoke("get-initial-time");
  },
});
