

const FISHIE_API = "https://api.crygup.com/fishie";
const CLIENT_ID = "1537535633038381190";


let currentTab = "user";
let currentSubtab = "avatars";
let currentPage = 1;
let userQuery = "";
let guildQuery = "";
let loggedInUser = null;
try { loggedInUser = JSON.parse(localStorage.getItem("discord_user") || "null"); } catch { localStorage.removeItem("discord_user"); }
let requestVersion = 0;
let lastTotal = 0;
let requestController;
let currentUserId = null;
let currentGuildId = null;

if (!window.__fishieOAuthPending) {
  FishieWeb.fetch(`${FISHIE_API}/oauth/me`)
    .then((res) => {
      if (res.status === 401) {
        loggedInUser = null;
        localStorage.removeItem("discord_user");
        updateDeleteAllLabel();
        if (currentTab === "settings") showSettingsPanel();
        return null;
      }
      if (!res.ok) throw new Error(`Session check failed (${res.status})`);
      return res.json();
    })
    .then((data) => {
      if (!data || !data.authenticated) {
        console.info("Fishie session not found; user is not logged in.");
        return;
      }
      loggedInUser = data.user;
      localStorage.setItem("discord_user", JSON.stringify(data.user));
      loadManagedGuilds();
      if (currentTab === "settings") showSettingsPanel();
    })
    .catch((error) => {
      console.error("Could not restore Fishie session:", error);
    });
}

window.addEventListener("discord-login", () => {
  loggedInUser = JSON.parse(localStorage.getItem("discord_user") || "null");
  if (loggedInUser && !localStorage.getItem("settings_pending")) {
    window.location.reload();
  }
});

const grid = document.getElementById("results-grid");
const pagination = document.getElementById("pagination");
const statusEl = document.getElementById("status");
const input = document.getElementById("search-input");
const loginSection = document.getElementById("login-section");
const settingsPanel = document.getElementById("settings-panel");
const searchForm = document.getElementById("search-form");
const inviteBanner = document.querySelector(".invite-banner");
const tabs = document.querySelectorAll("#discord-tabs .tab-btn");
const userSubtabs = document.getElementById("user-subtabs");
const guildSubtabs = document.getElementById("guild-subtabs");

function activeQuery() {
  return currentTab === "guild" ? guildQuery : userQuery;
}
function setActiveQuery(v) {
  if (currentTab === "guild") guildQuery = v;
  else userQuery = v;
}

const SUBTAB_LABELS = {
  avatars: "Avatars",
  usernames: "Usernames",
  "display-names": "Display Names",
  discrims: "Discrims",
  "server-tags": "Server Tags",
  statuses: "Statuses",
  icons: "Icons",
  names: "Names",
};

function tabLabel() {
  return SUBTAB_LABELS[currentSubtab] || "";
}

document.getElementById("discord-tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab-btn");
  if (!btn || !btn.dataset.tab) return;
  e.preventDefault();

  tabs.forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  requestVersion++;
  requestController?.abort();
  currentUserId = currentGuildId = null;
  pagination.classList.add("hidden");
  currentTab = btn.dataset.tab;
  currentPage = 1;

  if (currentTab === "settings") {
    showSettingsPanel();
    return;
  }
  hideSettingsPanel();

  userSubtabs.classList.add("hidden");
  guildSubtabs.classList.add("hidden");
  if (currentTab === "user") {
    userSubtabs.classList.remove("hidden");
    currentSubtab =
      document.querySelector("#user-subtabs .subtab-btn.active")?.dataset
        ?.subtab || "avatars";
    input.placeholder = "Discord ID or username…";
  } else if (currentTab === "guild") {
    guildSubtabs.classList.remove("hidden");
    currentSubtab =
      document.querySelector("#guild-subtabs .subtab-btn.active")?.dataset
        ?.subtab || "icons";
    input.placeholder = "Server ID…";
    loadManagedGuilds();
  }
  grid.innerHTML = "";
  statusEl.textContent = "";
  input.value = activeQuery();
  updateDeleteAllLabel();
  if (activeQuery()) fetchData();
});

