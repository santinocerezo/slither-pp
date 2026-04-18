/* ──────────────────────────────────────────────────────────────────────────
   game.js — Neon Slither complete game engine
   Single file, vanilla JS + HTML5 Canvas. No dependencies.

   Architecture:
   - NeonGame class drives everything
   - 1 human player + 9 AI bots
   - All logic client-side for responsiveness
   - Server only used for score persistence (POST /api/score)
   ────────────────────────────────────────────────────────────────────────── */

'use strict';

// ── Constants ─────────────────────────────────────────────────────────────────
const WORLD_W      = 5000;
const WORLD_H      = 5000;
const GRID_SIZE    = 50;
const FOOD_TARGET  = 520;
const BOT_COUNT    = 9;
const SEG_RADIUS   = 10;   // pixels, half-width of snake body
const SEG_SPACING  = 4;    // distance between stored segments
const BASE_SPEED   = 3.0;
const BOOST_SPEED  = 5.5;
const BOOST_DRAIN  = 0.4;  // segments lost per boost frame
const TURN_SPEED   = 0.082; // radians per frame (slightly sharper controls)
const GROWTH_RATE  = 0.4;   // growth per food size unit (lower = slower growth)
const SELF_COLLIDE_IDX = 40; // player can't self-collide until segment 40

// ── Bot AI tunables ──────────────────────────────────────────────────────────
const BOT_VIEW_RADIUS   = 520;   // how far bots can "see"
const BOT_DANGER_RADIUS = 240;   // immediate threat distance
const BOT_HUNT_RADIUS   = 420;   // distance to start hunting
const BOT_MIN_HUNT_LEN  = 85;    // min length before bot will attempt a cut
const BOT_FORESEE_STEPS = 20;    // look-ahead steps for collision prediction

const NEON_COLORS = [
  '#00ff88',  // player — neon green
  '#ff0080',  // hot pink
  '#00d4ff',  // electric cyan
  '#ff6b00',  // neon orange
  '#bb00ff',  // purple
  '#ffff00',  // yellow
  '#ff3355',  // neon red
  '#00ffff',  // aqua
  '#aaff00',  // lime
  '#ff44cc',  // magenta-pink
];

const BOT_NAMES = [
  'ViperX', 'CyberCoil', 'PlasmaKing', 'GlitchWorm',
  'ByteSerpent', 'NullCoil', 'VoidSlither', 'HexWorm', 'NeonSlash'
];

// Personality archetypes — each bot picks one. Controls how it balances
// aggression, caution, food greed, and boost usage.
const BOT_PERSONALITIES = [
  // aggressive hunter — big view, cuts off enemies, boosts often
  { name: 'hunter',      aggression: 0.85, caution: 0.55, greed: 0.50, boostLove: 0.75, turn: 0.095 },
  // opportunist — eats corpses, picks fights when ahead
  { name: 'opportunist', aggression: 0.60, caution: 0.70, greed: 0.80, boostLove: 0.55, turn: 0.090 },
  // coward — feeds and flees, very hard to catch
  { name: 'coward',      aggression: 0.15, caution: 0.95, greed: 0.70, boostLove: 0.35, turn: 0.100 },
  // pro — balanced, reads situations, punishes mistakes
  { name: 'pro',         aggression: 0.70, caution: 0.80, greed: 0.60, boostLove: 0.60, turn: 0.098 },
  // greedy — obsessed with food, reckless around corpses
  { name: 'greedy',      aggression: 0.40, caution: 0.65, greed: 0.95, boostLove: 0.50, turn: 0.088 },
];

// ── Utils ─────────────────────────────────────────────────────────────────────
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d >  Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function dist2(ax, ay, bx, by) {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
}

