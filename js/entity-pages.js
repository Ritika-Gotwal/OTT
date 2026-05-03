import {
  backdropUrl,
  fetchMovieDetail,
  fetchSimilarMovies,
  fetchRecommendations,
  discoverMoviesByGenre,
  fetchPersonDetail,
  fetchPersonMovieCreditsRaw,
  fetchMovieGenres,
  fetchPrimaryTrailerKey,
} from "./api.js";
import { normalizeMovie, filterPresentableMovies } from "./state.js";
import { createContentRow } from "./ui.js";

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = String(s ?? "");
  return d.innerHTML;
}

function escapeAttr(s) {
  return String(s).replace(/"/g, "&quot;");
}

function dedupeMovies(arr) {
  const seen = new Set();
  const out = [];
  for (const raw of arr || []) {
    const m = normalizeMovie(raw);
    if (!m || seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out;
}

/** Rails only: posters required for card UI */
function dedupeMoviesForRails(arr) {
  return filterPresentableMovies(dedupeMovies(arr));
}

function heroBackdropMovie(detail) {
  if (detail?.backdrop_path) return backdropUrl(detail.backdrop_path, "original");
  if (detail?.poster_path) return backdropUrl(detail.poster_path, "w1280");
  return "";
}

function heroBackdropPerson(person) {
  if (person?.profile_path) return backdropUrl(person.profile_path, "original");
  return "";
}

/**
 * @param {HTMLElement} root
 * @param {{ type: string, id?: number, label?: string }} spec
 * @param {*} ctx
 */
export async function renderEntityRoot(root, spec, ctx) {
  root.innerHTML = `<div class="entity-page entity-page--loading"><div class="entity-loading">Loading…</div></div>`;
  try {
    if (spec.type === "movie" && spec.id != null) {
      await renderMoviePage(root, spec.id, ctx);
    } else if (spec.type === "actor" && spec.id != null) {
      await renderActorPage(root, spec.id, ctx);
    } else if (spec.type === "genre" && spec.id != null) {
      await renderGenrePage(root, spec.id, spec.label || "Genre", ctx);
    } else {
      root.innerHTML = `<div class="entity-page entity-page--error"><p>Invalid page.</p></div>`;
    }
  } catch (err) {
    const hint = ctx.errorMessage?.(err) || "Something went wrong.";
    root.innerHTML = `<div class="entity-page entity-page--error"><p>${escapeHtml(hint)}</p></div>`;
  }
}

async function renderMoviePage(root, movieId, ctx) {
  const ac = new AbortController();
  const signal = ac.signal;
  const [detail, similarRaw, recRaw] = await Promise.all([
    fetchMovieDetail(movieId, signal),
    fetchSimilarMovies(movieId, signal, 1),
    fetchRecommendations(movieId, signal, 1),
  ]);

  const movie = normalizeMovie({ ...detail, id: detail.id });
  if (!movie) throw new Error("Movie not found");

  let trailerPrefetch = undefined;
  try {
    trailerPrefetch = await fetchPrimaryTrailerKey(movieId, signal);
  } catch {
    trailerPrefetch = undefined;
  }
  const trailerUnavailable = trailerPrefetch === null;

  const similar = dedupeMoviesForRails(similarRaw);
  const recommendations = dedupeMoviesForRails(recRaw);

  const genres = detail.genres || [];
  let genreDiscovery = [];
  if (genres[0]?.id) {
    try {
      const disc = await discoverMoviesByGenre(genres[0].id, signal, 1);
      genreDiscovery = dedupeMoviesForRails(disc)
        .filter((m) => m.id !== movieId)
        .slice(0, 16);
    } catch {
      genreDiscovery = [];
    }
  }

  const dur =
    typeof detail.runtime === "number" && detail.runtime > 0
      ? `${Math.floor(detail.runtime / 60)}h ${detail.runtime % 60}m`
      : "";
  const y = detail.release_date ? String(detail.release_date).slice(0, 4) : "";
  const rating =
    detail.vote_average != null ? Number(detail.vote_average).toFixed(1) : "—";
  const heroMetaBits = [y, dur, rating !== "—" ? `★ ${rating}` : ""].filter(Boolean);

  const bg = heroBackdropMovie(detail);
  const inList = ctx.isInWatchlist?.(movie.id);

  const mediaBG =
    bg &&
    `background-image:url('${bg.replace(/'/g, "\\'")}');background-size:cover;background-position:72% 28%;`;

  const overview = (detail.overview || "").trim();
  const overviewShort = overview.slice(0, 420);

  const page = document.createElement("div");
  page.className = "entity-page entity-page--movie entity-page--enter";
  page.innerHTML = `
    <section class="entity-hero entity-hero--movie" data-movie-id="${movie.id}">
      <div class="entity-hero__media"${mediaBG ? ` style="${escapeAttr(mediaBG)}"` : ""}></div>
      <div class="entity-hero__overlay-stack" aria-hidden="true">
        <div class="entity-hero__overlay entity-hero__overlay--left"></div>
        <div class="entity-hero__overlay entity-hero__overlay--bottom"></div>
        <div class="entity-hero__overlay entity-hero__overlay--vignette"></div>
      </div>
      <button type="button" class="entity-back entity-back--floating" data-entity-back aria-label="Back">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
      </button>
      <div class="entity-hero__shell">
        <div class="entity-hero__copy">
          <p class="entity-hero__eyebrow">Movie</p>
          <h1 class="entity-hero__title">${escapeHtml(movie.title)}</h1>
          ${
            heroMetaBits.length
              ? `<p class="entity-hero__meta">${escapeHtml(heroMetaBits.join(" · "))}</p>`
              : ""
          }
          ${
            overviewShort
              ? `<p class="entity-hero__desc">${escapeHtml(overviewShort)}${overview.length > 420 ? "…" : ""}</p>`
              : ""
          }
          <div class="entity-hero__actions">
            <button type="button" class="btn btn--primary entity-hero__play${
              trailerUnavailable ? " is-unavailable" : ""
            }" data-entity-play${trailerUnavailable ? " disabled" : ""} aria-disabled="${
    trailerUnavailable ? "true" : "false"
  }">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              ${trailerUnavailable ? "Trailer unavailable" : "Play trailer"}
            </button>
            <button type="button" class="btn btn--ghost entity-hero__wl ${inList ? "is-added" : ""}" data-entity-wl">
              <span data-wl-label>${inList ? "✓ In My List" : "+ Watchlist"}</span>
            </button>
          </div>
        </div>
        <div class="entity-hero__visual-space" aria-hidden="true"></div>
      </div>
    </section>
    <div class="entity-scroll">
      <div class="entity-body entity-body--rails-only">
        <div class="entity-rows" id="entity-movie-rows"></div>
      </div>
    </div>
  `;

  root.innerHTML = "";
  root.appendChild(page);

  root.querySelector("[data-entity-back]")?.addEventListener("click", () => ctx.onBack());
  root.querySelector("[data-entity-play]")?.addEventListener("click", (e) => {
    if (trailerUnavailable) {
      e.preventDefault();
      return;
    }
    ctx.onPlayMovie?.(movie, trailerPrefetch);
  });
  root.querySelector("[data-entity-wl]")?.addEventListener("click", () => {
    ctx.onToggleWatchlist?.(movie);
    const btn = root.querySelector("[data-entity-wl]");
    const span = root.querySelector("[data-wl-label]");
    const added = ctx.isInWatchlist?.(movie.id);
    btn?.classList.toggle("is-added", !!added);
    if (span) span.textContent = added ? "✓ In My List" : "+ Watchlist";
  });

  const rowsMount = root.querySelector("#entity-movie-rows");
  if (rowsMount) {
    const handlers = ctx.cardHandlers;
    const pid = ctx.profileId;
    if (similar.length) {
      rowsMount.appendChild(
        createContentRow({
          id: "entity-similar",
          title: "Similar movies",
          hint: "More like this",
          movies: similar.slice(0, 18),
          profileId: pid,
          handlers,
          emptyMessage: "",
        })
      );
    }
    if (recommendations.length) {
      rowsMount.appendChild(
        createContentRow({
          id: "entity-rec",
          title: "Recommended",
          hint: "Because you watched this",
          movies: recommendations.slice(0, 18),
          profileId: pid,
          handlers,
          emptyMessage: "",
        })
      );
    }
    if (genreDiscovery.length && genres[0]) {
      rowsMount.appendChild(
        createContentRow({
          id: "entity-genre-more",
          title: `${genres[0].name} picks`,
          hint: "Same genre",
          movies: genreDiscovery,
          profileId: pid,
          handlers,
          emptyMessage: "",
        })
      );
    }
  }

  requestAnimationFrame(() => page.classList.add("entity-page--enter-active"));
}

async function renderActorPage(root, personId, ctx) {
  const ac = new AbortController();
  const { signal } = ac;
  const [person, creditsData] = await Promise.all([
    fetchPersonDetail(personId, signal),
    fetchPersonMovieCreditsRaw(personId, signal),
  ]);

  const castJobs = creditsData?.cast || [];
  const moviesRaw = [];
  const seen = new Set();
  for (const job of castJobs) {
    const id = job?.id;
    if (id == null || seen.has(id)) continue;
    seen.add(id);
    moviesRaw.push(job);
  }
  moviesRaw.sort((a, b) => {
    const da = a.release_date || "";
    const db = b.release_date || "";
    return db.localeCompare(da);
  });

  const movies = dedupeMoviesForRails(moviesRaw);
  const knownFor = [...moviesRaw]
    .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
    .slice(0, 8);
  const knownNorm = dedupeMoviesForRails(knownFor);

  const bio = (person.biography || "").trim();
  const bioShort = bio.slice(0, 200);

  const bg = heroBackdropPerson(person);
  const actorMediaBG =
    bg &&
    `background-image:url('${bg.replace(/'/g, "\\'")}');background-size:cover;background-position:center 22%;`;
  const page = document.createElement("div");
  page.className = "entity-page entity-page--actor entity-page--enter";

  page.innerHTML = `
    <section class="entity-hero entity-hero--person">
      <div class="entity-hero__media"${actorMediaBG ? ` style="${escapeAttr(actorMediaBG)}"` : ""}></div>
      <div class="entity-hero__overlay-stack entity-hero__overlay-stack--talent" aria-hidden="true">
        <div class="entity-hero__overlay entity-hero__overlay--left"></div>
        <div class="entity-hero__overlay entity-hero__overlay--bottom"></div>
        <div class="entity-hero__overlay entity-hero__overlay--vignette"></div>
      </div>
      <button type="button" class="entity-back entity-back--floating" data-entity-back aria-label="Back">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
      </button>
      <div class="entity-hero__shell entity-hero__shell--compact">
        <div class="entity-hero__copy">
          <p class="entity-hero__eyebrow">People</p>
          <h1 class="entity-hero__title">${escapeHtml(person.name || "Actor")}</h1>
          ${
            bioShort
              ? `<p class="entity-hero__desc">${escapeHtml(bioShort)}${bio.length > 200 ? "…" : ""}</p>`
              : ""
          }
        </div>
        <div class="entity-hero__visual-space" aria-hidden="true"></div>
      </div>
    </section>
    <div class="entity-scroll">
      <div class="entity-body entity-body--rails-only">
        <div class="entity-rows" id="entity-actor-rows"></div>
      </div>
    </div>
  `;

  root.innerHTML = "";
  root.appendChild(page);

  root.querySelector("[data-entity-back]")?.addEventListener("click", () => ctx.onBack());

  const rowsMount = root.querySelector("#entity-actor-rows");
  const handlers = ctx.cardHandlers;
  const pid = ctx.profileId;

  if (knownNorm.length && rowsMount) {
    rowsMount.appendChild(
      createContentRow({
        id: "actor-known",
        title: "Known for",
        movies: knownNorm,
        profileId: pid,
        handlers,
      })
    );
  }
  if (movies.length && rowsMount) {
    rowsMount.appendChild(
      createContentRow({
        id: "actor-filmography",
        title: "Filmography",
        hint: `${movies.length} credits`,
        movies: movies.slice(0, 40),
        profileId: pid,
        handlers,
        emptyMessage: "",
      })
    );
  }

  requestAnimationFrame(() => page.classList.add("entity-page--enter-active"));
}

async function renderGenrePage(root, genreId, genreLabel, ctx) {
  const ac = new AbortController();
  const { signal } = ac;
  const list = await discoverMoviesByGenre(genreId, signal, 1);
  const movies = dedupeMoviesForRails(list);

  let genreName = genreLabel;
  try {
    const genres = await fetchMovieGenres(signal);
    const g = genres.find((x) => x.id === genreId);
    if (g?.name) genreName = g.name;
  } catch {
    /* keep label */
  }

  const bgMovie = movies[0];
  const bg =
    bgMovie?.backdrop_path || bgMovie?.poster_path
      ? heroBackdropMovie({
          backdrop_path: bgMovie.backdrop_path,
          poster_path: bgMovie.poster_path,
        })
      : "";

  const genreMediaBG =
    bg &&
    `background-image:url('${bg.replace(/'/g, "\\'")}');background-size:cover;background-position:68% 30%;`;

  const page = document.createElement("div");
  page.className = "entity-page entity-page--genre entity-page--enter";
  page.innerHTML = `
    <section class="entity-hero entity-hero--genre">
      <div class="entity-hero__media"${genreMediaBG ? ` style="${escapeAttr(genreMediaBG)}"` : ""}></div>
      <div class="entity-hero__overlay-stack" aria-hidden="true">
        <div class="entity-hero__overlay entity-hero__overlay--left"></div>
        <div class="entity-hero__overlay entity-hero__overlay--bottom"></div>
        <div class="entity-hero__overlay entity-hero__overlay--vignette"></div>
      </div>
      <button type="button" class="entity-back entity-back--floating" data-entity-back aria-label="Back">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
      </button>
      <div class="entity-hero__shell entity-hero__shell--compact">
        <div class="entity-hero__copy">
          <p class="entity-hero__eyebrow">Genre</p>
          <h1 class="entity-hero__title">${escapeHtml(genreName)}</h1>
        </div>
        <div class="entity-hero__visual-space" aria-hidden="true"></div>
      </div>
    </section>
    <div class="entity-scroll">
      <div class="entity-body entity-body--rails-only">
        <div class="entity-rows" id="entity-genre-rows"></div>
      </div>
    </div>
  `;

  root.innerHTML = "";
  root.appendChild(page);

  root.querySelector("[data-entity-back]")?.addEventListener("click", () => ctx.onBack());

  const rowsMount = root.querySelector("#entity-genre-rows");
  if (rowsMount && movies.length) {
    rowsMount.appendChild(
      createContentRow({
        id: "genre-all",
        title: "Movies",
        hint: "Sorted by popularity",
        movies,
        profileId: ctx.profileId,
        handlers: ctx.cardHandlers,
        emptyMessage: "No titles in this genre right now.",
      })
    );
  } else if (rowsMount) {
    rowsMount.innerHTML = `<p class="entity-empty">No movies found for this genre.</p>`;
  }

  requestAnimationFrame(() => page.classList.add("entity-page--enter-active"));
}
