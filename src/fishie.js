const FISHIE_API = "https://api.crygup.com/fishie";
const CLIENT_ID = "1537535633038381190";
const content = document.getElementById("tab-content");
const tabs = [...document.querySelectorAll("#fishie-tabs .tab-btn[data-tab]")];
let tabVersion = 0;
const cached = new Map();
function setQuery(values) {
  const url = new URL(location.href);
  for (const [key, value] of Object.entries(values)) {
    if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
  }
  history.replaceState(null, "", url);
}
async function cachedData(url, text = false) {
  const previous = cached.get(url);
  if (previous && Date.now() - previous.time < 60000) return previous.promise;
  const promise = FishieWeb.fetch(url, {signal: AbortSignal.timeout(15000)}).then(async res => {
    if (!res.ok) throw new Error("Could not load data. Please try again.");
    return text ? res.text() : res.json();
  }).catch(error => { cached.delete(url); throw error; });
  cached.set(url, {time: Date.now(), promise});
  return promise;
}
tabs.forEach(btn => btn.addEventListener("click", () => loadTab(btn.dataset.tab)));
async function loadTab(tab) {
  tabVersion++;
  tabs.forEach(btn => {
    const active = btn.dataset.tab === tab;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", String(active));
  });
  setQuery({tab});
  if (tab === "about") renderAbout();
  else if (tab === "stats") await renderStats();
  else if (tab === "commands") await renderCommands();
  else if (tab === "privacy") await renderPrivacy();
  else if (tab === "terms") await renderTerms();
}
function renderAbout() {
  content.innerHTML = `
    <div class="fishie-card">
      <p class="fishie-desc">Download media, play games, earn Coins, customize your profile, follow streams and anime releases, and manage your saved Discord history.</p>
      <div class="fishie-links">
        <a class="fishie-btn" href="/dashboard">Open Dashboard</a>
        <a class="fishie-btn" href="https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&scope=bot+applications.commands&permissions=138513074240" target="_blank">Invite to Server</a>
        <a class="fishie-btn" href="https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&scope=applications.commands&integration_type=1" target="_blank">Add to User Apps</a>
        <a class="fishie-btn" href="https://discord.gg/rM9u4MRFBE" target="_blank">Join Discord</a>
      </div>
    </div>`;
}

async function renderStats() {
  const version = tabVersion;
  content.innerHTML = '<p class="fishie-loading">Loading…</p>';
  try {
    const data = await cachedData(FISHIE_API + "/stats");
    if (version !== tabVersion) return;
    content.innerHTML = `
      <div class="fishie-card">
        <div class="fishie-stats">
          <div class="stat"><span class="stat-value">${(data.guilds || 0).toLocaleString()}</span><span class="stat-label">Servers</span></div>
          <div class="stat"><span class="stat-value">${(data.users || 0).toLocaleString()}</span><span class="stat-label">Server memberships</span></div>
          <div class="stat"><span class="stat-value">${data.commands}</span><span class="stat-label">Commands</span></div>
          <div class="stat"><span class="stat-value">${formatUptime(data.uptime_seconds)}</span><span class="stat-label">Uptime</span></div>
        </div>
        <div class="fishie-logs">
          ${logCard("Avatars", data.today.avatars, data.totals.avatars)}
          ${logCard("Usernames", data.today.usernames, data.totals.usernames)}
          ${logCard("Nicknames", data.today.nicknames, data.totals.nicknames)}
          ${logCard("Discrims", data.today.discrims, data.totals.discrims)}
          ${logCard("Commands", data.today.commands, data.totals.commands)}
          ${logCard("Guild Names", data.today.guild_names, data.totals.guild_names)}
          ${logCard("Guild Icons", data.today.guild_icons, data.totals.guild_icons)}
          ${logCard("Guild Avatars", data.today.guild_avatars, data.totals.guild_avatars)}
          ${logCard("Member Joins", data.today.member_joins, data.totals.member_joins)}
        </div>
      </div>`;
  } catch { if (version === tabVersion) content.innerHTML = '<p class="fishie-loading">Failed to load stats.</p>'; }
}