function randRange(min, max) { return min + Math.random() * (max - min); }

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// Shortest signed angular difference from a to b (result in (-pi, pi])
function angleDiff(a, b) {
  let d = b - a;
  while (d >  Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── Main game class ───────────────────────────────────────────────────────────
class NeonGame {
  constructor(canvas, nickname) {
    this.canvas   = canvas;
    this.ctx      = canvas.getContext('2d');
    this.nickname = nickname;

    this.running   = false;
    this.gameOver  = false;
    this.startTime = 0;

    // Camera (world-space top-left corner of the viewport)
    this.cam = { x: 0, y: 0 };

    // Mouse in screen-space
    this.mouse  = { x: canvas.width / 2, y: canvas.height / 2 };
    this.boost  = false;

    // Score popups
    this.popups    = [];
    // Particles
    this.particles = [];
    // Food orbs
    this.food      = [];

    this.player = null;
    this.bots   = [];

    this.onDeath = null; // callback(score, length, kills, durationSec)
  }

  // ── Initialise ──────────────────────────────────────────────────────────────
  start() {
    this.resize();
    this._setupInput();

    // Seed food
    for (let i = 0; i < FOOD_TARGET; i++) this._spawnFood();

    // Create player
    const cx = WORLD_W / 2 + randRange(-300, 300);
    const cy = WORLD_H / 2 + randRange(-300, 300);
    this.player = this._createSnake(cx, cy, NEON_COLORS[0], this.nickname, false);

    // Create bots with randomised personalities
    for (let i = 0; i < BOT_COUNT; i++) {
      const x   = randRange(300, WORLD_W - 300);
      const y   = randRange(300, WORLD_H - 300);
      const bot = this._createSnake(x, y, NEON_COLORS[i + 1], BOT_NAMES[i], true);
      bot.ai    = this._newAI();
      this.bots.push(bot);
    }

    this.running   = true;
    this.startTime = performance.now();
    this._lastTs   = this.startTime;
    requestAnimationFrame(ts => this._loop(ts));
  }

  resize() {
    this.canvas.width  = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  // ── Entity factory ──────────────────────────────────────────────────────────
  _createSnake(x, y, color, name, isBot) {
    const angle = Math.random() * Math.PI * 2;
    const segs  = [];
    for (let i = 0; i < 60; i++) {
      segs.push({
        x: x - Math.cos(angle) * i * SEG_SPACING,
        y: y - Math.sin(angle) * i * SEG_SPACING
      });
    }
    return {
      segs, color, name, isBot,
      angle,
      speed:    BASE_SPEED,
      growing:  0,
      boosting: false,
      alive:    true,
      score:    0,
      kills:    0,
      ai:       null
    };
  }

  _newAI() {
    const p = BOT_PERSONALITIES[Math.floor(Math.random() * BOT_PERSONALITIES.length)];
    return {
      personality: p,
      state:       'wander',              // wander | seek | evade | hunt | flee
      wanderAngle: Math.random() * Math.PI * 2,
      targetFood:  null,
      huntTarget:  null,
      huntTimer:   0,
      reactTimer:  randRange(0, 6),       // reaction latency noise
      decisionT:   0,                     // throttles expensive decisions
      lastTurn:    0,
      boostTimer:  0,
    };
  }

  // ── Food ────────────────────────────────────────────────────────────────────
  _spawnFood(x, y) {
    this.food.push({
      x:     x ?? randRange(40, WORLD_W - 40),
      y:     y ?? randRange(40, WORLD_H - 40),
      size:  randRange(3.5, 8),
      color: NEON_COLORS[Math.floor(Math.random() * NEON_COLORS.length)],
      phase: Math.random() * Math.PI * 2,
      value: 1
    });
  }

  // ── Main loop ───────────────────────────────────────────────────────────────
  _loop(ts) {
    if (!this.running && !this.gameOver) return;

    const raw   = ts - this._lastTs;
    this._lastTs = ts;
    const delta  = Math.min(raw / 16.667, 3); // normalise to 60 fps = 1.0

    if (this.running) {
      this._update(delta);
    }
    this._render(delta);

    requestAnimationFrame(next => this._loop(next));
  }

  // ── Update ──────────────────────────────────────────────────────────────────
  _update(delta) {
    this._updatePlayer(delta);
    this._updateBots(delta);
    this._checkFood();
    this._checkCollisions();
    this._tickParticles(delta);
    this._tickPopups(delta);
    this._maintainFood();
    this._respawnDead();
    this._updateCamera();
  }

  _updatePlayer(delta) {
    const p = this.player;
    if (!p.alive) return;

    const cx = this.canvas.width  / 2;
    const cy = this.canvas.height / 2;
    const target = Math.atan2(this.mouse.y - cy, this.mouse.x - cx);
    p.angle = lerpAngle(p.angle, target, TURN_SPEED * delta);

    const speed = (this.boost ? BOOST_SPEED : BASE_SPEED) * delta;

    if (this.boost && p.segs.length > 20) {
      p.growing = Math.max(p.growing - BOOST_DRAIN * delta, 0);
      // Drop a food orb from the tail for the boost trail
      if (Math.random() < 0.25 * delta) {
        const tail = p.segs[p.segs.length - 1];
        this.food.push({ x: tail.x, y: tail.y, size: 5, color: p.color, phase: 0, value: 1 });
      }
    }

    this._moveSnake(p, speed);
    this._borderKill(p);
  }

  _updateBots(delta) {
    for (const bot of this.bots) {
      if (!bot.alive) continue;
      this._runBotAI(bot, delta);
      const botSpeed = bot.boosting ? BOOST_SPEED : BASE_SPEED;
      if (bot.boosting) bot.growing = Math.max((bot.growing || 0) - BOOST_DRAIN * delta, 0);
      this._moveSnake(bot, botSpeed * delta);
      this._borderKill(bot);
    }
  }

  // ── Smarter bot AI ──────────────────────────────────────────────────────────
  // Strategy layers (first that applies wins):
  //   1. Predictive self-preservation  — look-ahead sampling of candidate
  //      headings, pick the one with longest clear path (avoids walls,
  //      other snakes, own body).
  //   2. Hunt / cut-off                — if bigger than a nearby target,
  //      aim at a lead point in front of them to force a collision.
  //   3. Food seeking                  — weighted by size/distance and by
  //      whether the bot is cornered by other snakes.
  //   4. Wander                        — smoothed random drift.
  _runBotAI(bot, delta) {
    const head = bot.segs[0];
    const ai   = bot.ai;
    const p    = ai.personality;

    ai.decisionT -= delta;
    ai.reactTimer = Math.max(0, ai.reactTimer - delta);
    if (ai.huntTimer > 0) ai.huntTimer -= delta;
    if (ai.boostTimer > 0) ai.boostTimer -= delta;

    const allSnakes = [this.player, ...this.bots];

    // ── 1. Threat scan ────────────────────────────────────────────────────────
    // Find nearest threatening segment. "Threatening" = another snake's body
    // within view, or a wall. Record direction and distance for each.
    let nearestThreatD2 = Infinity;
    let nearestThreatA  = 0;   // world angle from head to the threat
    const viewR2 = BOT_VIEW_RADIUS * BOT_VIEW_RADIUS;

    for (const other of allSnakes) {
      if (!other.alive) continue;
      const isSelf = other === bot;
      const start  = isSelf ? 24 : 0;
      const step   = other.segs.length > 120 ? 3 : 2; // coarse sampling for long snakes
      const maxI   = other.segs.length;
      for (let i = start; i < maxI; i += step) {
        const s  = other.segs[i];
        const d2 = dist2(head.x, head.y, s.x, s.y);
        if (d2 < viewR2 && d2 < nearestThreatD2) {
          nearestThreatD2 = d2;
          nearestThreatA  = Math.atan2(s.y - head.y, s.x - head.x);
        }
      }
    }

    // ── 2. Predictive safety: sample candidate headings ──────────────────────
    // Score each candidate by the distance we could travel before hitting
    // something. We then blend that with our desired intent (food/hunt).
    const speed = (bot.boosting ? BOOST_SPEED : BASE_SPEED);
    const stepLen = speed;
    const steps   = BOT_FORESEE_STEPS;
    const probeR  = SEG_RADIUS * 1.9;

    const CAND = [
      -1.10, -0.78, -0.52, -0.32, -0.16, -0.06,
       0.00,
       0.06,  0.16,  0.32,  0.52,  0.78,  1.10
    ];

    // Precompute nearby segments ONCE per AI tick (same origin for every candidate).
    const nearby = this._gatherNearby(bot, head.x, head.y, stepLen * steps + probeR + 40);

    const safety = new Array(CAND.length);
    let bestSafety = 0;
    for (let c = 0; c < CAND.length; c++) {
      const a = bot.angle + CAND[c];
      const free = this._foreseeWithBuffer(head.x, head.y, a, stepLen, steps, probeR, nearby);
      safety[c] = free;
      if (free > bestSafety) bestSafety = free;
    }

    // ── 3. Intent: where do we WANT to go? ───────────────────────────────────
    let desiredAngle = bot.angle;
    let desiredTurn  = p.turn;
    let wantBoost    = false;
    let intent       = 'wander';

    // Hunt target search (expensive) — throttled per-bot
    if (ai.decisionT <= 0) {
      ai.decisionT = randRange(6, 14);

      // --- Hunt candidate: any snake we can plausibly cut off ---
      ai.huntTarget = null;
      if (bot.segs.length >= BOT_MIN_HUNT_LEN && p.aggression > 0.3) {
        let bestHuntScore = 0;
        for (const other of allSnakes) {
          if (!other.alive || other === bot) continue;
          // Only hunt snakes meaningfully smaller than us (or near our size
          // for very aggressive bots).
          const lenRatio = other.segs.length / bot.segs.length;
          if (lenRatio > 1.05 + (1 - p.aggression) * 0.1) continue;
          const oh = other.segs[0];
          const d  = Math.sqrt(dist2(head.x, head.y, oh.x, oh.y));
          if (d > BOT_HUNT_RADIUS + p.aggression * 200) continue;
          // Score: prefer close + smaller + players > bots for aggressive bots
          const playerBias = !other.isBot ? 1.3 : 1.0;
          const score = (1 / (d + 1)) * (2 - lenRatio) * playerBias * p.aggression;
          if (score > bestHuntScore) {
            bestHuntScore  = score;
            ai.huntTarget  = other;
          }
        }
        if (ai.huntTarget) ai.huntTimer = randRange(60, 120);
      }

      // --- Food target: weighted by value/distance/safety ---
      let best = null, bestFoodScore = -Infinity;
      const greed = p.greed;
      for (const f of this.food) {
        const d2 = dist2(head.x, head.y, f.x, f.y);
        if (d2 > 1400 * 1400) continue; // ignore very distant food
        const d = Math.sqrt(d2);
        // Bigger food far away is worth chasing if greedy
        const score = (f.value + f.size * 0.15) * (1 / (d + 40)) * (1 + greed * 0.6);
        if (score > bestFoodScore) { bestFoodScore = score; best = f; }
      }
      ai.targetFood = best;
    } else if (ai.targetFood && !this.food.includes(ai.targetFood)) {
      ai.targetFood = null;
    }

    // Choose intent: hunt > food > wander
    if (ai.huntTarget && ai.huntTarget.alive && ai.huntTimer > 0) {
      const t   = ai.huntTarget;
      const th  = t.segs[0];
      // Lead point: aim ahead of target's head along its velocity
      const lead = 120 + Math.min(300, t.segs.length * 1.2);
      const lx   = th.x + Math.cos(t.angle) * lead;
      const ly   = th.y + Math.sin(t.angle) * lead;
      desiredAngle = Math.atan2(ly - head.y, lx - head.x);
      desiredTurn  = p.turn * 1.15;
      intent       = 'hunt';
      // Boost to close the gap if we're clearly bigger and path is clear
      const distToHead = Math.sqrt(dist2(head.x, head.y, th.x, th.y));
      const lenAdv     = bot.segs.length - t.segs.length;
      if (lenAdv > 30 && distToHead < 260 && bestSafety > steps * 0.7 && bot.segs.length > 60) {
        wantBoost = Math.random() < p.boostLove * 0.6;
      }
    } else if (ai.targetFood) {
      const tx = ai.targetFood.x, ty = ai.targetFood.y;
      desiredAngle = Math.atan2(ty - head.y, tx - head.x);
      desiredTurn  = p.turn;
      intent       = 'seek';
      // Boost to a cluster of food when big and safe
      const d2 = dist2(head.x, head.y, tx, ty);
      if (d2 < 260 * 260 && bot.segs.length > 70 && bestSafety > steps * 0.8 && p.boostLove > 0.5) {
        wantBoost = Math.random() < p.boostLove * 0.4;
      }
    } else {
      ai.wanderAngle += randRange(-0.05, 0.05) * delta;
      desiredAngle   = ai.wanderAngle;
      desiredTurn    = p.turn * 0.7;
      intent         = 'wander';
    }

    // ── 4. Border pressure ───────────────────────────────────────────────────
    // Borders are deadly — bias desired angle toward world center when close.
    const M = 360;
    let borderPanic = 0;
    if (head.x < M)             borderPanic = Math.max(borderPanic, 1 - head.x / M);
    if (head.x > WORLD_W - M)   borderPanic = Math.max(borderPanic, 1 - (WORLD_W - head.x) / M);
    if (head.y < M)             borderPanic = Math.max(borderPanic, 1 - head.y / M);
    if (head.y > WORLD_H - M)   borderPanic = Math.max(borderPanic, 1 - (WORLD_H - head.y) / M);

    if (borderPanic > 0.05) {
      const toCenter = Math.atan2(WORLD_H / 2 - head.y, WORLD_W / 2 - head.x);
      desiredAngle = lerpAngle(desiredAngle, toCenter, Math.min(1, borderPanic * 1.4));
      desiredTurn  = Math.max(desiredTurn, 0.12 + borderPanic * 0.15);
      if (borderPanic > 0.4) wantBoost = false;
    }

    // ── 5. Pick final heading: blend desired with safest candidate ───────────
    // Imminent threat = any segment within BOT_DANGER_RADIUS scaled by caution.
    const dangerR = BOT_DANGER_RADIUS * (0.6 + p.caution * 0.8);
    const inDanger = nearestThreatD2 < dangerR * dangerR || bestSafety < steps * 0.35;

    let pickIdx = -1;
    let pickScore = -Infinity;
    for (let c = 0; c < CAND.length; c++) {
      const a = bot.angle + CAND[c];
      const alignment = Math.cos(angleDiff(a, desiredAngle)); // 1 = same, -1 = opposite
      const safeFrac  = safety[c] / steps;                     // 0..1
      // Safety dominates when in danger; intent dominates otherwise.
      const w = inDanger ? (0.12 + (1 - p.caution) * 0.25) : (0.55 + (1 - p.caution) * 0.25);
      const score = safeFrac * (1 - w) + ((alignment + 1) * 0.5) * w
                  - Math.abs(CAND[c]) * 0.04; // tiny cost for huge turns
      if (score > pickScore) { pickScore = score; pickIdx = c; }
    }

    // Emergency evasion: if NO candidate is safe enough, pick the MOST
    // safe one ignoring intent. Also don't boost when fleeing.
    if (bestSafety < steps * 0.3) {
      let maxS = -1, maxI = 0;
      for (let c = 0; c < CAND.length; c++) {
        if (safety[c] > maxS) { maxS = safety[c]; maxI = c; }
      }
      pickIdx  = maxI;
      wantBoost = false;
      intent   = 'flee';
      desiredTurn = Math.max(desiredTurn, 0.18);
    }

    const targetA = bot.angle + CAND[pickIdx];
    // Reaction latency: if timer not up, slow our turn a bit so we aren't pixel-perfect.
    const latencyK = ai.reactTimer > 0 ? 0.75 : 1.0;
    const turnRate = clamp(desiredTurn * latencyK, 0.05, 0.22);
    bot.angle = lerpAngle(bot.angle, targetA, turnRate * delta);
    ai.lastTurn = turnRate;

    // ── 6. Boost control ─────────────────────────────────────────────────────
    // Never boost when fleeing, low-length, or heading toward a wall.
    if (bot.segs.length < 45) wantBoost = false;
    if (inDanger)             wantBoost = false;
    if (borderPanic > 0.3)    wantBoost = false;
    bot.boosting = wantBoost;
    if (wantBoost) ai.boostTimer = Math.max(ai.boostTimer, 12);
    ai.state = intent;
  }

  // Gather segments within `reach` of (x, y), excluding a small window of
  // `bot`'s own neck. Returns a { sx, sy, n } object with flat number arrays
  // for cache locality in the hot loop.
  _gatherNearby(bot, x, y, reach) {
    const sx = this._scratchSX || (this._scratchSX = []);
    const sy = this._scratchSY || (this._scratchSY = []);
    sx.length = 0;
    sy.length = 0;
    const reach2 = reach * reach;
    const allSnakes = [this.player, ...this.bots];
    for (let si = 0; si < allSnakes.length; si++) {
      const other = allSnakes[si];
      if (!other.alive) continue;
      const isSelf = other === bot;
      const start  = isSelf ? 24 : 0;
      const segs   = other.segs;
      const stride = segs.length > 100 ? 3 : 2;
      for (let k = start; k < segs.length; k += stride) {
        const s = segs[k];
        const dx = s.x - x, dy = s.y - y;
        if (dx * dx + dy * dy > reach2) continue;
        sx.push(s.x);
        sy.push(s.y);
      }
    }
    return { sx, sy, n: sx.length };
  }

  _foreseeWithBuffer(x, y, a, len, steps, probeR, nearby) {
    const cosA = Math.cos(a);
    const sinA = Math.sin(a);
    const probeR2 = probeR * probeR;
    const sx = nearby.sx, sy = nearby.sy, n = nearby.n;

    for (let i = 1; i <= steps; i++) {
      const px = x + cosA * len * i;
      const py = y + sinA * len * i;
      if (px < 20 || px > WORLD_W - 20 || py < 20 || py > WORLD_H - 20) return i - 1;
      for (let k = 0; k < n; k++) {
        const dx = sx[k] - px;
        if (dx > probeR || dx < -probeR) continue;
        const dy = sy[k] - py;
        if (dy > probeR || dy < -probeR) continue;
        if (dx * dx + dy * dy < probeR2) return i - 1;
      }
    }
    return steps;
  }

  _moveSnake(snake, speed) {
    const head    = snake.segs[0];
    const newHead = {
      x: head.x + Math.cos(snake.angle) * speed,
      y: head.y + Math.sin(snake.angle) * speed
    };
    snake.segs.unshift(newHead);

    if (snake.growing > 0) {
      snake.growing = Math.max(snake.growing - 1, 0);
    } else {
      snake.segs.pop();
    }
  }

  _borderKill(snake) {
    if (!snake.alive) return;
    const h = snake.segs[0];
    if (h.x < 0 || h.x > WORLD_W || h.y < 0 || h.y > WORLD_H) {
      this._killSnake(snake, null);
    }
  }

  // ── Food collision ──────────────────────────────────────────────────────────
  _checkFood() {
    const allSnakes = [this.player, ...this.bots];

    for (const snake of allSnakes) {
      if (!snake.alive) continue;
      const h   = snake.segs[0];
      const r   = SEG_RADIUS + 6;
      const r2  = r * r;

      for (let i = this.food.length - 1; i >= 0; i--) {
        const f  = this.food[i];
        if (dist2(h.x, h.y, f.x, f.y) < r2) {
          const growth = Math.ceil(f.size * GROWTH_RATE);
          snake.growing += growth;
          snake.score   += f.value;
          this.food.splice(i, 1);

          if (!snake.isBot) {
            this._spawnPopup(f.x, f.y, `+${f.value}`, f.color);
            this._burst(f.x, f.y, f.color, 4);
          }
        }
      }
    }
  }

  // ── Snake-snake collision ───────────────────────────────────────────────────
  _checkCollisions() {
    const allSnakes = [this.player, ...this.bots];

    for (const snake of allSnakes) {
      if (!snake.alive) continue;
      const h  = snake.segs[0];

      for (const other of allSnakes) {
        if (!other.alive) continue;

        const isSelf = (other === snake);

        // Neither player nor bots die from their own body
        if (isSelf) continue;

        const startIdx = 0;

        for (let i = startIdx; i < other.segs.length; i++) {
          const s       = other.segs[i];
          const collide = SEG_RADIUS * 1.6;
          if (dist2(h.x, h.y, s.x, s.y) < collide * collide) {
            this._killSnake(snake, other);
            break;
          }
        }

        if (!snake.alive) break;
      }
    }
  }

  // ── Kill a snake ────────────────────────────────────────────────────────────
  _killSnake(snake, killer) {
    if (!snake.alive) return;
    snake.alive = false;

    // Explode into food
    for (const seg of snake.segs) {
      if (Math.random() < 0.4) {
        this.food.push({
          x: seg.x + randRange(-6, 6),
          y: seg.y + randRange(-6, 6),
          size:  randRange(5, 9),
          color: snake.color,
          phase: Math.random() * Math.PI * 2,
          value: 2
        });
      }
    }

    // Big explosion
    this._burst(snake.segs[0].x, snake.segs[0].y, snake.color, 22);

    if (killer) {
      killer.kills++;
      if (!killer.isBot) {
        this._spawnPopup(snake.segs[0].x, snake.segs[0].y, 'KILL!', '#ff0080');
      }
    }

    if (!snake.isBot) {
      // Player died
      this.running = false;
      const elapsed = Math.round((performance.now() - this.startTime) / 1000);
      setTimeout(() => {
        if (this.onDeath) this.onDeath(
          snake.score,
          snake.segs.length,
          snake.kills,
          elapsed
        );
      }, 1200);
    }
  }

  // ── Respawn dead bots ───────────────────────────────────────────────────────
  _respawnDead() {
    const playerHead = this.player.alive && this.player.segs.length
      ? this.player.segs[0] : null;

    for (let i = 0; i < this.bots.length; i++) {
      if (!this.bots[i].alive) {
        // Keep trying spawn positions until we find one far from the player
        let x, y, attempts = 0;
        do {
          x = randRange(300, WORLD_W - 300);
          y = randRange(300, WORLD_H - 300);
          attempts++;
        } while (
          playerHead &&
          dist2(x, y, playerHead.x, playerHead.y) < 600 * 600 &&
          attempts < 20
        );

        const bot = this._createSnake(x, y, NEON_COLORS[(i % (NEON_COLORS.length - 1)) + 1], BOT_NAMES[i], true);
        bot.ai    = this._newAI();
        this.bots[i] = bot;
      }
    }
  }

  // ── Food maintenance ────────────────────────────────────────────────────────
  _maintainFood() {
    const needed = FOOD_TARGET - this.food.length;
    for (let i = 0; i < Math.min(needed, 5); i++) this._spawnFood();
  }

  // ── Particles ───────────────────────────────────────────────────────────────
  _burst(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      const a  = Math.random() * Math.PI * 2;
      const sp = randRange(1.5, 5 + count * 0.05);
      this.particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        color,
        size:  randRange(2, 6),
        life:  1.0,
        decay: randRange(0.015, 0.035)
      });
    }
  }

  _tickParticles(delta) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x    += p.vx * delta;
      p.y    += p.vy * delta;
      p.vx   *= 0.96;
      p.vy   *= 0.96;
      p.life -= p.decay * delta;
      p.size *= 0.97;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
  }

  // ── Score popups ─────────────────────────────────────────────────────────────
  _spawnPopup(x, y, text, color) {
    this.popups.push({ x, y, text, color, life: 1.0, vy: -1.2 });
  }

  _tickPopups(delta) {
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.y    += p.vy * delta;
      p.life -= 0.022 * delta;
      if (p.life <= 0) this.popups.splice(i, 1);
    }
  }

  // ── Camera ──────────────────────────────────────────────────────────────────
  _updateCamera() {
    if (!this.player.alive || !this.player.segs.length) return;
    const h    = this.player.segs[0];
    const tw   = h.x - this.canvas.width  / 2;
    const th   = h.y - this.canvas.height / 2;
    this.cam.x += (tw - this.cam.x) * 0.12;
    this.cam.y += (th - this.cam.y) * 0.12;
  }

  // ── Input ───────────────────────────────────────────────────────────────────
  // Mobile touch handling lives in boot() so it can manage the floating
  // joystick DOM. Here we only hook mouse + keyboard.
  _setupInput() {
    const c = this.canvas;

    c.addEventListener('mousemove', e => {
      const r = c.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left;
      this.mouse.y = e.clientY - r.top;
      const cur = document.getElementById('cursor');
      if (cur) { cur.style.left = e.clientX + 'px'; cur.style.top = e.clientY + 'px'; }
    });

    c.addEventListener('mousedown', e => { if (e.button === 0) this.boost = true; });
    window.addEventListener('mouseup',  e => { if (e.button === 0) this.boost = false; });

    // Keyboard: space / shift to boost. Useful on PC for trackpad players.
    window.addEventListener('keydown', e => {
      if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        this.boost = true;
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', e => {
      if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        this.boost = false;
      }
    });

    window.addEventListener('resize', () => this.resize());
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  _render() {
    const ctx = this.ctx;
    const W   = this.canvas.width;
    const H   = this.canvas.height;

    // Clear
    ctx.fillStyle = '#05050f';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(-this.cam.x, -this.cam.y);

    this._drawGrid(ctx);
    this._drawWorldBorder(ctx);
    this._drawFood(ctx);
    this._drawParticles(ctx);

    // Draw bots then player (player on top)
    for (const bot of this.bots) { if (bot.alive) this._drawSnake(ctx, bot); }
    if (this.player.alive) this._drawSnake(ctx, this.player);

    this._drawPopups(ctx);

    ctx.restore();

    // HUD (screen-space)
    this._drawHUD(ctx, W, H);
  }

  _drawGrid(ctx) {
    ctx.save();
    ctx.strokeStyle = 'rgba(30, 20, 55, 0.9)';
    ctx.lineWidth   = 0.5;

    const x0 = Math.floor(this.cam.x / GRID_SIZE) * GRID_SIZE;
    const y0 = Math.floor(this.cam.y / GRID_SIZE) * GRID_SIZE;
    const x1 = this.cam.x + this.canvas.width  + GRID_SIZE;
    const y1 = this.cam.y + this.canvas.height + GRID_SIZE;

    for (let x = x0; x < x1; x += GRID_SIZE) {
      ctx.beginPath(); ctx.moveTo(x, this.cam.y); ctx.lineTo(x, y1); ctx.stroke();
    }
    for (let y = y0; y < y1; y += GRID_SIZE) {
      ctx.beginPath(); ctx.moveTo(this.cam.x, y); ctx.lineTo(x1, y); ctx.stroke();
    }

    // Dot at each intersection
    ctx.fillStyle = 'rgba(80, 50, 120, 0.5)';
    for (let x = x0; x < x1; x += GRID_SIZE) {
      for (let y = y0; y < y1; y += GRID_SIZE) {
        ctx.beginPath(); ctx.arc(x, y, 1, 0, Math.PI * 2); ctx.fill();
      }
    }

    ctx.restore();
  }

  _drawWorldBorder(ctx) {
    // Danger zone — 80px red gradient at edges
    const grad = ctx.createLinearGradient(0, 0, 80, 0);
    grad.addColorStop(0, 'rgba(255, 30, 60, 0.25)');
    grad.addColorStop(1, 'rgba(255, 30, 60, 0)');

    // Left
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 80, WORLD_H);
    // Right
    ctx.save();
    ctx.translate(WORLD_W, 0);
    ctx.scale(-1, 1);
    ctx.fillRect(0, 0, 80, WORLD_H);
    ctx.restore();

    const gradV = ctx.createLinearGradient(0, 0, 0, 80);
    gradV.addColorStop(0, 'rgba(255, 30, 60, 0.25)');
    gradV.addColorStop(1, 'rgba(255, 30, 60, 0)');

    // Top
    ctx.fillStyle = gradV;
    ctx.fillRect(0, 0, WORLD_W, 80);
    // Bottom
    ctx.save();
    ctx.translate(0, WORLD_H);
    ctx.scale(1, -1);
    ctx.fillRect(0, 0, WORLD_W, 80);
    ctx.restore();

    // Outer glowing border line
    ctx.save();
    ctx.strokeStyle = '#ff1e3c';
    ctx.lineWidth   = 3;
    ctx.shadowBlur  = 18;
    ctx.shadowColor = '#ff1e3c';
    ctx.strokeRect(1, 1, WORLD_W - 2, WORLD_H - 2);
    ctx.restore();
  }

  _drawFood(ctx) {
    const t = performance.now() / 1000;

    for (const f of this.food) {
      const pulse = Math.sin(f.phase + t * 2.2) * 0.28 + 0.72;
      const r     = f.size * pulse;

      ctx.save();
      ctx.shadowBlur  = 12;
      ctx.shadowColor = f.color;
      ctx.fillStyle   = f.color;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
      ctx.fill();

      // Inner bright core
      ctx.fillStyle   = '#ffffff';
      ctx.globalAlpha = 0.5 * pulse;
      ctx.shadowBlur  = 0;
      ctx.beginPath();
      ctx.arc(f.x - r * 0.25, f.y - r * 0.25, r * 0.35, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }

  _drawParticles(ctx) {
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = p.life;
      ctx.shadowBlur  = 8;
      ctx.shadowColor = p.color;
      ctx.fillStyle   = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  _drawSnake(ctx, snake) {
    const segs = snake.segs;
    if (segs.length < 2) return;

    ctx.save();
    ctx.lineCap  = 'round';
    ctx.lineJoin = 'round';

    // ── Body ─────────────────────────────────────────────────────────────────
    // Pass 1: soft outer halo (no shadowBlur — use wider stroke at low alpha instead)
    ctx.globalAlpha = 0.15;
    ctx.lineWidth   = SEG_RADIUS * 2 + 12;
    ctx.strokeStyle = snake.color;
    ctx.shadowBlur  = 0;
    this._strokePath(ctx, segs);

    // Pass 2: main body — NO shadowBlur (huge perf win on long snakes)
    ctx.globalAlpha = 1.0;
    ctx.lineWidth   = SEG_RADIUS * 2;
    ctx.strokeStyle = snake.color;
    ctx.shadowBlur  = 0;
    this._strokePath(ctx, segs);

    // Pass 3: bright highlight stripe
    ctx.globalAlpha = 0.4;
    ctx.lineWidth   = SEG_RADIUS * 0.5;
    ctx.strokeStyle = '#ffffff';
    ctx.shadowBlur  = 0;
    this._strokePath(ctx, segs);

    ctx.restore();

    // ── Head ─────────────────────────────────────────────────────────────────
    const h = segs[0];
    const hr = SEG_RADIUS * 1.4;

    ctx.save();
    ctx.shadowBlur  = 25;
    ctx.shadowColor = snake.color;
    ctx.fillStyle   = snake.color;
    ctx.beginPath();
    ctx.arc(h.x, h.y, hr, 0, Math.PI * 2);
    ctx.fill();

    // Highlight on head
    ctx.fillStyle   = hexToRgba(snake.color, 0.5);
    ctx.shadowBlur  = 0;
    ctx.beginPath();
    ctx.arc(h.x - hr * 0.2, h.y - hr * 0.2, hr * 0.5, 0, Math.PI * 2);
    ctx.fill();

    // ── Eyes ─────────────────────────────────────────────────────────────────
    const eyeR  = hr * 0.38;
    const eyeOff= hr * 0.58;
    const ea    = snake.angle;

    const ex1 = h.x + Math.cos(ea - 0.55) * eyeOff;
    const ey1 = h.y + Math.sin(ea - 0.55) * eyeOff;
    const ex2 = h.x + Math.cos(ea + 0.55) * eyeOff;
    const ey2 = h.y + Math.sin(ea + 0.55) * eyeOff;

    ctx.fillStyle  = '#000';
    ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.arc(ex1, ey1, eyeR, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(ex2, ey2, eyeR, 0, Math.PI * 2); ctx.fill();

    // Pupils shine
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(ex1 + eyeR * 0.3, ey1 - eyeR * 0.3, eyeR * 0.35, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(ex2 + eyeR * 0.3, ey2 - eyeR * 0.3, eyeR * 0.35, 0, Math.PI * 2); ctx.fill();

    ctx.restore();

    // ── Name label ───────────────────────────────────────────────────────────
    const labelY = h.y - hr - 8;
    ctx.save();
    ctx.font        = `bold ${SEG_RADIUS * 1.1}px 'Orbitron', monospace`;
    ctx.textAlign   = 'center';
    ctx.shadowBlur  = 8;
    ctx.shadowColor = snake.color;
    ctx.fillStyle   = '#fff';
    ctx.fillText(snake.name, h.x, labelY);

    // Score under name
    ctx.font      = `${SEG_RADIUS * 0.85}px 'Orbitron', monospace`;
    ctx.fillStyle = snake.color;
    ctx.shadowBlur= 5;
    ctx.fillText(snake.score.toLocaleString(), h.x, labelY - SEG_RADIUS * 1.4);
    ctx.restore();
  }

  // Build a smooth quadratic path through segments,
  // breaking it when a wrap-around jump is detected
  _strokePath(ctx, segs) {
    // Viewport bounds in world-space (with margin so glow doesn't clip)
    const margin = SEG_RADIUS * 4;
    const vx0 = this.cam.x - margin;
    const vy0 = this.cam.y - margin;
    const vx1 = this.cam.x + this.canvas.width  + margin;
    const vy1 = this.cam.y + this.canvas.height + margin;

    ctx.beginPath();
    let inPath = false;

    for (let i = 0; i < segs.length - 1; i++) {
      const sx = segs[i].x, sy = segs[i].y;

      // Skip segment if both this and next point are offscreen
      const nx = segs[i + 1].x, ny = segs[i + 1].y;
      const offscreen =
        Math.max(sx, nx) < vx0 || Math.min(sx, nx) > vx1 ||
        Math.max(sy, ny) < vy0 || Math.min(sy, ny) > vy1;

      // Also break path on world-wrap jumps
      const jump = Math.abs(sx - nx) > 150 || Math.abs(sy - ny) > 150;

      if (offscreen || jump) {
        if (inPath) { ctx.stroke(); inPath = false; }
        ctx.beginPath();
        continue;
      }

      if (!inPath) {
        ctx.moveTo(sx, sy);
        inPath = true;
      }

      const mx = (sx + nx) / 2;
      const my = (sy + ny) / 2;
      ctx.quadraticCurveTo(sx, sy, mx, my);
    }

    if (inPath) ctx.stroke();
  }

  _drawPopups(ctx) {
    for (const p of this.popups) {
      ctx.save();
      ctx.globalAlpha = p.life;
      ctx.font        = `bold ${11 + (1 - p.life) * 6}px 'Orbitron', monospace`;
      ctx.textAlign   = 'center';
      ctx.shadowBlur  = 12;
      ctx.shadowColor = p.color;
      ctx.fillStyle   = p.color;
      ctx.fillText(p.text, p.x, p.y);
      ctx.restore();
    }
  }

  _drawHUD(ctx, W, H) {
    this._drawScore(ctx);
    this._drawLeaderboard(ctx, W);
    this._drawMinimap(ctx, W, H);
    if (this.boost && this.player.alive) this._drawBoostIndicator(ctx, W, H);
  }

  _drawScore(ctx) {
    const p = this.player;
    if (!p.alive) return;

    ctx.save();
    // Score
    ctx.font        = 'bold 22px Orbitron, monospace';
    ctx.fillStyle   = '#00ff88';
    ctx.shadowBlur  = 14;
    ctx.shadowColor = '#00ff88';
    ctx.fillText(`${p.score.toLocaleString()}`, 22, 42);

    ctx.shadowBlur  = 0;
    ctx.font        = '12px Orbitron, monospace';
    ctx.fillStyle   = '#556699';
    ctx.fillText(`LENGTH ${p.segs.length}   KILLS ${p.kills}`, 22, 62);
    ctx.restore();
  }

  _drawLeaderboard(ctx, W) {
    const all   = [this.player, ...this.bots].filter(s => s.alive);
    const sorted= all.sort((a, b) => b.score - a.score).slice(0, 6);

    const panelW = 200, rowH = 26;
    const panelH = sorted.length * rowH + 44;
    const px     = W - panelW - 12;
    const py     = 12;

    ctx.save();
    ctx.globalAlpha = 0.82;
    ctx.fillStyle   = 'rgba(4, 3, 18, 0.9)';
    ctx.strokeStyle = 'rgba(0, 212, 255, 0.2)';
    ctx.lineWidth   = 1;
    _roundRect(ctx, px, py, panelW, panelH, 8);
    ctx.fill();
    ctx.stroke();

    ctx.globalAlpha = 1;
    ctx.font        = '9px Orbitron, monospace';
    ctx.fillStyle   = '#556699';
    ctx.textAlign   = 'center';
    ctx.letterSpacing= '3px';
    ctx.fillText('LEADERBOARD', px + panelW / 2, py + 18);

    sorted.forEach((snake, i) => {
      const ry       = py + 36 + i * rowH;
      const isPlayer = !snake.isBot;

      ctx.font        = '11px Orbitron, monospace';
      ctx.shadowBlur  = isPlayer ? 8 : 0;
      ctx.shadowColor = snake.color;
      ctx.fillStyle   = isPlayer ? '#fff' : snake.color;
      ctx.textAlign   = 'left';
      ctx.fillText(`${i + 1}. ${snake.name.slice(0, 9)}`, px + 10, ry + 14);

      ctx.textAlign   = 'right';
      ctx.fillStyle   = isPlayer ? '#00ff88' : hexToRgba(snake.color, 0.9);
      ctx.fillText(snake.score.toLocaleString(), px + panelW - 10, ry + 14);
    });

    ctx.restore();
  }

  _drawMinimap(ctx, W, H) {
    const SIZE   = 160;
    const MARGIN = 14;
    const mx     = W - SIZE - MARGIN;
    const my     = H - SIZE - MARGIN;
    const scale  = SIZE / WORLD_W;

    ctx.save();
    ctx.globalAlpha = 0.82;
    ctx.fillStyle   = 'rgba(4, 3, 18, 0.9)';
    ctx.strokeStyle = 'rgba(0, 212, 255, 0.2)';
    ctx.lineWidth   = 1;
    _roundRect(ctx, mx, my, SIZE, SIZE, 8);
    ctx.fill();
    ctx.stroke();

    ctx.globalAlpha = 1;

    // Food dots
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    for (const f of this.food) {
      ctx.beginPath();
      ctx.arc(mx + f.x * scale, my + f.y * scale, 0.8, 0, Math.PI * 2);
      ctx.fill();
    }

    // Snakes — scale radius by length so big threats stand out
    for (const snake of [this.player, ...this.bots]) {
      if (!snake.alive || !snake.segs.length) continue;
      const h  = snake.segs[0];
      const lenBoost = Math.min(2.2, snake.segs.length / 120);
      const r  = (snake.isBot ? 2.0 : 3.5) + lenBoost;

      ctx.save();
      ctx.fillStyle  = snake.color;
      ctx.shadowBlur = 6;
      ctx.shadowColor= snake.color;
      ctx.beginPath();
      ctx.arc(mx + h.x * scale, my + h.y * scale, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Player ring
    if (this.player.alive && this.player.segs.length) {
      const h = this.player.segs[0];
      ctx.save();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth   = 1.2;
      ctx.beginPath();
      ctx.arc(mx + h.x * scale, my + h.y * scale, 5.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }

  _drawBoostIndicator(ctx, W, H) {
    const len = this.player.segs.length;
    const pct = Math.max(0, Math.min(1, (len - 20) / 200));

    ctx.save();
    ctx.globalAlpha = 0.7;

    const bx = 22, by = H - 30, bw = 160, bh = 10;

    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    _roundRect(ctx, bx, by, bw, bh, 5);
    ctx.fill();

    const grad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    grad.addColorStop(0, '#00ff88');
    grad.addColorStop(1, '#00d4ff');
    ctx.fillStyle = grad;
    ctx.shadowBlur = 8;
    ctx.shadowColor = '#00ff88';
    _roundRect(ctx, bx, by, bw * pct, bh, 5);
    ctx.fill();

    ctx.font      = '9px Orbitron, monospace';
    ctx.fillStyle = '#556699';
    ctx.shadowBlur= 0;
    ctx.textAlign = 'left';
    ctx.fillText('BOOST', bx, by - 4);

    ctx.restore();
  }
}

// ── Round rect helper ─────────────────────────────────────────────────────────
function _roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ── Boot ──────────────────────────────────────────────────────────────────────
(function boot() {
  const nickname = sessionStorage.getItem('neonSlither_nickname');
  if (!nickname) {
    window.location.href = 'index.html';
    return;
  }

  const canvas       = document.getElementById('gameCanvas');
  const startOverlay = document.getElementById('startOverlay');
  const deathOverlay = document.getElementById('deathOverlay');
  const deathStats   = document.getElementById('deathStats');
  const playerName   = document.getElementById('playerName');
  const startBtn     = document.getElementById('startBtn');
  const restartBtn   = document.getElementById('restartBtn');
  const menuBtn      = document.getElementById('menuBtn');
  const cursor       = document.getElementById('cursor');

  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;

  playerName.textContent = nickname;

  let game = null;

  function createGame() {
    game = new NeonGame(canvas, nickname);
    game.onDeath = async (score, length, kills, duration) => {
      // Show death screen
      deathStats.innerHTML = `
        <div class="death-stat"><span class="ds-val">${score.toLocaleString()}</span><span class="ds-lbl">SCORE</span></div>
        <div class="death-stat"><span class="ds-val">${length}</span><span class="ds-lbl">LENGTH</span></div>
        <div class="death-stat"><span class="ds-val">${kills}</span><span class="ds-lbl">KILLS</span></div>
      `;
      deathOverlay.classList.remove('hidden');

      // Save score to server
      try {
        await fetch('/api/score', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nickname, score, length, kills, duration })
        });
      } catch (e) {
        console.warn('Score save failed:', e.message);
      }
    };
    return game;
  }

  startBtn.addEventListener('click', () => {
    startOverlay.classList.add('hidden');
    cursor.style.display = 'block';
    createGame().start();
  });

  restartBtn.addEventListener('click', () => {
    deathOverlay.classList.add('hidden');
    createGame().start();
  });

  menuBtn.addEventListener('click', () => {
    window.location.href = 'index.html';
  });

  // Keep cursor dot in sync even before game starts
  window.addEventListener('mousemove', e => {
    cursor.style.left = e.clientX + 'px';
    cursor.style.top  = e.clientY + 'px';
  });

  // ── Mobile joystick ────────────────────────────────────────────────────────
  // Floating / dynamic joystick: the base appears where the player first
  // touches the left half of the screen. This is far more responsive than
  // a fixed-position joystick, especially for reaction plays.
  // The right half is reserved for the boost button (second finger), but
  // you can also double-tap anywhere to toggle boost briefly.
  if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
    cursor.style.display = 'none';

    const joystickZone = document.getElementById('joystick-zone');
    const joystickBase = document.getElementById('joystick-base');
    const joystickKnob = document.getElementById('joystick-knob');
    const boostBtn     = document.getElementById('boost-btn');

    joystickZone.classList.remove('hidden');
    boostBtn.classList.remove('hidden');
    joystickZone.style.opacity = '0'; // hidden until first touch

    const BASE_R  = 80;
    const DEAD_Z  = 6;
    let joyId     = null;
    let joyOrigin = { x: 0, y: 0 };

    // Touches anywhere on the right half of the screen steer the snake.
    function isRightHalf(x) { return x > window.innerWidth * 0.45; }

    window.addEventListener('touchstart', e => {
      for (const t of e.changedTouches) {
        // Steering touch — first finger on right half
        if (joyId === null && isRightHalf(t.clientX) &&
            !boostBtn.contains(t.target)) {
          joyId = t.identifier;
          joyOrigin.x = t.clientX;
          joyOrigin.y = t.clientY;
          joystickZone.style.left = (t.clientX - BASE_R) + 'px';
          joystickZone.style.top  = (t.clientY - BASE_R) + 'px';
          joystickZone.style.opacity = '1';
          joystickKnob.style.transform = 'translate(-50%, -50%)';
          e.preventDefault();
        }
      }
    }, { passive: false });

    window.addEventListener('touchmove', e => {
      if (!game || !game.running) return;
      for (const t of e.changedTouches) {
        if (t.identifier !== joyId) continue;
        const dx = t.clientX - joyOrigin.x;
        const dy = t.clientY - joyOrigin.y;
        const d  = Math.sqrt(dx * dx + dy * dy);
        // Re-center origin if finger drags far from it (floating behavior):
        // keeps joystick feel consistent during long swipes.
        if (d > BASE_R * 1.5) {
          const ang = Math.atan2(dy, dx);
          joyOrigin.x = t.clientX - Math.cos(ang) * BASE_R;
          joyOrigin.y = t.clientY - Math.sin(ang) * BASE_R;
          joystickZone.style.left = (joyOrigin.x - BASE_R) + 'px';
          joystickZone.style.top  = (joyOrigin.y - BASE_R) + 'px';
        }
        const dx2 = t.clientX - joyOrigin.x;
        const dy2 = t.clientY - joyOrigin.y;
        const d2  = Math.sqrt(dx2 * dx2 + dy2 * dy2);
        const clamped = Math.min(d2, BASE_R);
        const angle   = Math.atan2(dy2, dx2);
        joystickKnob.style.transform =
          `translate(calc(-50% + ${Math.cos(angle) * clamped}px), calc(-50% + ${Math.sin(angle) * clamped}px))`;
        if (d2 > DEAD_Z) {
          const W = canvas.width  / 2;
          const H = canvas.height / 2;
          // Use a long vector so lerp on game side turns quickly and smoothly.
          game.mouse.x = W + Math.cos(angle) * 400;
          game.mouse.y = H + Math.sin(angle) * 400;
        }
        e.preventDefault();
      }
    }, { passive: false });

    function endJoy(e) {
      for (const t of e.changedTouches) {
        if (t.identifier === joyId) {
          joyId = null;
          joystickZone.style.opacity = '0';
          joystickKnob.style.transform = 'translate(-50%, -50%)';
        }
      }
    }
    window.addEventListener('touchend',    endJoy);
    window.addEventListener('touchcancel', endJoy);

    // Boost button — any finger on it activates boost.
    let boostPointers = new Set();
    boostBtn.addEventListener('touchstart', e => {
      e.preventDefault();
      for (const t of e.changedTouches) boostPointers.add(t.identifier);
      if (game) game.boost = true;
      boostBtn.classList.add('active');
    }, { passive: false });
    function endBoost(e) {
      for (const t of e.changedTouches) boostPointers.delete(t.identifier);
      if (boostPointers.size === 0) {
        if (game) game.boost = false;
        boostBtn.classList.remove('active');
      }
    }
    boostBtn.addEventListener('touchend',    endBoost);
    boostBtn.addEventListener('touchcancel', endBoost);

    // Double-tap to toggle boost briefly (useful when a hand is busy steering).
    let lastTap = 0;
    window.addEventListener('touchstart', e => {
      const now = performance.now();
      // Only count taps that don't land on the boost button or active joystick.
      if (e.target === boostBtn || boostBtn.contains(e.target)) return;
      if (now - lastTap < 260 && game && game.running) {
        game.boost = true;
        boostBtn.classList.add('active');
        setTimeout(() => {
          if (boostPointers.size === 0) {
            if (game) game.boost = false;
            boostBtn.classList.remove('active');
          }
        }, 500);
      }
      lastTap = now;
    });
  }
})();
