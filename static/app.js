"use strict";

// ---- host token (persisted so a refresh keeps host powers) ----
let hostToken = localStorage.getItem("hostToken") || null;

const $ = (id) => document.getElementById(id);

let last = null;            // last state we rendered
let currentAnimPos = null;  // draft position we're animating, if any
let animRAF = null;
let teamsForReel = [];      // team names used to fill the spinning reel

// ---------------------------------------------------------------- helpers
async function api(path, body) {
  const opts = { method: "POST", headers: { "Content-Type": "application/json" } };
  if (hostToken) opts.headers["X-Host-Token"] = hostToken;
  opts.body = JSON.stringify(body || {});
  const res = await fetch(path, opts);
  return res.json().catch(() => ({}));
}

function isHost() { return !!hostToken; }

// ---------------------------------------------------------------- config UI
function makeRow(team, editable, index) {
  const tr = document.createElement("tr");
  if (!editable) tr.className = "readonly";
  const odds = team._odds != null ? team._odds : "";
  tr.innerHTML = `
    <td class="col-seed">${index + 1}</td>
    <td class="col-name"><input class="t-name" type="text" value=""></td>
    <td class="col-weight"><input class="t-weight" type="number" min="0" step="1" value="${team.weight}"></td>
    <td class="col-odds">${odds}</td>
    <td class="col-x"><button class="row-x" title="Remove">&times;</button></td>`;
  tr.querySelector(".t-name").value = team.name;
  tr.querySelector(".row-x").addEventListener("click", () => {
    tr.remove();
    recomputeOdds();
  });
  tr.querySelector(".t-weight").addEventListener("input", recomputeOdds);
  return tr;
}

function readTable() {
  const rows = [...document.querySelectorAll("#config-body tr")];
  return rows.map((tr) => ({
    name: tr.querySelector(".t-name").value.trim(),
    weight: parseFloat(tr.querySelector(".t-weight").value) || 0,
  })).filter((t) => t.name.length > 0);
}

function recomputeOdds() {
  const rows = [...document.querySelectorAll("#config-body tr")];
  const weights = rows.map((tr) => parseFloat(tr.querySelector(".t-weight").value) || 0);
  const total = weights.reduce((a, b) => a + b, 0);
  rows.forEach((tr, i) => {
    const cell = tr.querySelector(".col-odds");
    cell.textContent = total > 0 ? (100 * weights[i] / total).toFixed(1) + "%" : "—";
  });
}

function renderConfig(state) {
  const body = $("config-body");
  const editable = isHost();
  // Only rebuild when the underlying team list changes or host status flips,
  // so we don't wipe out what the host is currently typing.
  const sig = JSON.stringify(state.teams) + "|" + editable;
  if (body.dataset.sig === sig) return;
  body.dataset.sig = sig;
  body.innerHTML = "";
  state.teams.forEach((t, i) => body.appendChild(makeRow(t, editable, i)));
  recomputeOdds();

  $("add-row").disabled = !editable;
  $("save-btn").disabled = !editable;
  $("start-btn").disabled = !editable;
  $("viewer-note").style.display = editable ? "none" : "block";
}

// ---------------------------------------------------------------- reel anim
function buildReel(targetName) {
  const reel = $("reel");
  reel.innerHTML = "";
  reel.classList.remove("landed");
  reel.style.transition = "none";
  reel.style.transform = "translateY(0)";

  // A long strip of shuffled names ending on the real result.
  const pool = teamsForReel.length ? teamsForReel : [targetName];
  const strip = [];
  const COUNT = 34;
  for (let i = 0; i < COUNT; i++) {
    strip.push(pool[Math.floor(Math.random() * pool.length)]);
  }
  strip.push(targetName); // landing slot
  strip.forEach((name, i) => {
    const div = document.createElement("div");
    div.className = "slot" + (i === strip.length - 1 ? " mid final" : "");
    div.textContent = name;
    reel.appendChild(div);
  });
  return strip.length;
}

// slot height must match CSS (.reel .slot height)
const SLOT_H = 26;

