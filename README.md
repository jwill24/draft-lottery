# Draft Lottery

A shared, real-time draft-lottery dashboard. One person hosts; everyone else
opens the same URL and watches the picks reveal live in their browser.

It's a web version of the original terminal script (`lottery.py`, kept for
reference): configure standings and odds, run a weighted NBA-style lottery, and
reveal the board from the last pick up to #1 — with a slot-machine animation
before every result.

## What it does

- **Configurable on the main page.** The host edits the standings table and the
  lottery weight for each team before the draw. Live "#1 odds" percentages update
  as you type. A team with weight `0` falls to its spot by record (it can't win a
  top pick), matching the real lottery structure.
- **Everyone watches together.** State is shared server-side, so every viewer
  sees the same animation and results at the same time.
- **The classic reveal flow.** The bottom four picks reveal automatically with an
  animation. From then on the host clicks **Reveal Next Pick** before each of the
  remaining picks is decided, building to the #1 pick (with confetti).
- **Host-only controls.** Editing, starting, and revealing are gated behind a
  host passcode. Everyone else is a read-only viewer.

## Run it locally

```bash
pip install -r requirements.txt
HOST_PASSCODE=letmein python3 app.py
# open http://localhost:8080
```

Click **Host controls**, enter the passcode, edit the table, and hit
**Run Lottery**. Open the same URL in another window to see the viewer view.

### Configuration (environment variables)

| Variable                   | Default | Purpose                                            |
| -------------------------- | ------- | -------------------------------------------------- |
| `HOST_PASSCODE`            | `host`  | Passcode to unlock the host control panel.         |
| `REVEAL_ANIMATION_SECONDS` | `4.0`   | Suspense animation length before each result.      |
| `PORT`                     | `8080`  | Port to bind.                                      |

## Deploy to fly.io

The repo ships a `Dockerfile` and `fly.toml`.

```bash
# one-time
fly launch --no-deploy          # or edit the app name in fly.toml first
fly secrets set HOST_PASSCODE=your-secret-passcode
fly deploy
fly scale count 1               # IMPORTANT: keep exactly one machine
```

Then share the `https://<your-app>.fly.dev` URL with the participants.

> **Why a single machine / single worker?** The lottery state lives in memory and
> is shared across every viewer. Running more than one machine or gunicorn worker
> would split that state, so the `Dockerfile` runs one worker (many threads) and
> `fly.toml` keeps one machine always running.

## The lottery model

Teams with a positive weight are drawn without replacement into the top picks
(probability proportional to weight); once the remaining weights are all zero,
the rest fill the board in their configured standings order. Give the worst
records the highest weights and the better teams a weight of `0` to reproduce a
standard weighted lottery.
