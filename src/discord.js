console.log("discord.js v3 loaded");

const FISHIE_API = "https://api.crygup.com/fishie";
const CLIENT_ID = "876391494485950504";

(() => {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const options = init || {};
    const headers = new Headers(options.headers || {});
    headers.delete("Authorization");
    const requestUrl =
      typeof input === "string" ? input : input?.url || String(input);
    const credentials = requestUrl.startsWith("https://api.crygup.com/fishie")
      ? "include"
      : options.credentials || "same-origin";
    return nativeFetch(input, { ...options, credentials, headers });
  };
})();

let currentTab = "user";
let currentSubtab = "avatars";
let currentPage = 1;
let userQuery = "";
let guildQuery = "";
let loggedInUser = JSON.parse(localStorage.getItem("discord_user") || "null");
localStorage.removeItem("discord_token");
let currentUserId = null;
let currentGuildId = null;

if (!loggedInUser && !window.__fishieOAuthPending) {
  fetch(`${FISHIE_API}/oauth/me`)
    .then((res) => {
      if (res.status === 401) {
        console.info("Fishie session not found; user is not logged in.");
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
      localStorage.setItem("discord_user", JSON.stringify(data.user));
      window.location.reload();
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
});

userSubtabs.addEventListener("click", (e) => {
  const btn = e.target.closest(".subtab-btn");
  if (!btn) return;
  userSubtabs
    .querySelectorAll(".subtab-btn")
    .forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  currentSubtab = btn.dataset.subtab;
  currentPage = 1;
  updateDeleteAllLabel();
  grid.innerHTML = "";
  statusEl.textContent = "";
});

guildSubtabs.addEventListener("click", (e) => {
  const btn = e.target.closest(".subtab-btn");
  if (!btn) return;
  guildSubtabs
    .querySelectorAll(".subtab-btn")
    .forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  currentSubtab = btn.dataset.subtab;
  currentPage = 1;
  updateDeleteAllLabel();
  grid.innerHTML = "";
  statusEl.textContent = "";
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

function showSettingsPanel() {
  if (!settingsPanel) {
    console.error("#settings-panel not found in DOM");
    return;
  }
  searchForm.classList.add("hidden");
  userSubtabs.classList.add("hidden");
  guildSubtabs.classList.add("hidden");
  document.getElementById("delete-all-container").classList.add("hidden");
  grid.classList.add("hidden");
  pagination.classList.add("hidden");
  statusEl.classList.add("hidden");
  if (inviteBanner) inviteBanner.classList.add("hidden");
  loginSection.classList.add("hidden");
  settingsPanel.classList.remove("hidden");
  renderSettings();
}

function hideSettingsPanel() {
  searchForm.classList.remove("hidden");
  if (currentTab === "user") userSubtabs.classList.remove("hidden");
  else if (currentTab === "guild") guildSubtabs.classList.remove("hidden");
  document.getElementById("delete-all-container").classList.remove("hidden");
  grid.classList.remove("hidden");
  statusEl.classList.remove("hidden");
  if (inviteBanner) inviteBanner.classList.remove("hidden");
  loginSection.classList.remove("hidden");
  settingsPanel.classList.add("hidden");
}

function renderSettings() {
  if (loggedInUser) {
    settingsPanel.innerHTML = `
      <div class="settings-card">
        <div class="settings-header">
          <p class="settings-greeting">Hello, <strong>${escapeHtml(loggedInUser.global_name || loggedInUser.username)}</strong></p>
          <button id="settings-logout-btn" class="small-btn">Logout</button>
        </div>
        <nav class="settings-subtabs" id="settings-subtabs">
          <button class="subtab-btn active" data-subtab="user">User</button>
          <button class="subtab-btn" data-subtab="guild">Server</button>
        </nav>
        <div class="subtab-panel" id="subtab-user">
          <div class="settings-tracking">
            <p class="settings-section-title">Tracking settings</p>
            <p class="settings-hint">Toggle on and off any of the tracking settings.</p>
            <div class="tracking-toggles" id="tracking-toggles">
              <span class="toggle-status">Loading…</span>
            </div>
            <p class="settings-disclaimer">Opting out stops future tracking but does not remove existing data. Other users can still look up your profile and view past information. To remove existing data, use the delete options on the lookup tabs.</p>
          </div>
        </div>
        <div class="subtab-panel hidden" id="subtab-guild">
          <p class="settings-section-title">Server tracking settings</p>
          <p class="settings-hint">Select a server to manage its tracking opt-outs.</p>
          <div class="guild-select-wrapper">
            <select id="guild-select" class="guild-select">
              <option value="">Select a server…</option>
            </select>
          </div>
          <div class="tracking-toggles hidden" id="guild-toggles"></div>
        </div>
        <p class="settings-invite">Want to track your avatars (and more)? Join the <a href="https://discord.gg/rM9u4MRFBE" target="_blank" rel="noopener">Discord server</a> or invite the <a href="https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&scope=bot+applications.commands&permissions=138513074240" target="_blank" rel="noopener">Discord bot</a></p>
      </div>`;

    document
      .getElementById("settings-logout-btn")
      .addEventListener("click", () => {
        fetch(`${FISHIE_API}/oauth/logout`, { method: "POST" }).finally(() => {
          localStorage.removeItem("discord_user");
          loggedInUser = null;
          hideSettingsPanel();
          tabs.forEach((b) => b.classList.remove("active"));
          const userBtn = document.querySelector(
            '#discord-tabs [data-tab="user"]',
          );
          if (userBtn) userBtn.classList.add("active");
          currentTab = "user";
          currentSubtab = "avatars";
          userSubtabs.classList.remove("hidden");
          renderLogin();
        });
      });

    document
      .querySelectorAll("#settings-subtabs .subtab-btn")
      .forEach((btn) => {
        btn.addEventListener("click", () => {
          document
            .querySelectorAll("#settings-subtabs .subtab-btn")
            .forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          document
            .querySelectorAll(".subtab-panel")
            .forEach((p) => p.classList.add("hidden"));
          const panel = document.getElementById(`subtab-${btn.dataset.subtab}`);
          if (panel) panel.classList.remove("hidden");
          if (btn.dataset.subtab === "guild") {
            document.getElementById("guild-toggles").classList.add("hidden");
            fetchGuilds();
          } else {
            document.getElementById("guild-select").value = "";
            document.getElementById("guild-toggles").classList.add("hidden");
          }
        });
      });

    document.getElementById("guild-select").addEventListener("change", (e) => {
      const guildId = e.target.value;
      if (guildId) fetchGuildOptOuts(guildId);
      else document.getElementById("guild-toggles").classList.add("hidden");
    });

    fetchOptOuts();
  } else {
    settingsPanel.innerHTML = `
      <div class="settings-card">
        <p class="settings-greeting">You are not logged in.</p>
        <p class="settings-prompt">Would you like to log in with Discord?</p>
        <div class="settings-actions">
          <button id="settings-login-yes" class="small-btn">Yes</button>
          <button id="settings-login-no" class="small-btn">No</button>
        </div>
        <p class="settings-invite">Want to track your avatars (and more)? Join the <a href="https://discord.gg/rM9u4MRFBE" target="_blank" rel="noopener">Discord server</a> or invite the <a href="https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&scope=bot+applications.commands&permissions=138513074240" target="_blank" rel="noopener">Discord bot</a></p>
      </div>`;
    document
      .getElementById("settings-login-yes")
      .addEventListener("click", () => {
        localStorage.setItem("settings_pending", "1");
        window.location.href = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent("https://crygup.com")}&response_type=code&scope=identify`;
      });
    document
      .getElementById("settings-login-no")
      .addEventListener("click", () => {
        hideSettingsPanel();
        tabs.forEach((b) => b.classList.remove("active"));
        const userBtn = document.querySelector(
          '#discord-tabs [data-tab="user"]',
        );
        if (userBtn) userBtn.classList.add("active");
        currentTab = "user";
        currentSubtab = "avatars";
        userSubtabs.classList.remove("hidden");
      });
  }
}

const TRACKING_ITEMS = [
  { key: "avatar", label: "Avatar tracking" },
  { key: "username", label: "Username tracking" },
  { key: "display", label: "Display name tracking" },
  { key: "nickname", label: "Nickname tracking" },
  { key: "discrim", label: "Discriminator tracking", disabled: true },
  { key: "joins", label: "Server join tracking" },
];

const GUILD_TRACKING_ITEMS = [
  { key: "icon", label: "Server icon tracking" },
  { key: "name", label: "Server name tracking" },
];

async function fetchGuilds() {
  const select = document.getElementById("guild-select");
  if (!select || !loggedInUser) return;
  select.disabled = true;
  select.innerHTML = '<option value="">Loading…</option>';
  try {
    const res = await fetch(`${FISHIE_API}/user/${loggedInUser.id}/guilds`, {
    });
    if (!res.ok) throw new Error("Failed to fetch guilds");
    const data = await res.json();
    if (!data.guilds.length) {
      select.innerHTML = '<option value="">No eligible servers</option>';
      return;
    }
    select.innerHTML =
      '<option value="">Select a server…</option>' +
      data.guilds
        .map(
          (g) =>
            `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`,
        )
        .join("");
    managedGuildIds = data.guilds.map((g) => g.id);
    select._guildData = data.guilds;
  } catch {
    select.innerHTML = '<option value="">Failed to load servers</option>';
  } finally {
    select.disabled = false;
  }
}

async function loadManagedGuilds() {
  if (!loggedInUser) {
    managedGuildIds = [];
    return;
  }
  try {
    const res = await fetch(`${FISHIE_API}/user/${loggedInUser.id}/guilds`, {
    });
    if (res.ok) {
      const data = await res.json();
      managedGuildIds = data.guilds.map((g) => g.id);
      updateDeleteAllLabel();
    }
  } catch {
    managedGuildIds = [];
  }
}

function fetchGuildOptOuts(guildId) {
  const container = document.getElementById("guild-toggles");
  if (!container) return;
  const guilds = document.getElementById("guild-select")._guildData || [];
  const guild = guilds.find((g) => g.id === guildId);
  if (!guild) return;
  renderGuildToggles(guild.opted_out || [], guildId);
}

function renderGuildToggles(optedOut, guildId) {
  const container = document.getElementById("guild-toggles");
  if (!container) return;
  container.innerHTML = GUILD_TRACKING_ITEMS.map((item) => {
    const enabled = !optedOut.includes(item.key);
    return `
      <label class="toggle-row">
        <span class="toggle-label">${escapeHtml(item.label)}</span>
        <input type="checkbox" class="toggle-input guild-toggle" data-key="${escapeHtml(item.key)}" data-guild="${escapeHtml(guildId)}" ${enabled ? "checked" : ""}>
        <span class="toggle-switch"></span>
      </label>`;
  }).join("");
  container.classList.remove("hidden");
  container.querySelectorAll(".guild-toggle").forEach((input) => {
    input.addEventListener("change", () => saveGuildOptOuts(guildId));
  });
}

async function saveGuildOptOuts(guildId) {
  if (!loggedInUser) return;
  const optedOut = GUILD_TRACKING_ITEMS.filter((item) => {
    const input = document.querySelector(
      `#guild-toggles .guild-toggle[data-key="${item.key}"]`,
    );
    return input && !input.checked;
  }).map((item) => item.key);
  try {
    await fetch(`${FISHIE_API}/guild/${guildId}/opted-out`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ items: optedOut }),
    });
  } catch {
    /* silently fail */
  }
}

