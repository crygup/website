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
localStorage.removeItem("discord_token");

const FISHIE_API_BASE = "https://api.crygup.com/fishie";
const FISHIE_HOME_REDIRECT = "https://crygup.com";

window.startFishieOAuth = async function (redirectUri = FISHIE_HOME_REDIRECT) {
  const response = await fetch(
    `${FISHIE_API_BASE}/oauth/start?redirect_uri=${encodeURIComponent(redirectUri)}`,
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.url) {
    throw new Error(data.detail || "Could not start Discord login");
  }
  window.location.assign(data.url);
};

(function () {
  const page = document.body.dataset.page || "";

  const links = [
    { label: "Home", href: "/", match: "" },
    { label: "Discord", href: "/discord", match: "discord" },
    { label: "Fishie", href: "/fishie", match: "fishie" },
    { label: "Messages", href: "/messages", match: "messages" },
    {
      label: "Mudae",
      match: "mudae",
      subs: [
        { label: "OC Solver", href: "/oc" },
        { label: "OQ Solver", href: "/oq" },
      ],
    },
  ];

  const btn = document.createElement("button");
  btn.className = "hamburger";
  btn.innerHTML = "\u2630";
  btn.setAttribute("aria-label", "Menu");
  document.body.prepend(btn);

  const overlay = document.createElement("div");
  overlay.className = "sidebar-overlay";
  document.body.prepend(overlay);

  const sidebar = document.createElement("nav");
  sidebar.className = "sidebar";

  let html = "";

  function buildLoginSection() {
    const user = JSON.parse(localStorage.getItem("discord_user") || "null");
    let section = "";
    if (user) {
      const avatarUrl = user.avatar
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
        : "https://cdn.discordapp.com/embed/avatars/0.png";
      section += `<div class="sidebar-user">`;
      section += `<img src="${avatarUrl}" alt="" class="sidebar-avatar">`;
      section += `<span class="sidebar-username">${user.global_name || user.username}</span>`;
      section += `<button class="sidebar-logout">Logout</button>`;
      section += `</div>`;
    } else {
      section += `<a href="#" class="sidebar-login">Login with Discord</a>`;
    }
    section += `<div class="sidebar-divider"></div>`;
    return section;
  }

  html += buildLoginSection();

  for (const item of links) {
    if (item.subs) {
      const expanded = page === item.match ? " expanded" : "";
      html += `<button class="sidebar-expand${expanded}">${item.label}<span class="sidebar-arrow"></span></button>`;
      html += `<div class="sidebar-subs${expanded}">`;
      for (const sub of item.subs) {
        html += `<a href="${sub.href}" class="sidebar-sub">${sub.label}</a>`;
      }
      html += `</div>`;
    } else {
      const active = page === item.match ? " active" : "";
      html += `<a href="${item.href}" class="${active}">${item.label}</a>`;
    }
  }
  sidebar.innerHTML = html;
  document.body.prepend(sidebar);

  function bindLogout() {
    const btn = sidebar.querySelector(".sidebar-logout");
    if (btn) {
      btn.addEventListener("click", () => {
        fetch("https://api.crygup.com/fishie/oauth/logout", {
          method: "POST",
        }).finally(() => {
          localStorage.removeItem("discord_user");
          window.location.reload();
        });
      });
    }
  }

  function bindLogin() {
    const link = sidebar.querySelector(".sidebar-login");
    if (link) {
      link.addEventListener("click", async (event) => {
        event.preventDefault();
        try {
          await window.startFishieOAuth(FISHIE_HOME_REDIRECT);
        } catch (error) {
          console.error("Could not start Discord login:", error);
        }
      });
    }
  }

  bindLogout();
  bindLogin();

  function rebuildLogin() {
    const userEl = sidebar.querySelector(".sidebar-user, .sidebar-login");
    const divider = sidebar.querySelector(".sidebar-divider");
    if (userEl) userEl.remove();
    if (divider) divider.remove();
    sidebar.insertAdjacentHTML("afterbegin", buildLoginSection());
    bindLogout();
    bindLogin();
  }
  window.addEventListener("discord-login", rebuildLogin);

  function open() {
    rebuildLogin();
    sidebar.classList.add("open");
    overlay.classList.add("open");
  }
  function close() {
    sidebar.classList.remove("open");
    overlay.classList.remove("open");
  }

  btn.addEventListener("click", () =>
    sidebar.classList.contains("open") ? close() : open(),
  );
  overlay.addEventListener("click", close);
  sidebar.addEventListener("click", (e) => {
    if (e.target.tagName === "A") close();
  });

  const expandBtn = sidebar.querySelector(".sidebar-expand");
  const subsDiv = sidebar.querySelector(".sidebar-subs");
  if (expandBtn && subsDiv) {
    expandBtn.addEventListener("click", () => {
      expandBtn.classList.toggle("expanded");
      subsDiv.classList.toggle("expanded");
    });
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
})();

const YOUTUBE_PROXY = "https://youtube.crygup.com";
const YOUTUBE_CHANNEL = "@crygup";
const LASTFM_PROXY = "https://lastfm.crygup.com";
const LASTFM_USER = "crygup";

const profile = {
  name: "crygup",
  tagline: "did you know rawr means i love you in dinosaur",
  bio: `<strong>hey!</strong> my name's zil, but you can call me z, crygup, cry, or whatever you want. i don't really mind.

i'm a part-time video editor for a few different overwatch streamers. you can check out some of my work in the <a href="#" data-tab="videos">videos</a> tab.

i'm also a part-time software developer working on a bunch of different projects, though my main focus right now is my discord bot. you can learn more about it in the <a href="#" data-tab="projects">projects</a> tab.

i've been editing videos for about 8 years now, though i only recently got back into it as a hobby. programming's been a similar story but i've been doing it for about 10+ years, but with ai taking over it's been pretty demotivating, so i only do it as a hobby nowadays. fun fact: that's actually what got me back into video editing.

programming-wise, i'm proficient in python, ts/js, and lua and i'm currently learning c# and rust.

as for video editing, i've used adobe premiere pro for years, but about a year ago i switched to davinci resolve. i've been loving it ever since and i'm fully committed to the switch.

any pronouns`,

  projects: [
    {
      name: "Fishie",
      desc: `Fishie is an all around multipurpose Discord bot. Its main use is avatar, username, and nickname tracking.

As well, Fishie offers a wide range of useful features that make it a valuable addition to any server. If you use the Pokétwo or Mudae bots, Fishie includes tools designed specifically for them. Need reminders for Mudae? Fishie has you covered. Want help identifying a newly spawned Pokémon? Fishie can do that too.

You'll also find a download command, which supports a variety of websites, essential moderation tools, including a honeypot system that can automatically ban spammers, along with many other features to help everyone in your server.

<a href="https://discord.com/oauth2/authorize?client_id=876391494485950504&scope=bot+applications.commands&permissions=138513074240" target="_blank" rel="noopener">Invite here.</a>`,
    },
    {
      name: "Mudae Tools",
      desc: `Couple of helpful tools to solve some of the Mudae bot minigames.
<a href="/oc" target="_blank" rel="noopener">OC Solver</a> & <a href="/oc" target="_blank" rel="noopener">OQ Solver</a>`,
    },
    {
      name: "Discord avatar/username history",
      desc: `Saved using my Discord bot, Fishie, we can track the avatars, usernames and more of any user and view them online.
Check it out <a href="/discord" target="_blank" rel="noopener">here</a>`,
    },
    {
      name: "Subreddit Image Downloader",
      desc: `Simple CLI tool for mass downloading images from subreddits. Supports flags for time, hot, and more.
<a href="https://github.com/crygup/subreddit-image-downloader" target="_blank" rel="noopener">Get it here.</a>`,
    },
    {
      name: "Duckbot",
      desc: `Popular Discord bot that I have contributed to in the past.
<a href="https://discord.com/oauth2/authorize?client_id=788278464474120202&scope=applications.commands+bot&permissions=294171045078" target="_blank" rel="noopener">Invite here.</a>`,
    },
    {
      name: "Roblox Item Notifier (outdated)",
      desc: `Tool to mention and link a user to an item on Discord via Webhook when it comes on sale. Defaults to the Headless Horseman bundle but can easily be changed to any item by swapping the link.
<a href="https://github.com/crygup/headless-tracker" target="_blank" rel="noopener">Get it here.</a>`,
    },
  ],

  socials: [
    { name: "Discord", url: "https://discord.gg/rM9u4MRFBE" },
    { name: "Twitter", url: "https://x.com/crygup" },
    { name: "Instagram", url: "https://instagram.com/crygup" },
    { name: "YouTube", url: "https://youtube.com/@crygup" },
    { name: "Letterboxd", url: "https://letterboxd.com/fluttershy" },
    { name: "AniList", url: "https://anilist.co/user/fluttershy" },
    {
      name: "Steam",
      url: "https://steamcommunity.com/profiles/76561199034626559/",
    },
    { name: "Last.fm", url: "https://www.last.fm/user/crygup" },
    {
      name: "Spotify",
      url: "https://open.spotify.com/user/ndbz2vxohhd8y09292dtz5lbz",
    },
  ],
};

if (document.getElementById("bio-panel")) {
  document.querySelectorAll(".tab-btn[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document
        .querySelectorAll(".tab-btn[data-tab]")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      document
        .querySelectorAll(".tab-panel")
        .forEach((p) => p.classList.add("hidden"));
      const panel = document.getElementById(`${btn.dataset.tab}-panel`);
      panel.classList.remove("hidden");
    });
  });
}

