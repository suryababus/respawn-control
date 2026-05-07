import fs from "fs";
import os from "os";
import path from "path";

export type DetectedGame = {
  name: string;
  platform: "steam" | "epic" | "local";
  appId?: string;
  installPath: string;
  executablePath?: string;
  shortcutPath?: string;
  launchCommand?: string;
};

// --- Steam ---

function findSteamLibraryFolders(): string[] {
  const defaultSteamPath = "C:\\Program Files (x86)\\Steam";
  const libraryFoldersVdf = path.join(defaultSteamPath, "steamapps", "libraryfolders.vdf");

  const folders: string[] = [];

  // Always include the default
  const defaultApps = path.join(defaultSteamPath, "steamapps");
  if (fs.existsSync(defaultApps)) {
    folders.push(defaultApps);
  }

  if (!fs.existsSync(libraryFoldersVdf)) return folders;

  try {
    const content = fs.readFileSync(libraryFoldersVdf, "utf-8");
    // Match "path" entries like:  "path"		"D:\\SteamLibrary"
    const pathRegex = /"path"\s+"([^"]+)"/g;
    let match: RegExpExecArray | null;
    while ((match = pathRegex.exec(content)) !== null) {
      const libPath = path.join(match[1].replace(/\\\\/g, "\\"), "steamapps");
      if (fs.existsSync(libPath) && !folders.includes(libPath)) {
        folders.push(libPath);
      }
    }
  } catch {
    // Ignore read errors
  }

  return folders;
}

function scanSteamGames(): DetectedGame[] {
  const games: DetectedGame[] = [];
  const libraryFolders = findSteamLibraryFolders();

  for (const folder of libraryFolders) {
    try {
      const files = fs.readdirSync(folder).filter((f) => f.startsWith("appmanifest_") && f.endsWith(".acf"));

      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(folder, file), "utf-8");

          const nameMatch = content.match(/"name"\s+"([^"]+)"/);
          const appIdMatch = content.match(/"appid"\s+"([^"]+)"/);
          const installDirMatch = content.match(/"installdir"\s+"([^"]+)"/);
          const stateMatch = content.match(/"StateFlags"\s+"(\d+)"/);

          // StateFlags 4 = fully installed
          if (nameMatch && appIdMatch && installDirMatch && stateMatch?.[1] === "4") {
            const installPath = path.join(folder, "common", installDirMatch[1]);
            games.push({
              name: nameMatch[1],
              platform: "steam",
              appId: appIdMatch[1],
              installPath,
              launchCommand: `steam://rungameid/${appIdMatch[1]}`,
            });
          }
        } catch {
          // Skip unreadable manifests
        }
      }
    } catch {
      // Skip unreadable folders
    }
  }

  return games;
}

// --- Epic Games ---

function scanEpicGames(): DetectedGame[] {
  const games: DetectedGame[] = [];
  const manifestDir = "C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests";

  if (!fs.existsSync(manifestDir)) return games;

  try {
    const files = fs.readdirSync(manifestDir).filter((f) => f.endsWith(".item"));

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(manifestDir, file), "utf-8");
        const manifest = JSON.parse(content);

        if (manifest.DisplayName && manifest.InstallLocation && fs.existsSync(manifest.InstallLocation)) {
          games.push({
            name: manifest.DisplayName,
            platform: "epic",
            appId: manifest.CatalogItemId,
            installPath: manifest.InstallLocation,
            launchCommand: manifest.LaunchExecutable
              ? path.join(manifest.InstallLocation, manifest.LaunchExecutable)
              : undefined,
          });
        }
      } catch {
        // Skip unreadable manifests
      }
    }
  } catch {
    // Skip if directory unreadable
  }

  return games;
}

// --- Desktop Games Folder ---

const GAME_EXTENSIONS = [".exe", ".lnk", ".url"];

// Common non-game executables to ignore
const EXE_BLACKLIST = new Set([
  "uninstall.exe",
  "unins000.exe",
  "unins001.exe",
  "crashreporter.exe",
  "ue4prereqsetup_x64.exe",
  "dxsetup.exe",
  "vcredist_x64.exe",
  "vcredist_x86.exe",
  "dotnetfx.exe",
  "setup.exe",
  "installer.exe",
  "updater.exe",
  "launcher.exe",
]);

function resolveShortcutTarget(lnkPath: string): string | null {
  // .lnk files are binary — use PowerShell to resolve the target
  try {
    const { execSync } = require("child_process");
    const cmd = `powershell -NoProfile -Command "(New-Object -ComObject WScript.Shell).CreateShortcut('${lnkPath.replace(/'/g, "''")}').TargetPath"`;
    const target = execSync(cmd, { encoding: "utf-8", timeout: 5000 }).trim();
    return target || null;
  } catch {
    return null;
  }
}

