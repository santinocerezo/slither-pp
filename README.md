# 🐍 Neon Slither

A neon-styled browser game inspired by Slither.io — built as a personal portfolio project.

Play against **9 AI opponents** with reactive behavior, collect glowing food orbs, grow as long as possible, and top the all-time leaderboard.  
Your **nickname, score history, and stats** are saved across sessions — no password required.

## Features

- **Full canvas game engine** — smooth snake movement, particle effects, boost trails
- **9 AI bots** — seek food, evade threats, respawn when killed
- **Neon visual design** — fluorescent colors, glow effects, pulsing food orbs
- **Score history** — per-player history with best score, total kills, avg score
- **Live leaderboard** — updates in real-time via Socket.io
- **Minimap** — shows all snakes in the world
- **Persistent nicknames** — stored in localStorage, re-login without password
- **Mobile-friendly** — touch controls supported

## Controls

| Action        | Input                              |
|---------------|------------------------------------|
| Steer snake   | Move mouse toward desired direction |
| Boost         | Hold left click / hold touch        |
| Pause (debug) | `Esc`                               |

## Tech Stack

- **Backend:** Node.js + Express + Socket.io
- **Database:** PostgreSQL (Railway) — falls back to in-memory if `DATABASE_URL` is not set
- **Frontend:** Vanilla JS + HTML5 Canvas (no frameworks)
- **Deploy:** Railway

## Local Setup

```bash
git clone https://github.com/YOUR_USERNAME/neon-slither.git
cd neon-slither
npm install
cp .env.example .env       # edit if you have a local Postgres, otherwise leave it
npm run dev                # nodemon hot-reload
# open http://localhost:3000
```

Without `DATABASE_URL`, the game runs fully in-memory (scores reset on server restart).

## Deploy to Railway

1. Push to GitHub
2. Create new Railway project → **Deploy from GitHub repo**
3. Add a **PostgreSQL** service (Railway auto-injects `DATABASE_URL`)
4. Done — the tables are created automatically on first start

## Project Structure

```
slither-game/
├── server.js         Express + Socket.io server
├── db.js             PostgreSQL / in-memory abstraction
├── public/
│   ├── index.html    Login / leaderboard page
│   ├── game.html     Game canvas page
│   ├── css/
│   │   └── style.css Neon UI theme
│   └── js/
│       ├── ui.js     Login flow, leaderboard, history modal
│       └── game.js   Complete game engine (snakes, bots, rendering)
└── railway.toml      Railway deployment config
```

---

Built by **Santiago Cerezo** · [Portfolio](https://your-portfolio.com)
