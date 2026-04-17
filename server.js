require('dotenv').config();

const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const cors     = require('cors');
const path     = require('path');
const db       = require('./db');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Init DB ───────────────────────────────────────────────────────────────────
db.init().catch(err => {
  console.error('[DB] Init error:', err.message);
  console.log('[DB] Falling back to in-memory storage.');
});

// ── API ───────────────────────────────────────────────────────────────────────

// GET /api/player/:nickname — register or retrieve player + history
app.get('/api/player/:nickname', async (req, res) => {
  const { nickname } = req.params;
  const clean = (nickname || '').trim();

  if (!clean || clean.length < 2 || clean.length > 20) {
    return res.status(400).json({ error: 'Nickname must be 2-20 characters.' });
  }

  try {
    const player  = await db.getOrCreatePlayer(clean);
    const history = await db.getPlayerHistory(player.id);
    const stats   = await db.getPlayerStats(player.id);
    res.json({ player, history, stats });
  } catch (err) {
    console.error('[API] GET /player:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// POST /api/score — save a game result
app.post('/api/score', async (req, res) => {
  const { nickname, score, length, kills, duration } = req.body;
  const clean = (nickname || '').trim();

  if (!clean || score === undefined || score === null) {
    return res.status(400).json({ error: 'nickname and score are required.' });
  }

  try {
    const player  = await db.getOrCreatePlayer(clean);
    const session = await db.saveScore({
      playerId: player.id,
      score:    Math.max(0, parseInt(score)    || 0),
      length:   Math.max(0, parseInt(length)   || 0),
      kills:    Math.max(0, parseInt(kills)    || 0),
      duration: Math.max(0, parseInt(duration) || 0)
    });

    // Push updated leaderboard to all connected clients
    const leaderboard = await db.getLeaderboard();
    io.emit('leaderboard_update', leaderboard);

    res.json({ session, message: 'Score saved.' });
  } catch (err) {
    console.error('[API] POST /score:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// GET /api/leaderboard
app.get('/api/leaderboard', async (_req, res) => {
  try {
    const rows = await db.getLeaderboard();
    res.json(rows);
  } catch (err) {
    console.error('[API] GET /leaderboard:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// GET /api/scores/all — all game sessions ordered by score desc
app.get('/api/scores/all', async (_req, res) => {
  try {
    const rows = await db.getAllScores();
    res.json(rows);
  } catch (err) {
    console.error('[API] GET /scores/all:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// ── Socket.io ─────────────────────────────────────────────────────────────────
io.on('connection', async socket => {
  try {
    const lb = await db.getLeaderboard();
    socket.emit('leaderboard_update', lb);
  } catch (_) {}

  socket.on('disconnect', () => {});
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🐍  NEON SLITHER  →  http://localhost:${PORT}`);
});