userSubtabs.addEventListener("click", (e) => {
  const btn = e.target.closest(".subtab-btn");
  if (!btn) return;
  userSubtabs
    .querySelectorAll(".subtab-btn")
    .forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  requestVersion++;
  requestController?.abort();
  currentSubtab = btn.dataset.subtab;
  currentPage = 1;
  updateDeleteAllLabel();
  grid.innerHTML = "";
  statusEl.textContent = "";
  if (activeQuery()) fetchData();
});

guildSubtabs.addEventListener("click", (e) => {
  const btn = e.target.closest(".subtab-btn");
  if (!btn) return;
  guildSubtabs
    .querySelectorAll(".subtab-btn")
    .forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  requestVersion++;
  requestController?.abort();
  currentSubtab = btn.dataset.subtab;
  currentPage = 1;
  updateDeleteAllLabel();
  grid.innerHTML = "";
  statusEl.textContent = "";
  if (activeQuery()) fetchData();
});

function renderLogin() {
  loginSection.innerHTML = "";
  if (loggedInUser) return;
}

function updateDeleteAllLabel() {
  const container = document.getElementById("delete-all-container");
  if (!container) return;
  if (canDelete()) {
    container.innerHTML = `<button id="delete-all-btn" class="small-btn danger">Delete All ${tabLabel()}</button>`;
    document
      .getElementById("delete-all-btn")
      .addEventListener("click", deleteAll);
  } else {
    container.innerHTML = "";
  }
}

