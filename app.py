"""Draft Lottery dashboard.

A small Flask app that runs a weighted draft lottery (NBA-style) as a shared,
real-time web experience. One person acts as the host: they configure the
standings and odds on the main page, then run the lottery. Everyone else opens
the same URL and watches the picks reveal live.

Reveal behavior mirrors the original CLI: the first four picks (the bottom of
the draft) reveal automatically with an animation, and from then on the host
must click a button to reveal each remaining pick, building to the #1 pick.
"""

import os
import random
import secrets
import threading
import time

from flask import Flask, jsonify, request, render_template

app = Flask(__name__)

# Passcode the host enters to unlock the control panel. Override in production
# (e.g. `fly secrets set HOST_PASSCODE=...`).
HOST_PASSCODE = os.environ.get("HOST_PASSCODE", "host")

# How long (seconds) the suspense animation plays before each result appears.
REVEAL_ANIMATION_SECONDS = float(os.environ.get("REVEAL_ANIMATION_SECONDS", "4.0"))

# Pause between the automatic reveals of the first four picks.
AUTO_REVEAL_PAUSE_SECONDS = 1.6

# Number of picks that reveal automatically before the host must click.
AUTO_REVEAL_COUNT = 4

_lock = threading.RLock()


def _default_teams():
    """Seed the config from standings.txt, worst record first (best odds)."""
    default_weights = [30, 25, 16, 14, 10, 5, 0, 0, 0, 0]
    names = []
    try:
        with open("standings.txt", "r") as f:
            names = [line.strip() for line in f if line.strip()]
        # standings.txt is ordered best -> worst; the lottery table is worst
        # record first so the top row carries the best odds.
        names.reverse()
    except OSError:
        pass
    if not names:
        names = ["Team %d" % i for i in range(1, 11)]
    teams = []
    for i, name in enumerate(names):
        weight = default_weights[i] if i < len(default_weights) else 0
        teams.append({"name": name, "weight": weight})
    return teams


def _new_state():
    return {
        "phase": "config",          # config | reveal | complete
        "teams": _default_teams(),  # [{name, weight}] worst record first
        "order": [],                # final draft order; order[0] == pick #1
        "revealed_count": 0,        # how many picks (from the last) are shown
        "animating": False,
        "anim_position": None,      # draft position currently being revealed
        "anim_ends_at": 0.0,        # epoch seconds when the result appears
        "host_token": None,
        "version": 0,               # bumps on every state change (for polling)
    }


STATE = _new_state()


def _bump():
    STATE["version"] += 1


def _draw_order(teams):
    """Return a full draft order using a weighted draw without replacement.

    Teams with positive weight are drawn (weighted) into the top picks; once
    the remaining weights are all zero the rest fall in their configured
    (standings) order. This reproduces the NBA structure where only teams with
    lottery odds can jump to the top and everyone else slots by record.
    """
    remaining = list(range(len(teams)))
    order = []
    while any(teams[i]["weight"] > 0 for i in remaining):
        weights = [max(0.0, float(teams[i]["weight"])) for i in remaining]
        chosen = random.choices(remaining, weights=weights, k=1)[0]
        order.append(teams[chosen]["name"])
        remaining.remove(chosen)
    for i in remaining:  # zero-weight teams keep their standings order
        order.append(teams[i]["name"])
    return order


def _public_state():
    """State safe to send to every client (no host token)."""
    with _lock:
        n = len(STATE["order"])
        revealed = STATE["revealed_count"]
        # A position p (1-based, 1 == best pick) is revealed once it is within
        # the last `revealed` picks: positions n, n-1, ... n-revealed+1.
        picks = []
        for idx, name in enumerate(STATE["order"]):
            position = idx + 1
            is_revealed = position > n - revealed
            picks.append({
                "position": position,
                "name": name if is_revealed else None,
                "revealed": is_revealed,
            })
        # While a pick is animating we expose its name so every client's reel
        # lands on the real result in sync. The board still shows a placeholder
        # for it until the animation completes (revealed_count catches up).
        anim_name = None
        if STATE["animating"] and STATE["anim_position"] is not None:
            anim_name = STATE["order"][STATE["anim_position"] - 1]
        return {
            "phase": STATE["phase"],
            "teams": STATE["teams"],
            "picks": picks,
            "total": n,
            "revealed_count": revealed,
            "animating": STATE["animating"],
            "anim_position": STATE["anim_position"],
            "anim_name": anim_name,
            "anim_remaining": max(0.0, STATE["anim_ends_at"] - time.time())
            if STATE["animating"] else 0.0,
            "auto_reveal_count": AUTO_REVEAL_COUNT,
            "animation_seconds": REVEAL_ANIMATION_SECONDS,
            "version": STATE["version"],
            "now": time.time(),
        }


def _is_host(req):
    token = req.headers.get("X-Host-Token")
    if not token and req.is_json:
        token = (req.get_json(silent=True) or {}).get("token")
    return token is not None and token == STATE["host_token"]


