const inputScreen = document.getElementById("screen-input");
const loadingScreen = document.getElementById("screen-loading");
const resultScreen = document.getElementById("screen-result");
const input = document.getElementById("playlist-input");
const analyzeBtn = document.getElementById("analyze-btn");
const errorMsg = document.getElementById("error-msg");
const tryAgainBtn = document.getElementById("try-again-btn");

function showScreen(screen) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  screen.classList.add("active");
}

function animateNumber(el, target, duration = 1200) {
  const start = 0;
  const startTime = performance.now();

  function update(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    // Ease out cubic
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(start + (target - start) * eased);
    if (progress < 1) requestAnimationFrame(update);
  }

  requestAnimationFrame(update);
}

async function analyze() {
  const url = input.value.trim();
  if (!url) {
    errorMsg.textContent = "Paste a Spotify playlist link first.";
    return;
  }

  errorMsg.textContent = "";
  analyzeBtn.disabled = true;
  showScreen(loadingScreen);

  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playlistUrl: url }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Something went wrong");
    }

    renderResult(data);
    showScreen(resultScreen);
  } catch (err) {
    showScreen(inputScreen);
    errorMsg.textContent = err.message;
  } finally {
    analyzeBtn.disabled = false;
  }
}

function renderResult(data) {
  // IQ number animation
  const iqEl = document.getElementById("iq-number");
  animateNumber(iqEl, data.iq);

  // Verdicts
  const verdictsEl = document.getElementById("verdicts");
  verdictsEl.innerHTML = "";
  for (const v of data.verdicts) {
    const li = document.createElement("li");
    li.textContent = v;
    verdictsEl.appendChild(li);
  }

  // Playlist info
  const playlistInfo = document.getElementById("playlist-info");
  const img = document.getElementById("playlist-img");
  if (data.playlistImage) {
    img.src = data.playlistImage;
    img.style.display = "block";
  } else {
    img.style.display = "none";
  }
  document.getElementById("playlist-name").textContent = data.playlistName;
  document.getElementById("playlist-meta").textContent =
    `${data.trackCount} tracks \u00B7 ${data.artistCount} artists`;

  // Genre bars
  const barsContainer = document.getElementById("genre-bars");
  barsContainer.innerHTML = "";

  if (data.breakdown.length > 0) {
    const maxWeight = data.breakdown[0].weight;
    for (const item of data.breakdown) {
      const bar = document.createElement("div");
      bar.className = "genre-bar";
      const pct = (item.weight / maxWeight) * 100;
      bar.innerHTML = `
        <span class="label">${item.genre}</span>
        <div class="bar-track">
          <div class="bar-fill" style="width: 0%"></div>
        </div>
        <span class="score">${Math.round(item.weight * 100)}%</span>
      `;
      barsContainer.appendChild(bar);

      // Animate bar after a tick
      requestAnimationFrame(() => {
        bar.querySelector(".bar-fill").style.width = pct + "%";
      });
    }
  }

  // Modifiers
  const modContainer = document.getElementById("modifiers");
  modContainer.innerHTML = "";
  for (const mod of data.modifiers) {
    const tag = document.createElement("span");
    const sign = mod.value > 0 ? "+" : "";
    tag.className = `modifier-tag ${mod.value > 0 ? "positive" : mod.value < 0 ? "negative" : ""}`;
    tag.textContent = `${mod.name} ${sign}${mod.value}`;
    modContainer.appendChild(tag);
  }
}

analyzeBtn.addEventListener("click", analyze);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") analyze();
});

tryAgainBtn.addEventListener("click", () => {
  input.value = "";
  showScreen(inputScreen);
  input.focus();
});
