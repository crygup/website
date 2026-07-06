const FISHIE_API = "https://api.crygup.com/fishie";
const CLIENT_ID = "876391494485950504";

let currentTab = "avatars";
let currentPage = 1;
let currentQuery = "";
let loggedInUser = JSON.parse(localStorage.getItem("discord_user") || "null");
let accessToken = localStorage.getItem("discord_token") || null;
let currentUserId = null;

const grid = document.getElementById("results-grid");
const pagination = document.getElementById("pagination");
const statusEl = document.getElementById("status");
const input = document.getElementById("search-input");
const loginSection = document.getElementById("login-section");
const tabs = document.querySelectorAll("#discord-tabs .tab-btn");

tabs.forEach(btn => {
  btn.addEventListener("click", () => {
    tabs.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentTab = btn.dataset.tab;
    currentPage = 1;
    updateDeleteAllLabel();
    if (currentQuery) fetchData();
  });
});

function tabLabel() {
  return currentTab === "avatars" ? "Avatars" : currentTab === "usernames" ? "Usernames" : currentTab === "display-names" ? "Display Names" : "Discrims";
}

function renderLogin() {
  if (loggedInUser) {
    loginSection.innerHTML = `<p class="login-status">Logged in as <strong>${escapeHtml(loggedInUser.global_name || loggedInUser.username)}</strong> <button id="logout-btn" class="small-btn">Logout</button> <button id="delete-all-btn" class="small-btn danger" style="display:none">Delete All ${tabLabel()}</button></p>`;
    document.getElementById("logout-btn").addEventListener("click", () => {
      localStorage.removeItem("discord_user"); localStorage.removeItem("discord_token");
      loggedInUser = null; accessToken = null; renderLogin();
    });
    document.getElementById("delete-all-btn").addEventListener("click", deleteAll);
  } else {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (code) { window.history.replaceState({}, "", "/discord"); exchangeCode(code); }
    loginSection.innerHTML = `<a class="small-login-btn" href="https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent("https://crygup.com/discord")}&response_type=code&scope=identify">Login with Discord</a>`;
  }
}

function updateDeleteAllLabel() {
  const btn = document.getElementById("delete-all-btn");
  if (btn) btn.textContent = `Delete All ${tabLabel()}`;
}

async function exchangeCode(code) {
  loginSection.innerHTML = '<p class="login-status">Logging in…</p>';
  try {
    const res = await fetch(`${FISHIE_API}/oauth/exchange?code=${encodeURIComponent(code)}`, { method: "POST" });
    if (!res.ok) throw new Error("Login failed");
    const data = await res.json();
    localStorage.setItem("discord_user", JSON.stringify(data.user));
    localStorage.setItem("discord_token", data.access_token);
    loggedInUser = data.user; accessToken = data.access_token;
    renderLogin();
  } catch { loginSection.innerHTML = '<p class="login-status">Login failed. Refresh to try again.</p>'; }
}

document.getElementById("search-form").addEventListener("submit", e => {
  e.preventDefault();
  currentQuery = input.value.trim();
  currentPage = 1;
  if (currentQuery) fetchData();
});

const ENDPOINTS = {
  avatars: (id, page) => `https://api.crygup.com/avatars?q=${id}&page=${page}&per_page=80`,
  usernames: (id, page) => `${FISHIE_API}/usernames/${id}?page=${page}&per_page=80`,
  "display-names": (id, page) => `${FISHIE_API}/display-names/${id}?page=${page}&per_page=80`,
  discrims: (id, page) => `${FISHIE_API}/discrims/${id}?page=${page}&per_page=80`,
};
const TABLE_MAP = { usernames: "username_logs", "display-names": "display_name_logs", discrims: "discrim_logs", avatars: "avatars" };

const canDelete = () => accessToken && loggedInUser && currentUserId === String(loggedInUser.id);

async function fetchData() {
  grid.innerHTML = "";
  statusEl.textContent = "Loading…";
  pagination.classList.add("hidden");
  try {
    let id = currentQuery;
    if (!/^\d+$/.test(currentQuery)) {
      const r = await fetch(`${FISHIE_API}/resolve?q=${encodeURIComponent(currentQuery)}`);
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.detail || "Could not resolve user"); }
      id = (await r.json()).user_id;
    }
    currentUserId = id;
    const res = await fetch(ENDPOINTS[currentTab](id, currentPage));
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || "Not found"); }
    const data = await res.json();
    if (currentTab === "avatars") renderAvatars(data.avatars);
    else renderTextItems(data.items);
    renderPagination(data.page, data.pages);
    statusEl.textContent = data.total ? `${data.total} found` : "No results.";
    const delBtn = document.getElementById("delete-all-btn");
    if (delBtn) { updateDeleteAllLabel(); delBtn.style.display = canDelete() ? "" : "none"; }
  } catch (err) { statusEl.textContent = err.message; }
}

