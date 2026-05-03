import { CONFIG } from "./config.js";
import { posterUrl, backdropUrl, fetchMovieGenres } from "./api.js";
import { getWatchlist, isInWatchlist, normalizeMovie, filterPresentableMovies } from "./state.js";

/** Genre strips: show whenever there is at least one poster-backed title */
const MIN_SEARCH_GENRE_MOVIES = 1;
/** People row: show when any match exists (avatars use photo or initials) */
const MIN_SEARCH_PEOPLE = 1;

function isValidSearchMovieRaw(m) {
  if (m?.id == null) return false;
  const title = String(m.title || m.name || "").trim();
  if (!title) return false;
  return Boolean(m.poster_path && String(m.poster_path).trim());
}

/** @param {unknown[]} list */
function filterMoviesForSearchRows(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    if (!isValidSearchMovieRaw(raw)) continue;
    const n = normalizeMovie(raw);
    if (!n || seen.has(n.id)) continue;
    seen.add(n.id);
    out.push(n);
  }
  return out;
}

function isValidSearchPersonRaw(p) {
  return Boolean(
    p?.id != null &&
      String(p.name || "").trim() &&
      p.profile_path &&
      String(p.profile_path).trim()
  );
}

/** @param {unknown[]} list */
function filterPeopleForSearchRows(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(isValidSearchPersonRaw);
}

const PLACEHOLDER_SVG =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600"><rect fill="#1e1e26" width="400" height="600"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#5c5c6b" font-family="system-ui" font-size="14">No image</text></svg>`
  );

function imgErrorHandler(e) {
  const el = e.currentTarget;
  el.onerror = null;
  el.src = PLACEHOLDER_SVG;
}

export function bindImageFallback(img) {
  if (img) {
    img.addEventListener("error", imgErrorHandler, { once: true });
  }
}

export function showGlobalError(message) {
  const el = document.getElementById("global-error");
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
}

export function hideGlobalError() {
  const el = document.getElementById("global-error");
  if (el) el.hidden = true;
}

export function setNavScrolled(scrolled) {
  const nav = document.getElementById("nav");
  if (nav) nav.classList.toggle("is-scrolled", scrolled);
}

export function updateProfileHeader(profile) {
  const nameEl = document.getElementById("profile-name");
  const avatarEl = document.getElementById("profile-avatar");
  if (nameEl) nameEl.textContent = profile.name;
  if (avatarEl) {
    const initial = (profile.name || "P").trim().charAt(0).toUpperCase() || "P";
    avatarEl.textContent = initial;
  }
}

export function renderProfileMenu(profiles, currentId, onSelect) {
  const list = document.getElementById("profile-listbox");
  if (!list) return;
  list.innerHTML = "";
  profiles.forEach((p) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "nav__profile-item" + (p.id === currentId ? " is-active" : "");
    btn.setAttribute("role", "option");
    btn.dataset.profileId = p.id;
    btn.setAttribute("aria-selected", p.id === currentId ? "true" : "false");
    btn.textContent = p.name;
    btn.addEventListener("click", () => onSelect(p.id));
    li.appendChild(btn);
    list.appendChild(li);
  });
}

function youtubeEmbedUrl(
  videoKey,
  { muted = true, autoplay = true, minimal = false, loop = false } = {}
) {
  const base = `${CONFIG.YOUTUBE_EMBED}/${videoKey}`;
  const p = new URLSearchParams({
    autoplay: autoplay ? "1" : "0",
    mute: muted ? "1" : "0",
    playsinline: "1",
    rel: "0",
    modestbranding: "1",
  });
  if (loop) {
    p.set("loop", "1");
    p.set("playlist", videoKey);
  }
  if (minimal) {
    p.set("controls", "0");
    p.set("showinfo", "0");
  }
  return `${base}?${p.toString()}`;
}

let modalLastFocus = null;

export function openTrailerModal(videoKey, title) {
  const modal = document.getElementById("trailer-modal");
  const frame = document.getElementById("modal-frame");
  const titleEl = document.getElementById("modal-title");
  const main = document.getElementById("main-content");
  const nav = document.getElementById("nav");
  if (!modal || !frame) return;

  modalLastFocus = document.activeElement;
  main?.setAttribute("inert", "");
  nav?.setAttribute("inert", "");
  document.getElementById("entity-layer")?.setAttribute("inert", "");
  frame.innerHTML = "";
  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", title ? `Trailer: ${title}` : "Trailer");
  iframe.setAttribute("allow", "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share");
  iframe.setAttribute("allowfullscreen", "");
  iframe.src = youtubeEmbedUrl(videoKey, { muted: true, autoplay: true, minimal: false });
  frame.appendChild(iframe);

  if (titleEl) titleEl.textContent = title ? `Trailer — ${title}` : "Trailer";

  modal.hidden = false;
  requestAnimationFrame(() => {
    modal.classList.add("is-open");
    document.body.style.overflow = "hidden";
  });

  const closeBtn = document.getElementById("modal-close");
  closeBtn?.focus();
}

