/**
 * Thin DI seam around @tauri-apps/plugin-fs — every call is async because
 * Tauri's fs plugin is IPC-backed with no synchronous variant (verified
 * against the v2 plugin-fs JS reference: every exported function returns a
 * Promise). Per Amendment A the SavePort interface above this seam is also
 * async, so FsSavePort (src/shell/save-port-fs.ts) passes these calls
 * straight through — no cache, no adaptation layer.
 */

export interface FsDirEntry {
  name: string;
  isDirectory: boolean;
}

export interface FsOps {
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  readDir(path: string): Promise<FsDirEntry[]>;
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, contents: string): Promise<void>;
  remove(path: string): Promise<void>;
}

/**
 * Real Tauri-backed FsOps, scoped to BaseDirectory.AppData (matches the
 * capabilities/default.json fs:scope — $APPDATA/saves/**). Dynamically
 * imported so this module has zero load-time dependency on the Tauri
 * runtime being present (the web bundle never loads the plugin; tests
 * never call this function).
 */
export async function createTauriFsOps(): Promise<FsOps> {
  const { exists, mkdir, readDir, readTextFile, writeTextFile, remove, BaseDirectory } =
    await import('@tauri-apps/plugin-fs');
  const baseDir = BaseDirectory.AppData;

  return {
    exists: (path) => exists(path, { baseDir }),
    mkdir: (path) => mkdir(path, { baseDir }),
    readDir: (path) => readDir(path, { baseDir }),
    readTextFile: (path) => readTextFile(path, { baseDir }),
    writeTextFile: (path, contents) => writeTextFile(path, contents, { baseDir }),
    remove: (path) => remove(path, { baseDir }),
  };
}
