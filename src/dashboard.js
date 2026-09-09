const API = "https://api.crygup.com/fishie";
const REDIRECT = "https://crygup.com/dashboard";

// Authentication is provided by the API's HttpOnly session cookie. Strip any
// legacy bearer header and include the cookie on cross-origin API requests.

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const params = new URLSearchParams(window.location.search);
const code = params.get("code");
const state = params.get("state");

if (code && state) {
  (async () => {
    window.history.replaceState({}, document.title, "/dashboard");
    try {
      const res = await FishieWeb.fetch(API + "/oauth/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, state, redirect_uri: REDIRECT }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "OAuth exchange failed");
      if (data.user) {
        localStorage.setItem("discord_user", JSON.stringify(data.user));
        initDashboard();
      }
    } catch (e) {
      console.error("OAuth failed:", e);
      showLogin();
    }
  })();
} else {
  FishieWeb.fetch(API + "/oauth/me")
    .then((res) => {
      if (res.status === 401) {
        console.info("Fishie session not found; user is not logged in.");
        showLogin();
        return null;
      }
      if (!res.ok) throw new Error(`Session check failed (${res.status})`);
      return res.json();
    })
    .then((data) => {
      if (!data || !data.authenticated) {
        console.info("Fishie session not found; user is not logged in.");
        showLogin();
        return;
      }
      localStorage.setItem("discord_user", JSON.stringify(data.user));
      initDashboard();
    })
    .catch((error) => {
      console.error("Could not restore Fishie session:", error);
      showLogin();
    });
}

async function logout() {
  await FishieWeb.fetch(API + "/oauth/logout", { method: "POST" });
  localStorage.removeItem("discord_user");
  location.reload();
}

var _logout = document.getElementById("logoutBtn");
if (_logout)
  _logout.onclick = function () {
    logout();
  };
var _login = document.getElementById("loginBtn");
if (_login)
  _login.onclick = async function () {
    try {
      const res = await FishieWeb.fetch(
        API + "/oauth/start?redirect_uri=" + encodeURIComponent(REDIRECT),
      );
      const data = await res.json();
      if (!res.ok || !data.url) {
        throw new Error(data.detail || "Could not start Discord login");
      }
      window.location.assign(data.url);
    } catch (error) {
      console.error("Could not start Discord login:", error);
    }
  };

function showLogin() {
  localStorage.removeItem("discord_user");
  document.getElementById("loginView").style.display = "block";
  document.getElementById("dashboardView").classList.remove("active");
}

document
  .getElementById("dashboardTabs")
  .addEventListener("click", function (e) {
    var btn = e.target.closest(".dashboard-tab");
    if (!btn) return;
    document.querySelectorAll(".dashboard-tab").forEach(function (t) {
      t.classList.remove("active");
    });
    document.querySelectorAll(".tab-panel").forEach(function (p) {
      p.classList.remove("active");
    });
    btn.classList.add("active");
    document
      .getElementById(
        "tab" +
          btn.dataset.tab.charAt(0).toUpperCase() +
          btn.dataset.tab.slice(1),
      )
      .classList.add("active");
  });

async function initDashboard() {
  document.getElementById("loginView").style.display = "none";
  document.getElementById("dashboardView").classList.add("active");

  var user = JSON.parse(localStorage.getItem("discord_user") || "{}");

  var avatar = user.id && user.avatar
    ? "https://cdn.discordapp.com/avatars/" +
      user.id +
      "/" +
      user.avatar +
      ".png"
    : "";
  var headerHtml = avatar
    ? '<img src="' +
      esc(avatar) +
      '" alt="" style="width:48px;height:48px;border-radius:50%">'
    : "";
  headerHtml +=
    '<div class="user-info"><h2>' +
    esc(user.global_name || user.username || "Unknown") +
    "</h2>";
  headerHtml += '<div class="sub">ID: ' + esc(user.id) + "</div>";
  headerHtml += '<div class="sub" id="userSince"></div>';
  headerHtml += "</div>";
  document.getElementById("userHeader").innerHTML =
    headerHtml + '<button class="logout-btn" id="logoutBtn">Logout</button>';
  document.getElementById("logoutBtn").onclick = function () {
    logout();
  };

  const settingsReady = Promise.all([loadUserSettings(user.id), loadGuilds(user.id)]);
  try {
    var fcRes = await FishieWeb.fetch(API + "/user/" + user.id + "/first-command");
    var fcData = await fcRes.json();
    if (fcData.first_command) {
      var d = new Date(fcData.first_command);
      document.getElementById("userSince").textContent =
        "Fishie user since " + d.toISOString().split("T")[0];
    }
  } catch (_) {}

  await settingsReady;

  if (params.get("lastfm") === "connected") {
    var linkedUsername =
      sessionStorage.getItem("lastfm_linked_username") || "your account";
    sessionStorage.removeItem("lastfm_linked_username");
    window.history.replaceState({}, document.title, "/dashboard");
    alert("Connected Last.fm account " + linkedUsername + " to Fishie.");
  }
}

async function loadUserSettings(userId) {
  var div = document.getElementById("userSettingsContent");
  try {
    var [optRes, privacyRes, remRes, accRes, xpRes] = await Promise.all([
      FishieWeb.fetch(API + "/user/" + userId + "/opted-out", {
      }),
      FishieWeb.fetch(API + "/user/" + userId + "/privacy-settings", {
      }),
      FishieWeb.fetch(API + "/user/" + userId + "/reminders", {
      }),
      FishieWeb.fetch(API + "/user/" + userId + "/accounts", {
      }),
      FishieWeb.fetch(API + "/user/" + userId + "/xp", {
      }),
    ]);
    if (![optRes, privacyRes, remRes, accRes, xpRes].every(function (res) {
      return res.ok;
    })) {
      throw new Error("Could not load user settings");
    }
    var optData = await optRes.json();
    var privacyData = await privacyRes.json();
    var remData = await remRes.json();
    var accData = await accRes.json();
    var xpData = await xpRes.json();
    var optedOut = new Set(optData.items || []);
    var items = (await trackingCategories()).user;

    var html =
      '<div class="settings-subtabs" style="display:flex;gap:0.4rem;margin-bottom:0.75rem;flex-wrap:wrap">' +
      '<button id="userTabGeneral" class="guild-tab active" onclick="showUserSettingsTab(\'' + userId + '\',\'general\')">General</button>' +
      '<button id="userTabHighlights" class="guild-tab" onclick="openUserHighlights(\'' + userId + '\')">Highlights</button>' +
      '</div><div id="userGeneralSettings"><div class="card"><div class="settings-group"><h4>Privacy</h4>' +
      '<div class="setting-toggle"><div class="label">Track new activity</div><div class="toggle ' +
      (privacyData.tracking_enabled !== false ? "on" : "") +
      '" onclick="var t=this;t.classList.toggle(\'on\');togUserPrivacy(\'' +
      userId +
      '\',\'tracking_enabled\',t.classList.contains(\'on\'))"></div></div>' +
      '<div class="setting-toggle"><div class="label">Public saved history</div><div class="toggle ' +
      (privacyData.history_public === true ? "on" : "") +
      '" onclick="var t=this;t.classList.toggle(\'on\');togUserPrivacy(\'' +
      userId +
      '\',\'history_public\',t.classList.contains(\'on\'))"></div></div>' +
      '<div class="setting-toggle"><div class="label">Public game statistics</div><div class="toggle ' +
      (privacyData.game_history_public === true ? "on" : "") +
      '" onclick="var t=this;t.classList.toggle(\'on\');togUserPrivacy(\'' +
      userId +
      '\',\'game_history_public\',t.classList.contains(\'on\'))"></div></div>' +
      '<div style="color:#64748b;font-size:0.8rem;margin-top:0.6rem">These settings can be changed at any time and do not delete existing data.</div>' +
      '</div></div><div class="card"><div class="settings-group"><h4>Individual tracking</h4>';
    for (var i = 0; i < items.length; i++) {
      var disabled = Boolean(items[i].disabled);
      var on = !disabled && !optedOut.has(items[i].k);
      html +=
        '<div class="setting-toggle" style="' +
        (disabled ? "opacity:0.45;cursor:not-allowed" : "") +
        '"><div class="label">' +
        esc(items[i].l) +
        (items[i].hint ? '<div class="desc">' + esc(items[i].hint) + "</div>" : "") +
        (disabled
          ? ' <span style="font-size:0.72rem;color:#64748b">(unavailable)</span>'
          : "") +
        "</div>" +
        '<div class="toggle ' +
        (on ? "on" : "") +
        '" data-optout="' +
        items[i].k +
        '"' +
        (disabled
          ? ' aria-disabled="true" title="Discriminator tracking is unavailable"'
          : " onclick=\"var t=this;t.classList.toggle('on');togUserOpt('") +
        (disabled
          ? "></div></div>"
          : userId +
            "','" +
            items[i].k +
            "',t.classList.contains('on'))\"></div></div>");
    }
    html += "</div></div>";

    html +=
      '<div class="card"><div class="settings-group"><h4>XP</h4>' +
      '<div style="display:flex;gap:1.5rem"><div><div class="label">Messages</div><div class="value">' +
      (xpData.messages || 0).toLocaleString() +
      "</div></div>" +
      '<div><div class="label">XP</div><div class="value">' +
      (xpData.xp || 0).toLocaleString() +
      "</div></div></div></div></div>";

    html += '<div class="card"><div class="settings-group"><h4>Reminders</h4>';
    var rems = remData.reminders || [];
    if (!rems.length) {
      html +=
        '<div style="color:#64748b;font-size:0.8rem">No active reminders</div>';
    } else {
      for (var ri = 0; ri < rems.length; ri++) {
        var r = rems[ri];
        var now = Date.now();
        var exp = new Date(r.expires + "Z").getTime();
        var diff = Math.max(0, exp - now);
        var days = Math.floor(diff / 86400000);
        var hours = Math.floor((diff % 86400000) / 3600000);
        var mins = Math.floor((diff % 3600000) / 60000);
        var timeLeft =
          diff === 0
            ? "Expired"
            : (days ? days + "d " : "") + hours + "h " + mins + "m";
        html +=
          '<div class="row"><span style="font-size:0.82rem;color:#cbd5e1">' +
          esc(r.content || "Reminder") +
          '</span><span style="color:#64748b;font-size:0.75rem">' +
          timeLeft +
          "</span></div>";
      }
    }
    html += "</div></div>";

    html +=
      '<div class="card"><div class="settings-group"><h4>Connected Accounts</h4>';
    var accts = accData.accounts || {};
    var lastfm = accts.lastfm || "";
    var steam = accts.steam || "";
    var steamDisplayName = accts.steam_display_name || steam;
    var anilist = accts.anilist || "";
    html +=
      '<div class="row" style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap">' +
      '<span style="color:#94a3b8;font-size:0.78rem;min-width:60px">Last.fm</span>' +
      '<span style="color:' +
      (lastfm ? "#cbd5e1" : "#64748b") +
      ';font-size:0.8rem;flex:1">' +
      (lastfm ? esc(lastfm) : "Not connected") +
      "</span>" +
      '<button class="' +
      (lastfm ? "logout-btn" : "btn-primary") +
      '" onclick="' +
      (lastfm ? "disconnectLastfm('" + userId + "')" : "connectLastfm()") +
      '">' +
      (lastfm ? "Disconnect Last.fm" : "Connect Last.fm") +
      "</button>" +
      "</div>";
    html +=
      '<div class="row" style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap">' +
      '<span style="color:#94a3b8;font-size:0.78rem;min-width:60px">Steam</span>' +
      '<span style="color:' +
      (steam ? "#cbd5e1" : "#64748b") +
      ';font-size:0.8rem;flex:1">' +
      (steam ? esc(steamDisplayName) : "Not connected") +
      "</span>" +
      '<button class="' +
      (steam ? "logout-btn" : "btn-primary") +
      '" onclick="' +
      (steam ? "disconnectSteam('" + userId + "')" : "connectSteam()") +
      '">' +
      (steam ? "Disconnect Steam" : "Connect Steam") +
      "</button></div>";
    html +=
      '<div class="row" style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap">' +
      '<span style="color:#94a3b8;font-size:0.78rem;min-width:60px">AniList</span>' +
      '<span style="color:' +
      (anilist ? "#cbd5e1" : "#64748b") +
      ';font-size:0.8rem;flex:1">' +
      (anilist ? esc(anilist) : "Not connected") +
      "</span>" +
      '<button class="' +
      (anilist ? "logout-btn" : "btn-primary") +
      '" onclick="' +
      (anilist ? "disconnectAnilist('" + userId + "')" : "connectAnilist()") +
      '">' +
      (anilist ? "Disconnect AniList" : "Connect AniList") +
      "</button></div>";
    var svcs = ["roblox", "letterboxd"];
    for (var si = 0; si < svcs.length; si++) {
      var svc = svcs[si];
      var val = accts[svc] || "";
      html +=
        '<div class="row" style="display:flex;align-items:center;gap:0.3rem;flex-wrap:wrap">' +
        '<span style="color:#94a3b8;font-size:0.78rem;min-width:60px">' +
        svc +
        "</span>" +
        '<input type="text" id="acct-' +
        svc +
        '" placeholder="' +
        svc +
        ' username" value="' +
        esc(val) +
        '" class="text-input" style="flex:1;min-width:100px"></div>';
    }
    html +=
      '<button class="btn-primary" style="margin-top:0.5rem" onclick="saveAllAccounts(' +
      "'" +
      userId +
      "'" +
      ')">Save Accounts</button>';
    html += "</div></div>";
    html += "</div>";

    div.innerHTML = html;
    loadUserHighlights(userId);
  } catch (e) {
    console.error("User settings error:", e);
    div.innerHTML = '<p style="color:#64748b">Failed to load settings.</p>';
  }
}

var _userHighlightGuilds = [];
var _userHighlightWords = {};

function showUserSettingsTab(userId, tab) {
  var general = document.getElementById("userGeneralSettings");
  var highlights = document.getElementById("userHighlightsSettings");
  if (general) general.style.display = tab === "general" ? "block" : "none";
  if (highlights) highlights.style.display = tab === "highlights" ? "block" : "none";
  var generalButton = document.getElementById("userTabGeneral");
  var highlightsButton = document.getElementById("userTabHighlights");
  if (generalButton) generalButton.classList.toggle("active", tab === "general");
  if (highlightsButton) highlightsButton.classList.toggle("active", tab === "highlights");
}

async function openUserHighlights(userId) {
  showUserSettingsTab(userId, "highlights");
  await loadUserHighlights(userId);
}

async function loadUserHighlights(userId) {
  var panel = document.getElementById("userHighlightsSettings");
  if (!panel) return;
  panel.innerHTML = '<div class="card"><span style="color:#64748b">Loading highlights...</span></div>';
  try {
    var res = await FishieWeb.fetch(API + "/user/" + userId + "/highlights", { credentials: "include" });
    var data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Could not load highlights");
    _userHighlightGuilds = data.guilds || [];
    _userHighlightWords = {};
    _userHighlightGuilds.forEach(function (guild) {
      _userHighlightWords[String(guild.id)] = (guild.highlights || []).slice();
    });
    renderUserHighlights();
  } catch (error) {
    console.error("User highlights error:", error);
    panel.innerHTML = '<div class="card"><span style="color:#f87171">Failed to load highlights.</span></div>';
  }
}

function renderUserHighlights() {
  var panel = document.getElementById("userHighlightsSettings");
  if (!panel) return;
  if (!_userHighlightGuilds.length) {
    panel.innerHTML = '<div class="card"><div class="settings-group"><h4>Highlights</h4><div class="desc">You do not currently share a server with Fishie.</div></div></div>';
    return;
  }
  var selected = document.getElementById("userHighlightGuildSelect");
  var selectedId = selected ? selected.value : String(_userHighlightGuilds[0].id);
  if (!_userHighlightGuilds.some(function (guild) { return String(guild.id) === selectedId; })) {
    selectedId = String(_userHighlightGuilds[0].id);
  }
  var guild = _userHighlightGuilds.find(function (item) { return String(item.id) === selectedId; });
  var words = _userHighlightWords[selectedId] || [];
  var html = '<div class="card"><div class="settings-group"><h4>Highlights</h4><div class="desc">Choose a shared server to manage the words that send you a highlight notification.</div><select class="text-input" id="userHighlightGuildSelect" onchange="renderUserHighlights()">';
  html += _userHighlightGuilds.map(function (item) {
    return '<option value="' + esc(item.id) + '"' + (String(item.id) === selectedId ? ' selected' : '') + '>' + esc(item.name) + '</option>';
  }).join("");
  html += '</select></div></div><div class="card"><div class="settings-group"><h4>' + esc(guild.name) + '</h4><div class="prefix-list">';
  if (!words.length) html += '<span style="color:#64748b;font-size:0.8rem">No highlights configured.</span>';
  words.forEach(function (word, index) {
    html += '<span class="prefix-tag">' + esc(word) + ' <span class="remove" onclick="removeUserHighlight(' + index + ')">×</span></span>';
  });
  html += '</div><div style="display:flex;gap:0.3rem;flex-wrap:wrap"><input type="text" class="text-input" id="newUserHighlight" maxlength="100" placeholder="Word or phrase" style="flex:1;min-width:12rem"><button class="btn-primary" onclick="addUserHighlight()">Add</button><button class="btn-primary" onclick="saveUserHighlights(\'' + selectedId + '\')">Save</button></div></div></div>';
  panel.innerHTML = html;
}

function addUserHighlight() {
  var select = document.getElementById("userHighlightGuildSelect");
  var input = document.getElementById("newUserHighlight");
  if (!select || !input) return;
  var word = input.value.trim().replace(/\s+/g, " ");
  if (!word) return;
  var words = _userHighlightWords[select.value] || [];
  if (word.length > 100 || words.some(function (item) { return item.toLowerCase() === word.toLowerCase(); })) return;
  words.push(word);
  _userHighlightWords[select.value] = words;
  renderUserHighlights();
}

function removeUserHighlight(index) {
  var select = document.getElementById("userHighlightGuildSelect");
  if (!select) return;
  var words = _userHighlightWords[select.value] || [];
  words.splice(index, 1);
  _userHighlightWords[select.value] = words;
  renderUserHighlights();
}

async function saveUserHighlights(guildId) {
  var res = await FishieWeb.fetch(API + "/user/" + (JSON.parse(localStorage.getItem("discord_user") || "{}").id || "") + "/highlights", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ guild_id: guildId, words: _userHighlightWords[guildId] || [] }),
  });
  if (!res.ok) {
    var detail = await res.text();
    console.error("Highlight save failed", res.status, detail);
    alert("Could not save highlights: " + detail);
    return;
  }
  alert("Highlights saved.");
}

