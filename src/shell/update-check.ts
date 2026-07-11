/**
 * update-check — once-daily, silent-failure check against the GitHub
 * Releases API (design doc component 4). Every failure mode (offline,
 * rate-limited, malformed JSON, network error) resolves to
 * { checked: true, updateAvailable: false } rather than throwing — the
 * notice is best-effort and must never surface as a player-visible error.
 */

const REPO = 'lhocke/zplus';
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const THROTTLE_KEY = 'zork-update-check-last';
const DISMISS_KEY_PREFIX = 'zork-update-dismissed-';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export interface UpdateCheckResult {
  checked: boolean;
  updateAvailable: boolean;
  latestVersion?: string;
  releaseUrl?: string;
}

/** Strips an optional leading "v" and compares dotted numeric semver. */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const strip = (v: string) => v.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pa = strip(a);
  const pb = strip(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na < nb) return -1;
    if (na > nb) return 1;
  }
  return 0;
}

interface GithubRelease {
  tag_name?: unknown;
  html_url?: unknown;
}

function isGithubRelease(v: unknown): v is GithubRelease {
  return typeof v === 'object' && v !== null;
}

export async function checkForUpdate(opts: {
  currentVersion: string;
  fetchImpl: typeof fetch;
  store: Storage;
  now?: () => number;
}): Promise<UpdateCheckResult> {
  const now = opts.now ?? (() => Date.now());
  const last = Number(opts.store.getItem(THROTTLE_KEY) ?? '0');
  if (now() - last < ONE_DAY_MS) {
    return { checked: false, updateAvailable: false };
  }

  try {
    const res = await opts.fetchImpl(RELEASES_API, { method: 'GET' });
    // Record the attempt regardless of outcome — the throttle applies even
    // to a failed check, so a persistently-offline machine doesn't retry
    // every launch.
    opts.store.setItem(THROTTLE_KEY, String(now()));

    if (!res.ok) {
      return { checked: true, updateAvailable: false };
    }

    const body: unknown = await res.json();
    if (!isGithubRelease(body) || typeof body.tag_name !== 'string' || typeof body.html_url !== 'string') {
      return { checked: true, updateAvailable: false };
    }

    const latestVersion = body.tag_name;
    const releaseUrl = body.html_url;
    const updateAvailable = compareSemver(opts.currentVersion, latestVersion) < 0;

    return { checked: true, updateAvailable, latestVersion, releaseUrl };
  } catch {
    // Offline, DNS failure, malformed response, whatever — silent (spec:
    // "all failures silent").  Still record the attempt so the throttle holds.
    opts.store.setItem(THROTTLE_KEY, String(now()));
    return { checked: true, updateAvailable: false };
  }
}

/** Has the player already dismissed the notice for this specific version? */
export function isDismissed(store: Storage, version: string): boolean {
  return store.getItem(DISMISS_KEY_PREFIX + version) === '1';
}

export function dismiss(store: Storage, version: string): void {
  store.setItem(DISMISS_KEY_PREFIX + version, '1');
}
