import {
  fetchTrending,
  fetchTopRated,
  fetchPopular,
  searchMovies,
  fetchPrimaryTrailerKey,
  isTmdbConfigured,
  fetchMovieGenres,
  searchPeople,
  discoverMoviesByGenre,
  fetchPersonMovieCredits,
} from "./api.js";
import {
  getCurrentProfileId,
  setCurrentProfile,
  getProfilesState,
  normalizeMovie,
  filterPresentableMovies,
  getWatchlist,
  toggleWatchlistItem,
  removeFromWatchlist,
  upsertContinueWatching,
  getContinueWatching,
  isInWatchlist,
} from "./state.js";
import { renderEntityRoot } from "./entity-pages.js";
import {
  mountRows,
  renderSkeletonPlaceholder,
  setHeroMovie,
  updateHeroWatchlistButton,
  openTrailerModal,
  closeTrailerModal,
  showGlobalError,
  hideGlobalError,
  setNavScrolled,
  updateProfileHeader,
  renderProfileMenu,
  scheduleHoverPreview,
  destroyHoverPreview,
  createContentRow,
  heroBackdropUrl,
  syncHeroCarouselChrome,
  syncDefaultCardWatchlistButtons,
  updateNavbarWatchlistBadge,
  mountLiveSearchPanel,
  openMovieDetailModal,
  closeMovieDetailModal,
} from "./ui.js";

let heroMovie = null;
let heroSlides = [];
let heroSlideIndex = 0;
let heroRotationTimer = null;
let heroLocked = false;
let heroHoverPaused = false;
let trending = [];
let topRated = [];
let popular = [];

/** Last smart-search snapshot for person-click credits refresh */
let lastSmartSearch = null;

/** Full-screen search overlay is active */
let searchModeActive = false;

/** SPA-style entity pages (movie / actor / genre) */
/** @type {{ type: string, id?: number, label?: string }[]} */
let entityStack = [];
let entityRenderToken = 0;

const RECENT_SEARCHES_KEY = "ott_recent_searches_v1";
const MAX_RECENT_SEARCHES = 8;

let smartSearchAbort = null;
let smartSearchToken = 0;
let profileMenuOpen = false;

/** Transparent nav → elevated bar (rAF + hysteresis avoids flicker at threshold). */
let navScrollRaf = null;
let navBarElevated = false;

function syncTransparentNavScroll() {
  navScrollRaf = null;
  const y = window.scrollY || document.documentElement.scrollTop || 0;
  let next;
  if (!navBarElevated) next = y > 44;
  else next = y > 18;
  if (next !== navBarElevated) {
    navBarElevated = next;
    setNavScrolled(next);
  }
}

function scheduleTransparentNavScroll() {
  if (navScrollRaf != null) return;
  navScrollRaf = requestAnimationFrame(syncTransparentNavScroll);
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function heroSlidePresentable(m) {
  return (
    m?.id != null &&
    ((m.backdrop_path && String(m.backdrop_path).trim()) ||
      (m.poster_path && String(m.poster_path).trim()))
  );
}

function buildHeroSlides(t, tr) {
  const seen = new Set();
  const out = [];
  for (const m of t || []) {
    if (heroSlidePresentable(m) && !seen.has(m.id)) {
      seen.add(m.id);
      out.push(m);
      if (out.length >= 7) return out;
    }
  }
  for (const m of tr || []) {
    if (out.length >= 7) break;
    if (heroSlidePresentable(m) && !seen.has(m.id)) {
      seen.add(m.id);
      out.push(m);
    }
  }
  return out;
}

function clearHeroRotation() {
  if (heroRotationTimer != null) {
    clearTimeout(heroRotationTimer);
    heroRotationTimer = null;
  }
}

function scheduleHeroRotation() {
  clearHeroRotation();
  if (heroLocked || heroHoverPaused || heroSlides.length < 2) return;
  const delay = 5000 + Math.random() * 2000;
  heroRotationTimer = window.setTimeout(() => {
    heroRotationTimer = null;
    void advanceHeroAuto();
  }, delay);
}

async function advanceHeroAuto() {
  if (heroLocked || heroHoverPaused || heroSlides.length < 2) return;
  await goToHeroSlide(heroSlideIndex + 1, { instant: prefersReducedMotion() });
}

function preloadHeroAdjacent() {
  if (heroSlides.length < 2) return;
  const raw = heroSlides[(heroSlideIndex + 1) % heroSlides.length];
  const m = normalizeMovie(raw);
  if (!m) return;
  const url = heroBackdropUrl(m);
  if (url) {
    const img = new Image();
    img.src = url;
  }
}

function syncHeroChrome() {
  syncHeroCarouselChrome(heroSlides.length, heroSlideIndex, (i) => {
    void goToHeroSlide(i, { instant: prefersReducedMotion() });
  });
}

async function goToHeroSlide(index, { instant = false } = {}) {
  if (!heroSlides.length) return;
  const n = ((index % heroSlides.length) + heroSlides.length) % heroSlides.length;
  heroSlideIndex = n;
  heroMovie = normalizeMovie(heroSlides[n]);
  if (!heroMovie) return;

  const reduce = prefersReducedMotion();
  await setHeroMovie(heroMovie, {
    animate: true,
    crossfade: !instant && !reduce,
  });
  updateHeroWatchlistButton(getProfileId(), heroMovie.id);
  syncHeroChrome();
  preloadHeroAdjacent();

  clearHeroRotation();
  if (!heroLocked && !heroHoverPaused && heroSlides.length >= 2) {
    scheduleHeroRotation();
  }
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = window.setTimeout(() => {
      t = null;
      fn(...args);
    }, ms);
  };
}

