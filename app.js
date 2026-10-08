// Shelfmate: swipe through books like a dating app.
//
// The reader profile is a set of weights per genre, mood and pace. Onboarding
// picks seed the weights, then every swipe nudges them: likes push a book's
// tags up, passes pull them down. The match % for a book is computed from how
// strongly the profile favours that book's tags.

const STORAGE_KEY = "shelfmate:v1";

const SEED = { genre: 3, mood: 2, pace: 2 };          // weight from onboarding picks
const SWIPE = { like: 1, super: 2, nope: -0.6 };      // weight change per swipe
const MATCH_THRESHOLD = 75;                           // % needed for the "It's a match!" pop-up

const $ = (sel) => document.querySelector(sel);

let state = loadState() || freshState();

function freshState() {
  return {
    onboarded: false,
    weights: { genre: {}, mood: {}, pace: {} },
    picks: { genre: [], mood: [], pace: [] },
    seen: [],      // book ids already swiped
    matches: [],   // { id, pct, super }
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage can be unavailable (private mode); the app still works for this visit.
  }
}

// ---------- Matching ----------

// Map a raw weight to an affinity in (-1, 1). Diminishing returns, so one
// category can't dominate just because it was swiped a lot.
function affinity(w = 0) {
  return w / (Math.abs(w) + 1.5);
}

function groupScore(tags, weights) {
  if (!tags.length) return 0;
  const affs = tags.map((t) => affinity(weights[t]));
  const best = Math.max(...affs);
  const avg = affs.reduce((a, b) => a + b, 0) / affs.length;
  return 0.6 * best + 0.4 * avg;
}

function matchPercent(book) {
  const w = state.weights;
  const raw =
    0.5 * groupScore(book.genres, w.genre) +
    0.35 * groupScore(book.moods, w.mood) +
    0.15 * groupScore([book.pace], w.pace);
  // raw is in (-1, 1); map to a friendly 1-99 range centred on 50.
  return Math.max(1, Math.min(99, Math.round(50 + raw * 55)));
}

function matchReasons(book) {
  const w = state.weights;
  const hits = [
    ...book.genres.filter((g) => (w.genre[g] || 0) > 0).map((g) => GENRES[g]),
    ...book.moods.filter((m) => (w.mood[m] || 0) > 0).map((m) => MOODS[m].toLowerCase()),
  ];
  if ((w.pace[book.pace] || 0) > 0) hits.push(`${book.pace}-paced`);
  return hits.slice(0, 4);
}

function learn(book, delta) {
  const w = state.weights;
  book.genres.forEach((g) => (w.genre[g] = (w.genre[g] || 0) + delta));
  book.moods.forEach((m) => (w.mood[m] = (w.mood[m] || 0) + delta * 0.8));
  w.pace[book.pace] = (w.pace[book.pace] || 0) + delta * 0.5;
}