function startReelAnimation(targetName, durationMs) {
  const reel = $("reel");
  const count = buildReel(targetName);
  // We want the final slot centered in the marker band (second row).
  const finalIndex = count - 1;
  const targetY = -(finalIndex * SLOT_H) + SLOT_H; // land final on 2nd row
  // Force reflow, then animate with an easing that decelerates into place.
  void reel.offsetHeight;
  reel.style.transition = `transform ${durationMs}ms cubic-bezier(.12,.62,.2,1)`;
  reel.style.transform = `translateY(${targetY}px)`;
  reel.addEventListener("transitionend", () => {
    const finalSlot = reel.querySelector(".slot.final");
    if (finalSlot) finalSlot.classList.add("landed");
  }, { once: true });
}

function runCountdown(durationMs) {
  const bar = $("countdown-bar");
  bar.style.transition = "none";
  bar.style.transform = "scaleX(1)";
  void bar.offsetHeight;
  bar.style.transition = `transform ${durationMs}ms linear`;
  bar.style.transform = "scaleX(0)";
}

// ---------------------------------------------------------------- board
function renderBoard(state) {
  const board = $("board");
  const n = state.total;
  // Build once, then update in place.
  if (board.childElementCount !== n) {
    board.innerHTML = "";
    for (let i = 0; i < n; i++) {
      const li = document.createElement("li");
      li.innerHTML = `<span class="pos">#${i + 1}</span><span class="team"></span>`;
      board.appendChild(li);
    }
  }
  const items = board.children;
  const animPos = state.animating ? state.anim_position : null;
  state.picks.forEach((p, i) => {
    const li = items[i];
    const teamEl = li.querySelector(".team");
    li.classList.toggle("pick-one", p.position === 1 && p.revealed);
    if (p.revealed) {
      if (teamEl.textContent !== p.name) {
        teamEl.textContent = p.name;
        li.classList.add("just-revealed");
        setTimeout(() => li.classList.remove("just-revealed"), 900);
      }
      li.classList.remove("pending");
    } else {
      teamEl.textContent = p.position === animPos ? "• • •" : "———";
      li.classList.add("pending");
    }
  });
}

// ---------------------------------------------------------------- confetti
function fireConfetti() {
  const canvas = $("confetti");
  const ctx = canvas.getContext("2d");
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const colors = ["#ffcf3f", "#37e0c6", "#ff5c7a", "#ffffff", "#46e08a"];
  const parts = [];
  for (let i = 0; i < 180; i++) {
    parts.push({
      x: Math.random() * canvas.width,
      y: -20 - Math.random() * canvas.height * 0.4,
      r: 4 + Math.random() * 6,
      c: colors[Math.floor(Math.random() * colors.length)],
      vx: -2 + Math.random() * 4,
      vy: 2 + Math.random() * 4,
      rot: Math.random() * Math.PI,
      vr: -0.2 + Math.random() * 0.4,
    });
  }
  let frames = 0;
  function tick() {
    frames++;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    parts.forEach((p) => {
      p.x += p.vx; p.y += p.vy; p.vy += 0.06; p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 0.6);
      ctx.restore();
    });
    if (frames < 260) requestAnimationFrame(tick);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  tick();
}

// ---------------------------------------------------------------- render
function render(state) {
  // phase pill
  const pill = $("phase-pill");
  pill.textContent = { config: "Configuring", reveal: "Live", complete: "Complete" }[state.phase];
  pill.style.color = state.phase === "reveal" ? "var(--hot)" : "";

  teamsForReel = state.teams.map((t) => t.name);

  const configView = $("config-view");
  const revealView = $("reveal-view");
  configView.classList.toggle("hidden", state.phase === "config" ? false : true);
  revealView.classList.toggle("hidden", state.phase === "config");

  if (state.phase === "config") {
    renderConfig(state);
  } else {
    renderBoard(state);
    handleAnimation(state);

    // host controls
    const hc = $("host-controls");
    const revealBtn = $("reveal-btn");
    const canManual = state.phase === "reveal"
      && !state.animating
      && state.revealed_count >= state.auto_reveal_count
      && state.revealed_count < state.total;
    revealBtn.classList.toggle("hidden", state.phase === "complete");
    revealBtn.disabled = !canManual;
    revealBtn.textContent = state.revealed_count + 1 >= state.total
      ? "Reveal #1 Pick ▸" : "Reveal Next Pick ▸";
    hc.classList.toggle("hidden", !isHost());

    // idle text for viewers / between picks
    const idle = $("idle-text");
    if (state.animating) {
      idle.textContent = "";
    } else if (state.phase === "complete") {
      idle.textContent = "🏆 The board is set. Congrats to the #1 pick!";
    } else if (state.revealed_count < state.auto_reveal_count) {
      idle.textContent = "Revealing the early picks…";
    } else {
      idle.textContent = isHost()
        ? "Click below to reveal the next pick."
        : "Waiting for the host to reveal the next pick…";
    }
  }

  // #1 pick just revealed -> celebrate (once)
  if (last && state.phase === "complete" && last.phase !== "complete") {
    fireConfetti();
  }
  last = state;
}