function renderAvatars(avatars) {
  grid.innerHTML = "";
  grid.className = "avatar-grid";
  for (const av of avatars) {
    const div = document.createElement("div");
    div.className = "avatar-cell";
    const img = document.createElement("img");
    img.src = av.url; img.alt = av.avatar_key; img.loading = "lazy";
    img.onerror = () => { img.src = ""; };
    div.appendChild(img);
    div.addEventListener("click", () => openModal(av));
    grid.appendChild(div);
  }
}

function renderTextItems(items) {
  grid.innerHTML = "";
  grid.className = "";
  if (!items.length) return;
  const list = document.createElement("div");
  list.className = "text-list";
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "text-row";
    const key = item.id || item.value;
    const delBtn = canDelete() ? `<button class="delete-btn" data-key="${escapeHtml(key)}">×</button>` : "";
    row.innerHTML = `${delBtn}<span class="text-value">${escapeHtml(item.value)}</span><span class="text-date">${new Date(item.created_at).toLocaleDateString()}</span>`;
    if (canDelete()) row.querySelector(".delete-btn").addEventListener("click", e => { e.stopPropagation(); deleteItem(TABLE_MAP[currentTab], key); });
    list.appendChild(row);
  }
  grid.appendChild(list);
}

async function deleteItem(table, key) {
  if (!confirm("Delete this entry?")) return;
  try {
    const res = await fetch(`${FISHIE_API}/item/${table}/${currentUserId}?key=${encodeURIComponent(key)}`, { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error("Delete failed");
    closeModal();
    alert("Deleted.");
    fetchData();
  } catch { alert("Delete failed."); }
}

async function deleteAll() {
  const table = TABLE_MAP[currentTab];
  if (!confirm(`Delete ALL your ${tabLabel().toLowerCase()}? This cannot be undone!`)) return;
  if (!confirm("Are you sure? This data will be permanently deleted.")) return;
  try {
    const res = await fetch(`${FISHIE_API}/user/${currentUserId}?table=${table}`, { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error("Delete all failed");
    alert(`${tabLabel()} deleted.`);
    fetchData();
  } catch { alert("Delete failed."); }
}

function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

function renderPagination(page, pages) {
  if (pages <= 1) { pagination.classList.add("hidden"); return; }
  pagination.classList.remove("hidden");
  pagination.innerHTML = `<button ${page<=1?"disabled":""} id="prev-btn">← Prev</button><span>${page} / ${pages}</span><button ${page>=pages?"disabled":""} id="next-btn">Next →</button>`;
  document.getElementById("prev-btn")?.addEventListener("click", () => { currentPage--; fetchData(); });
  document.getElementById("next-btn")?.addEventListener("click", () => { currentPage++; fetchData(); });
}

const modal = document.getElementById("modal");
const modalImg = document.getElementById("modal-img");
const modalKey = document.getElementById("modal-key");
const modalDate = document.getElementById("modal-date");
function openModal(av) {
  modalImg.src = av.url;
  modalKey.innerHTML = `${escapeHtml(av.avatar_key)} ${canDelete() ? `<button class="modal-del" data-key="${escapeHtml(av.avatar_key)}">Delete</button>` : ""}`;
  modalDate.textContent = new Date(av.created_at).toLocaleString("en-US", { year:"numeric", month:"short", day:"numeric", hour:"numeric", minute:"2-digit" });
  if (canDelete()) modalKey.querySelector(".modal-del").addEventListener("click", () => deleteItem("avatars", av.avatar_key));
  modal.classList.remove("hidden");
}
function closeModal() { modal.classList.add("hidden"); modalImg.src = ""; }
document.querySelector(".modal-backdrop")?.addEventListener("click", closeModal);
document.querySelector(".modal-close")?.addEventListener("click", closeModal);
document.addEventListener("keydown", e => { if (e.key==="Escape" && !modal.classList.contains("hidden")) closeModal(); });

renderLogin();
const qp = new URLSearchParams(window.location.search);
const q = qp.get("q");
const tabParam = qp.get("tab");
if (tabParam && document.querySelector(`#discord-tabs [data-tab="${tabParam}"]`)) {
  document.querySelectorAll("#discord-tabs .tab-btn").forEach(b => b.classList.remove("active"));
  document.querySelector(`#discord-tabs [data-tab="${tabParam}"]`).classList.add("active");
  currentTab = tabParam;
}
if (q) { input.value = q; currentQuery = q; fetchData(); }
else if (loggedInUser) { input.value = loggedInUser.username; currentQuery = String(loggedInUser.id); fetchData(); }