const mudaeDropdown = document.getElementById("mudae-dropdown");
if (mudaeDropdown) {
  mudaeDropdown.addEventListener("click", (e) => {
    e.stopPropagation();
    mudaeDropdown.classList.toggle("dropdown-open");
  });
  document.addEventListener("click", () => {
    mudaeDropdown.classList.remove("dropdown-open");
  });
}

const nameEl = document.getElementById("name");
if (nameEl)
  nameEl.innerHTML = `${profile.name} <img src="images/drpepper-150.gif" alt="" class="drpepper-gif"> `;

const dp = document.querySelector(".drpepper-gif");
if (dp) {
  const nameRect = nameEl.getBoundingClientRect();
  dp.style.left = nameRect.right + 4 + "px";
  dp.style.top =
    nameRect.top + nameRect.height / 2 - dp.offsetHeight / 2 + "px";

  let dragging = false,
    startX,
    startY,
    startLeft,
    startTop;
  let lastX,
    lastY,
    lastTime,
    vx = 0,
    vy = 0;
  let animFrame;

  function getPos(e) {
    if (e.touches) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    return { x: e.clientX, y: e.clientY };
  }

  function beginDrag(pos) {
    cancelAnimationFrame(animFrame);
    startX = pos.x;
    startY = pos.y;
    startLeft = dp.offsetLeft;
    startTop = dp.offsetTop;
    lastX = pos.x;
    lastY = pos.y;
    lastTime = performance.now();
    vx = 0;
    vy = 0;
    dp.classList.add("dragging");
  }

  function doMove(pos) {
    const moveX = pos.x - startX;
    const moveY = pos.y - startY;
    dp.style.left =
      Math.max(
        0,
        Math.min(window.innerWidth - dp.offsetWidth, startLeft + moveX),
      ) + "px";
    dp.style.top =
      Math.max(
        0,
        Math.min(window.innerHeight - dp.offsetHeight, startTop + moveY),
      ) + "px";
    const now = performance.now();
    const dt = now - lastTime;
    if (dt > 0) {
      vx = ((pos.x - lastX) / dt) * 0.5;
      vy = ((pos.y - lastY) / dt) * 0.5;
    }
    lastX = pos.x;
    lastY = pos.y;
    lastTime = now;
  }

  function endDrag() {
    dp.classList.remove("dragging");
    if (Math.abs(vx) > 0.01 || Math.abs(vy) > 0.01) {
      (function animate() {
        vx *= 0.94;
        vy *= 0.94;
        if (Math.abs(vx) < 0.01 && Math.abs(vy) < 0.01) return;
        let left = dp.offsetLeft + vx * 16;
        let top = dp.offsetTop + vy * 16;
        if (left <= 0) {
          left = 0;
          vx = -vx * 0.5;
        }
        if (left >= window.innerWidth - dp.offsetWidth) {
          left = window.innerWidth - dp.offsetWidth;
          vx = -vx * 0.5;
        }
        if (top <= 0) {
          top = 0;
          vy = -vy * 0.5;
        }
        if (top >= window.innerHeight - dp.offsetHeight) {
          top = window.innerHeight - dp.offsetHeight;
          vy = -vy * 0.5;
        }
        dp.style.left = left + "px";
        dp.style.top = top + "px";
        animFrame = requestAnimationFrame(animate);
      })();
    }
  }

  dp.addEventListener("mousedown", (e) => {
    e.preventDefault();
    dragging = true;
    beginDrag({ x: e.clientX, y: e.clientY });
  });
  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    doMove({ x: e.clientX, y: e.clientY });
  });
  document.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    endDrag();
  });
  let touchScrolling = false;
  dp.addEventListener(
    "touchstart",
    (e) => {
      const pos = getPos(e);
      dragging = false;
      touchScrolling = false;
      beginDrag(pos);
    },
    { passive: false },
  );

  dp.addEventListener(
    "touchmove",
    (e) => {
      const pos = getPos(e);
      const dx = pos.x - startX;
      const dy = pos.y - startY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (!dragging) {
        if (dist < 8) return;
        if (Math.abs(dy) > Math.abs(dx) * 1.5) {
          touchScrolling = true;
          dp.classList.remove("dragging");
          return;
        }
        dragging = true;
        startX = pos.x - dx;
        startY = pos.y - dy;
        startLeft = dp.offsetLeft;
        startTop = dp.offsetTop;
      }

      if (touchScrolling) return;
      e.preventDefault();
      doMove(pos);
    },
    { passive: false },
  );

  function touchEnd() {
    dp.classList.remove("dragging");
    if (!dragging) return;
    dragging = false;
    endDrag();
  }
  dp.addEventListener("touchend", touchEnd);
  dp.addEventListener("touchcancel", touchEnd);
  document.addEventListener("touchend", () => {
    if (dragging) touchEnd();
  });
}
const taglineEl = document.getElementById("tagline");
if (taglineEl) taglineEl.textContent = profile.tagline;
const yearEl = document.getElementById("year");
if (yearEl) yearEl.textContent = String(new Date().getFullYear());
const bio = document.getElementById("bio");
if (bio) bio.innerHTML = profile.bio;