async function fetchOptOuts() {
  const container = document.getElementById("tracking-toggles");
  if (!container || !loggedInUser) return;
  try {
    const res = await fetch(`${FISHIE_API}/user/${loggedInUser.id}/opted-out`);
    if (!res.ok) throw new Error("Failed to fetch");
    const data = await res.json();
    renderToggles(data.items || []);
  } catch {
    container.innerHTML =
      '<span class="toggle-status">Failed to load tracking settings.</span>';
  }
}

function renderToggles(optedOut) {
  const container = document.getElementById("tracking-toggles");
  if (!container) return;
  container.innerHTML = TRACKING_ITEMS.map((item) => {
    const enabled = !item.disabled && !optedOut.includes(item.key);
    const disabledAttr = item.disabled ? " disabled" : "";
    return `
      <label class="toggle-row${item.disabled ? " toggle-disabled" : ""}">
        <span class="toggle-label">${escapeHtml(item.label)}</span>
        <input type="checkbox" class="toggle-input" data-key="${escapeHtml(item.key)}" ${enabled ? "checked" : ""}${disabledAttr}>
        <span class="toggle-switch"></span>
      </label>`;
  }).join("");
  container
    .querySelectorAll(".toggle-input:not([disabled])")
    .forEach((input) => {
      input.addEventListener("change", () => saveOptOuts());
    });
}

