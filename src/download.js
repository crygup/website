const downloadForm = document.getElementById("download-form");
const urlInput = document.getElementById("download-url");
const formatInput = document.getElementById("download-format");
const submitButton = document.getElementById("download-submit");
const cancelButton = document.getElementById("download-cancel");
const validation = document.getElementById("download-validation");
const statusBox = document.getElementById("download-status");
const statusTitle = document.getElementById("download-status-title");
const statusDetail = document.getElementById("download-status-detail");
const readyLink = document.getElementById("download-ready");
let pollTimer, expiryTimer, currentJob = null, failures = 0, busy = false, generation = 0;
const supportedHosts = new Set();

function showStatus(kind, title, detail = "") {
  statusBox.classList.remove("hidden", "error", "ready");
  if (kind) statusBox.classList.add(kind);
  statusTitle.textContent = title;
  statusDetail.textContent = detail;
}
function setBusy(value) {
  busy = value;
  submitButton.disabled = value;
  formatInput.disabled = value;
  urlInput.disabled = value;
  cancelButton.classList.toggle("hidden", !value || !currentJob);
}
function resetLink() {
  readyLink.classList.add("hidden");
  readyLink.removeAttribute("href");
  readyLink.removeAttribute("download");
  clearTimeout(expiryTimer);
}
function acceptable(value) {
  try {
    const u = new URL(value);
    return ["http:", "https:"].includes(u.protocol) && !u.username && !u.password &&
      ["", "80", "443"].includes(u.port) && supportedHosts.has(u.hostname.toLowerCase().replace(/\.$/, ""));
  } catch { return false; }
}
async function request(path, options = {}) {
  const response = await FishieWeb.fetch("/download-api" + path, {
    ...options, cache: "no-store", signal: AbortSignal.timeout(20000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(typeof data.detail === "string" ? data.detail : "The request could not be completed.");
    error.status = response.status;
    throw error;
  }
  return data;
}
const capabilities = request("/capabilities").then(data => {
  data.hosts.forEach(host => supportedHosts.add(host));
}).catch(() => {
  validation.textContent = "Could not load supported websites. Refresh to try again.";
});
urlInput.addEventListener("input", () => {
  urlInput.setCustomValidity("");
  validation.textContent = urlInput.value.trim() && supportedHosts.size && !acceptable(urlInput.value.trim())
    ? "Enter a link from a supported website (see the list below)." : "";
});
function forgetJob() {
  currentJob = null;
  sessionStorage.removeItem("download-job");
}
function expire() {
  resetLink(); forgetJob(); setBusy(false);
  showStatus("error", "Download expired", "The temporary file has been removed. Submit the URL again to recreate it.");
}
async function pollJob(id, version) {
  if (version !== generation) return;
  try {
    const job = await request("/jobs/" + encodeURIComponent(id));
    if (version !== generation) return;
    failures = 0;
    if (job.status === "failed" || job.status === "cancelled") {
      forgetJob(); setBusy(false);
      showStatus("error", job.status === "cancelled" ? "Download cancelled" : "Download failed", job.error || "");
      return;
    }
    if (job.status === "ready") {
      const expiry = Date.parse(job.expires_at);
      if (!Number.isFinite(expiry) || expiry <= Date.now()) { expire(); return; }
      const link = new URL(job.download_url, location.origin);
      if (link.origin !== location.origin || !link.pathname.startsWith("/download-api/jobs/")) throw new Error("Invalid download link.");
      readyLink.href = link.href;
      readyLink.download = job.filename || "download";
      readyLink.classList.remove("hidden");
      const size = Number.isFinite(job.size) ? " · " + (job.size / 1000000).toFixed(1) + " MB" : "";
      showStatus("ready", "Your file is ready", job.filename + size + " · Expires at " + new Date(expiry).toLocaleTimeString());
      setBusy(false);
      expiryTimer = setTimeout(expire, expiry - Date.now());
      return;
    }
    showStatus("", job.phase || "Downloading media", "You can leave and return to this tab while it finishes.");
    pollTimer = setTimeout(() => pollJob(id, version), 1500);
  } catch (error) {
    if (version !== generation) return;
    if (error.status === 404) { expire(); return; }
    if (error.status && error.status < 500 && error.status !== 429) {
      showStatus("error", "Could not check the download", error.message);
      setBusy(false); return;
    }
    failures++;
    showStatus("", "Reconnecting to your download", "Your job may still be running. Retrying automatically…");
    pollTimer = setTimeout(() => pollJob(id, version), Math.min(30000, 1500 * 2 ** Math.min(failures, 5)));
  }
}
downloadForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (busy) return;
  await capabilities;
  if (busy) return;
  if (!acceptable(urlInput.value.trim())) {
    urlInput.setCustomValidity("Enter a URL from a supported website.");
    urlInput.reportValidity(); return;
  }
  clearTimeout(pollTimer); resetLink(); forgetJob();
  const version = ++generation;
  setBusy(true);
  showStatus("", "Checking the URL", "");
  try {
    const job = await request("/jobs", {method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({url: urlInput.value.trim(), format: formatInput.value})});
    if (version !== generation) return;
    currentJob = job.id;
    sessionStorage.setItem("download-job", JSON.stringify({id: job.id, url: urlInput.value.trim(), format: formatInput.value}));
    setBusy(true);
    await pollJob(currentJob, version);
  } catch (error) {
    setBusy(false);
    showStatus("error", "Could not start the download", error.message);
  }
});
cancelButton.addEventListener("click", async () => {
  if (!currentJob) return;
  cancelButton.disabled = true;
  const id = currentJob;
  try {
    await request("/jobs/" + encodeURIComponent(id), {method: "DELETE"});
    ++generation; clearTimeout(pollTimer); resetLink(); forgetJob(); setBusy(false);
    showStatus("error", "Download cancelled", "");
  } catch (error) { validation.textContent = "Could not cancel yet: " + error.message; }
  finally { cancelButton.disabled = false; }
});
try {
  const saved = JSON.parse(sessionStorage.getItem("download-job") || "null");
  if (saved && typeof saved.id === "string") {
    currentJob = saved.id; urlInput.value = saved.url || ""; formatInput.value = saved.format || "mp4";
    setBusy(true); pollJob(currentJob, ++generation);
  }
} catch { sessionStorage.removeItem("download-job"); }