if (bio) {
  bio.addEventListener("click", (e) => {
    const tab = e.target.closest("a")?.dataset.tab;
    if (tab) {
      e.preventDefault();
      document.querySelector(`[data-tab="${tab}"]`)?.click();
    }
  });
}

const socialsEl = document.getElementById("socials");
if (socialsEl) {
  socialsEl.innerHTML = profile.socials
    .map(
      (s) =>
        `<a href="${s.url}" target="_blank" rel="noopener" class="social-link">${s.name}</a>`,
    )
    .join(" · ");
}
const list = document.getElementById("project-list");
if (list) {
  profile.projects.forEach((p) => {
    const li = document.createElement("li");
    li.innerHTML = `${p.name}<div class="project-detail">${p.desc}</div>`;
    li.addEventListener("click", () => {
      li.classList.toggle("expanded");
    });
    list.appendChild(li);
  });
}

const npSection = document.getElementById("now-playing");

async function fetchNowPlaying() {
  const res = await fetch(
    `${LASTFM_PROXY}/?method=user.getrecenttracks&user=${LASTFM_USER}&limit=1&format=json`,
  );
  if (!res.ok) throw new Error("Last.fm fetch failed");
  const data = await res.json();
  const track = data.recenttracks?.track?.[0];
  if (!track) throw new Error("No tracks");

  return {
    playing: track["@attr"]?.nowplaying === "true",
    name: track.name,
    artist: track.artist?.["#text"] || track.artist?.name || "Unknown",
    cover: track.image?.find((i) => i.size === "extralarge")?.["#text"] || "",
    url: track.url,
    playedAt: track.date?.uts ? Number(track.date.uts) * 1000 : null,
  };
}

