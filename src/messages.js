const API = "https://api.crygup.com/fishie";
const user = JSON.parse(localStorage.getItem("discord_user") || "null");

const form = document.getElementById("message-form");
const nameInput = document.getElementById("msg-name");
const contentInput = document.getElementById("msg-content");
const nameCount = document.getElementById("name-count");
const contentCount = document.getElementById("content-count");
const submitBtn = document.getElementById("msg-submit");
const clearBtn = document.getElementById("msg-clear");
const avatarImg = document.getElementById("msg-avatar");
const modal = document.getElementById("msg-modal");

let discordId = user ? user.id : null;
let avatarUrl = null;

if (user) {
  nameInput.value = user.global_name || user.username;
  if (user.avatar) {
    avatarUrl = `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
  } else {
    avatarUrl = "https://cdn.discordapp.com/embed/avatars/0.png";
  }
  avatarImg.src = avatarUrl;
  avatarImg.classList.remove("hidden");
  clearBtn.classList.remove("hidden");
}
updateCounts();

nameInput.addEventListener("input", updateCounts);
contentInput.addEventListener("input", updateCounts);

clearBtn.addEventListener("click", () => {
  nameInput.value = "";
  avatarUrl = null;
  discordId = null;
  avatarImg.classList.add("hidden");
  clearBtn.classList.add("hidden");
  updateCounts();
});

function updateCounts() {
  nameCount.textContent = `${nameInput.value.length}/50`;
  contentCount.textContent = `${contentInput.value.length}/2000`;
}

async function getMessageChallenge() {
  const res = await FishieWeb.fetch(`${API}/send-message/challenge`, {
    credentials: "include",
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.token) {
    throw new Error(data.detail || "Could not verify the message form");
  }
  return data.token;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = nameInput.value.trim();
  const content = contentInput.value.trim();
  if (!name || !content) return;

  submitBtn.disabled = true;
  submitBtn.textContent = "Sending…";

  try {
    const challenge = await getMessageChallenge();
    const res = await FishieWeb.fetch(`${API}/send-message`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-Fishie-Message-Challenge": challenge,
      },
      body: JSON.stringify({
        name,
        content,
        discord_id: discordId || undefined,
        avatar_url: avatarUrl || undefined,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (res.status === 429)
        throw new Error("Please wait a minute before sending another message.");
      throw new Error(err.detail || "Failed to send message");
    }

    showModal();
    contentInput.value = "";
    updateCounts();
  } catch (err) {
    alert(err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Send Message";
  }
});

function showModal() {
  modal.classList.remove("hidden");
}
function closeModal() {
  modal.classList.add("hidden");
}
modal
  .querySelector(".msg-modal-backdrop")
  .addEventListener("click", closeModal);
modal.querySelector(".msg-modal-close").addEventListener("click", closeModal);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !modal.classList.contains("hidden")) closeModal();
});