async function showSettingsPanel() {
  for (const element of [searchForm, userSubtabs, guildSubtabs, grid, pagination, statusEl, inviteBanner]) element.classList.add("hidden");
  document.getElementById("delete-all-container").classList.add("hidden");
  settingsPanel.classList.remove("hidden");
  if (!loggedInUser) {
    settingsPanel.innerHTML = '<p>Log in to delete or restore your Fishie data.</p><button class="discord-login-btn" id="privacy-login">Login with Discord</button>';
    settingsPanel.querySelector("button").onclick = async () => {
      localStorage.setItem("settings_pending", "1");
      try { await window.startFishieOAuth(); }
      catch (error) { settingsPanel.querySelector("p").textContent = error.message; }
    };
    return;
  }
  const categories = [
    ["avatars", "Avatars"], ["username_logs", "Usernames"], ["display_name_logs", "Display names"],
    ["discrim_logs", "Discriminators"], ["stag_logs", "Server tags"], ["nickname_logs", "Nicknames"],
    ["user_status_history", "Statuses"]
  ];
  settingsPanel.innerHTML = '<div class="privacy-controls"><h3>Your Fishie data</h3>' +
    '<p>Deleted data is hidden immediately. You have 31 days to restore it before it is permanently deleted.</p>' +
    '<button class="small-btn danger" id="privacy-delete-account">Delete entire account</button>' +
    '<p>This removes your wallet, inventory, linked accounts, settings and saved history. Website login sessions are revoked immediately and are not restored.</p>' +
    '<label for="privacy-category">Delete a specific log</label><select id="privacy-category" class="guild-select">' +
    categories.map(([key,label]) => '<option value="' + key + '">' + label + '</option>').join("") +
    '</select><button class="small-btn danger" id="privacy-delete-category">Delete selected log</button>' +
    '<hr><p>Restore user data</p><button class="small-btn hidden" id="privacy-restore">Restore all data</button>' +
    '<p id="privacy-pending" role="status"></p>' +
    '<div id="privacy-server-section"><hr><label for="privacy-guild">Restore server data</label>' +
    '<select id="privacy-guild" class="guild-select hidden"></select><button class="small-btn hidden" id="privacy-restore-guild">Restore server data</button>' +
    '<p id="privacy-server-pending" role="status">Loading pending deletions…</p></div></div>';
  const status = settingsPanel.querySelector("#privacy-pending");
  const userId = loggedInUser.id;
  const request = async (path, method, base = "/user/" + userId) => {
    const res = await FishieWeb.fetch(FISHIE_API + base + path, {method, signal: AbortSignal.timeout(120000)});
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "Could not update your data.");
    return data;
  };
  const refresh = async () => {
    const data = await request("/pending-deletions", "GET");
    settingsPanel.querySelector("#privacy-restore").classList.toggle("hidden", !data.records);
    status.textContent = data.records ? "Records pending deletion: " + data.records.toLocaleString() + ". Next expiry: " + new Date(data.next_expiry).toLocaleString() + "." : "No data is pending deletion.";
  };
  const run = async action => {
    const buttons = settingsPanel.querySelectorAll("button");
    buttons.forEach(button => button.disabled = true);
    try { await action(); }
    catch (error) { status.textContent = error.message; }
    finally { buttons.forEach(button => button.disabled = false); }
  };
  settingsPanel.querySelector("#privacy-delete-account").onclick = () => {
    if (!confirm("Delete your entire Fishie account, including wallet, inventory, linked accounts, settings and history? You have 31 days to restore it. You will need to log in again.")) return;
    run(async () => {
      await request("", "DELETE");
      loggedInUser = null;
      localStorage.removeItem("discord_user");
      window.dispatchEvent(new CustomEvent("discord-login"));
      await showSettingsPanel();
      settingsPanel.insertAdjacentHTML("afterbegin", "<p>Your account data is pending deletion for 31 days. Log in again to restore it.</p>");
    });
  };
  settingsPanel.querySelector("#privacy-delete-category").onclick = () => {
    const select = settingsPanel.querySelector("#privacy-category");
    if (!confirm("Delete all your " + select.selectedOptions[0].textContent.toLowerCase() + "? They will be hidden immediately and can be restored for 31 days.")) return;
    run(async () => { await request("?table=" + select.value, "DELETE"); await refresh(); });
  };
  settingsPanel.querySelector("#privacy-restore").onclick = () => run(async () => {
    const data = await request("/restore", "POST");
    await refresh();
    if (data.pending) status.textContent = "Records restored: " + data.restored.toLocaleString() + "." +
      (data.pending ? " Still pending: " + data.pending.toLocaleString() + ", due to expired tasks, current data conflicts or another deletion request." : "");
  });
  settingsPanel.querySelector("#privacy-restore-guild").onclick = () => run(async () => {
    const guildId = settingsPanel.querySelector("#privacy-guild").value;
    if (!guildId) return;
    const data = await request("/restore", "POST", "/guild/" + guildId);
    await loadManagedGuilds();
    if (data.pending) settingsPanel.querySelector("#privacy-server-pending").textContent = "Server records restored: " + data.restored.toLocaleString() + ". Still pending: " + data.pending.toLocaleString() + ".";
  });
  loadManagedGuilds();
  try { await refresh(); } catch (error) { status.textContent = error.message; }
}
function hideSettingsPanel() {
  settingsPanel.classList.add("hidden");
  for (const element of [searchForm, grid, statusEl, inviteBanner]) element.classList.remove("hidden");
  document.getElementById("delete-all-container").classList.remove("hidden");
}
async function loadManagedGuilds() {
  if (!loggedInUser) {
    managedGuildIds = [];
    return;
  }
  try {
    const res = await FishieWeb.fetch(`${FISHIE_API}/user/${loggedInUser.id}/guilds`, {
    });
    if (!res.ok) throw new Error("Could not load pending server deletions. Please try again.");
    {
      const data = await res.json();
      managedGuildIds = data.guilds.map((g) => g.id);
      const picker = document.getElementById("privacy-guild");
      if (picker) {
        const pending = data.guilds.filter(g => g.pending_deletion);
        picker.innerHTML = pending.map(g => '<option value="' + escapeHtml(g.id) + '">' + escapeHtml(g.name) + '</option>').join("");
        picker.classList.toggle("hidden", !pending.length);
        document.getElementById("privacy-restore-guild").classList.toggle("hidden", !pending.length);
        document.getElementById("privacy-server-pending").textContent = pending.length ? "" : "No data is pending deletion.";
      }
      updateDeleteAllLabel();
    }
  } catch {
    managedGuildIds = [];
    const status = document.getElementById("privacy-server-pending");
    if (status) status.textContent = "Could not load pending server deletions. Please try again.";
  }
}

