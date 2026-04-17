/* ──────────────────────────────────────────────────────────────────────────
   ui.js — Login page logic
   Handles: nickname input, recent-players localStorage, history modal,
            live leaderboard via Socket.io, navigation to game.html
   ────────────────────────────────────────────────────────────────────────── */

const STORAGE_KEY = 'neonSlither_recentPlayers';
const MAX_RECENT  = 6;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const nicknameInput  = document.getElementById('nicknameInput');
const inputHint      = document.getElementById('inputHint');
const playBtn        = document.getElementById('playBtn');
const recentSection  = document.getElementById('recentPlayers');
const recentList     = document.getElementById('recentList');
const scoresBody     = document.getElementById('scoresBody');
const scoresCount    = document.getElementById('scoresCount');
const historyModal   = document.getElementById('historyModal');
const historyTitle   = document.getElementById('historyTitle');
const playerStatsEl  = document.getElementById('playerStats');
const historyRowsEl  = document.getElementById('historyRows');
const closeHistoryBtn= document.getElementById('closeHistory');
const startGameBtn   = document.getElementById('startGameBtn');

let pendingNickname = '';

// ── All scores table ──────────────────────────────────────────────────────────
function loadAllScores() {
  fetch('/api/scores/all')
    .then(r => r.json())
    .then(rows => renderScoresTable(rows))
    .catch(() => {
      scoresBody.innerHTML = '<tr><td colspan="6" class="loading">Could not load scores.</td></tr>';
    });
}

