const inputScreen = document.getElementById("screen-input");
const loadingScreen = document.getElementById("screen-loading");
const resultScreen = document.getElementById("screen-result");
const input = document.getElementById("playlist-input");
const analyzeBtn = document.getElementById("analyze-btn");
const errorMsg = document.getElementById("error-msg");
const tryAgainBtn = document.getElementById("try-again-btn");
const progressBar = document.getElementById("progress-bar");
const progressText = document.getElementById("progress-text");
const progressDetail = document.getElementById("progress-detail");

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
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(start + (target - start) * eased);
    if (progress < 1) requestAnimationFrame(update);
  }

  requestAnimationFrame(update);
}

function analyze() {
  const url = input.value.trim();
  if (!url) {
    errorMsg.textContent = "Paste a Spotify playlist link first.";
    return;
  }

  errorMsg.textContent = "";
  analyzeBtn.disabled = true;
  progressBar.style.width = "0%";
  progressText.textContent = "Connecting...";
  progressDetail.textContent = "";
  showScreen(loadingScreen);

  const eventSource = new EventSource(
    `/api/analyze?url=${encodeURIComponent(url)}`
  );

  eventSource.addEventListener("progress", (e) => {
    const data = JSON.parse(e.data);
    progressBar.style.width = data.percent + "%";
    progressText.textContent = data.stage;
    if (data.current && data.total) {
      progressDetail.textContent = `${data.current} / ${data.total} artists`;
    }
  });

  eventSource.addEventListener("result", (e) => {
    eventSource.close();
    const data = JSON.parse(e.data);
    renderResult(data);
    showScreen(resultScreen);
    analyzeBtn.disabled = false;
  });

  eventSource.addEventListener("error", (e) => {
    eventSource.close();
    try {
      const data = JSON.parse(e.data);
      errorMsg.textContent = data.error || "Something went wrong";
    } catch {
      errorMsg.textContent = "Connection lost. Try again.";
    }
    showScreen(inputScreen);
    analyzeBtn.disabled = false;
  });

  eventSource.onerror = () => {
    eventSource.close();
    errorMsg.textContent = "Connection lost. Try again.";
    showScreen(inputScreen);
    analyzeBtn.disabled = false;
  };
}

function drawBellCurve(iq) {
  const canvas = document.getElementById("bell-curve");
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  const padding = { top: 10, bottom: 25, left: 10, right: 10 };
  const plotW = w - padding.left - padding.right;
  const plotH = h - padding.top - padding.bottom;

  ctx.clearRect(0, 0, w, h);

  // Bell curve: mean=100, sd=15 (standard IQ distribution)
  const mean = 100;
  const sd = 15;
  function gaussian(x) {
    return Math.exp(-0.5 * Math.pow((x - mean) / sd, 2));
  }

  // Draw filled curve
  const minX = 55;
  const maxX = 155;
  const steps = 200;

  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top + plotH);

  for (let i = 0; i <= steps; i++) {
    const x = minX + (maxX - minX) * (i / steps);
    const y = gaussian(x);
    const px = padding.left + (i / steps) * plotW;
    const py = padding.top + plotH - y * plotH * 0.95;
    ctx.lineTo(px, py);
  }

  ctx.lineTo(padding.left + plotW, padding.top + plotH);
  ctx.closePath();
  ctx.fillStyle = "#f0f0f0";
  ctx.fill();

  // Draw curve outline
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const x = minX + (maxX - minX) * (i / steps);
    const y = gaussian(x);
    const px = padding.left + (i / steps) * plotW;
    const py = padding.top + plotH - y * plotH * 0.95;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.strokeStyle = "#ccc";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Draw marker line at user's IQ
  const clampedIQ = Math.max(minX, Math.min(maxX, iq));
  const markerX = padding.left + ((clampedIQ - minX) / (maxX - minX)) * plotW;
  const markerY = gaussian(clampedIQ);
  const markerPY = padding.top + plotH - markerY * plotH * 0.95;

  ctx.beginPath();
  ctx.moveTo(markerX, padding.top + plotH);
  ctx.lineTo(markerX, markerPY - 4);
  ctx.strokeStyle = "#1a1a1a";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Draw dot at top of marker
  ctx.beginPath();
  ctx.arc(markerX, markerPY - 4, 4, 0, Math.PI * 2);
  ctx.fillStyle = "#1a1a1a";
  ctx.fill();

  // "You" label
  ctx.font = "500 11px 'DM Sans', sans-serif";
  ctx.fillStyle = "#1a1a1a";
  ctx.textAlign = "center";
  ctx.fillText("You", markerX, markerPY - 14);

  // X-axis labels
  ctx.font = "400 10px 'DM Sans', sans-serif";
  ctx.fillStyle = "#bbb";
  ctx.textAlign = "center";
  const labels = [60, 80, 100, 120, 140];
  for (const val of labels) {
    const lx = padding.left + ((val - minX) / (maxX - minX)) * plotW;
    ctx.fillText(val, lx, h - 6);
  }
}

function renderResult(data) {
  const iqEl = document.getElementById("iq-number");
  animateNumber(iqEl, data.iq);

  drawBellCurve(data.iq);

  const verdictsEl = document.getElementById("verdicts");
  verdictsEl.innerHTML = "";
  for (const v of data.verdicts) {
    const li = document.createElement("li");
    li.textContent = v;
    verdictsEl.appendChild(li);
  }

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

      requestAnimationFrame(() => {
        bar.querySelector(".bar-fill").style.width = pct + "%";
      });
    }
  }

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