function togUserOpt(userId, item, enable) {
  return saveSetting("/user/" + userId + "/opted-out", {changes: {[item]: enable}}, () => loadUserSettings(userId));
}

function togUserPrivacy(userId, setting, enabled) {
  return saveSetting("/user/" + userId + "/privacy-settings", {[setting]: enabled}, () => loadUserSettings(userId));
}

async function saveAllAccounts(userId) {
  var svcs = ["roblox", "letterboxd"];
  var payload = {};
  for (var si = 0; si < svcs.length; si++) {
    var el = document.getElementById("acct-" + svcs[si]);
    if (el) payload[svcs[si]] = el.value.trim();
  }
  await saveSetting("/user/" + userId + "/accounts", {accounts: payload}, () => loadUserSettings(userId));
}

async function connectLastfm() {
  try {
    var res = await FishieWeb.fetch(API + "/lastfm/connect", {
    });
    var data = await res.json();
    if (!res.ok || !data.url)
      throw new Error(data.detail || "Could not start Last.fm connection");
    window.location.href = data.url;
  } catch (e) {
    alert(e.message || "Could not start Last.fm connection.");
  }
}

async function connectSteam() {
  try {
    var res = await FishieWeb.fetch(API + "/steam/connect", {
    });
    var data = await res.json();
    if (!res.ok || !data.url)
      throw new Error(data.detail || "Could not start Steam connection");
    window.location.href = data.url;
  } catch (e) {
    alert(e.message || "Could not start Steam connection.");
  }
}