async function saveOptOuts() {
  if (!loggedInUser) return;
  const optedOut = TRACKING_ITEMS.filter((item) => !item.disabled)
    .filter((item) => {
      const input = document.querySelector(
        `#tracking-toggles .toggle-input[data-key="${item.key}"]`,
      );
      return input && !input.checked;
    })
    .map((item) => item.key);
  try {
    await fetch(`${FISHIE_API}/user/${loggedInUser.id}/opted-out`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ items: optedOut }),
    });
  } catch {
    /* silently fail */
  }
}

document.getElementById("search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  setActiveQuery(input.value.trim());
  currentPage = 1;
  if (activeQuery()) fetchData();
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
  grid.innerHTML = "";
  statusEl.textContent = "Loading…";
  pagination.classList.add("hidden");
  try {
    let id = activeQuery();
    if (currentTab === "user" && !/^\d+$/.test(activeQuery())) {
      const r = await fetch(
        `${FISHIE_API}/resolve?q=${encodeURIComponent(activeQuery())}`,
      );
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.detail || "Could not resolve user");
      }
      id = (await r.json()).user_id;
    }
    if (currentTab === "user") {
      currentUserId = id;
      const res = await fetch(USER_ENDPOINTS[currentSubtab](id, currentPage));
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.detail || "Not found");
      }
      const data = await res.json();
      if (currentSubtab === "avatars") renderAvatars(data.avatars);
      else renderTextItems(data.items);
      renderPagination(data.page, data.pages);
      statusEl.textContent = data.total ? `${data.total} found` : "No results.";
    } else if (currentTab === "guild") {
      currentGuildId = id;
      const res = await fetch(GUILD_ENDPOINTS[currentSubtab](id, currentPage));
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.detail || "Not found");
      }
      const data = await res.json();
      if (currentSubtab === "icons") renderAvatars(data.items);
      else renderTextItems(data.items);
      renderPagination(data.page, data.pages);
      statusEl.textContent = data.total ? `${data.total} found` : "No results.";
    }
    updateDeleteAllLabel();
  } catch (err) {
    statusEl.textContent = err.message;
  }
}

