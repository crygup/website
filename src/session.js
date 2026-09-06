"use strict";

// Cookie authentication applies only to our API. Request objects retain their
// method, body and headers; unrelated services retain their authentication.
window.FishieWeb = Object.freeze({
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