async function fetchTrackPlays(artist, track) {
  const res = await fetch(
    `${LASTFM_PROXY}/?method=track.getinfo&user=${LASTFM_USER}&artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(track)}&format=json`,
  );
  if (!res.ok) return null;
  const data = await res.json();
  return {
    plays: Number(data.track?.userplaycount) || null,
    loved: data.track?.userloved === "1",
  };
}

async function fetchTotalScrobbles() {
  const res = await fetch(
    `${LASTFM_PROXY}/?method=user.getinfo&user=${LASTFM_USER}&format=json`,
  );
  if (!res.ok) return null;
  const data = await res.json();
  return Number(data.user?.playcount) || null;
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function renderNowPlaying(track, trackInfo, totalScrobbles) {
  const trackPlays = trackInfo?.plays ?? null;
  const loved = trackInfo?.loved ?? false;

  const label = track.playing
    ? "Now Playing"
    : `Last Played &middot; ${timeAgo(track.playedAt)}`;

  const playsLine = [
    trackPlays ? `${formatCount(trackPlays)} track plays` : "",
    totalScrobbles ? `${formatCount(totalScrobbles)} total plays` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const cover = track.cover
    ? `<img class="np-cover" src="${track.cover}" alt="${escapeHtml(track.name)}" onerror="this.style.display='none';this.nextElementSibling.style.display='';fetchSpotifyCover(${JSON.stringify(track.artist)},${JSON.stringify(track.name)})">`
    : "";
  const placeholder = `<div class="np-cover placeholder np-cover-placeholder" style="${track.cover ? "display:none" : ""}"></div>`;

  const heart = loved ? ' <span class="np-loved">\u2665</span>' : "";

  npSection.innerHTML = `
    ${cover}${placeholder}
    <div class="np-info">
      <span class="np-label">${label}</span>
      <span class="np-track" title="${escapeHtml(track.name)}">${escapeHtml(track.name)}${heart}</span>
      <span class="np-artist">${escapeHtml(track.artist)}</span>
      ${playsLine ? `<span class="np-plays">${playsLine}</span>` : ""}
    </div>`;
  npSection.classList.remove("hidden");

  if (!track.cover) fetchSpotifyCover(track.artist, track.name);
}

async function fetchSpotifyCover(artist, name) {
  try {
    const res = await fetch(
      `https://api.crygup.com/fishie/spotify-cover?artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(name)}`,
    );
    if (!res.ok) return;
    const data = await res.json();
    if (data.url) {
      const ph = npSection.querySelector(".np-cover-placeholder");
      if (ph) {
        ph.style.backgroundImage = `url(${data.url})`;
        ph.style.backgroundSize = "cover";
        ph.style.backgroundPosition = "center";
      }
    }
  } catch {}
}

if (npSection) {
  fetchNowPlaying()
    .then(async (track) => {
      const [trackInfo, totalScrobbles] = await Promise.all([
        fetchTrackPlays(track.artist, track.name),
        fetchTotalScrobbles(),
      ]);
      renderNowPlaying(track, trackInfo, totalScrobbles);
    })
    .catch(() => npSection.classList.add("hidden"));
}

const videoContainer = document.getElementById("video-list");

function formatCount(n) {
  if (n >= 1_000_000)
    return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

async function fetchLatestVideos() {
  const chRes = await fetch(
    `${YOUTUBE_PROXY}/channels?part=contentDetails&forHandle=${YOUTUBE_CHANNEL}`,
  );
  if (!chRes.ok) throw new Error(`channel: ${chRes.status}`);
  const chData = await chRes.json();
  const uploadsId =
    chData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsId) throw new Error("No uploads playlist found");

  const plRes = await fetch(
    `${YOUTUBE_PROXY}/playlistItems?part=snippet&playlistId=${uploadsId}&maxResults=12`,
  );
  if (!plRes.ok) throw new Error(`playlist: ${plRes.status}`);
  const plData = await plRes.json();
  const items = plData.items || [];
  if (items.length === 0) return [];
  const ids = items.map((i) => i.snippet.resourceId.videoId).join(",");

  const vRes = await fetch(
    `${YOUTUBE_PROXY}/videos?part=statistics,snippet,contentDetails&id=${ids}`,
  );
  if (!vRes.ok) throw new Error(`videos: ${vRes.status}`);
  const vData = await vRes.json();

  const videos = (vData.items || []).map((v) => ({
    id: v.id,
    title: v.snippet.title,
    views: Number(v.statistics.viewCount || 0),
    likes: Number(v.statistics.likeCount || 0),
    publishedAt: v.snippet.publishedAt,
  }));

  const checks = await Promise.all(
    videos.map(async (v) => {
      try {
        const oeRes = await fetch(
          `https://www.youtube.com/oembed?url=https://www.youtube.com/shorts/${v.id}&format=json`,
        );
        if (!oeRes.ok) return v;
        const oeData = await oeRes.json();
        const m = oeData.html?.match(/width="(\d+)".*height="(\d+)"/);
        if (m && Number(m[1]) < Number(m[2])) return null; // portrait → Short
        return v;
      } catch {
        return v;
      }
    }),
  );

  return checks.filter(Boolean).slice(0, 6);
}

function renderVideoCard(v) {
  const card = document.createElement("div");
  card.className = "video-card";
  const date = new Date(v.publishedAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const thumb = document.createElement("div");
  thumb.className = "thumb";
  const img = document.createElement("img");
  img.src = `https://img.youtube.com/vi/${v.id}/hqdefault.jpg`;
  img.alt = v.title;
  img.loading = "lazy";
  const overlay = document.createElement("div");
  overlay.className = "play-overlay";
  thumb.appendChild(img);
  thumb.appendChild(overlay);

  thumb.addEventListener("click", () => {
    const iframe = document.createElement("iframe");
    iframe.src = `https://www.youtube-nocookie.com/embed/${v.id}?autoplay=1&origin=${window.location.origin}`;
    iframe.title = v.title;
    iframe.allow =
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    thumb.innerHTML = "";
    thumb.appendChild(iframe);
  });

  const info = document.createElement("div");
  info.className = "video-info";
  info.innerHTML = `
    <p class="video-title">${v.title}</p>
    <p class="video-stats">${formatCount(v.views)} views &middot; ${formatCount(v.likes)} likes &middot; ${date}</p>`;

  card.appendChild(thumb);
  card.appendChild(info);
  videoContainer.appendChild(card);
}

function renderError() {
  videoContainer.innerHTML =
    '<p style="color:#94a3b8;text-align:center;padding:2rem;">Could not load videos. Check your API key and channel handle.</p>';
}

if (videoContainer) {
  fetchLatestVideos()
    .then((videos) => {
      if (videos.length === 0) {
        renderError();
        return;
      }
      videos.forEach(renderVideoCard);
    })
    .catch(() => renderError());
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

(function () {
  const qp = new URLSearchParams(window.location.search);
  const lastfmToken = qp.get("token");
  const lastfmState = qp.get("lastfm_state");
  const steamState = qp.get("steam_state");
  const spotifyCode = qp.get("code");
  const spotifyState = qp.get("state");
  const anilistCode = qp.get("code");
  const anilistState = qp.get("state");
  const FISHIE_API = "https://api.crygup.com/fishie";

  if (steamState && qp.get("openid.mode")) {
    const callbackParams = new URLSearchParams();
    callbackParams.set("steam_state", steamState);
    qp.forEach((value, key) => {
      if (key.startsWith("openid.")) callbackParams.set(key, value);
    });
    window.history.replaceState({}, "", window.location.pathname);
    fetch(`${FISHIE_API}/steam/callback?${callbackParams.toString()}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.detail || "Steam connection failed");
        return data;
      })
      .then((data) => {
        if (data.source === "website") {
          sessionStorage.setItem(
            "steam_linked_name",
            data.personaname || data.steamid,
          );
        }
        alert(
          `Connected Steam account ${data.personaname || data.steamid} to Fishie.`,
        );
      })
      .catch((error) => alert(error.message || "Steam connection failed."));
    return;
  }

  if (spotifyCode && spotifyState && spotifyState.startsWith("spotify_")) {
    window.history.replaceState({}, "", window.location.pathname);
    fetch(
      `${FISHIE_API}/spotify/callback?code=${encodeURIComponent(spotifyCode)}&state=${encodeURIComponent(spotifyState)}`,
    )
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.detail || "Spotify connection failed");
        return data;
      })
      .then((data) => {
        if (data.source === "website") {
          sessionStorage.setItem("spotify_linked_name", data.display_name);
        }
        alert(`Connected Spotify account ${data.display_name} to Fishie.`);
      })
      .catch((error) => alert(error.message || "Spotify connection failed."));
    return;
  }

  if (anilistCode && anilistState && anilistState.startsWith("anilist_")) {
    window.history.replaceState({}, "", window.location.pathname);
    fetch(
      `${FISHIE_API}/anilist/callback?code=${encodeURIComponent(anilistCode)}&state=${encodeURIComponent(anilistState)}`,
    )
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.detail || "AniList connection failed");
        return data;
      })
      .then((data) => {
        if (data.source === "website") {
          sessionStorage.setItem("anilist_linked_username", data.username);
        }
        alert(`Connected AniList account ${data.username} to Fishie.`);
      })
      .catch((error) => alert(error.message || "AniList connection failed."));
    return;
  }

  if (lastfmToken && lastfmState) {
    window.history.replaceState({}, "", window.location.pathname);
    fetch(
      `${FISHIE_API}/lastfm/callback?token=${encodeURIComponent(lastfmToken)}&state=${encodeURIComponent(lastfmState)}`,
    )
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.detail || "Last.fm connection failed");
        return data;
      })
      .then((data) => {
        if (data.source === "website") {
          sessionStorage.setItem("lastfm_linked_username", data.username);
        }
        alert(`Connected Last.fm account ${data.username} to Fishie.`);
      })
      .catch((error) => alert(error.message || "Last.fm connection failed."));
    return;
  }

  const code = qp.get("code");
  const oauthState = qp.get("state");
  if (!code || !oauthState) return;
  window.__fishieOAuthPending = true;
  window.history.replaceState({}, "", window.location.pathname);

  fetch(`${FISHIE_API}/oauth/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code,
      state: oauthState,
      redirect_uri: FISHIE_HOME_REDIRECT,
    }),
  })
    .then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || "Login failed");
      return data;
    })
    .then((data) => {
      localStorage.setItem("discord_user", JSON.stringify(data.user));
      window.__fishieOAuthPending = false;
      window.dispatchEvent(new CustomEvent("discord-login"));
      if (localStorage.getItem("settings_pending")) {
        window.location.href = "/discord";
      }
    })
    .catch((error) => {
      console.error("Discord login failed:", error);
      window.__fishieOAuthPending = false;
    });
})();