function loadRecentSearches() {
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((s) => typeof s === "string" && s.trim().length)
      .slice(0, MAX_RECENT_SEARCHES);
  } catch {
    return [];
  }
}

function pushRecentSearch(q) {
  const t = String(q).trim();
  if (t.length < 2) return;
  const next = [t, ...loadRecentSearches().filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(
    0,
    MAX_RECENT_SEARCHES
  );
  try {
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

/**
 * @param {string} query
 * @param {{ id: number, name: string }[]} genres
 * @returns {{ id: number, name: string }[]}
 */
function findMatchingGenres(query, genres) {
  const q = query.trim().toLowerCase();
  if (!q || !genres?.length) return [];
  const tokens = q.split(/\s+/).filter((t) => t.length >= 2);
  const scored = [];
  for (const g of genres) {
    const name = g.name.toLowerCase();
    let score = 0;
    if (name === q) score = 100;
    else if (name.startsWith(q)) score = 85;
    else if (q.length >= 3 && (name.includes(q) || q.includes(name))) score = 70;
    else {
      for (const tok of tokens) {
        if (name === tok) {
          score = Math.max(score, 75);
          break;
        }
        if (tok.length >= 3 && name.startsWith(tok)) score = Math.max(score, 55);
        else if (tok.length >= 4 && name.includes(tok)) score = Math.max(score, 40);
      }
    }
    if (score > 0) scored.push({ g, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const out = [];
  const seen = new Set();
  for (const { g } of scored) {
    if (seen.has(g.id)) continue;
    seen.add(g.id);
    out.push(g);
    if (out.length >= 3) break;
  }
  return out;
}

function getSearchPanelEls() {
  return {
    experience: document.getElementById("search-experience"),
    inner: document.getElementById("search-panel-inner"),
    input: document.getElementById("search-input"),
    trigger: document.getElementById("nav-search-trigger"),
  };
}

function setSearchExperienceOpen(open) {
  const { experience, trigger } = getSearchPanelEls();
  const main = document.getElementById("main-content");
  const nav = document.getElementById("nav");
  const entityLayerEl = document.getElementById("entity-layer");
  searchModeActive = open;
  if (experience) {
    experience.hidden = !open;
    experience.setAttribute("aria-hidden", open ? "false" : "true");
    experience.classList.toggle("search-xp--open", open);
  }
  document.body.classList.toggle("search-mode", open);
  const entityChromeOpen = !!(entityLayerEl && !entityLayerEl.hidden);
  if (open) {
    main?.setAttribute("inert", "");
    nav?.setAttribute("inert", "");
    if (entityChromeOpen) entityLayerEl?.setAttribute("inert", "");
  } else {
    entityLayerEl?.removeAttribute("inert");
    if (!entityChromeOpen) {
      main?.removeAttribute("inert");
      nav?.removeAttribute("inert");
    }
  }
  if (trigger) trigger.setAttribute("aria-expanded", open ? "true" : "false");
}

function openSearchExperience() {
  destroyHoverPreview();
  setSearchExperienceOpen(true);
  const { inner, input } = getSearchPanelEls();
  if (!inner) return;
  const v = input?.value.trim() || "";
  if (!v) {
    lastSmartSearch = null;
    mountLiveSearchPanel(inner, {
      showRecent: true,
      recentQueries: loadRecentSearches(),
      trendingMovies: filterPresentableMovies(trending),
      ...getSearchPanelCommon(),
    });
  } else {
    void runSmartSearch(input.value);
  }
  requestAnimationFrame(() => {
    getSearchPanelEls().input?.focus();
  });
}

function closeSearchExperience() {
  destroyHoverPreview();
  const { inner, input } = getSearchPanelEls();
  setSearchExperienceOpen(false);
  if (inner) inner.innerHTML = "";
  lastSmartSearch = null;
  input?.blur();
}

function tmdbErrorMessage(err) {
  if (err?.code === "MISSING_TMDB_KEY") {
    return "Set your TMDb API key in js/config.js (TMDB_API_KEY) to load movies and trailers.";
  }
  if (err?.code === "TMDB_AUTH") {
    return "TMDb rejected this API key. Confirm it in js/config.js and your TMDb developer settings.";
  }
  return null;
}

function scrollBehaviorPref() {
  return prefersReducedMotion() ? "auto" : "smooth";
}

/** Thin top progress line + keeps scroll chrome in sync (main vs entity layer). */
function bindScrollProgressIndicator() {
  const bar = document.getElementById("scroll-progress");
  if (!bar) return;

  const update = () => {
    const entityLayer = document.getElementById("entity-layer");
    const entityOpen = !!(entityLayer && !entityLayer.hidden);
    let p = 0;
    if (entityOpen) {
      const er = document.getElementById("entity-root");
      if (er) {
        const max = er.scrollHeight - er.clientHeight;
        p = max > 0 ? er.scrollTop / max : 0;
      }
    } else {
      const el = document.documentElement;
      const max = el.scrollHeight - el.clientHeight;
      p = max > 0 ? el.scrollTop / max : 0;
    }
    const clamped = Math.min(1, Math.max(0, p));
    bar.style.transform = `scaleX(${clamped})`;
    bar.classList.toggle("is-visible", clamped > 0.012);
  };

  window.addEventListener("scroll", update, { passive: true });
  const entityRoot = document.getElementById("entity-root");
  entityRoot?.addEventListener("scroll", update, { passive: true });

  const entityLayer = document.getElementById("entity-layer");
  if (entityLayer) {
    const mo = new MutationObserver(update);
    mo.observe(entityLayer, { attributes: true, attributeFilter: ["hidden"] });
  }
  if (entityRoot && typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => update());
    ro.observe(entityRoot);
  }

  update();
}

function getProfileId() {
  return getCurrentProfileId();
}

function buildCardHandlers() {
  return {
    onHoverEnter: (card, movie) => {
      scheduleHoverPreview(card, movie.id, fetchPrimaryTrailerKey);
    },
    onHoverLeave: () => {
      destroyHoverPreview();
    },
    onPlay: (movie) => playTrailerForMovie(movie),
    onWatchlist: (movie) => {
      const pid = getProfileId();
      toggleWatchlistItem(pid, movie);
      applyWatchlistSync(movie.id);
    },
    onRemoveFromWatchlist: (movie) => {
      const pid = getProfileId();
      removeFromWatchlist(pid, movie.id);
      applyWatchlistSync(movie.id);
    },
    onMoreInfo: (movie) => {
      openMovieDetailModal(movie);
    },
  };
}

function buildEntityCardHandlers() {
  return {
    ...buildCardHandlers(),
    onOpenEntity: (movie) => {
      if (movie?.id != null) pushEntityPage({ type: "movie", id: movie.id });
    },
    onMoreInfo: (movie) => {
      if (movie?.id != null) pushEntityPage({ type: "movie", id: movie.id });
    },
  };
}

function getEntityLayerEls() {
  return {
    layer: document.getElementById("entity-layer"),
    root: document.getElementById("entity-root"),
  };
}

function applyEntityLayerChrome(open) {
  const { layer } = getEntityLayerEls();
  if (!layer) return;
  layer.hidden = !open;
  layer.setAttribute("aria-hidden", open ? "false" : "true");
  layer.classList.toggle("entity-layer--open", open);
  document.body.classList.toggle("entity-mode", open);

  const main = document.getElementById("main-content");
  const nav = document.getElementById("nav");
  const searchXp = document.getElementById("search-experience");
  if (open) {
    main?.setAttribute("inert", "");
    nav?.setAttribute("inert", "");
    searchXp?.setAttribute("inert", "");
    document.body.style.overflow = "hidden";
  } else {
    main?.removeAttribute("inert");
    nav?.removeAttribute("inert");
    if (!searchModeActive) searchXp?.removeAttribute("inert");
    document.body.style.overflow = "";
  }
}

function clearEntityStack() {
  entityStack = [];
  entityRenderToken += 1;
  const { root } = getEntityLayerEls();
  if (root) {
    root.innerHTML = "";
    root.scrollTop = 0;
  }
  applyEntityLayerChrome(false);
}

function buildEntityRenderContext() {
  return {
    profileId: getProfileId(),
    cardHandlers: buildEntityCardHandlers(),
    onBack: () => popEntityPage(),
    pushActor: (id) => pushEntityPage({ type: "actor", id }),
    pushGenre: (id, label) => pushEntityPage({ type: "genre", id, label }),
    onPlayMovie: (movie, trailerHint) =>
      void playTrailerForMovie(movie, trailerHint),
    onToggleWatchlist: (movie) => {
      toggleWatchlistItem(getProfileId(), movie);
      applyWatchlistSync(movie.id);
    },
    isInWatchlist: (movieId) => isInWatchlist(getProfileId(), movieId),
    errorMessage: tmdbErrorMessage,
  };
}

function syncEntityHeroScrollDim(entityRoot) {
  const root = entityRoot || document.getElementById("entity-root");
  if (!root) return;
  const hero = root.querySelector(".entity-hero");
  if (!hero) return;
  const fadeRange = Math.max(140, Math.min((hero.offsetHeight || 420) * 0.48, 380));
  const p = fadeRange > 0 ? Math.min(1, root.scrollTop / fadeRange) : 0;
  hero.style.setProperty("--hero-scroll", String(p));
}

function bindEntityHeroScrollFx() {
  const root = document.getElementById("entity-root");
  if (!root || root.dataset.heroScrollFxBound === "1") return;
  root.dataset.heroScrollFxBound = "1";
  const tick = () => syncEntityHeroScrollDim(root);
  root.addEventListener("scroll", tick, { passive: true });
}

async function renderTopEntityPage() {
  const { root } = getEntityLayerEls();
  if (!root || !entityStack.length) return;
  root.scrollTop = 0;
  const spec = entityStack[entityStack.length - 1];
  const token = ++entityRenderToken;
  await renderEntityRoot(root, spec, buildEntityRenderContext());
  if (token !== entityRenderToken) return;
  root.scrollTop = 0;
  syncEntityHeroScrollDim(root);
  requestAnimationFrame(() => {
    if (token !== entityRenderToken) return;
    root.scrollTop = 0;
    syncEntityHeroScrollDim(root);
    root.querySelector("[data-entity-play]")?.focus({ preventScroll: true });
  });
}

function pushEntityPage(spec) {
  if (!spec?.type || spec.id == null) return;
  destroyHoverPreview();
  hideGlobalError();
  closeSearchExperience();
  entityStack.push(spec);
  applyEntityLayerChrome(true);
  void renderTopEntityPage();
}

function popEntityPage() {
  entityStack.pop();
  if (!entityStack.length) {
    clearEntityStack();
    return;
  }
  void renderTopEntityPage();
}

/** Keeps movie detail hero watchlist chip in sync when toggling from rails/cards. */
function patchEntityMovieHeroWatchlist(profileId, movieId) {
  const layer = document.getElementById("entity-layer");
  if (!layer || layer.hidden || movieId == null) return;
  const hero = layer.querySelector(`.entity-hero[data-movie-id="${movieId}"]`);
  if (!hero) return;
  const btn = hero.querySelector("[data-entity-wl]");
  const span = hero.querySelector("[data-wl-label]");
  const added = isInWatchlist(profileId, movieId);
  btn?.classList.toggle("is-added", !!added);
  if (span) span.textContent = added ? "✓ In My List" : "+ Watchlist";
}

/** Targeted UI sync after watchlist mutations — avoids rebuilding every row. */
function applyWatchlistSync(changedMovieId) {
  const pid = getProfileId();
  patchWatchlistRow();
  syncDefaultCardWatchlistButtons(pid);
  if (heroMovie && (changedMovieId == null || heroMovie.id === changedMovieId)) {
    updateHeroWatchlistButton(pid, heroMovie.id);
  }
  if (changedMovieId != null) {
    patchEntityMovieHeroWatchlist(pid, changedMovieId);
  }
  updateNavbarWatchlistBadge(pid);
}

function patchWatchlistRow() {
  const root = document.getElementById("content-root");
  const oldRow = root?.querySelector('section.row[data-row-id="watchlist"]');
  const next = buildWatchlistRowSection();
  if (!root) return;

  // If watchlist is now empty, remove the entire section.
  if (!next) {
    oldRow?.remove();
    return;
  }

  // If we already have a row, replace in place.
  if (oldRow) {
    oldRow.replaceWith(next);
  } else {
    // Otherwise insert it near the top (after Continue Watching, if present).
    const cont = root.querySelector('section.row[data-row-id="continue"]');
    if (cont && cont.nextSibling) root.insertBefore(next, cont.nextSibling);
    else if (cont) root.appendChild(next);
    else root.insertBefore(next, root.firstChild);
    next.classList.add("row--enter");
    window.setTimeout(() => next.classList.remove("row--enter"), 420);
  }

  next.classList.add("row--flash");
  window.requestAnimationFrame(() => {
    next.classList.remove("row--flash");
  });
}

function buildWatchlistRowSection() {
  const pid = getProfileId();
  const handlers = buildEntityCardHandlers();
  return createContentRow({
    id: "watchlist",
    title: "My Watchlist",
    hint: "Recently added first",
    movies: getWatchlist(pid),
    profileId: pid,
    emptyMessage:
      "Your list is empty. Add titles with + Watchlist on posters or the hero banner.",
    handlers,
    cardVariant: "watchlist",
  });
}

function buildRows() {
  const pid = getProfileId();
  const handlers = buildEntityCardHandlers();
  const rows = [];

  const cont = getContinueWatching(pid);
  if (cont.length) {
    rows.push(
      createContentRow({
        id: "continue",
        title: "Continue Watching",
        hint: "Resume where you left off",
        movies: cont,
        profileId: pid,
        handlers,
      })
    );
  }

  rows.push(
    createContentRow({
      id: "watchlist",
      title: "My Watchlist",
      hint: "Recently added first",
      movies: getWatchlist(pid),
      profileId: pid,
      emptyMessage:
        "Your list is empty. Add titles with + Watchlist on posters or the hero banner.",
      handlers,
      cardVariant: "watchlist",
    })
  );

  rows.push(
    createContentRow({
      id: "trending",
      title: "Trending",
      hint: "This week",
      movies: trending,
      profileId: pid,
      emptyMessage: "No trending titles available right now.",
      handlers,
    })
  );

  rows.push(
    createContentRow({
      id: "top",
      title: "Top Rated",
      hint: "Critics & audiences",
      movies: topRated,
      profileId: pid,
      emptyMessage: "Top rated list isn’t available.",
      handlers,
    })
  );

  rows.push(
    createContentRow({
      id: "popular",
      title: "Popular",
      hint: "Everyone’s watching",
      movies: popular,
      profileId: pid,
      emptyMessage: "Popular titles couldn’t be loaded.",
      handlers,
    })
  );

  return rows;
}

function refreshContent() {
  const root = document.getElementById("content-root");
  if (!root) return;
  mountRows(root, buildRows());
  updateNavbarWatchlistBadge(getProfileId());
}

async function playTrailerForMovie(movie, trailerKeyHint) {
  destroyHoverPreview();
  closeSearchExperience();
  hideGlobalError();

  const modalEl = document.getElementById("trailer-modal");
  if (modalEl?.classList.contains("is-open")) return;

  const id = Number(movie?.id);
  if (!Number.isFinite(id)) {
    showGlobalError("Unable to play this title.");
    return;
  }

  try {
    let key =
      typeof trailerKeyHint === "string" && trailerKeyHint.trim()
        ? trailerKeyHint.trim()
        : null;
    if (!key) {
      key = await fetchPrimaryTrailerKey(id);
    }
    if (!key) {
      showGlobalError("No trailer is available for this title yet.");
      return;
    }
    openTrailerModal(key, movie.title);
    const pid = getProfileId();
    upsertContinueWatching(pid, movie, 12);
    refreshContent();
  } catch (e) {
    const setup = tmdbErrorMessage(e);
    showGlobalError(
      setup || "Could not load the trailer. Check your connection and try again."
    );
  }
}

function getSearchPanelCommon() {
  return {
    profileId: getProfileId(),
    handlers: buildEntityCardHandlers(),
    discoverFallbackMovies: filterPresentableMovies(trending),
    onOpenGenre: (genreId, label) => {
      if (genreId != null) pushEntityPage({ type: "genre", id: genreId, label });
    },
    onPickRecent: (rq) => {
      const inp = getSearchPanelEls().input;
      if (inp) inp.value = rq;
      pushRecentSearch(rq);
      void runSmartSearch(rq);
    },
  };
}

function handlePersonActivateSearch(person) {
  if (!person?.id) return;
  pushEntityPage({ type: "actor", id: person.id });
}

async function runSmartSearch(rawQuery) {
  const token = ++smartSearchToken;
  if (smartSearchAbort) smartSearchAbort.abort();
  smartSearchAbort = new AbortController();
  const signal = smartSearchAbort.signal;
  const q = String(rawQuery).trim().replace(/\s+/g, " ");
  const { inner } = getSearchPanelEls();
  if (!inner) return;

  if (!q) {
    if (token !== smartSearchToken) return;
    lastSmartSearch = null;
    mountLiveSearchPanel(inner, {
      showRecent: true,
      recentQueries: loadRecentSearches(),
      trendingMovies: filterPresentableMovies(trending),
      ...getSearchPanelCommon(),
    });
    return;
  }

  if (!isTmdbConfigured()) {
    if (token !== smartSearchToken) return;
    const msg = tmdbErrorMessage({ code: "MISSING_TMDB_KEY" });
    mountLiveSearchPanel(inner, {
      error: msg || "Configure your API key in js/config.js.",
      ...getSearchPanelCommon(),
    });
    if (msg) showGlobalError(msg);
    return;
  }

  try {
    const genres = await fetchMovieGenres(signal);
    if (token !== smartSearchToken) return;
    const matchedGenres = findMatchingGenres(q, genres);
    const parts = [searchMovies(q, signal), searchPeople(q, signal)];
    for (const g of matchedGenres) {
      parts.push(
        discoverMoviesByGenre(g.id, signal).then((movies) => ({
          label: g.name,
          id: g.id,
          movies,
        }))
      );
    }
    const results = await Promise.all(parts);
    if (token !== smartSearchToken) return;
    const titleRaw = results[0];
    const peopleRaw = results[1];
    const genreBlocksRaw = results.slice(2);

    const titles = filterPresentableMovies(titleRaw || []);
    const titleIds = new Set(titles.map((m) => m.id));
    const people = (peopleRaw || []).slice(0, 8);

    const genreSections = genreBlocksRaw.map((block) => ({
      label: block.label,
      id: block.id,
      movies: filterPresentableMovies(block.movies || []).filter(
        (m) => !titleIds.has(m.id)
      ),
    }));

    let castMovies = [];
    if (people[0]?.id) {
      try {
        const cr = await fetchPersonMovieCredits(people[0].id, signal);
        if (token !== smartSearchToken) return;
        castMovies = filterPresentableMovies(cr || []).filter(
          (m) => !titleIds.has(m.id)
        );
      } catch {
        castMovies = [];
      }
    }

    const castHeading =
      people[0]?.name != null
        ? `Films featuring ${people[0].name}`
        : "Films featuring top match";

    lastSmartSearch = {
      query: q,
      titles,
      genreSections,
      people,
      castMovies,
      castHeading,
    };

    mountLiveSearchPanel(inner, {
      query: q,
      titles,
      genreSections,
      people,
      castMovies,
      castHeading,
      onPersonActivate: handlePersonActivateSearch,
      ...getSearchPanelCommon(),
    });
  } catch (e) {
    if (e.name === "AbortError") return;
    if (token !== smartSearchToken) return;
    lastSmartSearch = null;
    mountLiveSearchPanel(inner, {
      error: "Search couldn’t load. Check your connection and try again.",
      ...getSearchPanelCommon(),
    });
  }
}

const debouncedSmartSearch = debounce((value) => {
  void runSmartSearch(value);
}, 300);

function syncProfileUI() {
  const { profiles, currentId } = getProfilesState();
  const current = profiles.find((p) => p.id === currentId) || profiles[0];
  updateProfileHeader(current);
  renderProfileMenu(profiles, currentId, (id) => {
    setCurrentProfile(id);
    profileMenuOpen = false;
    const menu = document.getElementById("profile-listbox");
    const trigger = document.getElementById("profile-trigger");
    if (menu) menu.hidden = true;
    if (trigger) {
      trigger.setAttribute("aria-expanded", "false");
    }
    clearEntityStack();
    syncProfileUI();
    if (heroMovie) updateHeroWatchlistButton(id, heroMovie.id);
    updateNavbarWatchlistBadge(id);
    refreshContent();
  });
}

function toggleProfileMenu() {
  const menu = document.getElementById("profile-listbox");
  const trigger = document.getElementById("profile-trigger");
  if (!menu || !trigger) return;
  profileMenuOpen = !profileMenuOpen;
  menu.hidden = !profileMenuOpen;
  trigger.setAttribute("aria-expanded", profileMenuOpen ? "true" : "false");
}

function bindEvents() {
  const searchInput = document.getElementById("search-input");
  const searchTrigger = document.getElementById("nav-search-trigger");

  searchTrigger?.addEventListener("click", () => {
    openSearchExperience();
  });

  if (searchInput) {
    searchInput.addEventListener("input", () => {
      if (!searchModeActive) return;
      hideGlobalError();
      const v = searchInput.value;
      if (!v.trim()) {
        lastSmartSearch = null;
        const { inner } = getSearchPanelEls();
        if (inner) {
          mountLiveSearchPanel(inner, {
            showRecent: true,
            recentQueries: loadRecentSearches(),
            trendingMovies: filterPresentableMovies(trending),
            ...getSearchPanelCommon(),
          });
        }
        return;
      }
      debouncedSmartSearch(v);
    });
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const q = searchInput.value.trim();
        if (q) pushRecentSearch(q);
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeSearchExperience();
      }
    });
    searchInput.addEventListener("search", () => {
      if (searchInput.value === "") {
        lastSmartSearch = null;
        const { inner } = getSearchPanelEls();
        if (inner) {
          mountLiveSearchPanel(inner, {
            showRecent: true,
            recentQueries: loadRecentSearches(),
            trendingMovies: filterPresentableMovies(trending),
            ...getSearchPanelCommon(),
          });
        }
      }
    });
  }

  document.getElementById("search-xp-back")?.addEventListener("click", () => {
    closeSearchExperience();
  });
  document.querySelectorAll("[data-search-xp-close]").forEach((el) => {
    el.addEventListener("click", () => closeSearchExperience());
  });

  const heroPlay = document.getElementById("hero-play");
  heroPlay?.addEventListener("click", () => {
    heroLocked = true;
    clearHeroRotation();
    if (heroMovie) playTrailerForMovie(heroMovie);
  });

  const heroWl = document.getElementById("hero-watchlist");
  heroWl?.addEventListener("click", () => {
    if (!heroMovie) return;
    heroLocked = true;
    clearHeroRotation();
    const pid = getProfileId();
    toggleWatchlistItem(pid, heroMovie);
    applyWatchlistSync(heroMovie.id);
  });

  document.getElementById("nav-watchlist-jump")?.addEventListener("click", () => {
    document.getElementById("my-watchlist-row")?.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "nearest",
    });
  });

  const heroSection = document.getElementById("hero");
  heroSection?.addEventListener("mouseenter", () => {
    heroHoverPaused = true;
    clearHeroRotation();
  });
  heroSection?.addEventListener("mouseleave", () => {
    heroHoverPaused = false;
    if (!heroLocked && heroSlides.length >= 2) {
      scheduleHeroRotation();
    }
  });

  document.getElementById("hero-prev")?.addEventListener("click", () => {
    void goToHeroSlide(heroSlideIndex - 1, { instant: prefersReducedMotion() });
  });
  document.getElementById("hero-next")?.addEventListener("click", () => {
    void goToHeroSlide(heroSlideIndex + 1, { instant: prefersReducedMotion() });
  });

  heroSection?.addEventListener("keydown", (e) => {
    if (heroSlides.length < 2) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      void goToHeroSlide(heroSlideIndex - 1, { instant: prefersReducedMotion() });
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      void goToHeroSlide(heroSlideIndex + 1, { instant: prefersReducedMotion() });
    }
  });

  const modal = document.getElementById("trailer-modal");
  modal?.querySelectorAll("[data-close-modal]").forEach((el) => {
    el.addEventListener("click", () => closeTrailerModal());
  });

  const detailModal = document.getElementById("detail-modal");
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const t = e.target;
      const tag = t && /** @type {HTMLElement} */ (t).tagName;
      if (tag !== "INPUT" && tag !== "TEXTAREA" && !t?.closest?.("[contenteditable='true']")) {
        e.preventDefault();
        openSearchExperience();
        return;
      }
    }
    if (e.key !== "Escape") return;
    const entityLayerEl = document.getElementById("entity-layer");
    if (entityLayerEl && !entityLayerEl.hidden && entityStack.length) {
      e.preventDefault();
      popEntityPage();
      return;
    }
    if (detailModal?.classList.contains("is-open")) {
      e.preventDefault();
      closeMovieDetailModal();
      return;
    }
    if (modal?.classList.contains("is-open")) {
      e.preventDefault();
      closeTrailerModal();
      return;
    }
    if (searchModeActive) {
      e.preventDefault();
      closeSearchExperience();
      return;
    }
    if (profileMenuOpen) {
      profileMenuOpen = false;
      const menu = document.getElementById("profile-listbox");
      const tr = document.getElementById("profile-trigger");
      if (menu) menu.hidden = true;
      if (tr) tr.setAttribute("aria-expanded", "false");
    }
  });

  function onRowTrackKeydown(e) {
    const track = e.target.closest?.(".row__track");
    if (!track || !e.currentTarget?.contains(track)) return;
    const step = Math.round(track.clientWidth * 0.65);
    const sb = scrollBehaviorPref();
    if (e.key === "ArrowRight") {
      e.preventDefault();
      track.scrollBy({ left: step, behavior: sb });
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      track.scrollBy({ left: -step, behavior: sb });
    } else if (e.key === "Home") {
      e.preventDefault();
      track.scrollTo({ left: 0, behavior: sb });
    } else if (e.key === "End") {
      e.preventDefault();
      track.scrollTo({ left: track.scrollWidth, behavior: sb });
    }
  }
  document.getElementById("content-root")?.addEventListener("keydown", onRowTrackKeydown);
  document.getElementById("search-experience")?.addEventListener("keydown", onRowTrackKeydown);

  const trigger = document.getElementById("profile-trigger");
  trigger?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleProfileMenu();
  });

  document.addEventListener("click", (e) => {
    if (profileMenuOpen) {
      profileMenuOpen = false;
      const menu = document.getElementById("profile-listbox");
      const tr = document.getElementById("profile-trigger");
      if (menu) menu.hidden = true;
      if (tr) tr.setAttribute("aria-expanded", "false");
    }
  });

  document.querySelector(".nav__profile")?.addEventListener("click", (e) => e.stopPropagation());

  document.querySelector('[data-action="home"]')?.addEventListener("click", (e) => {
    e.preventDefault();
    clearEntityStack();
    window.scrollTo({ top: 0, behavior: "smooth" });
    heroLocked = false;
    if (heroSlides.length) {
      void goToHeroSlide(0, { instant: true });
    }
    closeSearchExperience();
    if (searchInput) searchInput.value = "";
    refreshContent();
  });

  window.addEventListener("scroll", scheduleTransparentNavScroll, { passive: true });
  syncTransparentNavScroll();
  bindScrollProgressIndicator();
  bindEntityHeroScrollFx();
}