document.getElementById("search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  setActiveQuery(input.value.trim());
  currentPage = 1;
  requestVersion++;
  requestController?.abort();
  currentUserId = currentGuildId = null;
  if (activeQuery()) fetchData();
  else { grid.innerHTML = ""; pagination.classList.add("hidden"); statusEl.textContent = "Enter a Discord ID or username."; updateDeleteAllLabel(); }
});

const USER_ENDPOINTS = {
  avatars: (id, page) =>
    `https://api.crygup.com/avatars?q=${id}&page=${page}&per_page=80`,
  usernames: (id, page) =>
    `${FISHIE_API}/usernames/${id}?page=${page}&per_page=80`,
  "display-names": (id, page) =>
    `${FISHIE_API}/display-names/${id}?page=${page}&per_page=80`,
  discrims: (id, page) =>
    `${FISHIE_API}/discrims/${id}?page=${page}&per_page=80`,
  "server-tags": (id, page) =>
    `${FISHIE_API}/server-tags/${id}?page=${page}&per_page=80`,
  statuses: (id, page) =>
    `${FISHIE_API}/statuses/${id}?page=${page}&per_page=80`,
};
const GUILD_ENDPOINTS = {
  icons: (id, page) =>
    `${FISHIE_API}/guild/${id}/icons?page=${page}&per_page=80`,
  names: (id, page) =>
    `${FISHIE_API}/guild/${id}/names?page=${page}&per_page=80`,
};
const TABLE_MAP = {
  avatars: "avatars",
  usernames: "username_logs",
  "display-names": "display_name_logs",
  discrims: "discrim_logs",
  "server-tags": "stag_logs",
  statuses: "user_status_history",
  icons: "guild_icons",
  names: "guild_name_logs",
};

let managedGuildIds = [];

const canDelete = () =>
  loggedInUser &&
  ((currentTab === "user" && currentUserId === String(loggedInUser.id)) ||
    (currentTab === "guild" &&
      currentGuildId &&
      managedGuildIds.includes(currentGuildId)));

async function fetchData() {
  const version = ++requestVersion;
  requestController?.abort();
  requestController = new AbortController();
  const signal = requestController.signal;
  const tab = currentTab, subtab = currentSubtab, page = currentPage, query = activeQuery();
  const url = new URL(location.href);
  for (const [key, value] of Object.entries({tab, subtab, page, q: query})) url.searchParams.set(key, value);
  history.replaceState(null, "", url);
  grid.innerHTML = "";
  currentUserId = currentGuildId = null;
  lastTotal = 0;
  updateDeleteAllLabel();
  statusEl.textContent = "Loading…";
  pagination.classList.add("hidden");
  try {
    let id = query;
    if (tab === "user" && !/^\d+$/.test(query)) {
      const res = await FishieWeb.fetch(FISHIE_API + "/resolve?q=" + encodeURIComponent(query), {signal});
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Could not resolve user");
      id = String(data.user_id);
    }
    if (version !== requestVersion) return;
    if (!/^\d+$/.test(id)) throw new Error("Enter a valid Discord ID.");
    const endpoint = (tab === "user" ? USER_ENDPOINTS : GUILD_ENDPOINTS)[subtab];
    if (!endpoint) return;
    const res = await FishieWeb.fetch(endpoint(id, page), {signal});
    const data = await res.json();
    if (version !== requestVersion) return;
    if (!res.ok) throw new Error(data.detail || "Could not load history");
    if (tab === "user") currentUserId = id;
    else currentGuildId = id;
    lastTotal = data.total || 0;
    if (subtab === "avatars" || subtab === "icons") renderAvatars(data.avatars || data.items || []);
    else renderTextItems(data.items || []);
    renderPagination(data.page, data.pages);
    statusEl.textContent = lastTotal ? lastTotal + " found" : "No results.";
    updateDeleteAllLabel();
  } catch (error) {
    if (version === requestVersion && error.name !== "AbortError") statusEl.textContent = error.message;
  }
}