function renderScoresTable(rows) {
  if (!rows || !rows.length) {
    scoresBody.innerHTML = '<tr><td colspan="6" class="loading">No scores yet — be the first!</td></tr>';
    scoresCount.textContent = '';
    return;
  }

  scoresCount.textContent = `${rows.length} games`;

  const medals = ['🥇', '🥈', '🥉'];

  scoresBody.innerHTML = rows.map((r, i) => {
    const d = new Date(r.played_at);
    const dateStr = `${d.getDate().toString().padStart(2,'0')}/${(d.getMonth()+1).toString().padStart(2,'0')} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
    const rankClass = i < 3 ? ['gold','silver','bronze'][i] : '';
    return `
      <tr class="${rankClass ? 'row-' + rankClass : ''}">
        <td class="col-rank ${rankClass}">${medals[i] ?? i + 1}</td>
        <td class="col-name">${escHtml(r.nickname)}</td>
        <td class="col-score">${Number(r.score).toLocaleString()}</td>
        <td class="col-len">${r.length ?? 0}</td>
        <td class="col-kills">${r.kills ?? 0}</td>
        <td class="col-date">${dateStr}</td>
      </tr>
    `;
  }).join('');
}

// Socket.io: refresh table when a new score is saved
const socket = io();
socket.on('leaderboard_update', () => loadAllScores());

loadAllScores();

// ── Recent players ─────────────────────────────────────────────────────────────
function getRecent() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}

function saveRecent(name) {
  const list = [name, ...getRecent().filter(n => n.toLowerCase() !== name.toLowerCase())]
    .slice(0, MAX_RECENT);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

function renderRecent() {
  const list = getRecent();
  if (!list.length) { recentSection.classList.add('hidden'); return; }

  recentSection.classList.remove('hidden');
  recentList.innerHTML = list.map(name =>
    `<button class="recent-tag" data-name="${escHtml(name)}">${escHtml(name)}</button>`
  ).join('');

  recentList.querySelectorAll('.recent-tag').forEach(btn => {
    btn.addEventListener('click', () => {
      nicknameInput.value = btn.dataset.name;
      nicknameInput.dispatchEvent(new Event('input'));
      nicknameInput.focus();
    });
  });
}

renderRecent();

// ── Nickname validation ────────────────────────────────────────────────────────
nicknameInput.addEventListener('input', () => {
  const val = nicknameInput.value.trim();

  if (!val) {
    setHint('', '');
    playBtn.disabled = true;
    return;
  }
  if (val.length < 2) {
    setHint('error', 'Minimum 2 characters');
    playBtn.disabled = true;
    return;
  }
  if (val.length > 20) {
    setHint('error', 'Maximum 20 characters');
    playBtn.disabled = true;
    return;
  }
  if (!/^[a-zA-Z0-9_\- ]+$/.test(val)) {
    setHint('error', 'Letters, numbers, _ and - only');
    playBtn.disabled = true;
    return;
  }

  setHint('ok', 'Looking good!');
  playBtn.disabled = false;
});

nicknameInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !playBtn.disabled) playBtn.click();
});

function setHint(type, msg) {
  inputHint.textContent = msg || '\u00A0';
  inputHint.className   = 'input-hint' + (type ? ` ${type}` : '');
}

// ── Play button ────────────────────────────────────────────────────────────────
playBtn.addEventListener('click', async () => {
  const name = nicknameInput.value.trim();
  if (!name) return;

  playBtn.disabled   = true;
  playBtn.textContent = 'Loading...';

  try {
    const res  = await fetch(`/api/player/${encodeURIComponent(name)}`);
    const data = await res.json();

    if (!res.ok) {
      setHint('error', data.error || 'Server error');
      playBtn.disabled   = false;
      playBtn.textContent = 'ENTER ARENA';
      return;
    }

    pendingNickname = name;

    if (data.stats && parseInt(data.stats.total_games) > 0) {
      // Returning player → show history modal
      showHistoryModal(data);
    } else {
      // New player → go straight to game
      launchGame(name);
    }
  } catch (err) {
    console.error(err);
    setHint('error', 'Connection error — try again');
    playBtn.disabled   = false;
    playBtn.textContent = 'ENTER ARENA';
  }
});

// ── History modal ──────────────────────────────────────────────────────────────
function showHistoryModal({ player, stats, history }) {
  historyTitle.textContent = `WELCOME BACK, ${player.nickname.toUpperCase()}`;

  // Stats grid
  playerStatsEl.innerHTML = `
    <div class="stat-box">
      <span class="stat-value">${stats.total_games ?? 0}</span>
      <span class="stat-label">GAMES PLAYED</span>
    </div>
    <div class="stat-box">
      <span class="stat-value">${(stats.best_score ?? 0).toLocaleString()}</span>
      <span class="stat-label">BEST SCORE</span>
    </div>
    <div class="stat-box">
      <span class="stat-value">${stats.total_kills ?? 0}</span>
      <span class="stat-label">TOTAL KILLS</span>
    </div>
    <div class="stat-box">
      <span class="stat-value">${(stats.avg_score ?? 0).toLocaleString()}</span>
      <span class="stat-label">AVG SCORE</span>
    </div>
  `;

  // History rows
  if (history && history.length) {
    historyRowsEl.innerHTML = history.map(s => {
      const d = new Date(s.played_at);
      const dateStr = `${d.getDate().toString().padStart(2,'0')}/${(d.getMonth()+1).toString().padStart(2,'0')} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
      return `
        <div class="history-row">
          <span class="h-date">${dateStr}</span>
          <span class="h-score">${s.score.toLocaleString()}</span>
          <span class="h-len">${s.length}px</span>
          <span class="h-kills">${s.kills}K</span>
        </div>
      `;
    }).join('');
  } else {
    historyRowsEl.innerHTML = '<div class="loading">No games yet.</div>';
  }

  historyModal.classList.remove('hidden');
}

closeHistoryBtn.addEventListener('click', () => {
  historyModal.classList.add('hidden');
  playBtn.disabled   = false;
  playBtn.textContent = 'ENTER ARENA';
});

startGameBtn.addEventListener('click', () => {
  historyModal.classList.add('hidden');
  launchGame(pendingNickname);
});

// ── Launch game ────────────────────────────────────────────────────────────────
function launchGame(name) {
  saveRecent(name);
  sessionStorage.setItem('neonSlither_nickname', name);
  window.location.href = 'game.html';
}

// ── Utils ──────────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}
