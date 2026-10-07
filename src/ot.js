(function () {
  const grid = document.getElementById("ot-grid");
  const status = document.getElementById("ot-status");
  const palette = document.getElementById("ot-colors");
  const toggle = document.getElementById("ot-emoji-toggle");
  const colors = ["blue", "teal", "green", "yellow", "orange", "light", "purple", "red", "rainbow", "dark", "chaos"];
  const emojis = {
    blue: "1437149292530765825", teal: "1437149302970650624",
    green: "1437149315024949248", yellow: "1437149336730468392",
    orange: "1437149354774495412", light: "1437149400685084783",
    purple: "1437149276160397404", red: "1437140700604137554",
    rainbow: "1437149377754824724",
  };
  let revealed = {}, analysis = null, useEmoji = false;
  let worker = null, timer, revision = 0;
  const buttons = [];

  for (let position = 0; position < 25; position++) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "oq-cell";
    button.addEventListener("click", () => {
      history.before();
      const next = colors.indexOf(revealed[position]) + 1;
      if (next === colors.length) delete revealed[position];
      else revealed[position] = colors[next];
      solve();
      history.save();
    });
    grid.appendChild(button);
    buttons.push(button);
  }

  function render() {
    const blue = Object.values(revealed).filter(color => color === "blue").length;
    const found = Object.keys(revealed).length - blue;
    const total = 10 + 2 * (Number(palette.value) - 4);
    const finished = blue >= 4 || found >= total;
    buttons.forEach((button, position) => {
      const color = revealed[position];
      const recommended = !finished && analysis?.ranked.includes(position);
      button.classList.toggle("best", Boolean(recommended));
      button.classList.toggle("ot-safe", Boolean(analysis?.safe.includes(position)));
      button.classList.toggle("ot-danger", Boolean(analysis?.danger.includes(position)));
      if (color) button.dataset.color = color;
      else delete button.dataset.color;
      button.replaceChildren();
      if (color && useEmoji && emojis[color]) {
        const image = document.createElement("img");
        image.src = `https://cdn.discordapp.com/emojis/${emojis[color]}.png`;
        image.alt = color;
        button.appendChild(image);
      } else if (color) {
        // Unregistered rare artwork stays a letter; never substitute another emoji.
        button.textContent = {light: "L", rainbow: "Rᵂ", dark: "D", chaos: "C"}[color] || color[0].toUpperCase();
      }
      let label = `Row ${Math.floor(position / 5) + 1}, column ${position % 5 + 1}: ${color || "unrevealed"}`;
      if (!color && analysis && position in analysis.probabilities) {
        label += ` · ${analysis.complete ? "" : "estimated "}${(analysis.probabilities[position] * 100).toFixed(1)}% blue chance`;
      }
      if (recommended) label += " · recommended";
      button.setAttribute("aria-label", label);
      button.title = label;
    });
    let text = `${found}/${total} non-blue spheres found · ${blue}/4 clicks used`;
    if (!analysis) text += " · Calculating…";
    else if (!analysis.layouts) text += " · No layout matches these colors. Check your entries and number of colors.";
    else if (blue >= 4) text += " · Click limit reached";
    else if (found >= total) text += " · All non-blue spheres found!";
    else if (analysis.safe.length) text += ` · ${analysis.safe.length} guaranteed safe cells`;
    else if (!analysis.ranked.length) text += " · Only blue spheres remain";
    else text += " · Highlighted cells have the lowest estimated blue risk";
    status.textContent = text;
  }

  function solve() {
    revision++;
    clearTimeout(timer);
    worker?.terminate();
    analysis = null;
    render();
    timer = setTimeout(() => {
      try {
        worker = new Worker("ot-solver.js");
        worker.onmessage = ({data}) => {
          if (data.id !== revision) return;
          analysis = data;
          render();
          worker.terminate();
          worker = null;
        };
        worker.onerror = () => {
          status.textContent = "The OT solver could not load. Reset the grid or refresh to try again.";
          worker?.terminate();
          worker = null;
        };
        worker.postMessage({id: revision, revealed, numberColors: Number(palette.value)});
      } catch {
        status.textContent = "The OT solver could not load. Refresh to try again.";
      }
    }, 120);
  }

  document.getElementById("ot-reset").addEventListener("click", () => {
    history.before();
    revealed = {};
    solve();
    history.save();
  });
  let savedPalette = palette.value;
  palette.addEventListener("change", () => {
    const next = palette.value;
    palette.value = savedPalette;
    history.before();
    palette.value = savedPalette = next;
    solve();
    history.save();
  });
  toggle.addEventListener("click", () => {
    useEmoji = !useEmoji;
    toggle.textContent = useEmoji ? "Show Letters" : "Show Emojis";
    render();
  });
  const history = FishieWeb.solverHistory("ot", () => ({revealed, palette: palette.value}), saved => {
    revealed = {...saved.revealed};
    palette.value = savedPalette = saved.palette;
    solve();
  }, saved => FishieWeb.validGrid(saved.revealed, colors) && [...palette.options].some(option => option.value === saved.palette));
  solve();
})();
