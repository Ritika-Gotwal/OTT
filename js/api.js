import { CONFIG, IMAGE_SIZES } from "./config.js";

const defaultHeaders = {
  accept: "application/json",
};

/** Returns true when `js/config.js` has a non-empty TMDB_API_KEY. */
export function isTmdbConfigured() {
  const k = CONFIG.TMDB_API_KEY;
  return typeof k === "string" && k.trim().length > 0;
}

function buildUrl(path, params = {}) {
  const u = new URL(`${CONFIG.TMDB_BASE}${path}`);
  u.searchParams.set("api_key", CONFIG.TMDB_API_KEY);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
  });
  return u.toString();
}

async function fetchJson(url, { signal } = {}) {
  if (!isTmdbConfigured()) {
    const err = new Error("Missing TMDb API key");
    err.code = "MISSING_TMDB_KEY";
    throw err;
  }
  const res = await fetch(url, { headers: defaultHeaders, signal });
  if (!res.ok) {
    const err = new Error(`TMDb ${res.status}`);
    err.status = res.status;
    if (res.status === 401 || res.status === 403) {
      err.code = "TMDB_AUTH";
    }
    throw err;
  }
  return res.json();
}

export function posterUrl(path, size = IMAGE_SIZES.poster) {
  if (!path) return "";
  return `${CONFIG.TMDB_IMAGE_BASE}/${size}${path}`;
}

export function backdropUrl(path, size = IMAGE_SIZES.backdropHero) {
  if (!path) return "";
  return `${CONFIG.TMDB_IMAGE_BASE}/${size}${path}`;
}

export async function fetchTrending(signal) {
  const data = await fetchJson(buildUrl("/trending/movie/week"), { signal });
  return data.results || [];
}

export async function fetchTopRated(signal) {
  const data = await fetchJson(buildUrl("/movie/top_rated"), { signal });
  return data.results || [];
}

export async function fetchPopular(signal) {
  const data = await fetchJson(buildUrl("/movie/popular"), { signal });
  return data.results || [];
}

export async function searchMovies(query, signal) {
  const q = query.trim();
  if (!q) return [];
  const data = await fetchJson(buildUrl("/search/movie", { query: q, include_adult: false }), {
    signal,
  });
  return data.results || [];
}

/** Cached for session — genre id ↔ name */
let genresListCache = null;

export async function fetchMovieGenres(signal) {
  if (genresListCache) return genresListCache;
  const data = await fetchJson(buildUrl("/genre/movie/list"), { signal });
  genresListCache = data.genres || [];
  return genresListCache;
}

export async function searchPeople(query, signal) {
  const q = query.trim();
  if (!q) return [];
  const data = await fetchJson(buildUrl("/search/person", { query: q, include_adult: false }), {
    signal,
  });
  return data.results || [];
}

export async function discoverMoviesByGenre(genreId, signal, page = 1) {
  if (genreId == null) return [];
  const data = await fetchJson(
    buildUrl("/discover/movie", {
      with_genres: String(genreId),
      sort_by: "popularity.desc",
      page: String(page),
    }),
    { signal }
  );
  return data.results || [];
}

/**
 * Unique movies from person's cast credits (most relevant first).
 * @returns {Promise<Array>} raw movie-like objects from credits
 */
export async function fetchPersonMovieCredits(personId, signal) {
  const data = await fetchJson(buildUrl(`/person/${personId}/movie_credits`), { signal });
  const cast = data.cast || [];
  const seen = new Set();
  const out = [];
  for (const job of cast) {
    const id = job?.id;
    if (id == null || seen.has(id)) continue;
    seen.add(id);
    out.push(job);
  }
  out.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
  return out.slice(0, 14);
}

/** Full person profile (biography, birthday, etc.) */
export async function fetchPersonDetail(personId, signal) {
  return fetchJson(buildUrl(`/person/${personId}`), { signal });
}

/**
 * Raw movie credits for a person (cast + crew entries).
 * @returns {{ cast: object[], crew: object[] }}
 */
export async function fetchPersonMovieCreditsRaw(personId, signal) {
  return fetchJson(buildUrl(`/person/${personId}/movie_credits`), { signal });
}

/** Full movie record */
export async function fetchMovieDetail(movieId, signal) {
  return fetchJson(buildUrl(`/movie/${movieId}`), { signal });
}

/** Cast + crew */
export async function fetchMovieCredits(movieId, signal) {
  return fetchJson(buildUrl(`/movie/${movieId}/credits`), { signal });
}

export async function fetchSimilarMovies(movieId, signal, page = 1) {
  const data = await fetchJson(
    buildUrl(`/movie/${movieId}/similar`, { page: String(page) }),
    { signal }
  );
  return data.results || [];
}

export async function fetchRecommendations(movieId, signal, page = 1) {
  const data = await fetchJson(
    buildUrl(`/movie/${movieId}/recommendations`, { page: String(page) }),
    { signal }
  );
  return data.results || [];
}

/** Resolved trailer keys — avoids repeated `/videos` calls per title (session-scoped). */
const primaryTrailerKeyCache = new Map();

/**
 * @returns {Promise<string|null>} YouTube video key or null
 */
export async function fetchPrimaryTrailerKey(movieId, signal) {
  if (primaryTrailerKeyCache.has(movieId)) {
    return primaryTrailerKeyCache.get(movieId);
  }
  try {
    const data = await fetchJson(buildUrl(`/movie/${movieId}/videos`), { signal });
    const results = data.results || [];
    const trailer =
      results.find((v) => v.site === "YouTube" && v.type === "Trailer" && v.official) ||
      results.find((v) => v.site === "YouTube" && v.type === "Trailer") ||
      results.find((v) => v.site === "YouTube" && v.type === "Teaser");
    const key = trailer?.key || null;
    primaryTrailerKeyCache.set(movieId, key);
    return key;
  } catch (e) {
    // Do not cache failures — allows retry after transient errors; only successful responses cache `null` (no trailer).
    throw e;
  }
}
