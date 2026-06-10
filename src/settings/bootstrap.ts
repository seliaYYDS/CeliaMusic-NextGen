import { ensureAppSettings } from "./store";

let settingsBootPromise: Promise<void> | null = null;

export const bootstrapAppSettings = (): Promise<void> => {
  if (settingsBootPromise) {
    return settingsBootPromise;
  }

  settingsBootPromise = ensureAppSettings()
    .then((snapshot) => {
      console.info(
        "[settings] ready",
        snapshot.settingsPath,
        `language=${snapshot.settings.appearance.language}`,
        `volume=${snapshot.settings.playback.defaultVolume}`,
      );
    })
    .catch((error: unknown) => {
      console.error("[settings] failed to initialize", error);
      throw error;
    });

  return settingsBootPromise;
};
