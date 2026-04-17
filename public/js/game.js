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
const FOOD_TARGET  = 500;
const BOT_COUNT    = 9;
const SEG_RADIUS   = 10;   // pixels, half-width of snake body
const SEG_SPACING  = 4;    // distance between stored segments
const BASE_SPEED   = 3.0;
const BOOST_SPEED  = 5.5;
const BOOST_DRAIN  = 0.4;  // segments lost per boost frame
const TURN_SPEED   = 0.072; // radians per frame
const GROWTH_RATE  = 0.4;   // growth per food size unit (lower = slower growth)
const SELF_COLLIDE_IDX = 40; // player can't self-collide until segment 40

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

    // Create bots
    for (let i = 0; i < BOT_COUNT; i++) {
      const x   = randRange(300, WORLD_W - 300);
      const y   = randRange(300, WORLD_H - 300);
      const bot = this._createSnake(x, y, NEON_COLORS[i + 1], BOT_NAMES[i], true);
      bot.ai    = { state: 'wander', wanderAngle: Math.random() * Math.PI * 2, targetFood: null, spookTimer: 0 };
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

  _runBotAI(bot, delta) {
    const head = bot.segs[0];
    const ai   = bot.ai;

    if (ai.spookTimer > 0) ai.spookTimer -= delta;

    // ── Danger scan: other snakes + own body ──────────────────────────────────
    let danger          = false;
    let dangerAngle     = 0;
    let closestDangerD2 = Infinity;

    const allSnakes = [this.player, ...this.bots];

    for (const other of allSnakes) {
      if (!other.alive) continue;
      const isSelf  = other === bot;
      const startI  = isSelf ? 20 : 0;   // skip own neck segments
      const checkLen = Math.min(other.segs.length, isSelf ? 60 : 50);
      const radius   = isSelf ? 120 : 200;

      for (let i = startI; i < checkLen; i++) {
        const s  = other.segs[i];
        const d2 = dist2(head.x, head.y, s.x, s.y);
        if (d2 < radius * radius && d2 < closestDangerD2) {
          closestDangerD2 = d2;
          danger      = true;
          dangerAngle = Math.atan2(s.y - head.y, s.x - head.x);
        }
      }
    }

    // ── Border danger ─────────────────────────────────────────────────────────
    const M = 300;
    const borderDanger =
      head.x < M || head.x > WORLD_W - M ||
      head.y < M || head.y > WORLD_H - M;

    if (danger) {
      ai.state      = 'evade';
      ai.spookTimer = 50;
      const urgency = 1 - Math.sqrt(closestDangerD2) / 200;
      const turn    = 0.20 + urgency * 0.20;
      bot.angle     = lerpAngle(bot.angle, dangerAngle + Math.PI + randRange(-0.25, 0.25), turn * delta);
      bot.boosting  = false;
      return;
    }

    // Border avoidance
    if      (head.x < M)           bot.angle = lerpAngle(bot.angle,  0.0,           0.30 * delta);
    else if (head.x > WORLD_W - M) bot.angle = lerpAngle(bot.angle,  Math.PI,       0.30 * delta);
    if      (head.y < M)           bot.angle = lerpAngle(bot.angle,  Math.PI * 0.5, 0.30 * delta);
    else if (head.y > WORLD_H - M) bot.angle = lerpAngle(bot.angle, -Math.PI * 0.5, 0.30 * delta);

    if (borderDanger) { bot.boosting = false; return; }

    // ── Find best food: weighted by size/distance ─────────────────────────────
    if (!ai.targetFood || !this.food.includes(ai.targetFood) || Math.random() < 0.01) {
      let best = null, bestScore = -Infinity;
      for (const f of this.food) {
        const d2 = dist2(head.x, head.y, f.x, f.y);
        const score = f.value / (Math.sqrt(d2) + 1);
        if (score > bestScore) { bestScore = score; best = f; }
      }
      ai.targetFood = best;
    }

    if (ai.targetFood) {
      const tx = ai.targetFood.x, ty = ai.targetFood.y;
      const target = Math.atan2(ty - head.y, tx - head.x);
      const d2     = dist2(head.x, head.y, tx, ty);
      bot.angle    = lerpAngle(bot.angle, target, 0.13 * delta);
      // Boost toward food when close and snake is large enough
      bot.boosting = d2 < 200 * 200 && bot.segs.length > 40 && !danger;
    } else {
      ai.wanderAngle += randRange(-0.04, 0.04) * delta;
      bot.angle    = lerpAngle(bot.angle, ai.wanderAngle, 0.08 * delta);
      bot.boosting = false;
    }
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
        bot.ai    = { state: 'wander', wanderAngle: Math.random() * Math.PI * 2, targetFood: null, spookTimer: 0 };
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
  _setupInput() {
    const c = this.canvas;

    c.addEventListener('mousemove', e => {
      const r = c.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left;
      this.mouse.y = e.clientY - r.top;
      // Move cursor
      const cur = document.getElementById('cursor');
      if (cur) { cur.style.left = e.clientX + 'px'; cur.style.top = e.clientY + 'px'; }
    });

    c.addEventListener('mousedown', e => { if (e.button === 0) this.boost = true; });
    window.addEventListener('mouseup',  e => { if (e.button === 0) this.boost = false; });

    c.addEventListener('touchmove', e => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      this.mouse.x = e.touches[0].clientX - r.left;
      this.mouse.y = e.touches[0].clientY - r.top;
      if (e.touches.length > 1) this.boost = true;
    }, { passive: false });

    c.addEventListener('touchstart', e => {
      const r = c.getBoundingClientRect();
      this.mouse.x = e.touches[0].clientX - r.left;
      this.mouse.y = e.touches[0].clientY - r.top;
    });

    c.addEventListener('touchend', e => { if (e.touches.length < 2) this.boost = false; });

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

    // Snakes
    for (const snake of [this.player, ...this.bots]) {
      if (!snake.alive || !snake.segs.length) continue;
      const h  = snake.segs[0];
      const r  = snake.isBot ? 2.2 : 3.5;

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
  if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
    cursor.style.display = 'none'; // hide mouse cursor on touch devices

    const joystickZone = document.getElementById('joystick-zone');
    const joystickBase = document.getElementById('joystick-base');
    const joystickKnob = document.getElementById('joystick-knob');
    const boostBtn     = document.getElementById('boost-btn');

    joystickZone.classList.remove('hidden');
    boostBtn.classList.remove('hidden');

    const BASE_R = 65; // joystick base radius
    let joyActive = false;
    let joyId     = null;

    joystickBase.addEventListener('touchstart', e => {
      e.preventDefault();
      const t  = e.changedTouches[0];
      joyId     = t.identifier;
      joyActive = true;
    }, { passive: false });

    joystickBase.addEventListener('touchmove', e => {
      e.preventDefault();
      if (!joyActive || !game) return;

      let touch = null;
      for (const t of e.changedTouches) {
        if (t.identifier === joyId) { touch = t; break; }
      }
      if (!touch) return;

      const rect = joystickBase.getBoundingClientRect();
      const cx   = rect.left + rect.width  / 2;
      const cy   = rect.top  + rect.height / 2;
      const dx   = touch.clientX - cx;
      const dy   = touch.clientY - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const clamped = Math.min(dist, BASE_R);
      const angle   = Math.atan2(dy, dx);

      // Move knob visually
      joystickKnob.style.transform =
        `translate(calc(-50% + ${Math.cos(angle) * clamped}px), calc(-50% + ${Math.sin(angle) * clamped}px))`;

      // Steer snake by setting mouse position toward the angle
      if (dist > 8 && game.running) {
        const W = canvas.width  / 2;
        const H = canvas.height / 2;
        game.mouse.x = W + Math.cos(angle) * 200;
        game.mouse.y = H + Math.sin(angle) * 200;
      }
    }, { passive: false });

    joystickBase.addEventListener('touchend', e => {
      for (const t of e.changedTouches) {
        if (t.identifier === joyId) {
          joyActive = false;
          joystickKnob.style.transform = 'translate(-50%, -50%)';
          break;
        }
      }
    });

    boostBtn.addEventListener('touchstart', e => {
      e.preventDefault();
      if (game) game.boost = true;
      boostBtn.classList.add('active');
    }, { passive: false });

    boostBtn.addEventListener('touchend', () => {
      if (game) game.boost = false;
      boostBtn.classList.remove('active');
    });
  }
})();