function renderAvatars(avatars) {
  grid.innerHTML = "";
  grid.className = "avatar-grid";
  for (const av of avatars) {
    const div = document.createElement("button");
    div.type = "button";
    div.setAttribute("aria-label", "View image saved " + new Date(av.created_at).toLocaleDateString());
    div.className = "avatar-cell";
    const img = document.createElement("img");
    img.src = av.url || av.icon;
    img.alt = av.avatar_key || av.icon_key || "";
    img.loading = "lazy";
    img.onerror = () => {
      img.onerror = null;
      img.removeAttribute("src");
      img.alt = "Image unavailable";
    };
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
    const delBtn = canDelete()
      ? `<button class="delete-btn" data-key="${escapeHtml(key)}">×</button>`
      : "";
    const badge = item.badge_url
      ? `<img class="text-badge" src="${escapeHtml(item.badge_url)}" alt="" loading="lazy">`
      : "";
    row.innerHTML = `${delBtn}${badge}<span class="text-value">${escapeHtml(item.value)}</span><span class="text-date">${new Date(item.created_at).toLocaleDateString()}</span>`;
    if (canDelete())
      row.querySelector(".delete-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        deleteItem(TABLE_MAP[currentSubtab], key, item.value + " · " + new Date(item.created_at).toLocaleDateString());
      });
    list.appendChild(row);
  }
  grid.appendChild(list);
}

async function deleteItem(table, key, description = key) {
  if (!canDelete()) return;
  if (!confirm("Delete this " + tabLabel().toLowerCase() + " entry for " + activeQuery() + "? You have 31 days to restore it.\n" + description)) return;
  const targetId = currentTab === "user" ? currentUserId : currentGuildId;
  try {
    const res = await FishieWeb.fetch(
      `${FISHIE_API}/item/${table}/${targetId}?key=${encodeURIComponent(key)}`,
      { method: "DELETE" },
    );
    if (!res.ok) throw new Error("Delete failed");
    closeModal();
    alert("Hidden now. You have 31 days to restore it from Settings.");
    fetchData();
  } catch {
    alert("Delete failed.");
  }
}

