"use strict";

// Cookie authentication applies only to our API. Request objects retain their
// method, body and headers; unrelated services retain their authentication.
window.FishieWeb = Object.freeze({
  validGrid(value, colors) {
    return value && typeof value === "object" && !Array.isArray(value) && Object.entries(value).every(([position, color]) => /^(?:[0-9]|1[0-9]|2[0-4])$/.test(position) && colors.includes(color));
  },
  solverHistory(key, read, restore, valid) {
    let previous = [];
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Undo";
    button.id = key + "-undo";
    document.getElementById(key + "-reset").before(button);
    function save() {
      button.disabled = !previous.length;
      try { sessionStorage.setItem(key + "-grid", JSON.stringify(read())); } catch {}
    }
    button.onclick = () => { if (previous.length) { restore(previous.pop()); save(); } };
    try {
      const saved = JSON.parse(sessionStorage.getItem(key + "-grid") || "null");
      if (saved && valid(saved)) restore(saved);
    } catch {}
    button.disabled = true;
    return {
      before() { previous.push(JSON.parse(JSON.stringify(read()))); if (previous.length > 100) previous.shift(); },
      save,
    };
  },
  notice(message) {
    const target = document.activeElement?.closest(".card, .login-card") || document.querySelector("main") || document.body;
    let notice = document.getElementById("site-notice");
    if (!notice) {
      notice = document.createElement("p");
      notice.id = "site-notice";
      notice.setAttribute("role", "status");
    }
    if (notice.parentElement !== target) target.append(notice);
    notice.textContent = message;
  },
  async fetch(input, init = {}) {
    const request = new Request(input, init || {});
    if (new URL(request.url).origin !== "https://api.crygup.com") {
      return window.fetch(request);
    }
    const headers = new Headers(request.headers);
    headers.delete("Authorization");
    return window.fetch(new Request(request, { headers, credentials: "include" }));
  },
});
localStorage.removeItem("discord_token");
localStorage.removeItem("fishie_token");

// Ignore a corrupt legacy profile cache; authentication still comes from cookies.
try { JSON.parse(localStorage.getItem("discord_user") || "null"); }
catch { localStorage.removeItem("discord_user"); }
localStorage.removeItem("fishie_user");