async function connectAnilist() {
  try {
    var res = await FishieWeb.fetch(API + "/anilist/connect", {
    });
    var data = await res.json();
    if (!res.ok || !data.url)
      throw new Error(data.detail || "Could not start AniList connection");
    window.location.href = data.url;
  } catch (e) {
    alert(e.message || "Could not start AniList connection.");
  }
}

async function disconnectLastfm(userId) {
  if (!confirm("Disconnect your Last.fm account from Fishie?")) return;
  try {
    var res = await FishieWeb.fetch(API + "/user/" + userId + "/lastfm", {
      method: "DELETE",
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Could not disconnect Last.fm");
    await loadUserSettings(userId);
  } catch (e) {
    alert(e.message || "Could not disconnect Last.fm.");
  }
}

async function disconnectSteam(userId) {
  if (!confirm("Disconnect your Steam account from Fishie?")) return;
  try {
    var res = await FishieWeb.fetch(API + "/user/" + userId + "/steam", {
      method: "DELETE",
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Could not disconnect Steam");
    await loadUserSettings(userId);
  } catch (e) {
    alert(e.message || "Could not disconnect Steam.");
  }
}

async function disconnectAnilist(userId) {
  if (!confirm("Disconnect your AniList account from Fishie?")) return;
  try {
    var res = await FishieWeb.fetch(API + "/user/" + userId + "/anilist", {
      method: "DELETE",
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Could not disconnect AniList");
    await loadUserSettings(userId);
  } catch (e) {
    alert(e.message || "Could not disconnect AniList.");
  }
}

async function loadGuilds(userId) {
  const select = document.getElementById("guildSelect");
  try {
    const res = await FishieWeb.fetch(API + "/user/" + userId + "/guilds");
    if (!res.ok) throw new Error("Could not load servers");
    const data = await res.json();
    select.innerHTML = '<option value="">Select a server…</option>' +
      (data.guilds || []).map(guild => '<option value="' + esc(guild.id) + '">' + esc(guild.name) + '</option>').join("");
    select.disabled = false;
  } catch (error) {
    select.innerHTML = '<option value="">Could not load servers</option>';
    select.disabled = true;
    settingsStatus(error.message, true);
  }
}
document.getElementById("guildSelect").onchange = event => {
  const guildId = event.target.value;
  if (guildId) loadGuildSettings(guildId);
  else {
    guildSettingsVersion++;
    document.getElementById("guildSettingsContent").innerHTML = "";
  }
};

let guildSettingsVersion = 0;
async function loadGuildSettings(guildId) {
  const version = ++guildSettingsVersion;
  var div = document.getElementById("guildSettingsContent");
  div.innerHTML = '<p style="color:#64748b">Loading...</p>';
  try {
    var user = JSON.parse(localStorage.getItem("discord_user") || "{}");
    var [gRes, setRes, optRes, preRes, cmdRes] = await Promise.all([
      FishieWeb.fetch(API + "/user/" + user.id + "/guilds", {
      }),
      FishieWeb.fetch(API + "/guild/" + guildId + "/settings", {
      }),
      FishieWeb.fetch(API + "/guild/" + guildId + "/opted-out"),
      FishieWeb.fetch(API + "/guild/" + guildId + "/prefixes"),
      FishieWeb.fetch(API + "/guild/" + guildId + "/command-disables"),
    ]);
    if (![gRes, setRes, optRes, preRes].every(res => res.ok)) throw new Error("Could not load guild settings");
    var gData = await gRes.json();
    var guild = null;
    for (var gi = 0; gi < (gData.guilds || []).length; gi++) {
      if (gData.guilds[gi].id === guildId) {
        guild = gData.guilds[gi];
        break;
      }
    }
    var guildName = guild ? guild.name : guildId;
    var setData = await setRes.json();
    var optData = await optRes.json();
    var preData = await preRes.json();
    var optedOut = new Set(optData.items || []);
    var prefixes = preData.prefixes || [];
    var commandData = cmdRes.ok
      ? await cmdRes.json()
      : { commands: [], channels: [], disabled: [], error: true };
    var autoDownload = setData.auto_download || "";
    var honeypot = setData.honeypot || "";
    var poketwo = setData.poketwo || false;
    var autoReactions = setData.auto_reactions || false;
    var pinboard = setData.pinboard || "";

    var html =
      '<div class="settings-subtabs guild-settings-tabs" style="display:flex;gap:0.4rem;margin-bottom:0.75rem;flex-wrap:wrap">' +
      '<button id="guildTabGeneral" class="guild-tab active" onclick="showGuildSettingsTab(\'' +
      guildId +
      '\',\'general\')">General</button>' +
      '<button id="guildTabNotifications" class="guild-tab" onclick="showGuildSettingsTab(\'' +
      guildId +
      '\',\'notifications\')">Notifications</button>' +
      '<button id="guildTabLogger" class="guild-tab" onclick="showGuildSettingsTab(\'' +
      guildId +
      '\',\'logger\')">Logger channels</button></div>' +
      '<div id="guildGeneralTab"><div class="card">';
    var guildIcon = guild && guild.icon ? guild.icon : null;
    var iconUrl = guildIcon || null;
    html +=
      '<div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.75rem">';
    if (iconUrl)
      html +=
        '<img src="' +
        iconUrl +
        '" alt="" style="width:40px;height:40px;border-radius:50%">';
    html +=
      '<div><div style="font-size:0.95rem;color:#f8fafc;font-weight:600">' +
      esc(guildName) +
      '</div><div style="font-size:0.75rem;color:#64748b">ID: ' +
      guildId +
      "</div></div>";
    html += "</div>";
    html +=
      '<div class="setting-toggle"><div><div class="label">Auto-Download Channel</div><div class="desc">Messages with attachments are auto-forwarded here</div></div><div class="channel-input-group"><input type="text" class="text-input" id="gAutoDl" value="' +
      (autoDownload || "") +
      '" placeholder="Channel ID"><button class="btn-primary" onclick="saveGChan(' +
      "'" +
      guildId +
      "'" +
      ",'auto_download')\">Save</button></div></div>";
    html +=
      '<div class="setting-toggle"><div><div class="label">Honeypot Channel</div><div class="desc">Automatically ban people who talk here</div></div><div class="channel-input-group"><input type="text" class="text-input" id="gHoneypot" value="' +
      (honeypot || "") +
      '" placeholder="Channel ID"><button class="btn-primary" onclick="saveGChan(' +
      "'" +
      guildId +
      "'" +
      ",'honeypot')\">Save</button></div></div>";
    html +=
      '<div class="setting-toggle"><div><div class="label">Pinboard Channel</div><div class="desc">Pinned message archives go here</div></div><div class="channel-input-group"><input type="text" class="text-input" id="gPinboard" value="' +
      (pinboard || "") +
      '" placeholder="Channel ID"><button class="btn-primary" onclick="saveGChan(' +
      "'" +
      guildId +
      "'" +
      ",'pinboard')\">Save</button></div></div>";
    html += "</div>";
    html += '<div class="settings-group"><h4>Toggles</h4>';
    html +=
      '<div class="setting-toggle"><div class="label">Auto Reactions</div><div class="desc">Auto-react with up and downvotes on Media </div><div class="toggle ' +
      (autoReactions ? "on" : "") +
      "\" onclick=\"var t=this;t.classList.toggle('on');togGSet(" +
      "'" +
      guildId +
      "'" +
      ",'auto_reactions',t.classList.contains('on'))\"></div></div>";
    html +=
      '<div class="setting-toggle"><div class="label">PokéTwo Auto-Solve</div><div class="desc">Auto-solve PokéTwo spawns</div><div class="toggle ' +
      (poketwo ? "on" : "") +
      "\" onclick=\"var t=this;t.classList.toggle('on');togGSet(" +
      "'" +
      guildId +
      "'" +
      ",'poketwo',t.classList.contains('on'))\"></div></div>";
    html += "</div>";
    html += '<div class="settings-group"><h4>Custom Prefixes</h4>';
    html += '<div class="prefix-list" id="prefixList">';
    if (prefixes.length === 0) {
      html +=
        '<span style="color:#64748b;font-size:0.8rem">No custom prefixes</span>';
    } else {
      for (var pi = 0; pi < prefixes.length; pi++) {
        html +=
          '<span class="prefix-tag">' +
          esc(prefixes[pi].prefix) +
          ' <span class="remove" data-prefix="' +
          esc(prefixes[pi].prefix) +
          '">×</span></span>';
      }
    }
    html += "</div>";
    html +=
      '<div style="display:flex;gap:0.3rem"><input type="text" class="text-input" id="newPrefix" placeholder="Prefix (max 10 chars)" style="flex:1"><button class="btn-primary" onclick="addPrefix(' +
      "'" +
      guildId +
      "'" +
      ')">Add</button></div>';
    html += "</div>";

    html += '<div class="settings-group"><h4>Command Controls</h4>';
    html +=
      '<div class="desc" style="margin-bottom:0.6rem">Disable commands server-wide or only in a specific text channel.</div>';
    var commandOptions = commandData.commands || [];
    if (commandData.error || !commandOptions.length) {
      html +=
        '<div style="color:#f59e0b;font-size:0.8rem">Command controls are unavailable right now. Please refresh and try again.</div></div>';
    } else {
      html +=
        '<div style="display:flex;gap:0.4rem;flex-wrap:wrap">' +
        '<input class="text-input" id="gCommand" list="gCommandOptions" autocomplete="off" placeholder="Type to filter commands" style="flex:1;min-width:12rem">' +
        '<datalist id="gCommandOptions">';
      for (var ci = 0; ci < commandOptions.length; ci++) {
        html +=
          '<option value="' +
          esc(commandOptions[ci].name) +
          '"></option>';
      }
      html +=
        '</datalist><select data-search-label="Command channel" class="text-input" id="gCommandChannel" style="flex:1;min-width:12rem"><option value="0">Entire server</option>';
    var commandChannels = commandData.channels || [];
    for (var cci = 0; cci < commandChannels.length; cci++) {
      html +=
        '<option value="' +
        esc(commandChannels[cci].id) +
        '">#' +
        esc(commandChannels[cci].name) +
        "</option>";
    }
    html +=
      '</select><button class="btn-primary" onclick="setGuildCommand(\'' +
      guildId +
      '\',true)">Disable</button></div>';
    html += '<div style="margin-top:0.75rem">';
    var disabledCommands = commandData.disabled || [];
    if (!disabledCommands.length) {
      html +=
        '<span style="color:#64748b;font-size:0.8rem">No commands are disabled.</span>';
    } else {
      var channelNames = {};
      for (var cni = 0; cni < commandChannels.length; cni++) {
        channelNames[String(commandChannels[cni].id)] =
          "#" + commandChannels[cni].name;
      }
      for (var dci = 0; dci < disabledCommands.length; dci++) {
        var disabledItem = disabledCommands[dci];
        var scope = disabledItem.channel_id
          ? channelNames[String(disabledItem.channel_id)] ||
            "channel " + disabledItem.channel_id
          : "entire server";
        html +=
          '<div class="row" style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap"><span style="color:#cbd5e1;flex:1"><code>' +
          esc(disabledItem.command) +
          "</code> · " +
          esc(scope) +
          '</span><button class="logout-btn" onclick="enableGuildCommand(\'' +
          guildId +
          '\',\'' +
          esc(disabledItem.command) +
          '\',' +
          JSON.stringify(String(disabledItem.channel_id || "0")) +
          ')">Enable</button></div>';
      }
    }
    html += "</div></div>";
    }

    html += '<div class="settings-group"><h4>Server tracking and privacy</h4>';
    html +=
      '<div class="setting-toggle"><div class="label">Track new server activity</div><div class="toggle ' +
      (optData.tracking_enabled !== false ? "on" : "") +
      '" onclick="var t=this;t.classList.toggle(\'on\');togGuildPrivacy(\'' +
      guildId +
      '\',\'tracking_enabled\',t.classList.contains(\'on\'))"></div></div>' +
      '<div class="setting-toggle"><div class="label">Public saved server history</div><div class="toggle ' +
      (optData.history_public === true ? "on" : "") +
      '" onclick="var t=this;t.classList.toggle(\'on\');togGuildPrivacy(\'' +
      guildId +
      '\',\'history_public\',t.classList.contains(\'on\'))"></div></div>';
    var tItems = (await trackingCategories()).guild;
    for (var ti = 0; ti < tItems.length; ti++) {
      var on = !optedOut.has(tItems[ti].k);
      html +=
        '<div class="setting-toggle"><div class="label">' +
        tItems[ti].l +
        "</div>" +
        '<div class="toggle ' +
        (on ? "on" : "") +
        "\" onclick=\"var t=this;t.classList.toggle('on');togGOpt(" +
        "'" +
        guildId +
        "'" +
        ",'" +
        tItems[ti].k +
        "',t.classList.contains('on'))\"></div></div>";
    }
    html += "</div>";

    html +=
      '</div><div id="guildNotificationsTab" style="display:none"><div class="settings-subtabs">' +
      '<button class="guild-tab active" data-notification="twitch">Twitch</button>' +
      '<button class="guild-tab" data-notification="anime">Anime</button>' +
      '</div>' +
      '<div id="guildTwitchTab"></div><div id="guildAnimeTab" style="display:none"></div></div><div id="guildLoggerTab" style="display:none"></div>';

    if (version !== guildSettingsVersion) return;
    div.innerHTML = html;
    makeSearchablePickers(div);
    var prefixList = div.querySelector("#prefixList");
    if (prefixList) {
      prefixList.querySelectorAll(".remove").forEach(function (removeButton) {
        removeButton.addEventListener("click", function () {
          remPrefix(guildId, removeButton.dataset.prefix || "");
        });
      });
    }
    div.querySelectorAll("[data-notification]").forEach(button => {
      button.onclick = () => {
        for (const kind of ["twitch", "anime"]) {
          document.getElementById("guild" + kind[0].toUpperCase() + kind.slice(1) + "Tab").style.display = kind === button.dataset.notification ? "block" : "none";
          div.querySelector('[data-notification="' + kind + '"]').classList.toggle("active", kind === button.dataset.notification);
        }
      };
    });
    loadGuildTwitchTab(guildId);
    loadGuildNotifications(guildId, "anime");
    loadGuildLoggerTab(guildId);
  } catch (e) {
    if (version !== guildSettingsVersion) return;
    console.error("Guild settings error:", e);
    div.innerHTML =
      '<p style="color:#64748b">Failed to load guild settings.</p>';
  }
}

function showGuildSettingsTab(guildId, tab) {
  ["general", "notifications", "logger"].forEach(function (name) {
    var panel = document.getElementById("guild" + name[0].toUpperCase() + name.slice(1) + "Tab");
    if (panel) panel.style.display = name === tab ? "block" : "none";
    var button = document.getElementById("guildTab" + name[0].toUpperCase() + name.slice(1));
    if (button) button.classList.toggle("active", name === tab);
  });
}

function loadGuildTwitchTab(guildId) { return loadGuildNotifications(guildId, "twitch"); }

async function notificationRequest(path, options = {}) {
  const res = await FishieWeb.fetch(API + path, {signal: AbortSignal.timeout(40000), ...options});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Could not update notifications");
  return data;
}

function makeSearchablePickers(root) {
  root.querySelectorAll("select[data-search-label]").forEach(select => {
    if (select.closest(".search-picker")) return;
    const label = select.dataset.searchLabel;
    // A disclosure contains multiple controls, so don't nest them in one label.
    if (select.parentElement.tagName === "LABEL") {
      const wrapper = document.createElement("div");
      wrapper.className = "picker-field";
      const oldLabel = select.parentElement;
      wrapper.append(...oldLabel.childNodes);
      oldLabel.replaceWith(wrapper);
    }
    const picker = document.createElement("details");
    picker.className = "search-picker";
    const summary = document.createElement("summary");
    summary.className = "text-input";
    const menu = document.createElement("div");
    menu.className = "picker-menu";
    const search = document.createElement("input");
    search.type = "search";
    search.className = "text-input";
    search.placeholder = "Type to filter…";
    search.setAttribute("aria-label", "Filter " + label.toLowerCase());
    search.autocomplete = "off";
    const empty = document.createElement("p");
    empty.setAttribute("role", "status");
    empty.textContent = "No matches.";
    empty.hidden = true;
    select.before(picker);
    picker.append(summary, menu);
    menu.append(search, select, empty);
    select.size = 6;
    select.setAttribute("aria-label", label);
    const updateSummary = () => {
      summary.textContent = select.selectedOptions[0]?.textContent || "Choose " + label.toLowerCase();
      summary.setAttribute("aria-label", label + ": " + summary.textContent);
    };
    const filter = () => {
      const query = search.value.trim().toLocaleLowerCase().replace(/^[@#]/, "");
      for (const option of select.options) {
        option.hidden = !((option.textContent + " " + option.value).toLocaleLowerCase().includes(query));
      }
      empty.hidden = [...select.options].some(option => !option.hidden);
    };
    const close = () => { picker.open = false; summary.focus(); };
    select.addEventListener("change", () => { updateSummary(); close(); });
    picker.addEventListener("toggle", () => {
      if (!picker.open) return;
      document.querySelectorAll(".search-picker[open]").forEach(other => { if (other !== picker) other.open = false; });
      search.value = "";
      filter();
      search.focus();
    });
    search.addEventListener("input", filter);
    search.addEventListener("keydown", event => {
      if (event.key === "ArrowDown") { event.preventDefault(); select.focus(); }
    });
    picker.addEventListener("keydown", event => {
      if (event.key === "Escape") { event.preventDefault(); close(); }
      else if (event.key === "Enter" && event.target === select) { event.preventDefault(); updateSummary(); close(); }
    });
    updateSummary();
  });
}
document.addEventListener("click", event => {
  document.querySelectorAll(".search-picker[open]").forEach(picker => {
    if (!picker.contains(event.target)) picker.open = false;
  });
});

function mentionSelect(id, roles, follow = {}) {
  const value = follow.mention_everyone ? "everyone" : String(follow.mention_role_id || "");
  const options = [{id: "", name: "No mention"}, {id: "everyone", name: "@everyone"}, ...roles];
  if (value && !options.some(role => String(role.id) === value)) options.push({id: value, name: "Deleted role (choose a replacement)"});
  return '<label>Mention role <select data-search-label="Mention role" class="text-input" id="' + id + '">' +
    options.map(role => '<option value="' + esc(role.id) + '"' + (String(role.id) === value ? " selected" : "") + '>' + esc(role.name) + '</option>').join("") + '</select></label>';
}

async function loadGuildNotifications(guildId, kind) {
  const panel = document.getElementById("guild" + kind[0].toUpperCase() + kind.slice(1) + "Tab");
  if (!panel) return;
  try {
    const data = await notificationRequest("/guild/" + guildId + "/" + kind + "-follows");
    const follows = data.follows || [], channels = data.channels || [], roles = data.roles || [];
    const channelSelect = (id, selected) => {
      const choices = channels.slice();
      if (selected && !choices.some(channel => String(channel.id) === String(selected))) choices.push({id: selected, name: "Unavailable channel (choose a replacement)"});
      return '<label>Announcement channel <select data-search-label="Announcement channel" class="text-input" id="' + id + '">' +
        choices.map(channel => '<option value="' + esc(channel.id) + '"' + (String(channel.id) === String(selected) ? " selected" : "") + '>#' + esc(channel.name) + '</option>').join("") + '</select></label>';
    };
    const label = kind === "anime" ? "Anime" : "Twitch";
    let html = '<div class="card"><h4>' + label + ' notifications</h4><p class="desc">Follow up to ' + (kind === "anime" ? "20 upcoming anime" : "10 Twitch channels") + ' per server. New follows do not mention anyone unless selected.</p>' +
      '<label>' + label + ' name or link <input id="' + kind + 'NewName" class="text-input" maxlength="200"></label>' +
      channelSelect(kind + "NewChannel", null) + mentionSelect(kind + "NewMention", roles) +
      '<button class="btn-primary" data-add>Follow</button><p role="status" data-status></p></div>';
    follows.forEach((follow, index) => {
      const base = kind + "Follow" + index;
      const date = follow.next_airing_at || follow.release_at;
      html += '<div class="card"><h4>' + esc(follow.id) + ' · ' + esc(follow.title || follow.channel_name) + '</h4>' +
        (date ? '<p class="desc">' + (follow.next_episode ? "Episode " + esc(follow.next_episode) + " · " : "Releases ") + esc(new Date(date).toLocaleString()) + '</p>' : "") +
        channelSelect(base + "Channel", follow.announce_channel_id) + mentionSelect(base + "Mention", roles, follow) +
        '<div style="display:flex;gap:0.4rem;margin-top:0.5rem"><button class="btn-primary" data-save="' + index + '">Save</button><button class="logout-btn" data-remove="' + index + '">Unfollow</button></div></div>';
    });
    if (!follows.length) html += '<p class="desc">No ' + label + ' follows yet.</p>';
    if (!panel.isConnected) return;
    panel.innerHTML = html;
    makeSearchablePickers(panel);
    const destination = base => {
      const mention = panel.querySelector("#" + base + "Mention").value;
      return {
        announce_channel_id: panel.querySelector("#" + base + "Channel").value,
        mention_role_id: mention && mention !== "everyone" ? mention : null,
        mention_everyone: mention === "everyone"
      };
    };
    const run = async (button, action) => {
      button.disabled = true;
      const status = panel.querySelector("[data-status]");
      status.textContent = "Saving…";
      try { const result = await action(); if (result !== false) await loadGuildNotifications(guildId, kind); else status.textContent = ""; }
      catch (error) { status.textContent = error.message; }
      finally { button.disabled = false; }
    };
    const post = payload => notificationRequest("/guild/" + guildId + "/" + kind + "-follows", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(payload)});
    panel.querySelector("[data-add]").onclick = event => run(event.currentTarget, async () => {
      const value = panel.querySelector("#" + kind + "NewName").value.trim();
      if (!value) throw new Error("Enter a " + label + " name or link.");
      const payload = destination(kind + "New");
      if (!payload.announce_channel_id) throw new Error("Choose an announcement channel.");
      if (kind === "anime") {
        const candidate = await notificationRequest("/guild/" + guildId + "/anime-search?q=" + encodeURIComponent(value));
        if (!confirm("Follow " + candidate.title + "?\n" + (candidate.episode ? "Episode " + candidate.episode + " airing " : "Releases ") + new Date(candidate.airing_at).toLocaleString())) return false;
        payload.anilist_id = candidate.id;
      } else {
        payload.channel_name = value;
      }
      await post(payload);
    });
    panel.querySelectorAll("[data-save]").forEach(button => button.onclick = () => run(button, () => {
      const follow = follows[Number(button.dataset.save)];
      return post({...destination(kind + "Follow" + button.dataset.save), ...(kind === "anime" ? {id: follow.id} : {channel_name: follow.channel_name})});
    }));
    panel.querySelectorAll("[data-remove]").forEach(button => button.onclick = () => run(button, async () => {
      const follow = follows[Number(button.dataset.remove)];
      if (!confirm("Unfollow " + (follow.title || follow.channel_name) + "?")) return false;
      return notificationRequest("/guild/" + guildId + "/" + kind + "-follows/" + encodeURIComponent(kind === "anime" ? follow.id : follow.channel_name), {method: "DELETE"});
    }));
  } catch (error) {
    panel.innerHTML = '<p role="status">' + esc(error.message) + '</p>';
  }
}

async function loadGuildLoggerTab(guildId) {
  var panel = document.getElementById("guildLoggerTab");
  if (!panel) return;
  try {
    var res = await FishieWeb.fetch(API + "/guild/" + guildId + "/logger");
    var data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Could not load logger settings");
    var channels = data.channels || [];
    var configured = {};
    (data.configured || []).forEach(function (item) { configured[String(item.event).toLowerCase()] = item; });
    var loggerChannels = channels.slice();
    (data.configured || []).forEach(function (item) {
      if (item.channel_id != null && !loggerChannels.some(function (channel) {
        return String(channel.id) === String(item.channel_id);
      })) {
        loggerChannels.push({
          id: String(item.channel_id),
          name: item.channel_name || "Configured channel",
        });
      }
    });
    var html = '<div class="card"><div class="settings-group"><h4>Logger channels</h4><div class="desc">Each event uses its own Fishie webhook. Select a channel or clear an event.</div>';
    Object.keys(data.events || {}).forEach(function (event) {
      var item = configured[event];
      html += '<div style="display:flex;align-items:flex-end;gap:0.6rem;flex-wrap:wrap;padding:0.65rem 0;border-top:1px solid #2a2c2f"><div style="flex:1;min-width:14rem"><div class="label">' + esc(data.events[event]) + '</div><select data-search-label="Logger channel" class="text-input" id="logger-' + esc(event) + '"><option value="">Disabled</option>' + loggerChannels.map(function (channel) { return '<option value="' + esc(channel.id) + '"' + (item && String(item.channel_id) === String(channel.id) ? ' selected' : '') + '>#' + esc(channel.name) + '</option>'; }).join("") + '</select></div><button class="btn-primary" style="flex:0 0 auto;white-space:nowrap" onclick="saveLoggerEvent(\'' + guildId + '\',\'' + event + '\')">Save</button></div>';
    });
    html += '</div></div>';
    if (!panel.isConnected) return;
    panel.innerHTML = html;
    makeSearchablePickers(panel);
  } catch (error) {
    console.error("Logger settings error:", error);
    panel.innerHTML = '<div class="card"><span style="color:#f87171">Failed to load logger settings.</span></div>';
  }
}

async function saveLoggerEvent(guildId, event) {
  var input = document.getElementById("logger-" + event);
  if (!input) return;
  var url = API + "/guild/" + guildId + "/logger";
  var options = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: event, channel_id: input.value }) };
  if (!input.value) { options.method = "DELETE"; url += "/" + encodeURIComponent(event); delete options.body; }
  var res = await FishieWeb.fetch(url, options);
  if (!res.ok) { alert("Could not update that logger event."); return; }
  loadGuildLoggerTab(guildId);
}

async function saveGChan(guildId, key) {
  var el = document.getElementById(
    { auto_download: "gAutoDl", honeypot: "gHoneypot", pinboard: "gPinboard" }[
      key
    ],
  );
  var val = el ? el.value.trim() : "";
  var payload = {};
  payload[key] = val || null;
  await saveSetting("/guild/" + guildId + "/settings", payload, () => loadGuildSettings(guildId));
}

async function togGSet(guildId, key, enable) {
  var payload = {};
  payload[key] = enable;
  await saveSetting("/guild/" + guildId + "/settings", payload, () => loadGuildSettings(guildId));
}

async function setGuildCommand(guildId, disabled) {
  var command = document.getElementById("gCommand");
  var channel = document.getElementById("gCommandChannel");
  if (!command || !command.value) return;
  try {
    var res = await FishieWeb.fetch(API + "/guild/" + guildId + "/command-disables", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        command: command.value,
        channel_id: channel ? channel.value : "0",
        disabled: Boolean(disabled),
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    await loadGuildSettings(guildId);
  } catch (e) {
    console.error("Command setting error:", e);
    alert("Could not update that command setting.");
  }
}

async function enableGuildCommand(guildId, command, channelId) {
  try {
    var res = await FishieWeb.fetch(API + "/guild/" + guildId + "/command-disables", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        command: command,
        channel_id: String(channelId || "0"),
        disabled: false,
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    await loadGuildSettings(guildId);
  } catch (e) {
    console.error("Command setting error:", e);
    alert("Could not enable that command.");
  }
}

async function addPrefix(guildId) {
  var inp = document.getElementById("newPrefix");
  var prefix = inp.value.trim();
  if (!prefix || prefix.length > 10) return;
  var user = JSON.parse(localStorage.getItem("discord_user") || "{}");
  try {
    var res = await FishieWeb.fetch(API + "/guild/" + guildId + "/prefixes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prefix: prefix, author_id: user.id }),
    });
    if (!res.ok) {
      var err = await res.text();
      console.error("Prefix add failed:", res.status, err);
      alert("Failed to add prefix: " + err);
      return;
    }
    inp.value = "";
    loadGuildSettings(guildId);
  } catch (e) {
    console.error("Prefix add error:", e);
    alert("Network error adding prefix.");
  }
}

async function remPrefix(guildId, prefix) {
  await FishieWeb.fetch(API + "/guild/" + guildId + "/prefixes", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prefix: prefix }),
  });
  loadGuildSettings(guildId);
}

function togGOpt(guildId, item, enable) {
  return saveSetting("/guild/" + guildId + "/opted-out", {changes: {[item]: enable}}, () => loadGuildSettings(guildId));
}

function togGuildPrivacy(guildId, key, value) {
  return saveSetting("/guild/" + guildId + "/opted-out", {[key]: value}, () => loadGuildSettings(guildId));
}

let categoryRequest;
function trackingCategories() {
  if (!categoryRequest) categoryRequest = FishieWeb.fetch(API + "/tracking-categories").then(async res => {
    if (!res.ok) throw new Error("Could not load tracking categories");
    const data = await res.json();
    for (const scope of ["user", "guild"]) data[scope] = data[scope].map(item => ({...item, k: item.key, l: item.label}));
    return data;
  }).catch(error => { categoryRequest = null; throw error; });
  return categoryRequest;
}

let settingSave = Promise.resolve();
let settingsPending = 0;
document.addEventListener("click", event => {
  if (settingsPending && event.target.closest(".toggle")) { event.preventDefault(); event.stopImmediatePropagation(); }
}, true);
function saveSetting(path, payload, reload) {
  // Serialize saves; send only the changed field, never a stale settings snapshot.
  settingsPending++;
  settingSave = settingSave.then(async () => {
    settingsStatus("Saving…");
    try {
      const res = await FishieWeb.fetch(API + path, {
        signal: AbortSignal.timeout(15000),
        method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Could not save this setting");
      }
      settingsStatus("Saved.");
    } catch (error) {
      await reload();
      settingsStatus(error.message + ". Your saved settings have been restored.", true);
    } finally { settingsPending--; }
  });
  return settingSave;
}

function settingsStatus(message, failed = false) {
  let status = document.getElementById("settingsStatus");
  if (!status) {
    status = document.createElement("p");
    status.id = "settingsStatus";
    status.setAttribute("role", "status");
    document.getElementById("dashboardView").prepend(status);
  }
  status.textContent = message;
  status.style.color = failed ? "#f87171" : "#94a3b8";
}

// Existing toggle styles are retained; native buttons provide keyboard activation.
new MutationObserver(() => {
  document.querySelectorAll("div.toggle").forEach(toggle => {
    const button = document.createElement("button");
    for (const attr of toggle.attributes) button.setAttribute(attr.name, attr.value);
    button.type = "button";
    button.setAttribute("role", "switch");
    button.setAttribute("aria-label", toggle.parentElement.querySelector(".label")?.textContent || "Toggle setting");
    button.disabled = !button.hasAttribute("onclick");
    toggle.replaceWith(button);
  });
  document.querySelectorAll("button.toggle").forEach(button => {
    const value = String(button.classList.contains("on"));
    if (button.getAttribute("aria-checked") !== value) button.setAttribute("aria-checked", value);
  });
}).observe(document.getElementById("dashboardView"), {childList: true, subtree: true, attributes: true, attributeFilter: ["class"]});