async function deleteAll() {
  if (!canDelete() || !lastTotal) return;
  const targetId = currentTab === "user" ? currentUserId : currentGuildId;
  const endpoint = currentTab === "guild" ? "/guild/" + targetId + "/data" : "/user/" + targetId;
  const table = TABLE_MAP[currentSubtab];
  if (!confirm("Delete all " + lastTotal + " " + tabLabel().toLowerCase() + " entries for " + targetId + "? Other categories will be kept. You can restore these entries for 31 days.")) return;
  try {
    const res = await FishieWeb.fetch(FISHIE_API + endpoint + "?table=" + table, {method: "DELETE"});
    if (!res.ok) throw new Error("Could not delete history. No changes were confirmed.");
    await fetchData();
  } catch (error) { statusEl.textContent = error.message; }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderPagination(page, pages) {
  if (pages <= 1) {
    pagination.classList.add("hidden");
    return;
  }
  pagination.classList.remove("hidden");
  pagination.innerHTML = `<button ${page <= 1 ? "disabled" : ""} id="prev-btn">← Prev</button><span>${page} / ${pages}</span><button ${page >= pages ? "disabled" : ""} id="next-btn">Next →</button>`;
  document.getElementById("prev-btn")?.addEventListener("click", () => {
    currentPage--;
    fetchData();
  });
  document.getElementById("next-btn")?.addEventListener("click", () => {
    currentPage++;
    fetchData();
  });
}

const modal = document.getElementById("modal");
const modalImg = document.getElementById("modal-img");
const modalKey = document.getElementById("modal-key");
const modalDate = document.getElementById("modal-date");
let modalTrigger;
function openModal(av) {
  modalTrigger = document.activeElement;
  modalImg.src = av.url || av.icon || "";
  modalKey.innerHTML = `${escapeHtml(av.avatar_key || av.icon_key || av.value)} ${canDelete() ? `<button class="modal-del" data-key="${escapeHtml(av.avatar_key || av.icon_key || av.id)}">Delete</button>` : ""}`;
  modalDate.textContent = new Date(av.created_at).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  if (canDelete()) {
    modalKey.querySelector(".modal-del").addEventListener("click", () => {
      const table = TABLE_MAP[currentSubtab];
      const key = av.avatar_key || av.icon_key || String(av.id);
      deleteItem(table, key);
    });
  }
  modal.classList.remove("hidden");
  modal.querySelector(".modal-close").focus();
}
function closeModal() {
  modal.classList.add("hidden");
  modalImg.src = "";
  modalTrigger?.focus();
}
document
  .querySelector(".modal-backdrop")
  ?.addEventListener("click", closeModal);
document.querySelector(".modal-close")?.addEventListener("click", closeModal);
document.addEventListener("keydown", (e) => {
  if (e.key === "Tab" && !modal.classList.contains("hidden")) {
    const buttons = [...modal.querySelectorAll("button")];
    const first = buttons[0], last = buttons[buttons.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  if (e.key === "Escape" && !modal.classList.contains("hidden")) closeModal();
});

renderLogin();
const qp = new URLSearchParams(window.location.search);
const q = qp.get("q");
const tabParam = qp.get("tab");
if (
  ["user", "guild", "settings"].includes(tabParam) &&
  document.querySelector(`#discord-tabs [data-tab="${tabParam}"]`)
) {
  document
    .querySelectorAll("#discord-tabs .tab-btn")
    .forEach((b) => b.classList.remove("active"));
  document
    .querySelector(`#discord-tabs [data-tab="${tabParam}"]`)
    .classList.add("active");
  currentTab = tabParam;
  currentSubtab = currentTab === "guild" ? "icons" : "avatars";
  if (currentTab === "user") userSubtabs.classList.remove("hidden");
  else if (currentTab === "guild") guildSubtabs.classList.remove("hidden");
}
const subtabParam = qp.get("subtab");
if (Object.hasOwn(currentTab === "guild" ? GUILD_ENDPOINTS : USER_ENDPOINTS, subtabParam)) {
  const subtabBar =
    currentTab === "user"
      ? userSubtabs
      : currentTab === "guild"
        ? guildSubtabs
        : null;
  if (subtabBar) {
    const subtabBtn = subtabBar.querySelector(`[data-subtab="${subtabParam}"]`);
    if (subtabBtn) {
      subtabBar
        .querySelectorAll(".subtab-btn")
        .forEach((b) => b.classList.remove("active"));
      subtabBtn.classList.add("active");
      currentSubtab = subtabParam;
    }
  }
}
userSubtabs.classList.toggle("hidden", currentTab !== "user");
guildSubtabs.classList.toggle("hidden", currentTab !== "guild");
currentPage = Math.max(1, parseInt(qp.get("page"), 10) || 1);
const wantsSettings =
  currentTab === "settings" || localStorage.getItem("settings_pending");
if (wantsSettings) {
  localStorage.removeItem("settings_pending");
  currentTab = "settings";
  tabs.forEach(button => button.classList.toggle("active", button.dataset.tab === "settings"));
  showSettingsPanel();
} else if (q) {
  setActiveQuery(q);
  input.value = q;
  if (loggedInUser) {
    loadManagedGuilds().then(() => fetchData());
  } else {
    fetchData();
  }
} else if (loggedInUser && currentTab === "user") {
  input.value = String(loggedInUser.id);
}
if (loggedInUser && !q) loadManagedGuilds();
