require('dotenv').config();

const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const cors     = require('cors');
const helmet   = require('helmet');
const rateLimit = require('express-rate-limit');
const path     = require('path');
const db       = require('./db');

const app    = express();
const server = http.createServer(app);

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);
const corsOptions = allowedOrigins.length
  ? {
      origin: (origin, cb) => {
        if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
        return cb(new Error('CORS: origin not allowed'));
      },
    }
  : {}; // dev: permitir same-origin

const io = new Server(server, { cors: corsOptions });

const NICKNAME_REGEX = /^[a-zA-Z0-9_\- ]{2,20}$/;
const MAX_SCORE    = 1_000_000;
const MAX_LENGTH   = 100_000;
const MAX_KILLS    = 10_000;
const MAX_DURATION = 2 * 60 * 60; // 2h en segundos

app.set('trust proxy', 1); // Railway proxies
app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, slow down.' },
});
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many score submissions.' },
});
app.use('/api/', apiLimiter);

db.init().catch(err => {
  console.error('[DB] Init error:', err.message);
  console.log('[DB] Falling back to in-memory storage.');
});

// GET /api/player/:nickname
app.get('/api/player/:nickname', async (req, res) => {
  const clean = (req.params.nickname || '').trim();
  if (!NICKNAME_REGEX.test(clean)) {
    return res.status(400).json({ error: 'Nickname must be 2-20 chars (letters, numbers, _ - space).' });
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

// POST /api/score
app.post('/api/score', writeLimiter, async (req, res) => {
  const { nickname, score, length, kills, duration } = req.body || {};
  const clean = typeof nickname === 'string' ? nickname.trim() : '';

  if (!NICKNAME_REGEX.test(clean)) {
    return res.status(400).json({ error: 'Invalid nickname.' });
  }

  const s = Math.max(0, Math.min(MAX_SCORE,    parseInt(score)    || 0));
  const l = Math.max(0, Math.min(MAX_LENGTH,   parseInt(length)   || 0));
  const k = Math.max(0, Math.min(MAX_KILLS,    parseInt(kills)    || 0));
  const d = Math.max(0, Math.min(MAX_DURATION, parseInt(duration) || 0));

  try {
    const player  = await db.getOrCreatePlayer(clean);
    const session = await db.saveScore({
      playerId: player.id, score: s, length: l, kills: k, duration: d,
    });

    const leaderboard = await db.getLeaderboard();
    io.emit('leaderboard_update', leaderboard);

    res.json({ session, message: 'Score saved.' });
  } catch (err) {
    console.error('[API] POST /score:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

app.get('/api/leaderboard', async (_req, res) => {
  try { res.json(await db.getLeaderboard()); }
  catch (err) {
    console.error('[API] GET /leaderboard:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

app.get('/api/scores/all', async (_req, res) => {
  try { res.json(await db.getAllScores()); }
  catch (err) {
    console.error('[API] GET /scores/all:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

io.on('connection', async socket => {
  try {
    const lb = await db.getLeaderboard();
    socket.emit('leaderboard_update', lb);
  } catch (_) {}
  socket.on('disconnect', () => {});
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🐍  NEON SLITHER  →  http://localhost:${PORT}`);
});
