const STORAGE_PROFILES = "ott_profiles_v1";
const STORAGE_PREFIX_WATCH_LEGACY = "ott_watchlist_";
/** Unified bundle: { [profileId]: { watchlist: Movie[] } } — mirrors Netflix-style per-profile lists */
const STORAGE_WATCHLIST_V2 = "ott_watchlist_by_profile_v2";
const STORAGE_PREFIX_CONTINUE = "ott_continue_";

const DEFAULT_PROFILES = [
  { id: "p1", name: "Alex" },
  { id: "p2", name: "Jordan" },
  { id: "p3", name: "Sam" },
];

function safeParse(json, fallback) {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

function loadRawProfiles() {
  const raw = localStorage.getItem(STORAGE_PROFILES);
  if (!raw) {
    return { profiles: DEFAULT_PROFILES, currentId: DEFAULT_PROFILES[0].id };
  }
  const parsed = safeParse(raw, null);
  if (!parsed?.profiles?.length) {
    return { profiles: DEFAULT_PROFILES, currentId: DEFAULT_PROFILES[0].id };
  }
  return {
    profiles: parsed.profiles,
    currentId: parsed.currentId || parsed.profiles[0].id,
  };
}

export function getProfilesState() {
  return loadRawProfiles();
}

export function setCurrentProfile(id) {
  const { profiles } = loadRawProfiles();
  if (!profiles.some((p) => p.id === id)) return;
  localStorage.setItem(
    STORAGE_PROFILES,
    JSON.stringify({ profiles, currentId: id })
  );
}

export function getCurrentProfileId() {
  return loadRawProfiles().currentId;
}

export function normalizeMovie(m) {
  if (!m?.id) return null;
  return {
    id: m.id,
    title: m.title || m.name || "Untitled",
    poster_path: m.poster_path || null,
    backdrop_path: m.backdrop_path || null,
    overview: m.overview || "",
    vote_average: m.vote_average,
    release_date: m.release_date || m.first_air_date || "",
  };
}

/** Rows/cards: only titles with a TMDb poster path (no “No poster” tiles). */
export function filterPresentableMovies(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of arr) {
    const n = normalizeMovie(raw);
    if (!n?.id || seen.has(n.id)) continue;
    if (!n.poster_path || !String(n.poster_path).trim()) continue;
    seen.add(n.id);
    out.push(n);
  }
  return out;
}

function dedupeById(list) {
  const seen = new Set();
  return list.filter((m) => {
    if (!m?.id || seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
}

function sanitizeMovieList(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const item of arr) {
    const n = normalizeMovie(item);
    if (n) out.push(n);
  }
  return dedupeById(out);
}

function migrateLegacyIntoBundle() {
  const { profiles } = loadRawProfiles();
  const bundle = {};
  for (const p of profiles) {
    const legacyKey = `${STORAGE_PREFIX_WATCH_LEGACY}${p.id}`;
    const raw = localStorage.getItem(legacyKey);
    const arr = safeParse(raw, []);
    bundle[p.id] = { watchlist: sanitizeMovieList(arr) };
    try {
      localStorage.removeItem(legacyKey);
    } catch {
      /* ignore */
    }
  }
  try {
    localStorage.setItem(STORAGE_WATCHLIST_V2, JSON.stringify(bundle));
  } catch {
    /* quota */
  }
  return bundle;
}

function normalizeBundleShape(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const key of Object.keys(raw)) {
    const entry = raw[key];
    const wl = Array.isArray(entry?.watchlist)
      ? entry.watchlist
      : Array.isArray(entry)
        ? entry
        : [];
    out[key] = { watchlist: sanitizeMovieList(wl) };
  }
  return out;
}

/** In-memory bundle cache — invalidated on write */
let watchlistBundleCache = null;

function loadBundleFromStorage() {
  const raw = localStorage.getItem(STORAGE_WATCHLIST_V2);
  let parsed = safeParse(raw, null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    parsed = migrateLegacyIntoBundle();
  } else {
    parsed = normalizeBundleShape(parsed);
  }
  const { profiles } = loadRawProfiles();
  for (const p of profiles) {
    if (!parsed[p.id]) parsed[p.id] = { watchlist: [] };
  }
  return parsed;
}

function readBundle() {
  if (!watchlistBundleCache) {
    watchlistBundleCache = loadBundleFromStorage();
  }
  return watchlistBundleCache;
}

function writeBundle(bundle) {
  watchlistBundleCache = bundle;
  try {
    localStorage.setItem(STORAGE_WATCHLIST_V2, JSON.stringify(bundle));
  } catch {
    /* quota full — keep memory cache */
  }
}

function ensureProfileSlot(bundle, profileId) {
  if (!bundle[profileId]) bundle[profileId] = { watchlist: [] };
}

export function invalidateWatchlistCache() {
  watchlistBundleCache = null;
}

export function getWatchlist(profileId) {
  const bundle = readBundle();
  ensureProfileSlot(bundle, profileId);
  return sanitizeMovieList(bundle[profileId].watchlist);
}

export function setWatchlist(profileId, list) {
  const bundle = readBundle();
  ensureProfileSlot(bundle, profileId);
  bundle[profileId].watchlist = dedupeById(sanitizeMovieList(list));
  writeBundle(bundle);
}

export function isInWatchlist(profileId, movieId) {
  if (movieId == null) return false;
  return getWatchlist(profileId).some((m) => m.id === movieId);
}

export function toggleWatchlistItem(profileId, movie) {
  const n = normalizeMovie(movie);
  if (!n) return getWatchlist(profileId);
  let list = [...getWatchlist(profileId)];
  const exists = list.some((m) => m.id === n.id);
  if (exists) {
    list = list.filter((m) => m.id !== n.id);
  } else {
    if (list.some((m) => m.id === n.id)) return list;
    list = [n, ...list];
  }
  setWatchlist(profileId, list);
  return list;
}

export function removeFromWatchlist(profileId, movieId) {
  if (movieId == null) return getWatchlist(profileId);
  const list = getWatchlist(profileId).filter((m) => m.id !== movieId);
  setWatchlist(profileId, list);
  return list;
}

export function reorderWatchlist(profileId, orderedIds) {
  if (!Array.isArray(orderedIds)) return getWatchlist(profileId);
  const list = getWatchlist(profileId);
  const map = new Map(list.map((m) => [m.id, m]));
  const next = [];
  for (const id of orderedIds) {
    const m = map.get(id);
    if (m) next.push(m);
  }
  for (const m of list) {
    if (!next.some((x) => x.id === m.id)) next.push(m);
  }
  setWatchlist(profileId, next);
  return next;
}

/** @typedef {{ id: number, title: string, poster_path: string|null, backdrop_path: string|null, progress: number }} ContinueItem */

export function getContinueWatching(profileId) {
  const raw = localStorage.getItem(continueKey(profileId));
  const arr = safeParse(raw, []);
  return Array.isArray(arr) ? arr.filter((x) => x?.id) : [];
}

function continueKey(profileId) {
  return `${STORAGE_PREFIX_CONTINUE}${profileId}`;
}

export function setContinueWatching(profileId, list) {
  localStorage.setItem(continueKey(profileId), JSON.stringify(list));
}

export function upsertContinueWatching(profileId, movie, progress = 5) {
  const n = normalizeMovie(movie);
  if (!n) return getContinueWatching(profileId);
  const list = getContinueWatching(profileId).filter((x) => x.id !== n.id);
  const item = { ...n, progress: Math.min(100, Math.max(0, progress)) };
  list.unshift(item);
  const capped = list.slice(0, 24);
  setContinueWatching(profileId, capped);
  return capped;
}