export function closeTrailerModal() {
  const modal = document.getElementById("trailer-modal");
  const frame = document.getElementById("modal-frame");
  const main = document.getElementById("main-content");
  const nav = document.getElementById("nav");
  if (!modal || !frame) return;

  modal.classList.remove("is-open");
  frame.innerHTML = "";
  modal.hidden = true;
  document.body.style.overflow = "";
  main?.removeAttribute("inert");
  nav?.removeAttribute("inert");
  document.getElementById("entity-layer")?.removeAttribute("inert");

  if (modalLastFocus && typeof modalLastFocus.focus === "function") {
    modalLastFocus.focus();
  }
  modalLastFocus = null;
}

export function heroBackdropUrl(movie) {
  if (!movie) return "";
  if (movie.backdrop_path) return backdropUrl(movie.backdrop_path, "original");
  if (movie.poster_path) return backdropUrl(movie.poster_path, "w1280");
  return "";
}

const HERO_CROSSFADE_MS = 560;

function getHeroLayers() {
  const l0 = document.getElementById("hero-bg-0");
  const l1 = document.getElementById("hero-bg-1");
  return [l0, l1];
}

function preloadBackdropUrl(url) {
  return new Promise((resolve) => {
    if (!url) {
      resolve();
      return;
    }
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = url;
  });
}

let heroActiveLayerIdx = 0;

function applyHeroText(movie, { animate = true } = {}) {
  const titleEl = document.getElementById("hero-title");
  const descEl = document.getElementById("hero-desc");
  const meta = document.getElementById("hero-meta") || document.querySelector(".hero__meta");
  const playBtn = document.getElementById("hero-play");

  if (!titleEl || !descEl) return;

  titleEl.textContent = movie.title || "Untitled";
  descEl.textContent = movie.overview
    ? movie.overview
    : "Discover this title and more — watch the trailer or add it to your list.";

  const badgeEl = document.getElementById("hero-badge");
  if (badgeEl) {
    const y = movie.release_date && String(movie.release_date).slice(0, 4);
    badgeEl.textContent = y && /^\d{4}$/.test(y) ? y : "Featured";
  }

  if (playBtn) {
    playBtn.dataset.movieId = String(movie.id);
    playBtn.disabled = false;
  }

  if (meta && animate) {
    meta.classList.remove("is-ready");
    void meta.offsetWidth;
    meta.classList.add("is-ready");
  } else if (meta) {
    meta.classList.add("is-ready");
  }
}

function applyLayerBg(el, url) {
  if (!el) return;
  if (url) el.style.backgroundImage = `url("${url}")`;
  else el.style.backgroundImage = "none";
}

/**
 * @param {object} movie normalized or raw TMDb shape
 * @param {{ animate?: boolean, crossfade?: boolean }} opts crossfade uses dual layers + preload
 */
export async function setHeroMovie(movie, { animate = true, crossfade = false } = {}) {
  const [l0, l1] = getHeroLayers();
  if (!l0) return;

  const url = heroBackdropUrl(movie);
  await preloadBackdropUrl(url);

  if (crossfade && l1) {
    const curIdx = heroActiveLayerIdx;
    const nextIdx = 1 - curIdx;
    const curEl = curIdx === 0 ? l0 : l1;
    const nextEl = nextIdx === 0 ? l0 : l1;
    applyLayerBg(nextEl, url);
    nextEl.style.zIndex = "2";
    curEl.style.zIndex = "1";
    requestAnimationFrame(() => {
      nextEl.classList.add("is-visible");
      curEl.classList.remove("is-visible");
    });
    window.setTimeout(() => {
      curEl.style.zIndex = "0";
      nextEl.style.zIndex = "1";
    }, HERO_CROSSFADE_MS);
    heroActiveLayerIdx = nextIdx;
  } else {
    applyLayerBg(l0, url);
    l0.classList.add("is-visible");
    l0.style.zIndex = "1";
    if (l1) {
      l1.classList.remove("is-visible");
      l1.style.zIndex = "0";
      applyLayerBg(l1, "");
    }
    heroActiveLayerIdx = 0;
  }

  applyHeroText(movie, { animate });
}

/**
 * Show dots + prev/next when there are 2+ slides; wires dot clicks once per sync.
 */