function renderAvatars(avatars) {
  grid.innerHTML = "";
  grid.className = "avatar-grid";
  for (const av of avatars) {
    const div = document.createElement("div");
    div.className = "avatar-cell";
    const img = document.createElement("img");
    img.src = av.url || av.icon;
    img.alt = av.avatar_key || av.icon_key || "";
    img.loading = "lazy";
    img.onerror = () => {
      img.src = "";
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
    row.innerHTML = `${delBtn}<span class="text-value">${escapeHtml(item.value)}</span><span class="text-date">${new Date(item.created_at).toLocaleDateString()}</span>`;
    if (canDelete())
      row.querySelector(".delete-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        deleteItem(TABLE_MAP[currentSubtab], key);
      });
    list.appendChild(row);
  }
  grid.appendChild(list);
}

async function deleteItem(table, key) {
  if (!confirm("Delete this entry?")) return;
  const targetId = currentTab === "user" ? currentUserId : currentGuildId;
  try {
    const res = await fetch(
      `${FISHIE_API}/item/${table}/${targetId}?key=${encodeURIComponent(key)}`,
      { method: "DELETE" },
    );
    if (!res.ok) throw new Error("Delete failed");
    closeModal();
    alert("Deleted.");
    fetchData();
  } catch {
    alert("Delete failed.");
  }
}

async function deleteAll() {
  if (
    !confirm(
      `Delete ALL your ${tabLabel().toLowerCase()}? This cannot be undone!`,
    )
  )
    return;
  if (!confirm("Are you sure? This data will be permanently deleted.")) return;
  const targetId = currentTab === "user" ? currentUserId : currentGuildId;
  try {
    const res = await fetch(
      `${FISHIE_API}/user/${targetId}?table=${TABLE_MAP[currentSubtab]}`,
      { method: "DELETE" },
    );
    if (!res.ok) throw new Error("Delete all failed");
    alert(`${tabLabel()} deleted.`);
    fetchData();
  } catch {
    alert("Delete failed.");
  }
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
function openModal(av) {
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
}
function closeModal() {
  modal.classList.add("hidden");
  modalImg.src = "";
}
document
  .querySelector(".modal-backdrop")
  ?.addEventListener("click", closeModal);
document.querySelector(".modal-close")?.addEventListener("click", closeModal);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !modal.classList.contains("hidden")) closeModal();
});

renderLogin();
const qp = new URLSearchParams(window.location.search);
const q = qp.get("q");
const tabParam = qp.get("tab");
if (
  tabParam &&
  document.querySelector(`#discord-tabs [data-tab="${tabParam}"]`)
) {
  document
    .querySelectorAll("#discord-tabs .tab-btn")
    .forEach((b) => b.classList.remove("active"));
  document
    .querySelector(`#discord-tabs [data-tab="${tabParam}"]`)
    .classList.add("active");
  currentTab = tabParam;
  if (currentTab === "user") userSubtabs.classList.remove("hidden");
  else if (currentTab === "guild") guildSubtabs.classList.remove("hidden");
}
const subtabParam = qp.get("subtab");
if (subtabParam) {
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
if (currentTab === "user") userSubtabs.classList.remove("hidden");
else if (currentTab === "guild") guildSubtabs.classList.remove("hidden");
const wantsSettings =
  currentTab === "settings" || localStorage.getItem("settings_pending");
if (wantsSettings) {
  document
    .querySelectorAll("#discord-tabs .tab-btn")
    .forEach((b) => b.classList.remove("active"));
  const settingsTab = document.querySelector(
    '#discord-tabs [data-tab="settings"]',
  );
  if (settingsTab) settingsTab.classList.add("active");
  currentTab = "settings";
  if (loggedInUser) {
    input.value = String(loggedInUser.id);
    localStorage.removeItem("settings_pending");
    showSettingsPanel();
  } else if (!localStorage.getItem("settings_pending")) {
    showSettingsPanel();
  }
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
