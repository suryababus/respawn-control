import fs from "fs";
import path from "path";

export type DetectedGame = {
  name: string;
  platform: "steam" | "epic" | "local";
  appId?: string;
  installPath: string;
  executablePath?: string;
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

// --- Main Scanner ---

export function scanInstalledGames(): DetectedGame[] {
  const allGames: DetectedGame[] = [];

  try {
    allGames.push(...scanSteamGames());
  } catch {
    console.error("Failed to scan Steam games");
  }

  try {
    allGames.push(...scanEpicGames());
  } catch {
    console.error("Failed to scan Epic games");
  }

  return allGames;
}