export function syncHeroCarouselChrome(slideCount, activeIndex, onDotSelect) {
  const wrap = document.getElementById("hero-carousel-ui");
  const prev = document.getElementById("hero-prev");
  const next = document.getElementById("hero-next");
  const dots = document.getElementById("hero-dots");
  if (!wrap || !prev || !next || !dots) return;

  const show = slideCount >= 2;
  wrap.hidden = !show;
  prev.hidden = !show;
  next.hidden = !show;

  dots.innerHTML = "";
  if (!show) return;

  for (let i = 0; i < slideCount; i++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "hero__dot" + (i === activeIndex ? " is-active" : "");
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", i === activeIndex ? "true" : "false");
    btn.setAttribute("aria-label", `Featured title ${i + 1} of ${slideCount}`);
    btn.addEventListener("click", () => onDotSelect(i));
    dots.appendChild(btn);
  }
}

export function updateHeroWatchlistButton(profileId, movieId) {
  const btn = document.getElementById("hero-watchlist");
  const label = document.getElementById("hero-watchlist-label");
  if (!label) return;
  const inList = movieId != null && isInWatchlist(profileId, movieId);
  label.textContent = inList ? "✓ Added" : "+ Watchlist";
  btn?.classList.toggle("is-added", !!inList);
}

/** Delay before expanding card + showing preview (ms). Exported for tuning / tests. */
export const CARD_PREVIEW_HOVER_DELAY_MS = 380;

/** @type {Map<number, string>|null} */
let genreNameById = null;

const elitePreviewState = {
  hoverTimer: null,
  activeCard: null,
  abort: null,
};

async function ensureGenreNameMap(signal) {
  if (genreNameById) return genreNameById;
  const list = await fetchMovieGenres(signal);
  genreNameById = new Map(list.map((g) => [g.id, g.name]));
  return genreNameById;
}

function fillGenreLabels(card, movie, map) {
  const el = card.querySelector(".card__elite-genres");
  const sep = card.querySelector(".card__elite-genre-sep");
  if (!el) return;
  const ids = Array.isArray(movie.genre_ids) ? movie.genre_ids : [];
  const names = ids
    .map((id) => map.get(id))
    .filter(Boolean)
    .slice(0, 2);
  if (names.length) {
    el.textContent = names.join(" · ");
    sep?.removeAttribute("hidden");
  } else {
    el.textContent = "";
    sep?.setAttribute("hidden", "");
  }
}

