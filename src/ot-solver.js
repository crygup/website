// Port of Fishie's sphere.py OT layout search. Run in a worker, off the UI thread.
const COMMON = [["teal", 4], ["green", 3], ["yellow", 3]];
const BOARD_MASK = (1 << 25) - 1;
const LIMIT = 1_000_000;
// The bot's deterministic 10,000-board opening sample, for each palette size.
const OPENINGS = {
  6: [6000,4476,3907,4568,5957,4588,3904,3646,3908,4571,4009,3644,3475,3655,3951,4597,3927,3609,3927,4510,6053,4536,3999,4550,6033],
  7: [5251,3644,3267,3778,5259,3663,3027,2840,3118,3667,3248,2860,2767,2862,3145,3616,3108,2919,3069,3690,5232,3687,3284,3715,5284],
  8: [4402,2831,2488,2769,4447,2787,2324,2106,2298,2838,2454,2237,2069,2246,2502,2630,2331,2165,2302,2773,4450,2830,2464,2773,4484],
  9: [3485,1841,1809,1863,3479,1874,1574,1448,1526,1908,1868,1523,1396,1484,1887,1884,1560,1473,1548,1855,3535,1866,1868,1877,3569],
};

function lineMasks(length) {
  const masks = [];
  for (let row = 0; row < 5; row++) {
    for (let column = 0; column <= 5 - length; column++) {
      let mask = 0;
      for (let offset = 0; offset < length; offset++) mask |= 1 << (row * 5 + column + offset);
      masks.push(mask);
    }
  }
  for (let column = 0; column < 5; column++) {
    for (let row = 0; row <= 5 - length; row++) {
      let mask = 0;
      for (let offset = 0; offset < length; offset++) mask |= 1 << ((row + offset) * 5 + column);
      masks.push(mask);
    }
  }
  return masks;
}
const LINES = {2: lineMasks(2), 3: lineMasks(3), 4: lineMasks(4)};

function statistics(revealed, numberColors) {
  const required = {};
  let blueMask = 0, nonblueMask = 0;
  for (const [position, color] of Object.entries(revealed)) {
    if (color === "blue") blueMask |= 1 << position;
    else {
      required[color] = (required[color] || 0) | (1 << position);
      nonblueMask |= 1 << position;
    }
  }
  const rares = Object.keys(required).filter(color => !COMMON.some(([name]) => name === color)).sort();
  const blueCounts = Array(25).fill(0);
  let layouts = 0, truncated = false;
  if (rares.length > numberColors - 4) return {layouts, blueCounts, complete: true};

  function candidates(color, length, occupied) {
    const mask = required[color] || 0;
    return LINES[length].filter(line =>
      !(line & occupied) && !(line & blueMask) &&
      !(line & (nonblueMask ^ mask)) && (line & mask) === mask);
  }
  function emit(occupied) {
    if (layouts >= LIMIT) { truncated = true; return; }
    layouts++;
    const blue = BOARD_MASK ^ occupied;
    for (let position = 0; position < 25; position++) {
      if (blue & (1 << position)) blueCounts[position]++;
    }
  }
  function unknownRare(start, remaining, occupied) {
    if (truncated) return;
    if (remaining === 0) { emit(occupied); return; }
    if (LINES[2].length - start < remaining) return;
    for (let index = start; index < LINES[2].length; index++) {
      if (truncated) return;
      const mask = LINES[2][index];
      if (mask & (occupied | blueMask | nonblueMask)) continue;
      unknownRare(index + 1, remaining - 1, occupied | mask);
    }
  }
  function knownRare(index, occupied) {
    if (truncated) return;
    if (index === rares.length) {
      unknownRare(0, numberColors - 4 - rares.length, occupied);
      return;
    }
    for (const mask of candidates(rares[index], 2, occupied)) {
      knownRare(index + 1, occupied | mask);
      if (truncated) return;
    }
  }
  function common(index, occupied) {
    if (truncated) return;
    if (index === COMMON.length) { knownRare(0, occupied); return; }
    const [color, length] = COMMON[index];
    for (const mask of candidates(color, length, occupied)) {
      common(index + 1, occupied | mask);
      if (truncated) return;
    }
  }
  common(0, 0);
  return {layouts, blueCounts, complete: !truncated};
}

function analyzeOT(revealed, numberColors) {
  const opening = Object.keys(revealed).length === 0;
  const {layouts, blueCounts, complete} = opening
    ? {layouts: 10000, blueCounts: OPENINGS[numberColors], complete: false}
    : statistics(revealed, numberColors);
  const safe = [], danger = [], probabilities = {};
  if (!layouts) return {safe, danger, ranked: [], probabilities, complete, layouts};
  for (let position = 0; position < 25; position++) {
    if (position in revealed) continue;
    probabilities[position] = blueCounts[position] / layouts;
    if (complete && blueCounts[position] === 0) safe.push(position);
    if (complete && blueCounts[position] === layouts) danger.push(position);
  }
  const candidates = safe.length ? [...safe] : Object.keys(probabilities).map(Number).filter(p => !danger.includes(p));
  if (!candidates.length) return {safe, danger, ranked: [], probabilities, complete, layouts};
  const lowestBlueCount = Math.min(...candidates.map(position => blueCounts[position]));
  const ranked = candidates.filter(position => blueCounts[position] === lowestBlueCount).sort((a, b) => a - b);
  return {safe, danger, ranked, probabilities, complete, layouts};
}

if (typeof module !== "undefined") module.exports = {analyzeOT};
else self.onmessage = ({data}) => {
  self.postMessage({id: data.id, ...analyzeOT(data.revealed, data.numberColors)});
};
