import { ensureMediaLibrary } from "./library";

let libraryBootPromise: Promise<void> | null = null;

export const bootstrapMediaLibrary = (): Promise<void> => {
  if (libraryBootPromise) {
    return libraryBootPromise;
  }

  libraryBootPromise = ensureMediaLibrary()
    .then((snapshot) => {
      console.info(
        "[media] library ready",
        snapshot.libraryPath,
        `tracks=${snapshot.tracks.length}`,
        `artworks=${snapshot.artworks.length}`,
      );
    })
    .catch((error: unknown) => {
      console.error("[media] failed to initialize library", error);
      throw error;
    });

  return libraryBootPromise;
};