function clampOverviewText(text, max = 130) {
  const t = (text || "").trim();
  if (!t) return "Discover this title — hover for trailer and actions.";
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function clearElitePreviewLayers(card) {
  const host = card.querySelector(".card__preview-video-host");
  if (host) host.innerHTML = "";
  const bd = card.querySelector(".card__preview-backdrop");
  if (bd) {
    bd.removeAttribute("src");
    bd.hidden = true;
  }
  const img = card.querySelector(".card__img");
  if (img) img.style.opacity = "";
  const ph = card.querySelector(".card__placeholder");
  if (ph) ph.style.opacity = "";
  card.classList.remove("card--elite-active", "card--elite-no-trailer", "card--elite-poster-only");
  const dock = card.querySelector(".card__preview-dock");
  dock?.classList.remove("is-showing-backdrop");
  const fill = card.querySelector(".card__preview-progress-fill");
  if (fill) {
    fill.classList.remove("is-animating");
    void fill.offsetWidth;
  }
}

export function destroyHoverPreview() {
  if (elitePreviewState.hoverTimer) {
    clearTimeout(elitePreviewState.hoverTimer);
    elitePreviewState.hoverTimer = null;
  }
  if (elitePreviewState.abort) {
    elitePreviewState.abort.abort();
    elitePreviewState.abort = null;
  }
  if (elitePreviewState.activeCard) {
    clearElitePreviewLayers(elitePreviewState.activeCard);
    elitePreviewState.activeCard = null;
  }
}

/**
 * @param {HTMLElement} card
 * @param {number} movieId
 * @param {(id: number, signal: AbortSignal) => Promise<string|null>} fetchKey
 */
export function scheduleHoverPreview(card, movieId, fetchKey) {
  destroyHoverPreview();

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const session = new AbortController();
  elitePreviewState.abort = session;

  void fetchKey(movieId, session.signal).catch(() => {});

  elitePreviewState.hoverTimer = window.setTimeout(async () => {
    elitePreviewState.hoverTimer = null;
    if (session.signal.aborted) return;

    elitePreviewState.activeCard = card;

    const movie = /** @type {any} */ (card.__movie);
    if (!movie) {
      elitePreviewState.activeCard = null;
      return;
    }

    requestAnimationFrame(() => {
      if (elitePreviewState.activeCard !== card || session.signal.aborted) return;
      card.classList.add("card--elite-active");
    });

    const host = card.querySelector(".card__preview-video-host");
    const bdEl = card.querySelector(".card__preview-backdrop");
    const img = card.querySelector(".card__img");
    const ph = card.querySelector(".card__placeholder");

    try {
      const map = await ensureGenreNameMap(session.signal);
      if (elitePreviewState.activeCard === card && !session.signal.aborted) {
        fillGenreLabels(card, movie, map);
      }
    } catch {
      /* ignore */
    }

    let key = null;
    try {
      key = await fetchKey(movieId, session.signal);
    } catch {
      key = null;
    }

    if (session.signal.aborted || elitePreviewState.activeCard !== card) return;

    const backdropStill = heroBackdropUrl(movie);
    const showVideo = key && !reduced && host;

    if (showVideo) {
      card.classList.remove("card--elite-no-trailer", "card--elite-poster-only");
      card.querySelector(".card__preview-dock")?.classList.remove("is-showing-backdrop");
      if (bdEl) {
        bdEl.hidden = true;
        bdEl.removeAttribute("src");
      }
      const iframe = document.createElement("iframe");
      iframe.className = "card__preview-iframe";
      iframe.setAttribute(
        "allow",
        "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      );
      iframe.setAttribute("title", "");
      iframe.setAttribute("tabIndex", "-1");
      iframe.src = youtubeEmbedUrl(key, {
        muted: true,
        autoplay: true,
        minimal: true,
        loop: true,
      });
      host.innerHTML = "";
      host.appendChild(iframe);
      if (img) img.style.opacity = "0";
      if (ph) ph.style.opacity = "0";
      const fill = card.querySelector(".card__preview-progress-fill");
      fill?.classList.add("is-animating");
    } else {
      card.classList.add("card--elite-no-trailer");
      if (host) host.innerHTML = "";
      if (bdEl && backdropStill) {
        card.classList.remove("card--elite-poster-only");
        bdEl.src = backdropStill;
        bdEl.hidden = false;
        card.querySelector(".card__preview-dock")?.classList.add("is-showing-backdrop");
        bindImageFallback(bdEl);
        if (img) img.style.opacity = "0";
        if (ph) ph.style.opacity = "0";
      } else if (img) {
        img.style.opacity = "0.25";
        card.classList.add("card--elite-poster-only");
      }
    }
  }, reduced ? 120 : CARD_PREVIEW_HOVER_DELAY_MS);
}

let detailModalBound = false;

function bindDetailModalOnce() {
  if (detailModalBound) return;
  detailModalBound = true;
  const modal = document.getElementById("detail-modal");
  if (!modal) return;
  modal.querySelectorAll("[data-close-detail]").forEach((el) => {
    el.addEventListener("click", () => closeMovieDetailModal());
  });
}

/** @param {{ title?: string, overview?: string, release_date?: string, vote_average?: number }} movie */
export function openMovieDetailModal(movie) {
  destroyHoverPreview();
  bindDetailModalOnce();
  const modal = document.getElementById("detail-modal");
  const titleEl = document.getElementById("detail-modal-title");
  const metaEl = document.getElementById("detail-modal-meta");
  const bodyEl = document.getElementById("detail-modal-body");
  const main = document.getElementById("main-content");
  const nav = document.getElementById("nav");
  if (!modal || !titleEl || !bodyEl) return;

  titleEl.textContent = movie.title || "Untitled";
  const y = movie.release_date ? String(movie.release_date).slice(0, 4) : "";
  const r =
    movie.vote_average != null ? `★ ${Number(movie.vote_average).toFixed(1)}` : "";
  if (metaEl) {
    metaEl.textContent = [y, r].filter(Boolean).join(" · ");
    metaEl.hidden = !metaEl.textContent;
  }
  bodyEl.textContent =
    movie.overview?.trim() || "No synopsis is available for this title yet.";

  modal.hidden = false;
  main?.setAttribute("inert", "");
  nav?.setAttribute("inert", "");
  document.getElementById("search-experience")?.setAttribute("inert", "");
  document.getElementById("entity-layer")?.setAttribute("inert", "");
  requestAnimationFrame(() => {
    modal.classList.add("is-open");
    document.body.style.overflow = "hidden";
  });
  document.getElementById("detail-modal-close")?.focus();
}

export function closeMovieDetailModal() {
  const modal = document.getElementById("detail-modal");
  const main = document.getElementById("main-content");
  const nav = document.getElementById("nav");
  if (!modal) return;
  modal.classList.remove("is-open");
  modal.hidden = true;
  document.body.style.overflow = "";
  main?.removeAttribute("inert");
  nav?.removeAttribute("inert");
  document.getElementById("search-experience")?.removeAttribute("inert");
  document.getElementById("entity-layer")?.removeAttribute("inert");
}

/**
 * @param {"default" | "watchlist"} variant default = add/remove My List; watchlist row = play + remove
 * @param {{ highlightQuery?: string, showMeta?: boolean, disablePreview?: boolean }} [extras]
 */
export function createCard(movie, profileId, handlers, variant = "default", extras = {}) {
  const card = document.createElement("article");
  card.className = "card";
  if (extras.disablePreview) card.classList.add("card--static-tile");
  card.tabIndex = -1;
  card.dataset.movieId = String(movie.id);
  card.dataset.cardVariant = variant;
  card.setAttribute("role", "group");
  card.setAttribute("aria-label", movie.title || "Movie");
  card.__movie = movie;

  const inList = isInWatchlist(profileId, movie.id);
  const poster = posterUrl(movie.poster_path);
  const progress =
    typeof movie.progress === "number" ? Math.round(movie.progress) : null;

  const titleHtml = extras.highlightQuery
    ? highlightMatchHtml(String(movie.title || ""), extras.highlightQuery)
    : escapeHtml(movie.title || "");
  const descText = clampOverviewText(movie.overview, 130);
  const year = movie.release_date ? String(movie.release_date).slice(0, 4) : "—";
  const rating = Number(movie.vote_average ?? 0).toFixed(1);

  const moreInfoBtn =
    variant === "default"
      ? `<button type="button" class="card__round-btn card__round-btn--info" data-action="info" aria-label="More about ${escapeAttr(
          movie.title
        )}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
        </button>`
      : "";

  const actionsRow =
    variant === "watchlist"
      ? `
        <button type="button" class="card__round-btn card__round-btn--play" data-action="play" aria-label="Play trailer for ${escapeAttr(
          movie.title
        )}">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        </button>
        <button type="button" class="card__pill-btn card__pill-btn--remove" data-action="remove-watchlist" aria-label="Remove ${escapeAttr(
          movie.title
        )} from My Watchlist">
          <span class="card__pill-text">Remove</span>
        </button>
      `
      : `
        <button type="button" class="card__round-btn card__round-btn--play" data-action="play" aria-label="Play trailer for ${escapeAttr(
          movie.title
        )}">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        </button>
        <button type="button" class="card__pill-btn card__pill-btn--wl ${inList ? "is-added" : ""}" data-action="watchlist" aria-label="${
          inList ? "Remove from My List" : "Add to My List"
        }">
          <span class="card__wl-text">${inList ? "✓ Added" : "+ Watchlist"}</span>
        </button>
        ${moreInfoBtn}
      `;

  const idleMeta =
    extras.showMeta && (movie.release_date != null || movie.vote_average != null)
      ? `<p class="card__idle-meta">${escapeHtml(
          (movie.release_date ? String(movie.release_date).slice(0, 4) : "—") +
            " · ★ " +
            Number(movie.vote_average ?? 0).toFixed(1)
        )}</p>`
      : "";

  card.innerHTML = `
    <div class="card__surface">
      <div class="card__poster-layer">
        ${
          poster
            ? `<img class="card__img" src="${poster}" alt="" loading="lazy" decoding="async" width="500" height="750" />`
            : `<div class="card__placeholder">No poster</div>`
        }
      </div>
      <div class="card__preview-dock" aria-hidden="true">
        <div class="card__preview-video-host"></div>
        <img class="card__preview-backdrop" alt="" hidden decoding="async" />
        <div class="card__preview-chrome">
          <span class="card__mute-chip">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.65-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>
            Muted
          </span>
          <div class="card__preview-progress" aria-hidden="true">
            <span class="card__preview-progress-fill"></span>
          </div>
        </div>
      </div>
      <div class="card__preview-scrim" aria-hidden="true"></div>
      <div class="card__idle-fallback">
        <p class="card__idle-title">${titleHtml}</p>
        ${idleMeta}
      </div>
    </div>
    <div class="card__elite">
      <div class="card__elite-gradient" aria-hidden="true"></div>
      <div class="card__elite-body">
        <p class="card__elite-title">${titleHtml}</p>
        <p class="card__elite-desc">${escapeHtml(descText)}</p>
        <div class="card__elite-meta">
          <span class="card__elite-meta-item">${escapeHtml(year)}</span>
          <span class="card__elite-meta-sep" aria-hidden="true">·</span>
          <span class="card__elite-meta-item">★ ${escapeHtml(rating)}</span>
          <span class="card__elite-meta-sep card__elite-genre-sep" hidden aria-hidden="true">·</span>
          <span class="card__elite-genres"></span>
        </div>
        <div class="card__elite-actions">
          ${actionsRow}
        </div>
      </div>
    </div>
    ${progress !== null ? `<div class="card__progress"><div class="card__progress-bar" style="--progress:${progress}%"></div></div>` : ""}
  `;

  const img = card.querySelector(".card__img");
  bindImageFallback(img);

  if (!extras.disablePreview) {
    card.addEventListener("mouseenter", () => handlers.onHoverEnter(card, movie));
    card.addEventListener("mouseleave", () => handlers.onHoverLeave(card));
  }

  card.addEventListener("click", (e) => {
    const t = e.target;
    if (t.closest('[data-action="play"]')) {
      e.preventDefault();
      e.stopPropagation();
      handlers.onPlay(movie);
    } else if (t.closest('[data-action="watchlist"]')) {
      e.preventDefault();
      e.stopPropagation();
      handlers.onWatchlist(movie, card);
    } else if (t.closest('[data-action="remove-watchlist"]')) {
      e.preventDefault();
      e.stopPropagation();
      handlers.onRemoveFromWatchlist?.(movie, card);
    } else if (t.closest('[data-action="info"]')) {
      e.preventDefault();
      e.stopPropagation();
      handlers.onMoreInfo?.(movie);
    } else if (typeof handlers.onOpenEntity === "function") {
      e.preventDefault();
      e.stopPropagation();
      handlers.onOpenEntity(movie);
    }
  });

  return card;
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function escapeAttr(s) {
  return String(s).replace(/"/g, "&quot;");
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Safe HTML with &lt;mark&gt; around query token matches */
function highlightMatchHtml(text, query) {
  const base = escapeHtml(text);
  const q = query.trim();
  if (!q) return base;
  const parts = q.split(/\s+/).filter((w) => w.length > 1);
  if (!parts.length) return base;
  let out = base;
  for (const w of parts) {
    const re = new RegExp(`(${escapeRegex(w)})`, "gi");
    out = out.replace(re, '<mark class="search-highlight">$1</mark>');
  }
  return out;
}

export function createPersonSearchCard(person, { onActivate }) {
  if (!isValidSearchPersonRaw(person)) return null;
  const imgPath = posterUrl(person.profile_path, "w185");
  const initials = String(person.name || "?")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase() || "?";

  const card = document.createElement("button");
  card.type = "button";
  card.className = "person-card";
  const avatarHtml = imgPath
    ? `<img class="person-card__img" src="${imgPath}" alt="" loading="lazy" decoding="async" width="72" height="72"/>`
    : `<span class="person-card__ph" aria-hidden="true">${escapeHtml(initials)}</span>`;
  card.innerHTML = `
    ${avatarHtml}
    <span class="person-card__body">
      <span class="person-card__name">${escapeHtml(person.name || "")}</span>
      <span class="person-card__role">${escapeHtml(person.known_for_department || "Film & TV")}</span>
    </span>
  `;
  const img = card.querySelector(".person-card__img");
  if (img) bindImageFallback(img);
  card.addEventListener("click", () => onActivate(person));
  return card;
}

/**
 * Mount categorized live search results under the nav input.
 */
export function mountLiveSearchPanel(innerEl, payload) {
  const {
    query,
    profileId,
    handlers,
    titles = [],
    genreSections = [],
    people = [],
    castMovies = [],
    error,
    showRecent,
    recentQueries = [],
    trendingMovies = [],
    onPickRecent,
    onPersonActivate,
    onOpenGenre,
    castHeading,
    discoverFallbackMovies = [],
  } = payload;

  destroyHoverPreview();
  innerEl.innerHTML = "";
  innerEl.classList.add("search-panel__inner--fade");

  const searchExtras = {
    highlightQuery: query,
    showMeta: true,
  };

  function appendMovieStrip(title, movies, genreMeta = null) {
    if (!movies?.length) return;
    const sec = document.createElement("section");
    sec.className = "search-panel__section";
    sec.setAttribute("aria-label", title);
    const h = document.createElement("h3");
    h.className = "search-panel__section-title";
    if (genreMeta?.id != null && typeof onOpenGenre === "function") {
      h.classList.add("search-panel__section-title--link");
      h.setAttribute("role", "button");
      h.tabIndex = 0;
      h.textContent = title;
      const openGenrePage = () => onOpenGenre(genreMeta.id, genreMeta.label || "");
      h.addEventListener("click", (ev) => {
        ev.preventDefault();
        openGenrePage();
      });
      h.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          openGenrePage();
        }
      });
    } else {
      h.textContent = title;
    }
    sec.appendChild(h);

    const wrap = document.createElement("div");
    wrap.className = "row__track-wrap search-panel__strip";
    const track = document.createElement("div");
    track.className = "row__track search-panel__movie-track";
    track.setAttribute("role", "list");
    track.setAttribute("aria-label", title);
    movies.forEach((m) => {
      track.appendChild(createCard(m, profileId, handlers, "default", searchExtras));
    });
    wrap.appendChild(track);
    wireRowScrollControls(wrap, track);
    sec.appendChild(wrap);
    innerEl.appendChild(sec);
  }

  if (error) {
    const p = document.createElement("p");
    p.className = "search-panel__note search-panel__note--error";
    p.textContent = error;
    innerEl.appendChild(p);
    return;
  }

  if (showRecent) {
    const trendingFiltered = filterMoviesForSearchRows(trendingMovies).slice(0, 16);
    if (recentQueries.length) {
      const sec = document.createElement("section");
      sec.className = "search-panel__section";
      sec.innerHTML = `<h3 class="search-panel__section-title">Recent searches</h3>`;
      const list = document.createElement("div");
      list.className = "search-panel__recent";
      recentQueries.forEach((rq) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "search-panel__recent-item";
        b.textContent = rq;
        b.addEventListener("click", () => onPickRecent?.(rq));
        list.appendChild(b);
      });
      sec.appendChild(list);
      innerEl.appendChild(sec);
    }
    if (trendingFiltered.length) {
      appendMovieStrip("Trending now", trendingFiltered);
    }
    if (!recentQueries.length && !trendingFiltered.length) {
      const p = document.createElement("p");
      p.className = "search-panel__note";
      p.textContent = "Start typing to search titles, genres, or people.";
      innerEl.appendChild(p);
    }
    return;
  }

  const titlesFiltered = filterMoviesForSearchRows(titles).slice(0, 16);
  const genreSectionsFiltered = (genreSections || [])
    .map((block) => ({
      ...block,
      movies: filterMoviesForSearchRows(block?.movies || []),
    }))
    .filter((block) => block.movies.length >= MIN_SEARCH_GENRE_MOVIES);

  const peopleFiltered = filterPeopleForSearchRows(people).slice(0, 12);
  const showPeopleSection = peopleFiltered.length >= MIN_SEARCH_PEOPLE;

  const castMoviesFiltered = filterMoviesForSearchRows(castMovies).slice(0, 12);

  const hasAny =
    titlesFiltered.length > 0 ||
    genreSectionsFiltered.length > 0 ||
    (showPeopleSection && peopleFiltered.length >= MIN_SEARCH_PEOPLE) ||
    castMoviesFiltered.length > 0;

  if (!hasAny) {
    const fallback = filterMoviesForSearchRows(discoverFallbackMovies).slice(0, 16);
    if (fallback.length) {
      const note = document.createElement("p");
      note.className = "search-panel__note";
      note.textContent =
        "No exact matches for that search. Here are some titles people are watching now:";
      innerEl.appendChild(note);
      appendMovieStrip("Popular picks", fallback);
      return;
    }
    const p = document.createElement("p");
    p.className = "search-panel__note";
    p.textContent = "No results found. Try another title, genre, or name.";
    innerEl.appendChild(p);
    return;
  }

  if (titlesFiltered.length) {
    appendMovieStrip("Titles", titlesFiltered);
  }

  genreSectionsFiltered.forEach((block) => {
    appendMovieStrip(`Genre — ${block.label || "Picks"}`, block.movies.slice(0, 16), {
      id: block.id,
      label: block.label,
    });
  });

  if (showPeopleSection) {
    const sec = document.createElement("section");
    sec.className = "search-panel__section";
    const h = document.createElement("h3");
    h.className = "search-panel__section-title";
    h.textContent = "People";
    sec.appendChild(h);

    const wrap = document.createElement("div");
    wrap.className = "row__track-wrap search-panel__strip";
    const track = document.createElement("div");
    track.className = "row__track search-panel__people-track";
    track.setAttribute("role", "list");
    peopleFiltered.slice(0, 8).forEach((p) => {
      const pc = createPersonSearchCard(p, {
        onActivate: () => onPersonActivate?.(p),
      });
      if (pc) track.appendChild(pc);
    });
    wrap.appendChild(track);
    wireRowScrollControls(wrap, track);
    sec.appendChild(wrap);
    innerEl.appendChild(sec);
  }

  if (castMoviesFiltered.length) {
    const castTitle = castHeading || "Films featuring top match";
    appendMovieStrip(castTitle, castMoviesFiltered);
  }
}

export function setCardWatchlistState(card, inList) {
  const btn = card.querySelector('[data-action="watchlist"]');
  if (!btn) return;
  const label = btn.querySelector(".card__wl-text");
  btn.classList.toggle("is-added", inList);
  if (label) label.textContent = inList ? "✓ Added" : "+ Watchlist";
  btn.setAttribute("aria-label", inList ? "Remove from My List" : "Add to My List");
}

/** Updates only cards that use the + Watchlist control (not the My Watchlist row). */
export function syncDefaultCardWatchlistButtons(profileId) {
  document.querySelectorAll('.card[data-card-variant="default"]').forEach((card) => {
    const id = Number(card.dataset.movieId);
    if (!Number.isFinite(id)) return;
    setCardWatchlistState(card, isInWatchlist(profileId, id));
  });
}

export function updateNavbarWatchlistBadge(profileId) {
  const wrap = document.getElementById("nav-watchlist-jump");
  const countEl = document.getElementById("watchlist-count-badge");
  if (!wrap || !countEl) return;
  const n = getWatchlist(profileId).length;
  countEl.textContent = String(n);
  const show = n > 0;
  wrap.hidden = !show;
  countEl.hidden = !show;
  wrap.setAttribute("aria-label", `My Watchlist, ${n} ${n === 1 ? "title" : "titles"}`);
}

const ROW_SCROLL_STEP = 0.76;

function rowScrollBehavior() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

function wireRowScrollControls(wrap, track) {
  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = "row__nav row__nav--prev";
  prevBtn.setAttribute("aria-label", "Scroll left");
  prevBtn.innerHTML =
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>';

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "row__nav row__nav--next";
  nextBtn.setAttribute("aria-label", "Scroll right");
  nextBtn.innerHTML =
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>';

  wrap.insertBefore(prevBtn, track);
  wrap.insertBefore(nextBtn, track);

  const scrollAmount = () => Math.max(120, Math.round(track.clientWidth * ROW_SCROLL_STEP));

  function updateNavState() {
    const maxScroll = Math.max(0, track.scrollWidth - track.clientWidth);
    const canScroll = maxScroll > 4;
    wrap.classList.toggle("is-scrollable", canScroll);
    if (!canScroll) {
      prevBtn.disabled = true;
      nextBtn.disabled = true;
      return;
    }
    prevBtn.disabled = track.scrollLeft <= 2;
    nextBtn.disabled = track.scrollLeft >= maxScroll - 2;
  }

  function onWheel(e) {
    const maxScroll = track.scrollWidth - track.clientWidth;
    if (maxScroll <= 4) return;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    if (Math.abs(e.deltaY) < 0.5) return;
    e.preventDefault();
    track.scrollLeft += e.deltaY;
  }

  prevBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    track.scrollBy({ left: -scrollAmount(), behavior: rowScrollBehavior() });
  });
  nextBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    track.scrollBy({ left: scrollAmount(), behavior: rowScrollBehavior() });
  });

  track.addEventListener("scroll", () => requestAnimationFrame(updateNavState), { passive: true });
  wrap.addEventListener("wheel", onWheel, { passive: false });

  let resizeRaf = null;
  const onResize = () => {
    if (resizeRaf != null) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = null;
      updateNavState();
    });
  };
  window.addEventListener("resize", onResize, { passive: true });
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(onResize);
    ro.observe(track);
    ro.observe(wrap);
  }

  updateNavState();
}