function handleAnimation(state) {
  const animator = $("animator");
  const idle = $("stage-idle");
  if (state.animating && state.anim_remaining > 0.05) {
    idle.classList.add("hidden");
    animator.classList.remove("hidden");
    const isFinal = state.anim_position === 1;
    animator.classList.toggle("reveal-final", isFinal);
    $("anim-pos").textContent = state.anim_position;
    // (Re)start the reel only when a new position begins animating.
    if (currentAnimPos !== state.anim_position) {
      currentAnimPos = state.anim_position;
      const ms = Math.max(600, state.anim_remaining * 1000);
      const targetName = state.anim_name || randomName();
      startReelAnimation(targetName, ms);
      runCountdown(ms);
    }
  } else {
    animator.classList.add("hidden");
    idle.classList.remove("hidden");
    currentAnimPos = null;
  }
}

// While animating, the server sends `anim_name` (the real pick for the
// position being revealed) so the reel lands on the true result in sync across
// clients; the board keeps a placeholder until the reveal completes.
function randomName() {
  if (!teamsForReel.length) return "?";
  return teamsForReel[Math.floor(Math.random() * teamsForReel.length)];
}

// ---------------------------------------------------------------- polling
async function poll() {
  try {
    const res = await fetch("/api/state");
    const state = await res.json();
    render(state);
  } catch (e) { /* transient */ }
}
setInterval(poll, 500);
poll();

// ---------------------------------------------------------------- events
$("host-btn").addEventListener("click", () => {
  if (isHost()) return; // already host
  $("host-modal").classList.remove("hidden");
  $("passcode").focus();
});
$("host-cancel").addEventListener("click", () => $("host-modal").classList.add("hidden"));
$("host-submit").addEventListener("click", submitHost);
$("passcode").addEventListener("keydown", (e) => { if (e.key === "Enter") submitHost(); });

async function submitHost() {
  const passcode = $("passcode").value;
  const res = await api("/api/host/claim", { passcode });
  if (res.ok) {
    hostToken = res.token;
    localStorage.setItem("hostToken", hostToken);
    $("host-modal").classList.add("hidden");
    $("host-btn").textContent = "You are host";
    $("host-err").textContent = "";
    $("config-body").dataset.sig = ""; // force re-render as editable
    poll();
  } else {
    $("host-err").textContent = res.error || "Failed.";
  }
}

$("add-row").addEventListener("click", () => {
  const body = $("config-body");
  const idx = body.childElementCount;
  body.appendChild(makeRow({ name: "", weight: 0 }, true, idx));
  recomputeOdds();
});

$("save-btn").addEventListener("click", async () => {
  const teams = readTable();
  const res = await api("/api/config", { teams });
  const msg = $("config-msg");
  if (res.ok) { msg.textContent = "Saved."; msg.className = "msg ok"; }
  else { msg.textContent = res.error || "Failed."; msg.className = "msg err"; }
});

$("start-btn").addEventListener("click", async () => {
  // Save current table first, then start.
  const teams = readTable();
  if (teams.length === 0) {
    $("config-msg").textContent = "Add at least one team.";
    $("config-msg").className = "msg err";
    return;
  }
  await api("/api/config", { teams });
  const res = await api("/api/start", {});
  if (!res.ok) {
    $("config-msg").textContent = res.error || "Could not start.";
    $("config-msg").className = "msg err";
  }
});

$("reveal-btn").addEventListener("click", async () => {
  $("reveal-btn").disabled = true;
  await api("/api/reveal-next", {});
  poll();
});

$("reset-btn").addEventListener("click", async () => {
  if (!confirm("Reset the lottery back to configuration?")) return;
  await api("/api/reset", {});
  poll();
});

// If we already hold a token, reflect host status in the button label.
if (isHost()) $("host-btn").textContent = "You are host";
