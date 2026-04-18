const { Pool } = require('pg');

let pool = null;
let useMemory = false;

// In-memory fallback storage
const memPlayersByName = new Map();
const memPlayersById   = new Map();
const memSessions      = [];
let nextPlayerId  = 1;
let nextSessionId = 1;

async function init() {
  if (!process.env.DATABASE_URL) {
    console.log('[DB] No DATABASE_URL found — using in-memory storage.');
    useMemory = true;
    return;
  }

  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      id         SERIAL PRIMARY KEY,
      nickname   VARCHAR(50) UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      last_seen  TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_sessions (
      id        SERIAL PRIMARY KEY,
      player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
      score     INTEGER NOT NULL DEFAULT 0,
      length    INTEGER NOT NULL DEFAULT 0,
      kills     INTEGER NOT NULL DEFAULT 0,
      duration  INTEGER NOT NULL DEFAULT 0,
      played_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query('CREATE INDEX IF NOT EXISTS idx_sessions_player ON game_sessions(player_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_sessions_score  ON game_sessions(score DESC)');

  console.log('[DB] PostgreSQL connected and tables ready.');
}

async function getOrCreatePlayer(nickname) {
  if (useMemory) {
    const key = nickname.toLowerCase();
    let p = memPlayersByName.get(key);
    if (!p) {
      p = { id: nextPlayerId++, nickname, created_at: new Date(), last_seen: new Date() };
      memPlayersByName.set(key, p);
      memPlayersById.set(p.id, p);
    } else {
      p.last_seen = new Date();
    }
    return p;
  }

  const { rows } = await pool.query(`
    INSERT INTO players (nickname, last_seen)
    VALUES ($1, NOW())
    ON CONFLICT (nickname) DO UPDATE SET last_seen = NOW()
    RETURNING *
  `, [nickname]);
  return rows[0];
}

async function getPlayerHistory(playerId) {
  if (useMemory) {
    return memSessions
      .filter(s => s.player_id === playerId)
      .sort((a, b) => b.played_at - a.played_at)
      .slice(0, 20);
  }

  const { rows } = await pool.query(`
    SELECT * FROM game_sessions
    WHERE player_id = $1
    ORDER BY played_at DESC
    LIMIT 20
  `, [playerId]);
  return rows;
}

async function getPlayerStats(playerId) {
  if (useMemory) {
    const sessions = memSessions.filter(s => s.player_id === playerId);
    if (!sessions.length) return { total_games: 0, best_score: 0, total_kills: 0, avg_score: 0 };
    let best = 0, totalKills = 0, totalScore = 0;
    for (const s of sessions) {
      if (s.score > best) best = s.score;
      totalKills += s.kills;
      totalScore += s.score;
    }
    return {
      total_games: sessions.length,
      best_score:  best,
      total_kills: totalKills,
      avg_score:   Math.round(totalScore / sessions.length),
    };
  }

  const { rows } = await pool.query(`
    SELECT
      COUNT(*)::int          AS total_games,
      MAX(score)             AS best_score,
      SUM(kills)::int        AS total_kills,
      ROUND(AVG(score))::int AS avg_score
    FROM game_sessions
    WHERE player_id = $1
  `, [playerId]);
  return rows[0];
}

async function saveScore({ playerId, score, length, kills, duration }) {
  if (useMemory) {
    const s = { id: nextSessionId++, player_id: playerId, score, length, kills, duration, played_at: new Date() };
    memSessions.push(s);
    return s;
  }

  const { rows } = await pool.query(`
    INSERT INTO game_sessions (player_id, score, length, kills, duration)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `, [playerId, score, length, kills, duration]);
  return rows[0];
}

async function getLeaderboard() {
  if (useMemory) {
    const bestByPlayer = new Map();
    for (const s of memSessions) {
      const best = bestByPlayer.get(s.player_id);
      if (!best || best.score < s.score) bestByPlayer.set(s.player_id, s);
    }
    return [...bestByPlayer.values()]
      .map(s => {
        const p = memPlayersById.get(s.player_id);
        return p ? { nickname: p.nickname, score: s.score, kills: s.kills, played_at: s.played_at } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  }

  const { rows } = await pool.query(`
    SELECT p.nickname, gs.score, gs.kills, gs.played_at
    FROM game_sessions gs
    JOIN players p ON p.id = gs.player_id
    WHERE gs.score = (
      SELECT MAX(gs2.score) FROM game_sessions gs2 WHERE gs2.player_id = gs.player_id
    )
    ORDER BY gs.score DESC
    LIMIT 10
  `);

  return rows;
}

async function getAllScores() {
  if (useMemory) {
    return memSessions
      .map(s => {
        const p = memPlayersById.get(s.player_id);
        return p ? { nickname: p.nickname, score: s.score, length: s.length, kills: s.kills, duration: s.duration, played_at: s.played_at } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);
  }

  const { rows } = await pool.query(`
    SELECT p.nickname, gs.score, gs.length, gs.kills, gs.duration, gs.played_at
    FROM game_sessions gs
    JOIN players p ON p.id = gs.player_id
    ORDER BY gs.score DESC
  `);

  return rows;
}

module.exports = { init, getOrCreatePlayer, getPlayerHistory, getPlayerStats, saveScore, getLeaderboard, getAllScores };