// Remaining books, best match first, with a little jitter so the deck
// doesn't feel identical every time.
function buildDeck() {
  const seen = new Set(state.seen);
  return BOOKS.filter((b) => !seen.has(b.id))
    .map((b) => ({ book: b, score: matchPercent(b) + Math.random() * 12 }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.book);
}

// ---------- Rendering helpers ----------

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function coverStyle(book) {
  const h = (book.id * 47) % 360;
  return `background: linear-gradient(150deg, hsl(${h} 70% 58%), hsl(${(h + 40) % 360} 65% 38%));`;
}

function pctClass(p) {
  return p >= 75 ? "high" : p >= 50 ? "mid" : "low";
}

function bookById(id) {
  return BOOKS.find((b) => b.id === id);
}

// ---------- Views ----------

function show(view) {
  for (const v of ["onboarding", "swipe", "matches"]) {
    $(`#view-${v}`).hidden = v !== view;
  }
  if (view === "swipe") renderDeck();
  if (view === "matches") renderMatches();
}

function renderOnboarding() {
  const groups = [
    ["genre", "#chips-genres", GENRES],
    ["mood", "#chips-moods", MOODS],
    ["pace", "#chips-pace", { slow: "Slow burn", medium: "Steady", fast: "Page-turner" }],
  ];
  for (const [key, sel, labels] of groups) {
    const el = $(sel);
    el.innerHTML = "";
    for (const [id, label] of Object.entries(labels)) {
      const chip = document.createElement("button");
      chip.className = "chip";
      chip.textContent = label;
      chip.setAttribute("aria-pressed", state.picks[key].includes(id));
      chip.addEventListener("click", () => {
        const on = chip.getAttribute("aria-pressed") !== "true";
        chip.setAttribute("aria-pressed", on);
        state.picks[key] = on ? [...state.picks[key], id] : state.picks[key].filter((x) => x !== id);
        updateStartButton();
      });
      el.appendChild(chip);
    }
  }
  updateStartButton();
}

function updateStartButton() {
  $("#btn-start").disabled = state.picks.genre.length === 0;
  $("#btn-start").textContent = state.picks.genre.length ? "Start swiping" : "Pick at least one genre";
}

function finishOnboarding() {
  // Rebuild weights: seed from picks, then replay past swipes so editing
  // preferences doesn't throw away what the app has learned.
  state.weights = { genre: {}, mood: {}, pace: {} };
  state.picks.genre.forEach((g) => (state.weights.genre[g] = SEED.genre));
  state.picks.mood.forEach((m) => (state.weights.mood[m] = SEED.mood));
  state.picks.pace.forEach((p) => (state.weights.pace[p] = SEED.pace));
  const liked = new Map(state.matches.map((m) => [m.id, m.super ? SWIPE.super : SWIPE.like]));
  state.seen.forEach((id) => learn(bookById(id), liked.get(id) ?? SWIPE.nope));
  state.onboarded = true;
  saveState();
  show("swipe");
}

function cardHTML(book) {
  const pct = matchPercent(book);
  const reasons = matchReasons(book);
  const w = state.weights;
  const tag = (label, hit) => `<span class="tag${hit ? " hit" : ""}">${esc(label)}</span>`;
  return `
    <div class="stamp like">LIKE</div>
    <div class="stamp nope">NOPE</div>
    <div class="stamp super">SUPER</div>
    <div class="cover" style="${coverStyle(book)}">
      <span class="pct ${pctClass(pct)}">${pct}% match</span>
      <h2 class="cover-title">${esc(book.title)}</h2>
      <p class="cover-author">${esc(book.author)}</p>
    </div>
    <div class="card-body">
      <p class="meta">${book.year} · ${book.pages} pages · ${esc(book.pace)}-paced</p>
      <div class="tags">
        ${book.genres.map((g) => tag(GENRES[g], (w.genre[g] || 0) > 0)).join("")}
        ${book.moods.map((m) => tag(MOODS[m], (w.mood[m] || 0) > 0)).join("")}
      </div>
      <p class="blurb">${esc(book.blurb)}</p>
      ${reasons.length ? `<p class="why">You both like: ${esc(reasons.join(", "))}</p>` : ""}
    </div>`;
}

let deck = [];

function renderDeck() {
  deck = buildDeck();
  const el = $("#deck");
  el.innerHTML = "";

  if (!deck.length) {
    el.innerHTML = `
      <div class="empty-deck">
        <h2>You've seen every book!</h2>
        <p class="muted">You matched with ${state.matches.length} of ${BOOKS.length}.</p>
        <button class="primary" id="btn-restart">Start over</button>
      </div>`;
    $("#btn-restart").addEventListener("click", () => {
      state.seen = [];
      state.matches = [];
      finishOnboarding();
    });
    setButtonsEnabled(false);
    return;
  }

  // Render the top two so the next card is visible underneath.
  deck.slice(0, 2).reverse().forEach((book, i, arr) => {
    const card = document.createElement("article");
    card.className = "card" + (i < arr.length - 1 ? " behind" : "");
    card.dataset.id = book.id;
    card.innerHTML = cardHTML(book);
    el.appendChild(card);
  });
  attachDrag(el.lastElementChild);
  setButtonsEnabled(true);
}

function setButtonsEnabled(on) {
  ["#btn-nope", "#btn-like", "#btn-super"].forEach((s) => ($(s).disabled = !on));
}

function topCard() {
  return $("#deck .card:not(.behind):not(.gone)");
}

// ---------- Swiping ----------

let busy = false;

function swipe(direction) {
  const card = topCard();
  if (!card || busy) return;
  busy = true;

  const book = bookById(Number(card.dataset.id));
  const pct = matchPercent(book); // capture before learning changes it

  const out = { like: [1, 0, 25], nope: [-1, 0, -25], super: [0, -1, 0] }[direction];
  card.classList.add("animate", "gone");
  card.style.transform = `translate(${out[0] * 150}vw, ${out[1] * 120}vh) rotate(${out[2]}deg)`;
  card.style.opacity = "0";
  card.querySelector(`.stamp.${direction}`).style.opacity = 1;

  learn(book, SWIPE[direction]);
  state.seen.push(book.id);
  if (direction !== "nope") {
    state.matches.unshift({ id: book.id, pct, super: direction === "super" });
  }
  saveState();
  updateBadge();

  setTimeout(() => {
    busy = false;
    renderDeck();
    if (direction === "super" || (direction === "like" && pct >= MATCH_THRESHOLD)) {
      showMatch(book, pct);
    }
  }, 300);
}

function attachDrag(card) {
  let startX = 0, startY = 0, dx = 0, dy = 0, dragging = false;
  const stamps = {
    like: card.querySelector(".stamp.like"),
    nope: card.querySelector(".stamp.nope"),
    super: card.querySelector(".stamp.super"),
  };

  card.addEventListener("pointerdown", (e) => {
    if (busy) return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    dx = dy = 0;
    card.setPointerCapture(e.pointerId);
    card.classList.add("dragging");
    card.classList.remove("animate");
  });

  card.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    dx = e.clientX - startX;
    dy = e.clientY - startY;
    card.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 18}deg)`;
    stamps.like.style.opacity = Math.max(0, Math.min(1, dx / 100));
    stamps.nope.style.opacity = Math.max(0, Math.min(1, -dx / 100));
    stamps.super.style.opacity = Math.abs(dx) < 60 ? Math.max(0, Math.min(1, -dy / 120)) : 0;
  });

  const end = () => {
    if (!dragging) return;
    dragging = false;
    card.classList.remove("dragging");
    const w = card.offsetWidth;
    if (dx > w * 0.3) return swipe("like");
    if (dx < -w * 0.3) return swipe("nope");
    if (dy < -140 && Math.abs(dx) < 80) return swipe("super");
    // A tap (barely moved) opens details; otherwise snap back.
    if (Math.abs(dx) < 5 && Math.abs(dy) < 5) openDetail(bookById(Number(card.dataset.id)));
    card.classList.add("animate");
    card.style.transform = "";
    Object.values(stamps).forEach((s) => (s.style.opacity = 0));
  };
  card.addEventListener("pointerup", end);
  card.addEventListener("pointercancel", end);
}

// ---------- Overlays ----------

function showMatch(book, pct) {
  $("#overlay-cover").style.cssText = coverStyle(book);
  $("#overlay-pct").textContent = `${pct}% match`;
  $("#overlay-title").textContent = `${book.title} by ${book.author}`;
  $("#match-overlay").hidden = false;
  $("#btn-keep-swiping").focus();
}

function openDetail(book) {
  const pct = matchPercent(book);
  const w = state.weights;
  const part = (tags, weights) => Math.round(((groupScore(tags, weights) + 1) / 2) * 100);
  const bars = [
    ["Genre", part(book.genres, w.genre)],
    ["Mood", part(book.moods, w.mood)],
    ["Pace", part([book.pace], w.pace)],
  ];
  $("#detail-body").innerHTML = `
    <div class="overlay-cover" style="${coverStyle(book)}; margin: 0 0 16px;"></div>
    <h3>${esc(book.title)}</h3>
    <p class="muted" style="margin:4px 0 0">${esc(book.author)} · ${book.year} · ${book.pages} pages</p>
    <p class="blurb">${esc(book.blurb)}</p>
    <p style="font-weight:800;color:var(--accent);margin:0 0 10px">${pct}% overall match</p>
    ${bars.map(([label, v]) => `
      <div class="bar-label"><span>${label}</span><span>${v}%</span></div>
      <div class="bar"><div style="width:${v}%"></div></div>`).join("")}
    <button class="primary" id="btn-close-detail">Close</button>`;
  $("#detail-overlay").hidden = false;
  $("#btn-close-detail").addEventListener("click", closeDetail);
}

function closeDetail() {
  $("#detail-overlay").hidden = true;
}

// ---------- Matches ----------

function renderMatches() {
  const list = $("#match-list");
  list.innerHTML = "";
  $("#matches-empty").hidden = state.matches.length > 0;

  for (const m of state.matches) {
    const book = bookById(m.id);
    const li = document.createElement("li");
    li.className = "match-item";
    li.innerHTML = `
      <div class="mini-cover" style="${coverStyle(book)}"></div>
      <div class="match-info">
        <strong>${esc(book.title)}${m.super ? '<span class="super-star" title="Super liked">★</span>' : ""}</strong>
        <small>${esc(book.author)}</small>
      </div>
      <span class="match-pct">${m.pct}%</span>
      <button class="remove" aria-label="Unmatch ${esc(book.title)}" title="Unmatch">✕</button>`;
    li.addEventListener("click", (e) => {
      if (e.target.closest(".remove")) {
        state.matches = state.matches.filter((x) => x.id !== m.id);
        saveState();
        updateBadge();
        renderMatches();
      } else {
        openDetail(book);
      }
    });
    list.appendChild(li);
  }
}

function updateBadge() {
  const n = state.matches.length;
  $("#match-count").hidden = n === 0;
  $("#match-count").textContent = n;
}

// ---------- Wiring ----------

$("#btn-start").addEventListener("click", finishOnboarding);
$("#btn-like").addEventListener("click", () => swipe("like"));
$("#btn-nope").addEventListener("click", () => swipe("nope"));
$("#btn-super").addEventListener("click", () => swipe("super"));
$("#btn-matches").addEventListener("click", () => state.onboarded && show("matches"));
$("#btn-back").addEventListener("click", () => show("swipe"));
$("#btn-profile").addEventListener("click", () => {
  renderOnboarding();
  show("onboarding");
});
$("#btn-keep-swiping").addEventListener("click", () => ($("#match-overlay").hidden = true));
$("#detail-overlay").addEventListener("click", (e) => e.target === e.currentTarget && closeDetail());

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    $("#match-overlay").hidden = true;
    closeDetail();
    return;
  }
  const overlayOpen = !$("#match-overlay").hidden || !$("#detail-overlay").hidden;
  if (overlayOpen || $("#view-swipe").hidden) return;
  if (e.key === "ArrowRight") swipe("like");
  if (e.key === "ArrowLeft") swipe("nope");
  if (e.key === "ArrowUp") { e.preventDefault(); swipe("super"); }
});

updateBadge();
if (state.onboarded) {
  show("swipe");
} else {
  renderOnboarding();
  show("onboarding");
}
