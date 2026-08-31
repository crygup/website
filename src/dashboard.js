const API = "https://api.crygup.com/fishie";
const REDIRECT = "https://crygup.com/dashboard";

// Authentication is provided by the API's HttpOnly session cookie. Strip any
// legacy bearer header and include the cookie on cross-origin API requests.
(() => {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const options = init || {};
    const headers = new Headers(options.headers || {});
    headers.delete("Authorization");
    const requestUrl =
      typeof input === "string" ? input : input?.url || String(input);
    const credentials = requestUrl.startsWith("https://api.crygup.com/")
      ? "include"
      : options.credentials || "same-origin";
    return nativeFetch(input, { ...options, credentials, headers });
  };
})();

localStorage.removeItem("fishie_token");
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
      const res = await fetch(API + "/oauth/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, state, redirect_uri: REDIRECT }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "OAuth exchange failed");
      if (data.user) {
        localStorage.setItem("fishie_user", JSON.stringify(data.user));
        initDashboard();
      }
    } catch (e) {
      console.error("OAuth failed:", e);
      showLogin();
    }
  })();
} else {
  fetch(API + "/oauth/me")
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
      localStorage.setItem("fishie_user", JSON.stringify(data.user));
      initDashboard();
    })
    .catch((error) => {
      console.error("Could not restore Fishie session:", error);
      showLogin();
    });
}

async function logout() {
  await fetch(API + "/oauth/logout", { method: "POST" });
  localStorage.removeItem("fishie_user");
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
      const res = await fetch(
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

  var user = JSON.parse(localStorage.getItem("fishie_user") || "{}");

  var avatar = user.id
    ? "https://cdn.discordapp.com/avatars/" +
      user.id +
      "/" +
      user.avatar +
      ".png"
    : "";
  var headerHtml = avatar
    ? '<img src="' +
      avatar +
      '" alt="" style="width:48px;height:48px;border-radius:50%">'
    : "";
  headerHtml +=
    '<div class="user-info"><h2>' +
    esc(user.global_name || user.username || "Unknown") +
    "</h2>";
  headerHtml += '<div class="sub">ID: ' + user.id + "</div>";
  headerHtml += '<div class="sub" id="userSince"></div>';
  headerHtml += "</div>";
  document.getElementById("userHeader").innerHTML =
    headerHtml + '<button class="logout-btn" id="logoutBtn">Logout</button>';
  document.getElementById("logoutBtn").onclick = function () {
    logout();
  };

  try {
    var fcRes = await fetch(API + "/user/" + user.id + "/first-command");
    var fcData = await fcRes.json();
    if (fcData.first_command) {
      var d = new Date(fcData.first_command);
      document.getElementById("userSince").textContent =
        "Fishie user since " + d.toISOString().split("T")[0];
    }
  } catch (_) {}

  await loadUserSettings(user.id);
  await loadGuilds(user.id);

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
      fetch(API + "/user/" + userId + "/opted-out", {
      }),
      fetch(API + "/user/" + userId + "/privacy-settings", {
      }),
      fetch(API + "/user/" + userId + "/reminders", {
      }),
      fetch(API + "/user/" + userId + "/accounts", {
      }),
      fetch(API + "/user/" + userId + "/xp", {
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
    var items = [
      { k: "avatar", l: "Avatar" },
      { k: "username", l: "Username" },
      { k: "display", l: "Display name" },
      { k: "nickname", l: "Nickname" },
      { k: "discrim", l: "Discriminator", disabled: true },
      { k: "stag", l: "Server tags" },
      { k: "status", l: "Status" },
      { k: "joins", l: "Server joins" },
      { k: "xp", l: "XP and message count" },
      { k: "commands", l: "Command usage" },
      { k: "activity", l: "Game and activity" },
      { k: "pokemon", l: "Pokémon solves" },
      { k: "corn", l: "Corn reactions" },
      { k: "reactions", l: "Reaction history" },
      { k: "games", l: "Game statistics" },
      { k: "currency", l: "Currency history" },
    ];

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
      '<div style="color:#64748b;font-size:0.8rem;margin-top:0.6rem">These settings can be changed at any time and do not delete existing data.</div>' +
      '</div></div><div class="card"><div class="settings-group"><h4>Individual tracking</h4>';
    for (var i = 0; i < items.length; i++) {
      var disabled = Boolean(items[i].disabled);
      var on = !disabled && !optedOut.has(items[i].k);
      html +=
        '<div class="setting-toggle" style="' +
        (disabled ? "opacity:0.45;cursor:not-allowed" : "") +
        '"><div class="label">' +
        items[i].l +
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
    var res = await fetch(API + "/user/" + userId + "/highlights", { credentials: "include" });
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
  var res = await fetch(API + "/user/" + (JSON.parse(localStorage.getItem("fishie_user") || "{}").id || "") + "/highlights", {
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

async function togUserOpt(userId, item, enable) {
  try {
    var res = await fetch(API + "/user/" + userId + "/opted-out", {
    });
    var data = await res.json();
    var items = data.items || [];
    if (enable)
      items = items.filter(function (i) {
        return i !== item;
      });
    else {
      if (!items.includes(item)) items.push(item);
    }
    await fetch(API + "/user/" + userId + "/opted-out", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ items: items }),
    });
  } catch (_) {}
}

async function togUserPrivacy(userId, setting, enabled) {
  try {
    var res = await fetch(API + "/user/" + userId + "/privacy-settings");
    if (!res.ok) throw new Error("Could not load privacy settings");
    var data = await res.json();
    data[setting] = enabled;
    var saveRes = await fetch(API + "/user/" + userId + "/privacy-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tracking_enabled: data.tracking_enabled !== false,
        history_public: data.history_public !== false,
      }),
    });
    if (!saveRes.ok) throw new Error("Could not save privacy settings");
  } catch (error) {
    console.error("Privacy settings update failed:", error);
    await loadUserSettings(userId);
  }
}

async function saveAllAccounts(userId) {
  var svcs = ["roblox", "letterboxd"];
  var payload = {};
  for (var si = 0; si < svcs.length; si++) {
    var el = document.getElementById("acct-" + svcs[si]);
    if (el) payload[svcs[si]] = el.value.trim();
  }
  await fetch(API + "/user/" + userId + "/accounts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ accounts: payload }),
  });
}

