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
      <h2>Fishie</h2>
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
    const cats = {};
    for (const cmd of data.commands) {
      const cat = cmd.category || "Other";
      if (!cats[cat]) cats[cat] = [];
      cats[cat].push(cmd);
    }
    let html = '<div class="fishie-commands">';
    for (const [cat, cmds] of Object.entries(cats)) {
      for (const c of cmds) {
        const hasParams = c.params && c.params.length;
        const paramText = hasParams ? `<span class="cmd-params">${c.params.map(p => `${escapeHtml(p.name)} (${p.required})`).join(", ")}</span>` : "";
        html += `<div class="cmd-item"><span class="cmd-name cmd-hover" data-tip="${c.aliases ? 'Aliases: ' + escapeHtml(c.aliases) : ''}">${escapeHtml(c.name)}</span><span class="cmd-desc cmd-hover" data-tip="${escapeHtml(c.description)}">${escapeHtml(c.description)}</span></div>`;
      }
      html += '</div>';
    }
    html += '</div>';
    content.innerHTML = html;
  } catch { content.innerHTML = '<p class="fishie-loading">Failed to load commands.</p>'; }
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