const commandState = {category: "", query: ""};
async function renderCommands() {
  const version = tabVersion;
  content.innerHTML = '<p role="status">Loading commands…</p>';
  try {
    const data = await cachedData(FISHIE_API + "/commands");
    if (version !== tabVersion) return;
    const commands = data.commands;
    const searchable = new Map(commands.map(c => [c, [c.name, c.aliases, c.description, ...(c.slash_commands || [])].join(" ").toLowerCase()]));
    const categories = [...new Set(commands.map(c => c.category))].sort();
    const params = new URLSearchParams(location.search);
    commandState.query = params.get("q") || commandState.query;
    commandState.category = params.get("category") || commandState.category;
    const requestedCommand = commands.find(c => c.name === params.get("command"));
    if (requestedCommand) { commandState.category = requestedCommand.category; commandState.query = ""; }
    if (!categories.includes(commandState.category)) commandState.category = categories[0];
    content.innerHTML = '<div class="fishie-commands">' +
      '<div class="command-controls"><label>Search commands<input type="search" id="cmd-search" placeholder="Search a command"></label></div>' +
      '<label class="cmd-category-picker">Category<select id="cmd-category"></select></label><div class="cmd-tabs" aria-label="Command categories"></div><p id="cmd-count" role="status"></p><div id="cmd-results" class="cmd-grid"></div></div>';
    const search = document.getElementById("cmd-search");
    search.value = commandState.query;
    const categoryPicker = document.getElementById("cmd-category");
    const categoryTabs = content.querySelector(".cmd-tabs");
    const counts = new Map(categories.map(category => [category, commands.filter(c => c.category === category).length]));
    categoryPicker.innerHTML = categories.map(category => '<option value="' + escapeHtml(category) + '">' + escapeHtml(category) + ' (' + counts.get(category) + ')</option>').join("");
    categoryTabs.innerHTML = categories.map(category => '<button class="cmd-tab" data-category="' + escapeHtml(category) + '">' + escapeHtml(category) + ' (' + counts.get(category) + ')</button>').join("");
    function render() {
      const state = commandState;
      setQuery({q:state.query, type:"", category:state.category});
      const query = state.query.trim().toLowerCase();
      const filtered = commands.filter(c => query
        ? searchable.get(c).includes(query)
        : c.category === state.category);
      categoryPicker.value = state.category;
      categoryTabs.querySelectorAll("button").forEach(button => {
        const active = button.dataset.category === state.category && !query;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
      });
      document.getElementById("cmd-count").textContent = filtered.length ? filtered.length + " commands" : "No matching commands.";
      document.getElementById("cmd-results").innerHTML = filtered.map(renderCmdCard).join("");
    }
    search.oninput = () => { setQuery({command:""}); commandState.query = search.value; render(); };
    categoryPicker.onchange = () => { setQuery({command:""}); commandState.category = categoryPicker.value; commandState.query = ""; search.value = ""; render(); };
    content.querySelector(".cmd-tabs").onclick = event => {
      const button = event.target.closest("[data-category]");
      if (!button) return;
      setQuery({command:""});
      commandState.category = button.dataset.category;
      commandState.query = ""; search.value = ""; render();
    };
    render();
    if (requestedCommand) {
      const card = document.getElementById("command-" + encodeURIComponent(requestedCommand.name));
      if (card) { const details = card.querySelector("details"); if (details) details.open = true; card.scrollIntoView({block:"center"}); }
    }
  } catch {
    if (version === tabVersion) content.innerHTML = '<p role="status">Could not load commands. Select Commands to retry.</p>';
  }
}
function renderCmdCard(c) {
  const esc = escapeHtml;
  function argumentsHtml(params) {
    return params.map(p => '<li><code>' + (p.syntax ? esc(p.syntax) :
      (p.required === "required" ? '&lt;' : '[') + esc(p.name) +
      (p.required === "required" ? '&gt;' : ']')) + '</code>' +
      (p.default != null ? ' · default: ' + esc(p.default) : '') +
      (p.description ? '<br>' + esc(p.description) : '') + '</li>').join("");
  }
  const textParams = c.params || [], slashParams = c.slash_params || [];
  // Missing metadata isn't a different argument; preserve the fuller description/default.
  const sameParams = textParams.length === slashParams.length && textParams.every((p, i) => {
    const other = slashParams[i];
    return p.name === other.name && p.required === other.required && p.syntax === other.syntax &&
      ["description", "default"].every(key => p[key] == null || p[key] === "" ||
        other[key] == null || other[key] === "" || String(p[key]).trim() === String(other[key]).trim());
  });
  const mergedParams = sameParams ? textParams.map((p, i) => ({...p,
    description: p.description || slashParams[i].description,
    default: p.default == null || p.default === "" ? slashParams[i].default : p.default
  })) : textParams;
  const textArgs = argumentsHtml(mergedParams);
  const slashArgs = sameParams ? textArgs : argumentsHtml(slashParams);
  const argumentsText = textArgs && slashArgs && textArgs !== slashArgs
    ? '<h4>Text arguments</h4><ul>' + textArgs + '</ul><h4>Slash arguments</h4><ul>' + slashArgs + '</ul>'
    : textArgs || slashArgs ? '<h4>Arguments</h4><ul>' + (textArgs || slashArgs) + '</ul>' : '';
  return '<article class="cmd-card" id="command-' + esc(encodeURIComponent(c.name)) + '"><h3 class="cmd-name"><a href="?tab=commands&amp;command=' + esc(encodeURIComponent(c.name)) + '">' +
    (c.slash_commands?.length ? '<span title="Available as a slash command" aria-label="Available as a slash command">[ / ]</span> ' : '') + esc(c.name) + '</a></h3>' +
    '<p class="cmd-desc">' + esc(c.description || "No description available.") + '</p>' +
    (c.permissions?.length ? '<p>Requires: ' + c.permissions.map(esc).join(', ') + '</p>' : '') +
    (argumentsText || c.usage || c.aliases ? '<details><summary>Usage and arguments</summary>' +
      (c.usage && !textParams.some(p => p.syntax === c.usage) ? '<p><code>' + esc(c.usage) + '</code></p>' : '') +
      (c.aliases ? '<p>Aliases: ' + esc(c.aliases) + '</p>' : '') + argumentsText + '</details>' : '') + '</article>';
}

