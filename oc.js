(function(){
window.renderOCGrid = renderGrid;
window.ocReset = function(){ for(const k of Object.keys(revealed)) delete revealed[k]; renderGrid(); };
const GRID_SIZE = 5;
const CENTER = 12;
const COLOR_CYCLE = ["blue", "green", "yellow", "orange", "teal", "red"];
const MAX_COUNTS = { orange: 2, yellow: 3, green: 4 };

const EMOJI_IDS = {
  red:    "1437140700604137554",
  blue:   "1437140639987929108",
  teal:   "1437140651614535680",
  green:  "1437140664193126441",
  yellow: "1437140677187338310",
  orange: "1437140688608432185",
};

const toRC = (i) => [Math.floor(i / GRID_SIZE), i % GRID_SIZE];
const sameRow = (a, b) => Math.floor(a / GRID_SIZE) === Math.floor(b / GRID_SIZE);
const sameCol = (a, b) => a % GRID_SIZE === b % GRID_SIZE;
const sameDiag = (a, b) => {
  const [ar, ac] = toRC(a), [br, bc] = toRC(b);
  return Math.abs(ar - br) === Math.abs(ac - bc);
};
const adjacent = (a, b) => {
  const [ar, ac] = toRC(a), [br, bc] = toRC(b);
  return Math.max(Math.abs(ar - br), Math.abs(ac - bc)) === 1;
};

function possibleRedPositions(revealed) {
  let candidates = new Set();
  for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
    if (i !== CENTER) candidates.add(i);
  }

  for (const [pos, color] of Object.entries(revealed)) {
    const p = Number(pos);
    if (color === "red") return new Set([p]);

    let filtered = new Set();
    for (const c of candidates) {
      if (color === "orange" && adjacent(c, p)) filtered.add(c);
      else if (color === "yellow" && sameDiag(c, p) && !adjacent(c, p)) filtered.add(c);
      else if (color === "green" && (sameRow(c, p) || sameCol(c, p)) && !sameDiag(c, p)) filtered.add(c);
      else if (color === "teal" && (sameRow(c, p) || sameCol(c, p) || sameDiag(c, p))) filtered.add(c);
      else if (color === "blue" && !sameRow(c, p) && !sameCol(c, p) && !sameDiag(c, p)) filtered.add(c);
    }
    candidates = filtered;
  }

  for (const p of Object.keys(revealed)) candidates.delete(Number(p));
  return candidates;
}

function bestNextClick(revealed) {
  const remaining = {};
  for (const [color, count] of Object.entries(MAX_COUNTS)) {
    remaining[color] = count - Object.values(revealed).filter(c => c === color).length;
  }

  const allPositions = Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, i) => i);
  const unrevealed = allPositions.filter(p => !(p in revealed) && p !== CENTER);
  if (!unrevealed.length) return null;

  const redPos = Number(Object.entries(revealed).find(([, c]) => c === "red")?.[0]);

  if (redPos !== undefined && !isNaN(redPos)) {
    function score(pos) {
      const adj = adjacent(pos, redPos);
      const diag = sameDiag(pos, redPos);
      const rowcol = sameRow(pos, redPos) || sameCol(pos, redPos);

      if (adj && remaining.orange > 0) return 50;
      if (diag && !adj && remaining.yellow > 0) return 40;
      if (rowcol && !diag && remaining.green > 0) return 30;
      if (rowcol || diag) return 20; // teal
      return 10; // blue
    }
    return unrevealed.reduce((best, p) => score(p) > score(best) ? p : best, unrevealed[0]);
  }

  if (!Object.keys(revealed).length) return 16; // optimal opening

  const candidates = possibleRedPositions(revealed);
  if (!candidates.size) return null;
  if (candidates.size === 1) return [...candidates][0];

  const unrevealedCandidates = unrevealed.filter(p => candidates.has(p));
  if (!unrevealedCandidates.length) return null;

  const possibleColors = ["teal", "blue"];
  for (const [color, count] of Object.entries(remaining)) {
    if (count > 0) possibleColors.push(color);
  }
  if (!Object.values(revealed).includes("red")) possibleColors.push("red");

  let bestPos = null;
  let bestWorst = candidates.size;

  for (const pos of unrevealedCandidates) {
    let maxRemaining = 0;
    for (const testColor of possibleColors) {
      const test = { ...revealed, [pos]: testColor };
      const remainingCount = possibleRedPositions(test).size;
      maxRemaining = Math.max(maxRemaining, remainingCount);
    }
    if (maxRemaining < bestWorst) {
      bestWorst = maxRemaining;
      bestPos = pos;
    }
  }
  return bestPos;
}

const grid = document.getElementById("oc-grid");
const statusEl = document.getElementById("oc-status");
const revealed = {}; // { position: color }
let useEmoji = false;

function renderGrid() {
  grid.innerHTML = "";
  const best = bestNextClick(revealed);
  grid.classList.toggle("oc-grid-emoji", useEmoji);

  for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
    const btn = document.createElement("button");
    btn.className = "oc-cell";
    if (i === best) btn.classList.add("best");
    if (i === CENTER) {
      btn.disabled = true;
      btn.textContent = "\u00D7";
    } else {
      const color = revealed[i];
      if (color) {
        btn.dataset.color = color;
        if (useEmoji && EMOJI_IDS[color]) {
          btn.style.setProperty("--emoji", `url(https://cdn.discordapp.com/emojis/${EMOJI_IDS[color]}.png)`);
        }
      }
      btn.addEventListener("click", () => cycleCell(i));
    }
    grid.appendChild(btn);
  }

  updateStatus();
}

function cycleCell(pos) {
  const current = revealed[pos];
  if (!current) {
    revealed[pos] = COLOR_CYCLE[0];
  } else {
    const idx = COLOR_CYCLE.indexOf(current);
    if (idx === COLOR_CYCLE.length - 1) {
      delete revealed[pos];
    } else {
      revealed[pos] = COLOR_CYCLE[idx + 1];
    }
  }
  renderGrid();
}

function updateStatus() {
  const redPos = Object.entries(revealed).find(([, c]) => c === "red")?.[0];
  const revealedCount = Object.keys(revealed).length;
  let text = `${revealedCount} cell${revealedCount !== 1 ? "s" : ""} revealed`;

  if (redPos !== undefined) {
    text += " · red found!";
    const best = bestNextClick(revealed);
    if (best !== null && revealedCount < 5) {
      const [r, c] = toRC(best);
      text += ` · click row ${r + 1}, col ${c + 1}`;
    }
  } else {
    const candidates = possibleRedPositions(revealed);
    if (candidates.size === 0) {
      text += " · invalid layout, no position satisfies all constraints";
    } else if (candidates.size === 1) {
      const [r, c] = toRC([...candidates][0]);
      text += ` · red must be at row ${r + 1}, col ${c + 1}`;
    } else {
      text += ` · red could be in ${candidates.size} cell${candidates.size !== 1 ? "s" : ""}`;
    }
  }

  statusEl.textContent = text;
}

document.getElementById("oc-reset").addEventListener("click", () => {
  for (const k of Object.keys(revealed)) delete revealed[k];
  renderGrid();
});

document.getElementById("oc-emoji-toggle").addEventListener("click", () => {
  useEmoji = !useEmoji;
  const btn = document.getElementById("oc-emoji-toggle");
  btn.textContent = useEmoji ? "Show Colours" : "Show Emojis";
  renderGrid();
});


})();