export function createContentRow({
  id,
  title,
  hint,
  movies,
  profileId,
  emptyMessage,
  skeleton,
  handlers,
  cardVariant = "default",
}) {
  const row = document.createElement("section");
  row.className = "row";
  row.dataset.rowId = id;
  if (id === "search") row.id = "search-results-region";
  if (id === "watchlist") {
    row.id = "my-watchlist-row";
  }

  const head = document.createElement("div");
  head.className = "row__head";
  head.innerHTML = `<h2 class="row__title">${escapeHtml(title)}</h2>`;
  if (hint) {
    const h = document.createElement("span");
    h.className = "row__hint";
    h.textContent = hint;
    head.appendChild(h);
  }
  row.appendChild(head);

  const wrap = document.createElement("div");
  wrap.className = "row__track-wrap";

  const track = document.createElement("div");
  track.className = "row__track";
  track.tabIndex = 0;
  track.setAttribute("role", "list");
  track.setAttribute("aria-label", title);

  if (skeleton) {
    row.classList.add("skeleton-row");
    for (let i = 0; i < 8; i++) {
      const sk = document.createElement("div");
      sk.className = "card";
      sk.setAttribute("aria-hidden", "true");
      track.appendChild(sk);
    }
    wrap.appendChild(track);
  } else {
    const list =
      cardVariant === "watchlist"
        ? (movies || []).map((m) => normalizeMovie(m)).filter(Boolean)
        : filterPresentableMovies(movies);
    if (!list.length) {
      const empty = document.createElement("p");
      empty.className = "row--empty";
      empty.textContent = emptyMessage || "Nothing here yet.";
      wrap.appendChild(empty);
    } else {
      list.forEach((m) => {
        track.appendChild(createCard(m, profileId, handlers, cardVariant));
      });
      wrap.appendChild(track);
      wireRowScrollControls(wrap, track);
    }
  }

  row.appendChild(wrap);

  return row;
}

export function renderSkeletonPlaceholder(root) {
  const frag = document.createDocumentFragment();
  ["continue", "watchlist", "trending", "top", "popular"].forEach((rid) => {
    const row = createContentRow({
      id: rid,
      title:
        rid === "continue"
          ? "Continue Watching"
          : rid === "watchlist"
            ? "My Watchlist"
            : rid === "trending"
              ? "Trending"
              : rid === "top"
                ? "Top Rated"
                : rid === "popular"
                  ? "Popular"
                  : "My Watchlist",
      movies: [],
      skeleton: true,
      handlers: {},
    });
    frag.appendChild(row);
  });
  root.innerHTML = "";
  root.appendChild(frag);
}

export function mountRows(root, rows) {
  root.innerHTML = "";
  rows.forEach((r) => {
    if (r) root.appendChild(r);
  });
}
