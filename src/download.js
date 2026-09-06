const downloadForm = document.getElementById("download-form");
const urlInput = document.getElementById("download-url");
const formatInput = document.getElementById("download-format");
const submitButton = document.getElementById("download-submit");
const statusBox = document.getElementById("download-status");
const statusTitle = document.getElementById("download-status-title");
const statusDetail = document.getElementById("download-status-detail");
const readyLink = document.getElementById("download-ready");
const downloadTagline = document.getElementById("tagline");

downloadTagline.textContent = "save a public video, clip, or audio file";

let pollTimer = null;
let downloadInProgress = false;

const supportedHosts = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "instagram.com",
  "www.instagram.com",
  "tiktok.com",
  "www.tiktok.com",
  "m.tiktok.com",
  "vm.tiktok.com",
  "vt.tiktok.com",
  "vk.tiktok.com",
  "soundcloud.com",
  "on.soundcloud.com",
  "twitter.com",
  "www.twitter.com",
  "x.com",
  "www.x.com",
  "fxtwitter.com",
  "vxtwitter.com",
  "fixupx.com",
  "girlcockx.com",
  "clips.twitch.tv",
  "twitch.tv",
  "www.twitch.tv",
  "reddit.com",
  "www.reddit.com",
  "pin.it",
  "pinterest.com",
  "www.pinterest.com",
  "tenor.com",
  "www.tenor.com",
  "klipy.com",
  "www.klipy.com",
  "static.klipy.com",
]);

function isAcceptableUrl(value) {
  try {
    const url = new URL(value);
    const validPort = !url.port || url.port === "80" || url.port === "443";
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password &&
      validPort &&
      supportedHosts.has(url.hostname.toLowerCase().replace(/\.$/, ""))
    );
  } catch {
    return false;
  }
}

function updateSubmitButton() {
  const show = isAcceptableUrl(urlInput.value.trim());
  submitButton.classList.toggle("hidden", !show);
  submitButton.disabled = downloadInProgress;
}

function setDownloadInProgress(value) {
  downloadInProgress = value;
  updateSubmitButton();
}

urlInput.addEventListener("input", () => {
  urlInput.setCustomValidity("");
  updateSubmitButton();
});

updateSubmitButton();

function showStatus(kind, title, detail = "") {
  statusBox.classList.remove("hidden", "error", "ready");
  if (kind) statusBox.classList.add(kind);
  statusTitle.textContent = title;
  statusDetail.textContent = detail;
}

function resetReadyLink() {
  readyLink.classList.add("hidden");
  readyLink.removeAttribute("href");
  readyLink.removeAttribute("download");
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "";
  const units = ["B", "KB", "MB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

async function readError(response, fallback) {
  const data = await response.json().catch(() => ({}));
  return data.detail || fallback;
}

async function pollJob(jobId) {
  try {
    const response = await FishieWeb.fetch(`/download-api/jobs/${encodeURIComponent(jobId)}`, {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(await readError(response, "The download job could not be found."));
    }

    const job = await response.json();
    if (job.status === "failed") {
      showStatus("error", "Download failed", job.error || "Please try another URL.");
      setDownloadInProgress(false);
      return;
    }

    if (job.status === "ready") {
      const size = formatBytes(job.size);
      showStatus("ready", "Your file is ready", `${job.filename}${size ? ` · ${size}` : ""}`);
      readyLink.href = job.download_url;
      readyLink.download = job.filename || "download";
      readyLink.classList.remove("hidden");
      setDownloadInProgress(false);
      return;
    }

    showStatus("", job.phase || "Downloading media", "This can take a little while.");
    pollTimer = window.setTimeout(() => pollJob(jobId), 1500);
  } catch (error) {
    showStatus("error", "Could not check the download", error.message);
    setDownloadInProgress(false);
  }
}

downloadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  window.clearTimeout(pollTimer);
  resetReadyLink();

  const url = urlInput.value.trim();
  if (!isAcceptableUrl(url)) {
    urlInput.setCustomValidity("Enter a URL from a supported media website.");
    urlInput.reportValidity();
    return;
  }

  setDownloadInProgress(true);
  showStatus("", "Checking the URL", "Making sure the media can be downloaded safely.");

  try {
    const response = await FishieWeb.fetch("/download-api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        format: formatInput.value,
      }),
    });
    if (!response.ok) {
      throw new Error(await readError(response, "The download could not be started."));
    }

    const job = await response.json();
    showStatus("", job.phase || "Download queued", "This can take a little while.");
    await pollJob(job.id);
  } catch (error) {
    showStatus("error", "Could not start the download", error.message);
    setDownloadInProgress(false);
  }
});
