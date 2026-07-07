const YOUTUBE_PROXY = "https://youtube.crygup.com";
const YOUTUBE_CHANNEL = "@crygup";
const LASTFM_PROXY = "https://lastfm.crygup.com";
const LASTFM_USER = "crygup";

const profile = {
  name: "crygup",
  tagline: "video editor & backend developer",
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
};

if (document.getElementById("bio-panel")) {
  document.querySelectorAll(".tab-btn[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn[data-tab]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
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
if (nameEl) nameEl.textContent = profile.name;
const taglineEl = document.getElementById("tagline");
if (taglineEl) taglineEl.textContent = profile.tagline;
document.getElementById("year").textContent = String(new Date().getFullYear());
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
    `${LASTFM_PROXY}/?method=user.getrecenttracks&user=${LASTFM_USER}&limit=1&format=json`
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
    `${LASTFM_PROXY}/?method=track.getinfo&user=${LASTFM_USER}&artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(track)}&format=json`
  );
  if (!res.ok) return null;
  const data = await res.json();
  return Number(data.track?.userplaycount) || null;
}

async function fetchTotalScrobbles() {
  const res = await fetch(
    `${LASTFM_PROXY}/?method=user.getinfo&user=${LASTFM_USER}&format=json`
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
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function renderNowPlaying(track, trackPlays, totalScrobbles) {
  const label = track.playing
    ? "Now Playing"
    : `Last Played &middot; ${timeAgo(track.playedAt)}`;

  const playsLine = [
    trackPlays ? `${formatCount(trackPlays)} plays` : "",
    totalScrobbles ? `${formatCount(totalScrobbles)} total` : "",
  ].filter(Boolean).join(" · ");

  const cover = track.cover
    ? `<img class="np-cover" src="${track.cover}" alt="${escapeHtml(track.name)}" onerror="this.style.display='none';this.nextElementSibling.style.display='';fetchSpotifyCover(${JSON.stringify(track.artist)},${JSON.stringify(track.name)})">`
    : "";
  const placeholder = `<div class="np-cover placeholder np-cover-placeholder" style="${track.cover ? 'display:none' : ''}"></div>`;

  npSection.innerHTML = `
    ${cover}${placeholder}
    <div class="np-info">
      <span class="np-label">${label}</span>
      <span class="np-track" title="${escapeHtml(track.name)}">${escapeHtml(track.name)}</span>
      <span class="np-artist">${escapeHtml(track.artist)}</span>
      ${playsLine ? `<span class="np-plays">${playsLine}</span>` : ""}
    </div>`;
  npSection.classList.remove("hidden");

  if (!track.cover) fetchSpotifyCover(track.artist, track.name);
}

async function fetchSpotifyCover(artist, name) {
  try {
    const res = await fetch(`https://api.crygup.com/fishie/spotify-cover?artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(name)}`);
    if (!res.ok) return;
    const data = await res.json();
    if (data.url) {
      const ph = npSection.querySelector(".np-cover-placeholder");
      if (ph) { ph.style.backgroundImage = `url(${data.url})`; ph.style.backgroundSize = "cover"; ph.style.backgroundPosition = "center"; }
    }
  } catch {}
}

if (npSection) {
  fetchNowPlaying()
    .then(async (track) => {
      const [trackPlays, totalScrobbles] = await Promise.all([
        fetchTrackPlays(track.artist, track.name),
        fetchTotalScrobbles(),
      ]);
      renderNowPlaying(track, trackPlays, totalScrobbles);
    })
    .catch(() => npSection.classList.add("hidden"));
}

const videoContainer = document.getElementById("video-list");

function formatCount(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

async function fetchLatestVideos() {
  const chRes = await fetch(
    `${YOUTUBE_PROXY}/channels?part=contentDetails&forHandle=${YOUTUBE_CHANNEL}`
  );
  if (!chRes.ok) throw new Error(`channel: ${chRes.status}`);
  const chData = await chRes.json();
  const uploadsId = chData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsId) throw new Error("No uploads playlist found");


  const plRes = await fetch(
    `${YOUTUBE_PROXY}/playlistItems?part=snippet&playlistId=${uploadsId}&maxResults=12`
  );
  if (!plRes.ok) throw new Error(`playlist: ${plRes.status}`);
  const plData = await plRes.json();
  const items = plData.items || [];
  if (items.length === 0) return [];
  const ids = items.map((i) => i.snippet.resourceId.videoId).join(",");


  const vRes = await fetch(
    `${YOUTUBE_PROXY}/videos?part=statistics,snippet,contentDetails&id=${ids}`
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
          `https://www.youtube.com/oembed?url=https://www.youtube.com/shorts/${v.id}&format=json`
        );
        if (!oeRes.ok) return v;
        const oeData = await oeRes.json();
        const m = oeData.html?.match(/width="(\d+)".*height="(\d+)"/);
        if (m && Number(m[1]) < Number(m[2])) return null; // portrait → Short
        return v;
      } catch {
        return v;
      }
    })
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
    iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
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

function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }


