const FISHIE_API = "https://api.crygup.com/fishie";
const CLIENT_ID = "876391494485950504";
const content = document.getElementById("tab-content");
const tabs = document.querySelectorAll("#fishie-tabs .tab-btn[data-tab]");

tabs.forEach(btn => {
  btn.addEventListener("click", () => {
    tabs.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    loadTab(btn.dataset.tab);
  });
});

async function loadTab(tab) {
  if (tab === "about") renderAbout();
  else if (tab === "stats") await renderStats();
  else if (tab === "commands") await renderCommands();
  else if (tab === "privacy") await renderPrivacy();
  else if (tab === "terms") await renderTerms();
}

function renderAbout() {
  content.innerHTML = `
    <div class="fishie-card">
      <p class="fishie-desc">Avatar tracking, leveling, mudae help, poketwo help & more.</p>
      <div class="fishie-links">
        <a class="fishie-btn" href="https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&scope=bot+applications.commands&permissions=138513074240" target="_blank">Invite to Server</a>
        <a class="fishie-btn" href="https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}" target="_blank">Add to User Apps</a>
        <a class="fishie-btn" href="https://discord.gg/rM9u4MRFBE" target="_blank">Join Discord</a>
      </div>
    </div>`;
}

async function renderStats() {
  content.innerHTML = '<p class="fishie-loading">Loading…</p>';
  try {
    const res = await fetch(`${FISHIE_API}/stats`);
    const data = await res.json();
    content.innerHTML = `
      <div class="fishie-card">
        <div class="fishie-stats">
          <div class="stat"><span class="stat-value">${(data.guilds || 0).toLocaleString()}</span><span class="stat-label">Servers</span></div>
          <div class="stat"><span class="stat-value">${(data.users || 0).toLocaleString()}</span><span class="stat-label">Users</span></div>
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
  } catch { content.innerHTML = '<p class="fishie-loading">Failed to load stats.</p>'; }
}


async function renderCommands() {
  content.innerHTML = '<p class="fishie-loading">Loading…</p>';
  try {
    const res = await fetch(`${FISHIE_API}/commands`);
    const data = await res.json();
    const allCmds = data.commands;
    const cats = {};
    for (const cmd of allCmds) {
      const cat = cmd.category || "Other";
      if (!cats[cat]) cats[cat] = [];
      cats[cat].push(cmd);
    }
    const catNames = Object.keys(cats).sort((a, b) => cats[b].length - cats[a].length);
    
    let html = '<div class="fishie-commands">';
    html += `<div style="display:flex;gap:0.4rem;align-items:center;justify-content:center;margin:0 auto 1rem;max-width:400px;width:100%">
      <input type="search" id="cmd-search" placeholder="Search commands..." autocomplete="off" style="flex:1;padding:0.45rem 0.7rem;background:#1a1c1f;border:none;border-radius:0.3rem;color:#ddd;font-size:0.85rem;outline:none">
      <div style="position:relative">
        <img src="images/filter.svg" alt="Filter" id="cmd-filter-btn" style="width:30px;height:30px;cursor:pointer;opacity:0.6;filter:brightness(0) invert(1);transition:opacity 0.15s;padding:0.4rem" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.6">
        <div id="cmd-filter-dropdown" style="display:none;position:absolute;top:100%;right:0;background:#1a1c1f;padding:0.4rem;z-index:100;min-width:140px">
          <label style="display:flex;align-items:center;gap:0.3rem;padding:0.25rem 0;cursor:pointer;font-size:0.78rem;color:#94a3b8"><input type="checkbox" value="slash" class="cmd-check"> Slash only</label>
          <label style="display:flex;align-items:center;gap:0.3rem;padding:0.25rem 0;cursor:pointer;font-size:0.78rem;color:#94a3b8"><input type="checkbox" value="text" class="cmd-check"> Text only</label>
        </div>
      </div>
    </div>`;
    html += `<div class="cmd-tabs">`;
    for (const cat of catNames) {
      html += `<button class="cmd-tab${cat === catNames[0] ? ' active' : ''}" data-cat="${escapeHtml(cat)}">${escapeHtml(cat)} (${cats[cat].length})</button>`;
    }
    html += '</div>';
    for (const cat of catNames) {
      cats[cat].sort((a, b) => a.name.localeCompare(b.name));
      html += `<div class="cmd-panel${cat === catNames[0] ? ' active' : ''}" data-cat="${escapeHtml(cat)}"><div class="cmd-grid">`;
      for (const c of cats[cat]) {
        html += renderCmdCard(c);
      }
      html += '</div></div>';
    }
    html += '</div>';
    content.innerHTML = html;
    
    content.querySelectorAll(".cmd-tab").forEach(btn => {
      btn.addEventListener("click", () => {
        content.querySelectorAll(".cmd-tab").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        content.querySelectorAll(".cmd-panel").forEach(p => p.classList.remove("active"));
        const panel = content.querySelector(`.cmd-panel[data-cat="${btn.dataset.cat}"]`);
        if (panel) panel.classList.add("active");
      });
    });
    
    const filterBtn = document.getElementById("cmd-filter-btn");
    const filterDropdown = document.getElementById("cmd-filter-dropdown");
    filterBtn.onclick = (e) => {
      e.preventDefault();
      filterDropdown.style.display = filterDropdown.style.display === "none" ? "block" : "none";
    };
    document.addEventListener("click", (e) => {
      if (!filterBtn.contains(e.target) && !filterDropdown.contains(e.target)) {
        filterDropdown.style.display = "none";
      }
      const copyBtn = e.target.closest(".cmd-copy");
      if (copyBtn) {
        const text = copyBtn.dataset.copy;
        if (text) {
          navigator.clipboard.writeText(text).then(() => {
            copyBtn.classList.add("copied");
            setTimeout(() => copyBtn.classList.remove("copied"), 1200);
          }).catch(() => {});
        }
      }
    });
    
    const searchInput = document.getElementById("cmd-search");
    filterDropdown.addEventListener("change", () => filterCmds());
    searchInput.addEventListener("input", () => filterCmds());
    
    function getActiveFilters() {
      const active = new Set();
      filterDropdown.querySelectorAll(".cmd-check:checked").forEach(cb => active.add(cb.value));
      return active;
    }
    
    function filterCmds() {
      const q = searchInput.value.toLowerCase().trim();
      const activeFilters = getActiveFilters();
      const hasType = activeFilters.has("slash") || activeFilters.has("text");      const container = content.querySelector(".cmd-tabs").parentNode;
      const oldResults = container.querySelector(".cmd-search-results");
      const panels = content.querySelectorAll(".cmd-panel");
      const tabs = content.querySelectorAll(".cmd-tab");
      if (!q) {
        panels.forEach(p => { p.style.display = ""; });
        tabs.forEach(t => { t.style.display = ""; });
        panels.forEach(p => p.classList.remove("active"));
        tabs.forEach(t => t.classList.remove("active"));
        tabs[0].classList.add("active");
        panels[0].classList.add("active");
        if (oldResults) oldResults.remove();
        content.querySelectorAll(".cmd-card").forEach(c => {
          const isHybrid = c.dataset.aliases && c.dataset.aliases.trim().length > 0;
          if (activeFilters.size === 0) { c.style.display = ""; return; }
          if (hasType) {
            const tMatch = (activeFilters.has("slash") && !isHybrid) || (activeFilters.has("text") && isHybrid);
            if (!tMatch) { c.style.display = "none"; return; }
          }
          c.style.display = "";
        });
        content.querySelectorAll(".cmd-tab").forEach(tab => {
          const cat = tab.dataset.cat;
          const cmds = cats[cat] || [];
          const count = cmds.filter(c => {
            if (hasType) {
              const h = c.aliases && c.aliases.trim().length > 0;

              if (activeFilters.has("slash") && h) return false;
              if (activeFilters.has("text") && !h) return false;
            }

            return true;
          }).length;
          tab.textContent = `${cat} (${count})`;
        });
      } else {
        tabs.forEach(t => t.style.display = "none");
        panels.forEach(p => { p.style.display = "none"; p.classList.remove("active"); });
        if (oldResults) oldResults.remove();
        let matchHtml = '<div class="cmd-search-results"><div class="cmd-grid">';
        for (const cmd of allCmds) {
          const name = cmd.name.toLowerCase();
          const aliases = (cmd.aliases || "").toLowerCase();
          const isHybrid = cmd.aliases && cmd.aliases.trim().length > 0;
          let tMatch2 = !hasType;
          if (hasType) tMatch2 = (activeFilters.has("slash") && !isHybrid) || (activeFilters.has("text") && isHybrid);
          if ((name.includes(q) || aliases.includes(q)) && tMatch2) {
            matchHtml += renderCmdCard(cmd);
          }
        }
        matchHtml += '</div></div>';
        container.insertAdjacentHTML("beforeend", matchHtml);
      }
    }
  } catch { content.innerHTML = '<p class="fishie-loading">Failed to load commands.</p>'; }
}

function renderCmdCard(c) {
  const isHybrid = c.aliases && c.aliases.trim().length > 0;
  const copyText = isHybrid ? "fish " + escapeHtml(c.name) : "/" + escapeHtml(c.name);
  const hasParams = c.params && c.params.length;
  let paramText = "";
  if (hasParams) {
    paramText = '<span class="cmd-arg-title">Arguments</span>';
    paramText += c.params.filter(p => p.name).map(p => {
      const bracket = p.required === "required" ? "&lt;" : "[";
      const close = p.required === "required" ? "&gt;" : "]";
      let text = bracket + escapeHtml(p.name) + close;
      if (p.default || p.default_value) text += " (default: " + escapeHtml(String(p.default || p.default_value)) + ")";
      return '<span class="cmd-arg">' + text + '</span>';
    }).join(" ");
  }
  const esc = escapeHtml;
  return '<div class="cmd-card" data-cmd="' + esc(c.name) + '" data-aliases="' + esc(c.aliases || "") + '">'
    + '<div class="cmd-head">'
    + '<span class="cmd-name" title="' + esc(c.name) + '">' + esc(c.name) + '</span>'
    + '<button class="cmd-copy" data-copy="' + copyText + '" title="Copy"><img src="images/copy-icon.svg" alt="" class="cmd-copy-icon"></button>'
    + '</div>'
    + '<div class="cmd-body">'
    + '<div class="cmd-desc">' + (esc(c.description) || "No description yet...") + '</div>'
    + (hasParams ? '<div class="cmd-params">' + paramText + '</div>' : "")
    + '</div>'
    + '</div>';
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
  content.innerHTML = '<p class="fishie-loading">Loading…</p>';
  try {
    const res = await fetch(PRIVACY_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const md = await res.text();
    content.innerHTML = `<div class="policy-content">${renderMarkdown(md)}</div>`;
  } catch {
    content.innerHTML = '<p class="fishie-loading">Failed to load privacy policy.</p>';
  }
}

async function renderTerms() {
  content.innerHTML = '<p class="fishie-loading">Loading…</p>';
  try {
    const res = await fetch(TERMS_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const md = await res.text();
    content.innerHTML = `<div class="policy-content">${renderMarkdown(md)}</div>`;
  } catch {
    content.innerHTML = '<p class="fishie-loading">Failed to load terms of service.</p>';
  }
}

const qp = new URLSearchParams(window.location.search);
const initialTab = qp.get("tab");
if (initialTab && document.querySelector(`#fishie-tabs [data-tab="${initialTab}"]`)) {
  document.querySelectorAll("#fishie-tabs .tab-btn").forEach(b => b.classList.remove("active"));
  document.querySelector(`#fishie-tabs [data-tab="${initialTab}"]`).classList.add("active");
  loadTab(initialTab);
} else {
  loadTab("about");
}

let tooltip = null;
document.addEventListener("mouseover", e => {
  const el = e.target.closest(".cmd-hover");
  if (!el || !el.dataset.tip) return;
  if (!tooltip) { tooltip = document.createElement("div"); tooltip.className = "fishie-tooltip"; document.body.appendChild(tooltip); }
  tooltip.textContent = el.dataset.tip;
  tooltip.style.display = "block";
  tooltip.style.left = Math.min(e.clientX + 12, window.innerWidth - 260) + "px";
  tooltip.style.top = (e.clientY + 12) + "px";
});
document.addEventListener("mouseout", e => {
  if (e.target.closest(".cmd-hover")) { if (tooltip) tooltip.style.display = "none"; }
});
