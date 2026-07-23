(function () {
  const GRID = 5;
  const TOTAL = GRID * GRID;
  const TARGET_TOTAL = 4;
  const PURPLES_BEFORE_RED = 3;
  const MAX_CLICKS = 7;
  const INITIAL_MOVES = [6, 16, 8, 18];
  const COLORS = [
    "blue",
    "teal",
    "green",
    "yellow",
    "orange",
    "purple",
    "red",
  ];
  const CLUE_VALUES = {
    blue: 0,
    teal: 1,
    green: 2,
    yellow: 3,
    orange: 4,
  };

  const EMOJI_IDS = {
    blue: "1437140639987929108",
    teal: "1437140651614535680",
    green: "1437140664193126441",
    yellow: "1437140677187338310",
    orange: "1437140688608432185",
    purple: "1437140625844867244",
    red: "1437140700604137554",
  };

  const NEIGHBORS = (() => {
    const neighbors = {};
    for (let position = 0; position < TOTAL; position++) {
      const row = Math.floor(position / GRID);
      const column = position % GRID;
      neighbors[position] = [];
      for (let rowOffset = -1; rowOffset <= 1; rowOffset++) {
        for (let columnOffset = -1; columnOffset <= 1; columnOffset++) {
          if (rowOffset === 0 && columnOffset === 0) continue;
          const neighborRow = row + rowOffset;
          const neighborColumn = column + columnOffset;
          if (
            neighborRow >= 0 &&
            neighborRow < GRID &&
            neighborColumn >= 0 &&
            neighborColumn < GRID
          ) {
            neighbors[position].push(
              neighborRow * GRID + neighborColumn,
            );
          }
        }
      }
    }
    return neighbors;
  })();

  const grid = document.getElementById("oq-grid");
  const statusEl = document.getElementById("oq-status");
  const revealed = {};
  let useEmoji = false;
  let cachedState = "";
  let cachedAnalysis = null;

  function resetGrid() {
    for (const position of Object.keys(revealed)) delete revealed[position];
    renderGrid();
  }

  window.renderOQGrid = renderGrid;
  window.oqReset = resetGrid;

  function stateKey() {
    return Object.entries(revealed)
      .sort(([left], [right]) => Number(left) - Number(right))
      .map(([position, color]) => `${position}:${color}`)
      .join("|");
  }

  function choose(items, count, callback, start = 0, selected = []) {
    if (count === 0) {
      callback(selected);
      return;
    }
    for (let index = start; index <= items.length - count; index++) {
      selected.push(items[index]);
      choose(items, count - 1, callback, index + 1, selected);
      selected.pop();
    }
  }

  function matchesClues(layout, clues) {
    return clues.every(([position, value]) => {
      const neighboringTargets = NEIGHBORS[position].filter((neighbor) =>
        layout.has(neighbor),
      ).length;
      return neighboringTargets === value;
    });
  }

  function analyze() {
    const key = stateKey();
    if (key === cachedState && cachedAnalysis) return cachedAnalysis;

    const purples = new Set();
    const reds = new Set();
    const targets = new Set();
    const clues = [];

    for (const [rawPosition, color] of Object.entries(revealed)) {
      const position = Number(rawPosition);
      if (color === "purple" || color === "red") {
        targets.add(position);
        if (color === "purple") purples.add(position);
        else reds.add(position);
      } else if (color in CLUE_VALUES) {
        clues.push([position, CLUE_VALUES[color]]);
      }
    }

    const unknown = [];
    const candidates = [];
    for (let position = 0; position < TOTAL; position++) {
      if (!(position in revealed)) unknown.push(position);
      if (!(position in revealed)) candidates.push(position);
    }

    const layouts = [];
    const remainingTargets = TARGET_TOTAL - targets.size;
    let invalidReason = "";

    if (reds.size > 1) {
      invalidReason = "Only one red sphere can be revealed.";
    } else if (remainingTargets < 0) {
      invalidReason = `The board contains more than ${TARGET_TOTAL} targets.`;
    } else if (remainingTargets > candidates.length) {
      invalidReason = "There are not enough cells left for four targets.";
    } else {
      choose(candidates, remainingTargets, (selected) => {
        const layout = new Set([...targets, ...selected]);
        if (matchesClues(layout, clues)) layouts.push(layout);
      });
      if (layouts.length === 0) {
        invalidReason = "No four-target layout matches the entered clues.";
      }
    }

    const safe = new Set();
    const mustBe = new Set();
    const targetFrequency = new Map();

    if (!invalidReason) {
      for (const position of unknown) {
        let occurrences = 0;
        for (const layout of layouts) {
          if (layout.has(position)) occurrences++;
        }
        targetFrequency.set(position, occurrences);
        if (occurrences === 0) safe.add(position);
        else if (occurrences === layouts.length) mustBe.add(position);
      }
    }

    cachedState = key;
    cachedAnalysis = {
      invalidReason,
      layouts,
      mustBe,
      purples,
      reds,
      safe,
      targetFrequency,
      targets,
      unknown,
    };
    return cachedAnalysis;
  }

  function clicksUsed() {
    return Object.values(revealed).filter((color) => color !== "red").length;
  }

  function outcomeFor(layout, position) {
    if (layout.has(position)) return "target";
    return String(
      NEIGHBORS[position].filter((neighbor) => layout.has(neighbor)).length,
    );
  }

  function certainColor(analysis, position) {
    if (analysis.invalidReason || analysis.layouts.length === 0) return null;

    let certainOutcome = null;
    for (const layout of analysis.layouts) {
      const outcome = outcomeFor(layout, position);
      if (certainOutcome === null) certainOutcome = outcome;
      else if (outcome !== certainOutcome) return null;
    }

    if (certainOutcome === "target") return "purple";
    return COLORS[Number(certainOutcome)] || null;
  }

  function bestClicks(analysis) {
    if (
      analysis.invalidReason ||
      analysis.targets.size >= TARGET_TOTAL ||
      analysis.reds.size > 0 ||
      analysis.purples.size >= PURPLES_BEFORE_RED ||
      clicksUsed() >= MAX_CLICKS ||
      analysis.layouts.length === 0
    ) {
      return [];
    }

    if (analysis.mustBe.size > 0) {
      return [...analysis.mustBe]
        .sort(
          (left, right) =>
            NEIGHBORS[right].length - NEIGHBORS[left].length || left - right,
        )
        .slice(0, 4);
    }

    const layoutCount = analysis.layouts.length;
    let bestScore = Number.NEGATIVE_INFINITY;
    const ranked = [];

    for (const position of analysis.unknown) {
      const outcomes = new Map();
      for (const layout of analysis.layouts) {
        const outcome = outcomeFor(layout, position);
        outcomes.set(outcome, (outcomes.get(outcome) || 0) + 1);
      }

      let entropy = 0;
      for (const count of outcomes.values()) {
        const probability = count / layoutCount;
        entropy -= probability * Math.log2(probability);
      }

      const targetChance =
        (analysis.targetFrequency.get(position) || 0) / layoutCount;
      const score = entropy + targetChance * 1.5;
      ranked.push({ entropy, position, score, targetChance });
      bestScore = Math.max(bestScore, score);
    }

    const tied = ranked.filter(
      ({ score }) => Math.abs(score - bestScore) <= 1e-9,
    );
    const bestTargetChance = Math.max(
      ...tied.map(({ targetChance }) => targetChance),
    );
    return tied
      .filter(
        ({ targetChance }) =>
          Math.abs(targetChance - bestTargetChance) <= 1e-9,
      )
      .sort(
        (left, right) =>
          right.entropy - left.entropy || left.position - right.position,
      )
      .slice(0, 4)
      .map(({ position }) => position);
  }

  function renderGrid() {
    const analysis = analyze();
    const opening = Object.keys(revealed).length === 0;
    const recommendedPositions = opening ? INITIAL_MOVES : bestClicks(analysis);
    const recommendations = new Set(recommendedPositions);
    const waitingForRed =
      analysis.purples.size === PURPLES_BEFORE_RED &&
      analysis.targets.size < TARGET_TOTAL &&
      analysis.reds.size === 0;

    grid.innerHTML = "";
    grid.classList.toggle("oq-grid-emoji", useEmoji);

    for (let position = 0; position < TOTAL; position++) {
      const button = document.createElement("button");
      const row = Math.floor(position / GRID) + 1;
      const column = (position % GRID) + 1;
      button.className = "oq-cell";

      if (position in revealed) {
        const color = revealed[position];
        button.dataset.color = color;
        button.setAttribute(
          "aria-label",
          `Row ${row}, column ${column}: ${color}`,
        );
        if (useEmoji && EMOJI_IDS[color]) {
          button.style.setProperty(
            "--emoji",
            `url(https://cdn.discordapp.com/emojis/${EMOJI_IDS[color]}.png)`,
          );
        }
      } else {
        button.setAttribute(
          "aria-label",
          `Row ${row}, column ${column}: unrevealed`,
        );
        if (analysis.safe.has(position)) button.classList.add("safe");
        if (analysis.mustBe.has(position)) button.classList.add("purple-hint");
        if (recommendations.has(position)) button.classList.add("best");
      }

      button.addEventListener("click", () => {
        if (waitingForRed && !(position in revealed)) {
          revealed[position] = "red";
        } else if (position in revealed) {
          const index = COLORS.indexOf(revealed[position]);
          if (index === COLORS.length - 1 || index === -1) {
            delete revealed[position];
          } else {
            revealed[position] = COLORS[index + 1];
          }
        } else {
          revealed[position] = certainColor(analysis, position) || "blue";
        }
        renderGrid();
      });
      grid.appendChild(button);
    }

    updateStatus(analysis, recommendedPositions, opening);
  }

  function updateStatus(analysis, recommendations, opening) {
    const found = analysis.targets.size;
    const used = clicksUsed();
    let text = `${found}/${TARGET_TOTAL} targets found \u00b7 ${used}/${MAX_CLICKS} clicks used`;

    if (analysis.invalidReason) {
      text += ` \u00b7 ${analysis.invalidReason}`;
    } else if (found >= TARGET_TOTAL) {
      text += " \u00b7 all four found!";
    } else if (analysis.reds.size > 0) {
      text += " \u00b7 red found, record the remaining visible purples";
    } else if (analysis.purples.size >= PURPLES_BEFORE_RED) {
      text += " \u00b7 select the red sphere revealed by the command";
    } else if (used >= MAX_CLICKS) {
      text += " \u00b7 click limit reached";
    } else if (opening) {
      text += " \u00b7 four recommended opening cells";
    } else if (analysis.mustBe.size > 0) {
      text += ` \u00b7 ${analysis.mustBe.size} guaranteed purple`;
    } else if (recommendations.length > 0) {
      const recommendation = recommendations[0];
      const chance = Math.round(
        ((analysis.targetFrequency.get(recommendation) || 0) /
          analysis.layouts.length) *
          100,
      );
      text +=
        recommendations.length === 1
          ? ` \u00b7 recommended cell has a ${chance}% target chance`
          : ` \u00b7 ${recommendations.length} equally ranked cells have a ${chance}% target chance`;
    }

    if (!analysis.invalidReason && found < TARGET_TOTAL) {
      text += ` \u00b7 ${analysis.layouts.length.toLocaleString()} possible layout${analysis.layouts.length === 1 ? "" : "s"}`;
    }
    statusEl.textContent = text;
  }

  document.getElementById("oq-reset").addEventListener("click", resetGrid);

  document.getElementById("oq-emoji-toggle").addEventListener("click", () => {
    useEmoji = !useEmoji;
    document.getElementById("oq-emoji-toggle").textContent = useEmoji
      ? "Show Letters"
      : "Show Emojis";
    renderGrid();
  });

  renderGrid();
})();
