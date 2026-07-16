const API = "https://api.crygup.com/fishie";
const CLIENT_ID = "876391494485950504";
const REDIRECT = "https://crygup.com/dashboard";
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

if (code) {
  (async () => {
    try {
      const res = await fetch(
        API + "/oauth/exchange?code=" + encodeURIComponent(code),
      );
      const data = await res.json();
      if (data.access_token) {
        localStorage.setItem("fishie_token", data.access_token);
        localStorage.setItem("fishie_user", JSON.stringify(data.user));
        window.history.replaceState({}, document.title, "/dashboard");
        initDashboard();
      }
    } catch (e) {
      console.error("OAuth failed:", e);
    }
  })();
} else {
  var token = localStorage.getItem("fishie_token");
  if (token) initDashboard();
  else showLogin();
}

var _logout = document.getElementById("logoutBtn");
if (_logout)
  _logout.onclick = function () {
    localStorage.removeItem("fishie_token");
    localStorage.removeItem("fishie_user");
    location.reload();
  };
var _login = document.getElementById("loginBtn");
if (_login)
  _login.onclick = function () {
    window.location.href =
      "https://discord.com/api/oauth2/authorize?client_id=" +
      CLIENT_ID +
      "&redirect_uri=" +
      encodeURIComponent(REDIRECT) +
      "&response_type=code&scope=identify%20guilds";
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
  var token = localStorage.getItem("fishie_token");

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
    localStorage.removeItem("fishie_token");
    localStorage.removeItem("fishie_user");
    location.reload();
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

  await loadUserSettings(user.id, token);
  await loadGuilds(user.id, token);

  if (params.get("lastfm") === "connected") {
    var linkedUsername =
      sessionStorage.getItem("lastfm_linked_username") || "your account";
    sessionStorage.removeItem("lastfm_linked_username");
    window.history.replaceState({}, document.title, "/dashboard");
    alert("Connected Last.fm account " + linkedUsername + " to Fishie.");
  }
}

async function loadUserSettings(userId, token) {
  var div = document.getElementById("userSettingsContent");
  try {
    var [optRes, remRes, accRes, xpRes] = await Promise.all([
      fetch(API + "/user/" + userId + "/opted-out", {
        headers: { Authorization: "Bearer " + token },
      }),
      fetch(API + "/user/" + userId + "/reminders", {
        headers: { Authorization: "Bearer " + token },
      }),
      fetch(API + "/user/" + userId + "/accounts", {
        headers: { Authorization: "Bearer " + token },
      }),
      fetch(API + "/user/" + userId + "/xp", {
        headers: { Authorization: "Bearer " + token },
      }),
    ]);
    var optData = await optRes.json();
    var remData = await remRes.json();
    var accData = await accRes.json();
    var xpData = await xpRes.json();
    var optedOut = new Set(optData.items || []);
    var items = [
      { k: "avatar", l: "Avatar" },
      { k: "username", l: "Username" },
      { k: "display", l: "Display name" },
      { k: "nickname", l: "Nickname" },
      { k: "discrim", l: "Discriminator" },
      { k: "joins", l: "Server joins" },
    ];

    var html =
      '<div class="card"><div class="settings-group"><h4>Tracking</h4>';
    for (var i = 0; i < items.length; i++) {
      var on = !optedOut.has(items[i].k);
      html +=
        '<div class="setting-toggle"><div class="label">' +
        items[i].l +
        "</div>" +
        '<div class="toggle ' +
        (on ? "on" : "") +
        '" data-optout="' +
        items[i].k +
        "\" onclick=\"var t=this;t.classList.toggle('on');togUserOpt('" +
        userId +
        "','" +
        items[i].k +
        "',t.classList.contains('on'))\"></div></div>";
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

    div.innerHTML = html;
  } catch (e) {
    console.error("User settings error:", e);
    div.innerHTML = '<p style="color:#64748b">Failed to load settings.</p>';
  }
}

async function togUserOpt(userId, item, enable) {
  var token = localStorage.getItem("fishie_token");
  try {
    var res = await fetch(API + "/user/" + userId + "/opted-out", {
      headers: { Authorization: "Bearer " + token },
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
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ items: items }),
    });
  } catch (_) {}
}

async function saveAllAccounts(userId) {
  var token = localStorage.getItem("fishie_token");
  var svcs = ["roblox", "letterboxd"];
  var payload = {};
  for (var si = 0; si < svcs.length; si++) {
    var el = document.getElementById("acct-" + svcs[si]);
    if (el) payload[svcs[si]] = el.value.trim();
  }
  await fetch(API + "/user/" + userId + "/accounts", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ accounts: payload }),
  });
}

