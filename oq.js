(function(){
window.renderOQGrid = renderGrid;
window.oqReset = function(){ for(const k of Object.keys(revealed)) delete revealed[k]; purples.clear(); renderGrid(); };
const GRID = 5;
const TOTAL = GRID * GRID;
const COLORS = ["blue", "teal", "green", "yellow", "orange", "purple"];
const INITIAL_MOVES = [6, 16, 8, 18];

const EMOJI_IDS = {
  blue: "1437140639987929108", teal: "1437140651614535680",
  green: "1437140664193126441", yellow: "1437140677187338310",
  orange: "1437140688608432185", purple: "1437140700604137554",
  red: "1437140700604137554",
};

const NEIGHBORS = (() => {
  const n = {};
  for (let i = 0; i < TOTAL; i++) {
    const r = Math.floor(i / GRID), c = i % GRID;
    n[i] = [];
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < GRID && nc >= 0 && nc < GRID) n[i].push(nr * GRID + nc);
      }
  }
  return n;
})();

const grid = document.getElementById("oq-grid");
const statusEl = document.getElementById("oq-status");
const revealed = {};
let useEmoji = false;
const GOAL = 3;

function solve() {
  const purples = new Set();
  for (const [pos, color] of Object.entries(revealed)) {
    if (color === "purple") purples.add(Number(pos));
  }
  const unknown = new Set();
  for (let i = 0; i < TOTAL; i++) {
    if (!(i in revealed)) unknown.add(i);
  }
  const safe = new Set();
  const mustBe = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [pos, color] of Object.entries(revealed)) {
      const p = Number(pos);
      if (color === "purple" || color === "red") continue;
      const num = {blue:0,teal:1,green:2,yellow:3,orange:4}[color];
      if (num === undefined) continue;
      const unk = NEIGHBORS[p].filter(n => !(n in revealed) && !safe.has(n) && !mustBe.has(n));
      const known = NEIGHBORS[p].filter(n => purples.has(n) || mustBe.has(n)).length;
      if (known === num) { for (const n of unk) { safe.add(n); unknown.delete(n); changed = true; } }
      else if (known + unk.length === num) { for (const n of unk) { mustBe.add(n); unknown.delete(n); changed = true; } }
    }
    const found = purples.size + mustBe.size;
    const rem = GOAL + 1 - found;
    if (rem === 0) { for (const n of unknown) { safe.add(n); changed = true; } unknown.clear(); }
    else if (rem > 0 && unknown.size === rem) { for (const n of unknown) { mustBe.add(n); changed = true; } unknown.clear(); }
  }
  return { safe, mustBe, purples };
}

function bestClicks() {
  const { safe, mustBe } = solve();
  if (mustBe.size > 0) {
    return [...mustBe].sort((a, b) => NEIGHBORS[b].filter(x => x in revealed).length - NEIGHBORS[a].filter(x => x in revealed).length);
  }
  const unrevealed = [];
  for (let i = 0; i < TOTAL; i++) {
    if (!(i in revealed) && !safe.has(i)) unrevealed.push(i);
  }
  const initial = INITIAL_MOVES.filter(p => unrevealed.includes(p));
  if (initial.length > 0) return initial;
  const candidates = unrevealed.filter(p => safe.has(p));
  if (candidates.length) {
    return candidates.sort((a, b) => NEIGHBORS[b].filter(x => x in revealed).length - NEIGHBORS[a].filter(x => x in revealed).length);
  }
  return unrevealed.length > 0 ? [unrevealed[0]] : [];
}

function renderGrid() {
  // Auto-reveal: if we know all 4 purples, mark the 4th as red
  const { mustBe, purples } = solve();
  if (purples.size >= GOAL && mustBe.size === 1) {
    for (const pos of mustBe) {
      if (!(pos in revealed)) revealed[pos] = "red";
    }
  }

  grid.innerHTML = "";
  grid.className = useEmoji ? "oq-grid-emoji" : "";
  const best = new Set(bestClicks());
  const { safe } = solve();
  // Re-solve after potential auto-reveal
  const st = solve();

  for (let i = 0; i < TOTAL; i++) {
    const btn = document.createElement("button");
    btn.className = "oq-cell";
    if (i in revealed) {
      btn.dataset.color = revealed[i];
      if (useEmoji && EMOJI_IDS[revealed[i]]) {
        btn.style.setProperty("--emoji", `url(https://cdn.discordapp.com/emojis/${EMOJI_IDS[revealed[i]]}.png)`);
      }
    } else {
      if (best.has(i)) btn.classList.add("best");
      if (st.safe.has(i) && !best.has(i)) btn.classList.add("safe");
      if (st.mustBe.has(i)) btn.classList.add("purple-hint");
    }
    btn.addEventListener("click", () => {
      if (st.mustBe.has(i)) {
        revealed[i] = "purple";
      } else if (i in revealed) {
        const idx = COLORS.indexOf(revealed[i]);
        if (idx === COLORS.length - 1) delete revealed[i];
        else revealed[i] = COLORS[idx + 1];
      } else {
        revealed[i] = "blue";
      }
      renderGrid();
    });
    grid.appendChild(btn);
  }
  updateStatus();
}

function updateStatus() {
  const { safe, mustBe, purples } = solve();
  const found = purples.size;
  let text = `${found}/${GOAL} purples found`;
  if (found >= GOAL) text += " \u00b7 4th auto-revealed as red!";
  if (mustBe.size > 0) text += ` \u00b7 ${mustBe.size} guaranteed purple`;
  else if (safe.size > 0 && found < GOAL) text += ` \u00b7 ${safe.size} safe`;
  if (found >= GOAL + 1) text += " \u00b7 all purples found!";
  statusEl.textContent = text;
}

document.getElementById("oq-reset").addEventListener("click", () => {
  for (const k of Object.keys(revealed)) delete revealed[k];
  renderGrid();
});

document.getElementById("oq-emoji-toggle").addEventListener("click", () => {
  useEmoji = !useEmoji;
  document.getElementById("oq-emoji-toggle").textContent = useEmoji ? "Show Letters" : "Show Emojis";
  renderGrid();
});


})();