function fmt(n) { return n ? n.toLocaleString() : "0"; }
function logCard(label, today, total) {
  return `<div class="stat-compact"><strong>${label}</strong><span>${fmt(today)} today</span><span>${fmt(total)} all time</span></div>`;
}
function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function formatUptime(s) {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ") || "0m";
}

function renderMarkdown(md) {
  const lines = md.split("\n");
  let html = "";
  let inList = null;
  let inPara = false;

  function closeList() {
    if (inList) { html += `</${inList}>`; inList = null; }
  }
  function closePara() {
    if (inPara) { html += "</p>"; inPara = false; }
  }

  for (const line of lines) {
    let m;
    if ((m = line.match(/^### (.+)/))) {
      closeList(); closePara();
      html += `<h4>${escapeHtml(m[1])}</h4>`;
    } else if ((m = line.match(/^## (.+)/))) {
      closeList(); closePara();
      html += `<h3>${escapeHtml(m[1])}</h3>`;
    } else if ((m = line.match(/^# (.+)/))) {
      closeList(); closePara();
      html += `<h2>${escapeHtml(m[1])}</h2>`;
    } else if ((m = line.match(/^\d+\.\s+(.+)/))) {
      if (inList !== "ol") { closeList(); inList = "ol"; html += "<ol>"; }
      html += `<li>${escapeHtml(m[1])}</li>`;
    } else if ((m = line.match(/^[-*]\s+(.+)/))) {
      if (inList !== "ul") { closeList(); inList = "ul"; html += "<ul>"; }
      html += `<li>${escapeHtml(m[1])}</li>`;
    } else if (line.trim() === "") {
      closeList(); closePara();
    } else {
      closeList();
      if (!inPara) { inPara = true; html += "<p>"; }
      else html += "<br>";
      html += escapeHtml(line);
    }
  }
  closeList(); closePara();
  return html;
}

const PRIVACY_URL = "https://raw.githubusercontent.com/crygup/fish/refs/heads/rewrite/Privacy%20Policy.md";
const TERMS_URL   = "https://raw.githubusercontent.com/crygup/fish/refs/heads/rewrite/Terms%20of%20Service.md";

async function renderPrivacy() {
  const version = tabVersion;
  content.innerHTML = '<p class="fishie-loading">Loading…</p>';
  try {
    const md = await cachedData(PRIVACY_URL, true);
    if (version !== tabVersion) return;
    content.innerHTML = `<div class="policy-content">${renderMarkdown(md)}</div>`;
  } catch {
    if (version !== tabVersion) return;
    content.innerHTML = '<p class="fishie-loading">Failed to load privacy policy.</p>';
  }
}

async function renderTerms() {
  const version = tabVersion;
  content.innerHTML = '<p class="fishie-loading">Loading…</p>';
  try {
    const md = await cachedData(TERMS_URL, true);
    if (version !== tabVersion) return;
    content.innerHTML = `<div class="policy-content">${renderMarkdown(md)}</div>`;
  } catch {
    if (version !== tabVersion) return;
    content.innerHTML = '<p class="fishie-loading">Failed to load terms of service.</p>';
  }
}

const initial = new URLSearchParams(location.search).get("tab");
loadTab(tabs.some(button => button.dataset.tab === initial) ? initial : "about");
document.getElementById("fishie-tabs").setAttribute("role", "tablist");
tabs.forEach(button => {
  button.setAttribute("role", "tab");
  button.setAttribute("aria-controls", "fishie-panel");
  button.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const i = tabs.indexOf(button);
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length-1 :
      (i + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].focus(); tabs[next].click();
  });
});