async function connectLastfm() {
  try {
    var res = await fetch(API + "/lastfm/connect", {
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
    var res = await fetch(API + "/steam/connect", {
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
    var res = await fetch(API + "/anilist/connect", {
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
    var res = await fetch(API + "/user/" + userId + "/lastfm", {
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
    var res = await fetch(API + "/user/" + userId + "/steam", {
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
    var res = await fetch(API + "/user/" + userId + "/anilist", {
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
  try {
    var res = await fetch(API + "/user/" + userId + "/guilds", {
    });
    var data = await res.json();
    var list = document.getElementById("guildDropdownList");
    var text = document.getElementById("guildDropdownText");
    var guilds = data.guilds || [];
    list.innerHTML =
      '<div class="guild-dropdown-item" data-id="">' +
      '<div class="item-info"><div class="item-name" style="color:#64748b">Select a server...</div></div></div>';
    for (var gi = 0; gi < guilds.length; gi++) {
      var g = guilds[gi];
      var iconUrl = g.icon ? g.icon : null;
      var img = iconUrl
        ? '<img src="' + iconUrl + '" alt="" loading="lazy">'
        : "";
      list.innerHTML +=
        '<div class="guild-dropdown-item" data-id="' +
        g.id +
        '">' +
        img +
        '<div class="item-info">' +
        '<div class="item-name">' +
        esc(g.name) +
        "</div>" +
        '<div class="item-sub">ID: ' +
        g.id +
        "</div>" +
        "</div></div>";
    }
    if (list.dataset.selectedId) {
      var prev = list.querySelector(
        '[data-id="' + list.dataset.selectedId + '"]',
      );
      if (prev) text.textContent = prev.querySelector(".item-name").textContent;
    }
  } catch (_) {
    document.getElementById("guildDropdownList").innerHTML =
      '<div style="color:#64748b;padding:0.5rem;font-size:0.85rem">Failed to load servers</div>';
  }
}

function selectGuild(guildId) {
  if (!guildId) {
    document.getElementById("guildSettingsContent").innerHTML = "";
    return;
  }
  loadGuildSettings(guildId);
}

document.addEventListener("click", function (e) {
  var dd = document.getElementById("guildDropdown");
  var header = document.getElementById("guildDropdownHeader");
  var list = document.getElementById("guildDropdownList");
  if (!dd) return;
  if (header && header.contains(e.target)) {
    dd.classList.toggle("open");
  } else if (!dd.contains(e.target)) {
    dd.classList.remove("open");
  }
  var item = e.target.closest(".guild-dropdown-item");
  if (item && list && list.contains(item)) {
    var id = item.dataset.id;
    var text = document.getElementById("guildDropdownText");
    var name = item.querySelector(".item-name").textContent;
    text.textContent = name;
    list.dataset.selectedId = id;
    dd.classList.remove("open");
    selectGuild(id);
  }
});

var _guildChannels = {};

async function loadGuildSettings(guildId) {
  var div = document.getElementById("guildSettingsContent");
  div.innerHTML = '<p style="color:#64748b">Loading...</p>';
  try {
    var user = JSON.parse(localStorage.getItem("fishie_user") || "{}");
    var [gRes, setRes, optRes, preRes, cmdRes] = await Promise.all([
      fetch(API + "/user/" + user.id + "/guilds", {
      }),
      fetch(API + "/guild/" + guildId + "/settings", {
      }),
      fetch(API + "/guild/" + guildId + "/opted-out"),
      fetch(API + "/guild/" + guildId + "/prefixes"),
      fetch(API + "/guild/" + guildId + "/command-disables"),
    ]);
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
      '<button id="guildTabTwitch" class="guild-tab" onclick="showGuildSettingsTab(\'' +
      guildId +
      '\',\'twitch\')">Twitch follows</button>' +
      '<button id="guildTabYoutube" class="guild-tab" onclick="showGuildSettingsTab(\'' +
      guildId +
      '\',\'youtube\')">YouTube follows</button>' +
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
          ' <span class="remove" onclick="remPrefix(' +
          "'" +
          guildId +
          "'" +
          ",'" +
          esc(prefixes[pi].prefix) +
          "')\">×</span></span>";
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
        '</datalist><select class="text-input" id="gCommandChannel" style="flex:1;min-width:12rem"><option value="0">Entire server</option>';
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
    var tItems = [
      { k: "icon", l: "Server icon history" },
      { k: "name", l: "Server name history" },
      { k: "joins", l: "Member join history" },
      { k: "status", l: "Member status history" },
      { k: "commands", l: "Server command logs" },
      { k: "emoji", l: "Emoji statistics" },
      { k: "downloads", l: "Download statistics" },
      { k: "corn", l: "Corn reactions" },
      { k: "reactions", l: "Reaction history" },
      { k: "tags", l: "Server tags" },
      { k: "mudae", l: "Mudae wishes and timers" },
    ];
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
      '</div><div id="guildTwitchTab" style="display:none"></div><div id="guildYoutubeTab" style="display:none"></div><div id="guildLoggerTab" style="display:none"></div>';

    div.innerHTML = html;
    loadGuildTwitchTab(guildId);
    loadGuildYoutubeTab(guildId);
    loadGuildLoggerTab(guildId);
  } catch (e) {
    console.error("Guild settings error:", e);
    div.innerHTML =
      '<p style="color:#64748b">Failed to load guild settings.</p>';
  }
}

function showGuildSettingsTab(guildId, tab) {
  ["general", "twitch", "youtube", "logger"].forEach(function (name) {
    var panel = document.getElementById("guild" + name[0].toUpperCase() + name.slice(1) + "Tab");
    if (panel) panel.style.display = name === tab ? "block" : "none";
    var button = document.getElementById("guildTab" + name[0].toUpperCase() + name.slice(1));
    if (button) button.classList.toggle("active", name === tab);
  });
}

async function loadGuildTwitchTab(guildId) {
  var panel = document.getElementById("guildTwitchTab");
  if (!panel) return;
  try {
    var res = await fetch(API + "/guild/" + guildId + "/twitch-follows");
    var data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Could not load Twitch follows");
    var channels = data.channels || [];
    var html = '<div class="card"><div class="settings-group"><h4>Twitch follows</h4>';
    html += '<div class="desc">Follow up to three channels and customize where and what announcements post.</div>';
    html += '<div style="display:flex;gap:0.4rem;flex-wrap:wrap;margin-top:0.6rem"><input id="twNewName" class="text-input" placeholder="Twitch channel name" style="flex:1;min-width:10rem"><select id="twNewChannel" class="text-input" style="flex:1;min-width:10rem">';
    html += channels.map(function (channel) { return '<option value="' + esc(channel.id) + '">#' + esc(channel.name) + '</option>'; }).join("");
    html += '</select><button class="btn-primary" onclick="saveTwitchFollow(\'' + guildId + '\',null)">Follow</button></div>';
    html += '<textarea id="twNewMessage" class="text-input" maxlength="2000" placeholder="Optional announcement text" style="width:100%;margin-top:0.4rem;min-height:4rem"></textarea></div></div>';
    var follows = data.follows || [];
    if (!follows.length) html += '<div class="card"><span style="color:#64748b;font-size:0.8rem">No Twitch channels are followed.</span></div>';
    follows.forEach(function (follow, index) {
      var base = "twFollow" + index;
      var followChannels = channels.slice();
      if (follow.announce_channel_id != null && !followChannels.some(function (channel) {
        return String(channel.id) === String(follow.announce_channel_id);
      })) {
        followChannels.push({
          id: String(follow.announce_channel_id),
          name: follow.announce_channel_name || "Configured channel",
        });
      }
      html += '<div class="card"><div class="settings-group"><h4>' + esc(follow.channel_name) + '</h4>';
      html += '<label class="label">Announcement channel</label><select class="text-input" id="' + base + 'Channel">' + followChannels.map(function (channel) { return '<option value="' + esc(channel.id) + '"' + (String(channel.id) === String(follow.announce_channel_id) ? ' selected' : '') + '>#' + esc(channel.name) + '</option>'; }).join("") + '</select>';
      html += '<textarea class="text-input" id="' + base + 'Message" maxlength="2000" placeholder="Optional announcement text" style="width:100%;margin-top:0.4rem;min-height:4rem">' + esc(follow.message_template || "") + '</textarea>';
      html += '<div style="display:flex;gap:0.4rem;margin-top:0.4rem"><button class="btn-primary" onclick="saveTwitchFollow(\'' + guildId + '\',\'' + esc(follow.channel_name) + '\',\'' + base + '\')">Save</button><button class="logout-btn" onclick="removeTwitchFollow(\'' + guildId + '\',\'' + esc(follow.channel_name) + '\')">Unfollow</button></div></div></div>';
    });
    panel.innerHTML = html;
    // Set the existing destination explicitly after rendering.  This keeps the
    // saved channel selected even when the browser does not honor a generated
    // `selected` attribute while replacing the panel HTML.
    follows.forEach(function (follow, index) {
      var select = document.getElementById("twFollow" + index + "Channel");
      if (select && follow.announce_channel_id != null) {
        select.value = String(follow.announce_channel_id);
      }
    });
  } catch (error) {
    console.error("Twitch settings error:", error);
    panel.innerHTML = '<div class="card"><span style="color:#f87171">Failed to load Twitch follows.</span></div>';
  }
}

async function saveTwitchFollow(guildId, channelName, base) {
  var name = channelName || (document.getElementById("twNewName") || {}).value;
  var channel = document.getElementById(base ? base + "Channel" : "twNewChannel");
  var message = document.getElementById(base ? base + "Message" : "twNewMessage");
  if (!name || !channel) return;
  // Discord snowflake IDs exceed JavaScript's safe integer range. Keep the
  // selected value as a string so it reaches the API without rounding.
  var res = await fetch(API + "/guild/" + guildId + "/twitch-follows", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel_name: name, announce_channel_id: channel.value, message_template: message ? message.value : null }) });
  if (!res.ok) {
    var detail = await res.text();
    console.error("Twitch follow save failed", res.status, detail);
    alert("Could not save the Twitch follow: " + detail);
    return;
  }
  loadGuildTwitchTab(guildId);
}

async function removeTwitchFollow(guildId, channelName) {
  if (!confirm("Unfollow " + channelName + "?")) return;
  var res = await fetch(API + "/guild/" + guildId + "/twitch-follows/" + encodeURIComponent(channelName), { method: "DELETE" });
  if (!res.ok) { alert("Could not unfollow that Twitch channel."); return; }
  loadGuildTwitchTab(guildId);
}

function youtubeEventCheckboxes(base, selected) {
  var enabled = new Set(selected || ["video", "live", "short", "community"]);
  return ["video", "live", "short", "community"].map(function (event) {
    var label = event === "short" ? "Shorts" : event[0].toUpperCase() + event.slice(1);
    return '<label style="display:flex;align-items:center;gap:0.3rem;color:#cbd5e1;font-size:0.8rem"><input type="checkbox" id="' + base + "Event" + event + '"' + (enabled.has(event) ? " checked" : "") + ">" + label + "</label>";
  }).join("");
}

function selectedYoutubeEvents(base) {
  return ["video", "live", "short", "community"].filter(function (event) {
    var input = document.getElementById(base + "Event" + event);
    return input && input.checked;
  });
}

async function loadGuildYoutubeTab(guildId) {
  var panel = document.getElementById("guildYoutubeTab");
  if (!panel) return;
  try {
    var res = await fetch(API + "/guild/" + guildId + "/youtube-follows");
    var data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Could not load YouTube follows");
    var channels = data.channels || [];
    var html = '<div class="card"><div class="settings-group"><h4>YouTube follows</h4>';
    html += '<div class="desc">Follow up to three channels. Uploads use near real-time notifications. Community posts use a lightweight periodic check.</div>';
    html += '<div style="display:flex;gap:0.4rem;flex-wrap:wrap;margin-top:0.6rem"><input id="ytNewName" class="text-input" placeholder="@handle or YouTube channel URL" style="flex:1;min-width:12rem"><select id="ytNewChannel" class="text-input" style="flex:1;min-width:10rem">';
    html += channels.map(function (channel) { return '<option value="' + esc(channel.id) + '">#' + esc(channel.name) + '</option>'; }).join("");
    html += '</select><button class="btn-primary" onclick="saveYoutubeFollow(\'' + guildId + '\',null)">Follow</button></div>';
    html += '<div style="display:flex;gap:0.8rem;flex-wrap:wrap;margin-top:0.55rem">' + youtubeEventCheckboxes("ytNew", data.event_types) + '</div>';
    html += '<textarea id="ytNewMessage" class="text-input" maxlength="2000" placeholder="Optional announcement text" style="width:100%;margin-top:0.4rem;min-height:4rem"></textarea></div></div>';
    var follows = data.follows || [];
    if (!follows.length) html += '<div class="card"><span style="color:#64748b;font-size:0.8rem">No YouTube channels are followed.</span></div>';
    follows.forEach(function (follow, index) {
      var base = "ytFollow" + index;
      var followChannels = channels.slice();
      if (follow.announce_channel_id != null && !followChannels.some(function (channel) {
        return String(channel.id) === String(follow.announce_channel_id);
      })) {
        followChannels.push({ id: String(follow.announce_channel_id), name: follow.announce_channel_name || "Configured channel" });
      }
      html += '<div class="card"><div class="settings-group"><h4>' + esc(follow.channel_name) + '</h4>';
      if (follow.channel_handle) html += '<div class="desc">' + esc(follow.channel_handle) + '</div>';
      html += '<label class="label">Announcement channel</label><select class="text-input" id="' + base + 'Channel">' + followChannels.map(function (channel) { return '<option value="' + esc(channel.id) + '"' + (String(channel.id) === String(follow.announce_channel_id) ? ' selected' : '') + '>#' + esc(channel.name) + '</option>'; }).join("") + '</select>';
      html += '<div style="display:flex;gap:0.8rem;flex-wrap:wrap;margin-top:0.55rem">' + youtubeEventCheckboxes(base, follow.event_types) + '</div>';
      html += '<textarea class="text-input" id="' + base + 'Message" maxlength="2000" placeholder="Optional announcement text" style="width:100%;margin-top:0.4rem;min-height:4rem">' + esc(follow.message_template || "") + '</textarea>';
      html += '<div style="display:flex;gap:0.4rem;margin-top:0.4rem"><button class="btn-primary" onclick="saveYoutubeFollow(\'' + guildId + '\',\'' + esc(follow.youtube_channel_id) + '\',\'' + base + '\')">Save</button><button class="logout-btn" onclick="removeYoutubeFollow(\'' + guildId + '\',\'' + esc(follow.youtube_channel_id) + '\')">Unfollow</button></div></div></div>';
    });
    panel.innerHTML = html;
    follows.forEach(function (follow, index) {
      var select = document.getElementById("ytFollow" + index + "Channel");
      if (select) select.value = String(follow.announce_channel_id);
    });
  } catch (error) {
    console.error("YouTube settings error:", error);
    panel.innerHTML = '<div class="card"><span style="color:#f87171">Failed to load YouTube follows.</span></div>';
  }
}

async function saveYoutubeFollow(guildId, channelId, base) {
  var query = channelId || (document.getElementById("ytNewName") || {}).value;
  var prefix = base || "ytNew";
  var channel = document.getElementById(prefix + "Channel");
  var message = document.getElementById(prefix + "Message");
  var eventTypes = selectedYoutubeEvents(prefix);
  if (!query || !channel) return;
  if (!eventTypes.length) {
    alert("Choose at least one YouTube notification type.");
    return;
  }
  var res = await fetch(API + "/guild/" + guildId + "/youtube-follows", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      channel: query,
      youtube_channel_id: channelId || null,
      announce_channel_id: channel.value,
      message_template: message ? message.value : null,
      event_types: eventTypes,
    }),
  });
  if (!res.ok) {
    var data = await res.json().catch(function () { return {}; });
    alert("Could not save the YouTube follow: " + (data.detail || "Unknown error"));
    return;
  }
  loadGuildYoutubeTab(guildId);
}

async function removeYoutubeFollow(guildId, channelId) {
  if (!confirm("Unfollow this YouTube channel?")) return;
  var res = await fetch(API + "/guild/" + guildId + "/youtube-follows/" + encodeURIComponent(channelId), { method: "DELETE" });
  if (!res.ok) {
    alert("Could not unfollow that YouTube channel.");
    return;
  }
  loadGuildYoutubeTab(guildId);
}

async function loadGuildLoggerTab(guildId) {
  var panel = document.getElementById("guildLoggerTab");
  if (!panel) return;
  try {
    var res = await fetch(API + "/guild/" + guildId + "/logger");
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
      html += '<div style="display:flex;align-items:flex-end;gap:0.6rem;flex-wrap:wrap;padding:0.65rem 0;border-top:1px solid #2a2c2f"><div style="flex:1;min-width:14rem"><div class="label">' + esc(data.events[event]) + '</div><select class="text-input" id="logger-' + esc(event) + '"><option value="">Disabled</option>' + loggerChannels.map(function (channel) { return '<option value="' + esc(channel.id) + '"' + (item && String(item.channel_id) === String(channel.id) ? ' selected' : '') + '>#' + esc(channel.name) + '</option>'; }).join("") + '</select></div><button class="btn-primary" style="flex:0 0 auto;white-space:nowrap" onclick="saveLoggerEvent(\'' + guildId + '\',\'' + event + '\')">Save</button></div>';
    });
    html += '</div></div>';
    panel.innerHTML = html;
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
  var res = await fetch(url, options);
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
  await fetch(API + "/guild/" + guildId + "/settings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

async function togGSet(guildId, key, enable) {
  var payload = {};
  payload[key] = enable;
  await fetch(API + "/guild/" + guildId + "/settings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

async function setGuildCommand(guildId, disabled) {
  var command = document.getElementById("gCommand");
  var channel = document.getElementById("gCommandChannel");
  if (!command || !command.value) return;
  try {
    var res = await fetch(API + "/guild/" + guildId + "/command-disables", {
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
    var res = await fetch(API + "/guild/" + guildId + "/command-disables", {
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
  var user = JSON.parse(localStorage.getItem("fishie_user") || "{}");
  try {
    var res = await fetch(API + "/guild/" + guildId + "/prefixes", {
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
  await fetch(API + "/guild/" + guildId + "/prefixes", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prefix: prefix }),
  });
  loadGuildSettings(guildId);
}

async function togGOpt(guildId, item, enable) {
  try {
    var res = await fetch(API + "/guild/" + guildId + "/opted-out");
    var data = await res.json();
    var items = data.items || [];
    if (enable)
      items = items.filter(function (i) {
        return i !== item;
      });
    else {
      if (!items.includes(item)) items.push(item);
    }
    await fetch(API + "/guild/" + guildId + "/opted-out", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        items: items,
        tracking_enabled: data.tracking_enabled !== false,
        history_public: data.history_public !== false,
      }),
    });
  } catch (_) {}
}

async function togGuildPrivacy(guildId, key, value) {
  try {
    var res = await fetch(API + "/guild/" + guildId + "/opted-out");
    var data = await res.json();
    var payload = {
      items: data.items || [],
      tracking_enabled: data.tracking_enabled !== false,
      history_public: data.history_public === true,
    };
    payload[key] = value;
    await fetch(API + "/guild/" + guildId + "/opted-out", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (_) {}
}