function resolveUrlTarget(urlPath: string): string | null {
  // .url files are INI-like: [InternetShortcut]\nURL=steam://rungameid/730
  try {
    const content = fs.readFileSync(urlPath, "utf-8");
    const match = content.match(/^URL=(.+)$/m);
    return match?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

function getDesktopPaths(): string[] {
  const home = os.homedir();
  const paths = [
    path.join(home, "Desktop"),
    path.join(home, "OneDrive", "Desktop"), // OneDrive synced desktop
    "C:\\Users\\Public\\Desktop",
  ];
  return paths.filter((p) => fs.existsSync(p));
}

function getGamesFolderPaths(): string[] {
  const home = os.homedir();
  const paths = [
    path.join(home, "Desktop", "Games"),
    path.join(home, "Desktop", "games"),
    path.join(home, "OneDrive", "Desktop", "Games"),
    path.join(home, "OneDrive", "Desktop", "games"),
    "C:\\Users\\Public\\Desktop\\Games",
    "C:\\Users\\Public\\Desktop\\games",
  ];
  return paths.filter((p) => fs.existsSync(p));
}

function scanDesktopGames(): DetectedGame[] {
  const games: DetectedGame[] = [];
  const seen = new Set<string>();

  // Scan Games folders first, then the whole Desktop
  const foldersToScan = [...getGamesFolderPaths(), ...getDesktopPaths()];

  for (const folder of foldersToScan) {
    try {
      const entries = fs.readdirSync(folder, { withFileTypes: true });

      for (const entry of entries) {
        // Recurse one level into subfolders (e.g. Desktop/Games/Valorant/)
        if (entry.isDirectory()) {
          const subDir = path.join(folder, entry.name);
          try {
            const subEntries = fs.readdirSync(subDir);
            for (const subFile of subEntries) {
              const ext = path.extname(subFile).toLowerCase();
              if (GAME_EXTENSIONS.includes(ext)) {
                const game = processDesktopEntry(path.join(subDir, subFile), subFile);
                if (game && !seen.has(game.name.toLowerCase())) {
                  seen.add(game.name.toLowerCase());
                  games.push(game);
                }
              }
            }
          } catch {
            // Skip unreadable subdirs
          }
          continue;
        }

        const ext = path.extname(entry.name).toLowerCase();
        if (!GAME_EXTENSIONS.includes(ext)) continue;

        const fullPath = path.join(folder, entry.name);
        const game = processDesktopEntry(fullPath, entry.name);
        if (game && !seen.has(game.name.toLowerCase())) {
          seen.add(game.name.toLowerCase());
          games.push(game);
        }
      }
    } catch {
      // Skip unreadable folders
    }
  }

  return games;
}

function processDesktopEntry(fullPath: string, fileName: string): DetectedGame | null {
  const ext = path.extname(fileName).toLowerCase();
  const baseName = path.basename(fileName, ext);

  if (ext === ".exe") {
    if (EXE_BLACKLIST.has(fileName.toLowerCase())) return null;
    return {
      name: baseName,
      platform: "local",
      installPath: path.dirname(fullPath),
      executablePath: fullPath,
      launchCommand: fullPath,
    };
  }

  if (ext === ".lnk") {
    // For .lnk files, always launch the shortcut itself — Windows handles it.
    // We resolve the target only to detect the platform (steam vs local).
    const target = resolveShortcutTarget(fullPath);
    const platform = target?.startsWith("steam://") ? "steam" as const : "local" as const;

    return {
      name: baseName,
      platform,
      installPath: path.dirname(fullPath),
      shortcutPath: fullPath,
      executablePath: target?.toLowerCase().endsWith(".exe") ? target : undefined,
      launchCommand: fullPath, // Launch the .lnk directly
    };
  }

  if (ext === ".url") {
    const target = resolveUrlTarget(fullPath);
    if (!target) return null;

    return {
      name: baseName,
      platform: target.startsWith("steam://") ? "steam" : "local",
      installPath: path.dirname(fullPath),
      shortcutPath: fullPath,
      launchCommand: target,
    };
  }

  return null;
}

// --- Main Scanner ---

export function scanInstalledGames(): DetectedGame[] {
  const allGames: DetectedGame[] = [];
  const seen = new Set<string>();

  // Desktop / Games folder first — these are the games the cafe admin curated
  try {
    for (const game of scanDesktopGames()) {
      if (!seen.has(game.name.toLowerCase())) {
        seen.add(game.name.toLowerCase());
        allGames.push(game);
      }
    }
  } catch {
    console.error("Failed to scan Desktop games");
  }

  try {
    for (const game of scanSteamGames()) {
      if (!seen.has(game.name.toLowerCase())) {
        seen.add(game.name.toLowerCase());
        allGames.push(game);
      }
    }
  } catch {
    console.error("Failed to scan Steam games");
  }

  try {
    for (const game of scanEpicGames()) {
      if (!seen.has(game.name.toLowerCase())) {
        seen.add(game.name.toLowerCase());
        allGames.push(game);
      }
    }
  } catch {
    console.error("Failed to scan Epic games");
  }

  console.log(`[scanner] Found ${allGames.length} total games`);
  return allGames;
}