async function bootstrap() {
  hideGlobalError();
  const root = document.getElementById("content-root");
  if (root) renderSkeletonPlaceholder(root);

  syncProfileUI();
  bindEvents();

  const controller = new AbortController();

  if (!isTmdbConfigured()) {
    showGlobalError(
      "Set your TMDb API key in js/config.js (TMDB_API_KEY) to load the catalog."
    );
    trending = [];
    topRated = [];
    popular = [];
    heroSlides = [];
    const titleEl = document.getElementById("hero-title");
    const descEl = document.getElementById("hero-desc");
    const hm = document.getElementById("hero-meta") || document.querySelector(".hero__meta");
    if (titleEl) titleEl.textContent = "API key required";
    if (descEl) {
      descEl.textContent =
        "Add your v3 key from themoviedb.org/settings/api to js/config.js, then refresh this page.";
    }
    hm?.classList.add("is-ready");
    syncHeroCarouselChrome(0, 0, () => {});
    refreshContent();
    syncTransparentNavScroll();
    return;
  }

  try {
    const [t, top, pop] = await Promise.all([
      fetchTrending(controller.signal),
      fetchTopRated(controller.signal),
      fetchPopular(controller.signal),
    ]);
    trending = t;
    topRated = top;
    popular = pop;
  } catch (e) {
    const hint = tmdbErrorMessage(e);
    showGlobalError(
      hint ||
        "We couldn’t reach the movie catalog. Check your network and API key in js/config.js."
    );
    trending = [];
    topRated = [];
    popular = [];
  }

  heroSlides = buildHeroSlides(trending, topRated);
  if (heroSlides.length) {
    heroSlideIndex = 0;
    heroLocked = false;
    await goToHeroSlide(0, { instant: true });
  } else {
    const hm = document.getElementById("hero-meta") || document.querySelector(".hero__meta");
    const titleEl = document.getElementById("hero-title");
    const descEl = document.getElementById("hero-desc");
    if (titleEl) titleEl.textContent = "Nothing to watch yet";
    if (descEl) descEl.textContent = "";
    hm?.classList.add("is-ready");
    syncHeroCarouselChrome(0, 0, () => {});
  }

  refreshContent();
  syncTransparentNavScroll();
}

bootstrap();