def _finish_reveal(seq_index, auto):
    """Called after the animation for sequence `seq_index` completes."""
    time.sleep(REVEAL_ANIMATION_SECONDS)
    with _lock:
        # Guard against a reset that happened mid-animation.
        if STATE["phase"] != "reveal" or STATE["revealed_count"] != seq_index:
            return
        STATE["revealed_count"] = seq_index + 1
        STATE["animating"] = False
        STATE["anim_position"] = None
        if STATE["revealed_count"] >= len(STATE["order"]):
            STATE["phase"] = "complete"
        _bump()
        keep_going = (auto
                      and STATE["phase"] == "reveal"
                      and STATE["revealed_count"] < AUTO_REVEAL_COUNT)
    if keep_going:
        time.sleep(AUTO_REVEAL_PAUSE_SECONDS)
        _begin_reveal(auto=True)


def _begin_reveal(auto):
    """Start the animation for the next pick, if one is pending."""
    with _lock:
        if STATE["phase"] != "reveal" or STATE["animating"]:
            return False
        seq_index = STATE["revealed_count"]
        n = len(STATE["order"])
        if seq_index >= n:
            return False
        # Manual reveals are only allowed once the auto picks are done.
        if not auto and seq_index < AUTO_REVEAL_COUNT:
            return False
        position = n - seq_index  # 1-based draft position being revealed
        STATE["animating"] = True
        STATE["anim_position"] = position
        STATE["anim_ends_at"] = time.time() + REVEAL_ANIMATION_SECONDS
        _bump()
    threading.Thread(target=_finish_reveal, args=(seq_index, auto),
                     daemon=True).start()
    return True


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/state")
def api_state():
    return jsonify(_public_state())


@app.route("/api/host/claim", methods=["POST"])
def api_host_claim():
    data = request.get_json(silent=True) or {}
    if data.get("passcode") != HOST_PASSCODE:
        return jsonify({"ok": False, "error": "Incorrect passcode."}), 403
    with _lock:
        STATE["host_token"] = secrets.token_hex(16)
        token = STATE["host_token"]
    return jsonify({"ok": True, "token": token})


@app.route("/api/config", methods=["POST"])
def api_config():
    if not _is_host(request):
        return jsonify({"ok": False, "error": "Not the host."}), 403
    data = request.get_json(silent=True) or {}
    teams = data.get("teams")
    if not isinstance(teams, list) or not teams:
        return jsonify({"ok": False, "error": "Need at least one team."}), 400
    cleaned = []
    for t in teams:
        name = str(t.get("name", "")).strip()
        try:
            weight = float(t.get("weight", 0))
        except (TypeError, ValueError):
            weight = 0.0
        if not name:
            continue
        cleaned.append({"name": name, "weight": max(0.0, weight)})
    if not cleaned:
        return jsonify({"ok": False, "error": "Need at least one named team."}), 400
    with _lock:
        if STATE["phase"] != "config":
            return jsonify({"ok": False, "error": "Lottery already started."}), 409
        STATE["teams"] = cleaned
        _bump()
    return jsonify({"ok": True})


@app.route("/api/start", methods=["POST"])
def api_start():
    if not _is_host(request):
        return jsonify({"ok": False, "error": "Not the host."}), 403
    with _lock:
        if STATE["phase"] != "config":
            return jsonify({"ok": False, "error": "Already started."}), 409
        if not STATE["teams"]:
            return jsonify({"ok": False, "error": "No teams configured."}), 400
        STATE["order"] = _draw_order(STATE["teams"])
        STATE["phase"] = "reveal"
        STATE["revealed_count"] = 0
        STATE["animating"] = False
        _bump()
    _begin_reveal(auto=True)  # kicks off the automatic first four
    return jsonify({"ok": True})


@app.route("/api/reveal-next", methods=["POST"])
def api_reveal_next():
    if not _is_host(request):
        return jsonify({"ok": False, "error": "Not the host."}), 403
    started = _begin_reveal(auto=False)
    return jsonify({"ok": started})


@app.route("/api/reset", methods=["POST"])
def api_reset():
    if not _is_host(request):
        return jsonify({"ok": False, "error": "Not the host."}), 403
    with _lock:
        token = STATE["host_token"]
        teams = STATE["teams"]
        globals()["STATE"] = _new_state()
        STATE["host_token"] = token   # keep the host logged in
        STATE["teams"] = teams        # keep their configured table
        _bump()
    return jsonify({"ok": True})


@app.route("/favicon.ico")
def favicon():
    svg = ("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>"
           "<text y='.9em' font-size='90'>\U0001F3C0</text></svg>")
    return app.response_class(svg, mimetype="image/svg+xml")


@app.route("/healthz")
def healthz():
    return "ok", 200


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "8080")),
            threaded=True)