async function connectLastfm() {
  var token = localStorage.getItem("fishie_token");
  try {
    var res = await fetch(API + "/lastfm/connect", {
      headers: { Authorization: "Bearer " + token },
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
  var token = localStorage.getItem("fishie_token");
  try {
    var res = await fetch(API + "/steam/connect", {
      headers: { Authorization: "Bearer " + token },
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
  var token = localStorage.getItem("fishie_token");
  try {
    var res = await fetch(API + "/anilist/connect", {
      headers: { Authorization: "Bearer " + token },
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
  var token = localStorage.getItem("fishie_token");
  try {
    var res = await fetch(API + "/user/" + userId + "/lastfm", {
      method: "DELETE",
      headers: { Authorization: "Bearer " + token },
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Could not disconnect Last.fm");
    await loadUserSettings(userId, token);
  } catch (e) {
    alert(e.message || "Could not disconnect Last.fm.");
  }
}

async function disconnectSteam(userId) {
  if (!confirm("Disconnect your Steam account from Fishie?")) return;
  var token = localStorage.getItem("fishie_token");
  try {
    var res = await fetch(API + "/user/" + userId + "/steam", {
      method: "DELETE",
      headers: { Authorization: "Bearer " + token },
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Could not disconnect Steam");
    await loadUserSettings(userId, token);
  } catch (e) {
    alert(e.message || "Could not disconnect Steam.");
  }
}

async function disconnectAnilist(userId) {
  if (!confirm("Disconnect your AniList account from Fishie?")) return;
  var token = localStorage.getItem("fishie_token");
  try {
    var res = await fetch(API + "/user/" + userId + "/anilist", {
      method: "DELETE",
      headers: { Authorization: "Bearer " + token },
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Could not disconnect AniList");
    await loadUserSettings(userId, token);
  } catch (e) {
    alert(e.message || "Could not disconnect AniList.");
  }
}

async function loadGuilds(userId, token) {
  try {
    var res = await fetch(API + "/user/" + userId + "/guilds", {
      headers: { Authorization: "Bearer " + token },
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
  loadGuildSettings(guildId, localStorage.getItem("fishie_token"));
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

async function loadGuildSettings(guildId, token) {
  var div = document.getElementById("guildSettingsContent");
  div.innerHTML = '<p style="color:#64748b">Loading...</p>';
  try {
    var user = JSON.parse(localStorage.getItem("fishie_user") || "{}");
    var [gRes, setRes, optRes, preRes] = await Promise.all([
      fetch(API + "/user/" + user.id + "/guilds", {
        headers: { Authorization: "Bearer " + token },
      }),
      fetch(API + "/guild/" + guildId + "/settings", {
        headers: { Authorization: "Bearer " + token },
      }),
      fetch(API + "/guild/" + guildId + "/opted-out"),
      fetch(API + "/guild/" + guildId + "/prefixes"),
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
    var autoDownload = setData.auto_download || "";
    var honeypot = setData.honeypot || "";
    var poketwo = setData.poketwo || false;
    var autoReactions = setData.auto_reactions || false;
    var pinboard = setData.pinboard || "";

    var html = '<div class="card">';
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

    html += '<div class="settings-group"><h4>Tracking Opt-Out</h4>';
    var tItems = [
      { k: "name", l: "Server name logging" },
      { k: "icon", l: "Server icon logging" },
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

    html += "</div>";

    div.innerHTML = html;
  } catch (e) {
    console.error("Guild settings error:", e);
    div.innerHTML =
      '<p style="color:#64748b">Failed to load guild settings.</p>';
  }
}

async function saveGChan(guildId, key) {
  var token = localStorage.getItem("fishie_token");
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
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

async function togGSet(guildId, key, enable) {
  var token = localStorage.getItem("fishie_token");
  var payload = {};
  payload[key] = enable;
  await fetch(API + "/guild/" + guildId + "/settings", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

async function addPrefix(guildId) {
  var inp = document.getElementById("newPrefix");
  var prefix = inp.value.trim();
  if (!prefix || prefix.length > 10) return;
  var token = localStorage.getItem("fishie_token");
  var user = JSON.parse(localStorage.getItem("fishie_user") || "{}");
  try {
    var res = await fetch(API + "/guild/" + guildId + "/prefixes", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
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
    loadGuildSettings(guildId, token);
  } catch (e) {
    console.error("Prefix add error:", e);
    alert("Network error adding prefix.");
  }
}

async function remPrefix(guildId, prefix) {
  var token = localStorage.getItem("fishie_token");
  await fetch(API + "/guild/" + guildId + "/prefixes", {
    method: "DELETE",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prefix: prefix }),
  });
  loadGuildSettings(guildId, token);
}

async function togGOpt(guildId, item, enable) {
  var token = localStorage.getItem("fishie_token");
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
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ items: items }),
    });
  } catch (_) {}
}
