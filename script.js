/**
 * Geometry Dash — Clone
 * Single-file main logic. Keep things modular with JS classes.
 *
 * Core systems:
 *  - Game loop with requestAnimationFrame + delta time (ms -> seconds conversion)
 *  - Simple gravity physics and one-tap jump + optional double jump
 *  - Axis-aligned bounding box collision detection
 *  - Level system with handcrafted levels, unlock/save using localStorage
 *  - Basic level editor for creating grids of obstacles
 *
 * Notes:
 *  - Put audio files in /assets/ to enable sounds.
 *  - Tweak LEVELS below. Each obstacle is {type, x, y, w, h, params}
 */

/* ===========================
   Utility & Constants
   =========================== */
const CANVAS = document.getElementById('gameCanvas');
const ctx = CANVAS.getContext('2d', { alpha: false });
let DPR = Math.max(1, window.devicePixelRatio || 1);

const STORAGE_KEY = 'gdash_clone_save_v1';
const GAME_WIDTH = 1100; // logical width (scaled by DPR)
const GAME_HEIGHT = 600;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rectIntersect = (a, b) => !(a.x + a.w < b.x || a.x > b.x + b.w || a.y + a.h < b.y || a.y > b.y + b.h);

/* ===========================
   DOM refs & UI wiring
   =========================== */
const ui = {
  root: document.getElementById('ui-root'),
  btnPlay: document.getElementById('btn-play'),
  btnLevels: document.getElementById('btn-levels'),
  btnEditor: document.getElementById('btn-editor'),
  levelSelect: document.getElementById('level-select'),
  levelsList: document.getElementById('levels-list'),
  btnBackLevels: document.getElementById('btn-back-levels'),
  toggleDouble: document.getElementById('toggle-double'),
  hud: document.getElementById('hud'),
  progressBar: document.getElementById('progress-bar'),
  attempts: document.getElementById('attempts'),
  overlay: document.getElementById('overlay'),
  overlayTitle: document.getElementById('overlay-title'),
  overlayBody: document.getElementById('overlay-body'),
  overlayResume: document.getElementById('overlay-resume'),
  overlayRestart: document.getElementById('overlay-restart'),
  overlayMenu: document.getElementById('overlay-menu'),
  deathScreen: document.getElementById('death-screen'),
  deathAttempts: document.getElementById('death-attempts'),
  bestScore: document.getElementById('best-score'),
  restartNow: document.getElementById('restart-now'),
  backToMenu: document.getElementById('back-to-menu'),
  btnPause: document.getElementById('btn-pause'),
  editorPanel: document.getElementById('editor-panel'),
  editorSave: document.getElementById('editor-save'),
  editorLoad: document.getElementById('editor-load'),
  editorClear: document.getElementById('editor-clear'),
  editorExit: document.getElementById('editor-exit')
};

const audio = {
  music: document.getElementById('music'),
  jump: document.getElementById('sfx-jump'),
  death: document.getElementById('sfx-death')
};

/* ===========================
   Levels (handcrafted) — modify these
   - x positions are relative to levelLength (in px)
   - y is measured from top (0) to bottom; ground is at y ~ (GAME_HEIGHT - groundHeight)
   =========================== */
const LEVELS = [
  {
    id: 'level1',
    name: 'Beginner Groove',
    length: 3000,
    bgSpeed: 0.2,
    music: 'assets/bg_music_level1.mp3',
    obstacles: [
      // spikes
      { type: 'spike', x: 900, y: 520, w: 30, h: 60 },
      { type: 'spike', x: 1200, y: 520, w: 30, h: 60 },
      // gap
      { type: 'gap', x: 1500, y: 560, w: 220, h: 40 },
      // platform
      { type: 'platform', x: 1850, y: 440, w: 180, h: 16 },
      // moving obstacle (vertical)
      { type: 'moving', x: 2300, y: 480, w: 60, h: 60, params: { dir: 'y', range: 120, speed: 80 } }
    ]
  },
  {
    id: 'level2',
    name: 'Neon Sprint',
    length: 4200,
    bgSpeed: 0.35,
    music: 'assets/bg_music_level2.mp3',
    obstacles: [
      { type: 'spike', x: 700, y: 520, w: 30, h: 60 },
      { type: 'platform', x: 980, y: 480, w: 120, h: 16 },
      { type: 'gap', x: 1250, y: 560, w: 180, h: 40 },
      { type: 'moving', x: 1900, y: 420, w: 80, h: 80, params: { dir: 'x', range: 160, speed: 140 } },
      { type: 'spike', x: 2600, y: 520, w: 30, h: 60 }
    ]
  }
];

/* ===========================
   Save manager (localStorage)
   =========================== */
const Save = {
  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { unlocked: ['level1'], best: {}, attempts: {}, options: { doubleJump: false } };
      return JSON.parse(raw);
    } catch (e) { return { unlocked: ['level1'], best: {}, attempts: {}, options: { doubleJump: false } }; }
  },
  save(state) { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
};

let SAVE = Save.load();
ui.toggleDouble.checked = !!SAVE.options.doubleJump;

/* ===========================
   Game classes
   =========================== */

class Input {
  constructor() {
    this.down = false;
    this.justPressed = false;
    this.onTap = () => {};
    this.bind();
  }
  bind() {
    window.addEventListener('keydown', e => {
      if (e.code === 'Space') this._press();
      if (e.key === 'p') game.togglePause();
    });
    window.addEventListener('mousedown', e => {
      if (e.button === 0) this._press();
    });
    window.addEventListener('touchstart', e => {
      this._press();
    }, {passive:true});
    window.addEventListener('mouseup', () => this.down = false);
    window.addEventListener('touchend', () => this.down = false);
  }
  _press() {
    if (!this.down) this.justPressed = true;
    this.down = true;
    this.onTap();
  }
  consume() { this.justPressed = false; }
}

class Player {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.w = 36; this.h = 36;
    this.vx = 0; this.vy = 0;
    this.gravity = 2000; // px/s^2
    this.jumpForce = 700; // px/s initial impulse
    this.groundY = GAME_HEIGHT - 40;
    this.jumps = 0;
    this.maxJumps = SAVE.options.doubleJump ? 2 : 1;
    this.dead = false;
  }
  reset() {
    this.y = GAME_HEIGHT - 40 - this.h;
    this.vy = 0; this.jumps = 0; this.dead = false;
  }
  update(dt, levelSpeed, platforms) {
    // Horizontal auto-run simulated by moving world left; player stays roughly at x.
    // Vertical physics:
    this.vy += this.gravity * dt;
    this.y += this.vy * dt;

    // Ground collision
    let grounded = false;
    const playerBox = this.getBox();
    // check against each platform
    for (const p of platforms) {
      if (this.vy >= 0) {
        // simple AABB standing check: player bottom intersects platform top and was above
        const platBox = { x: p.x, y: p.y, w: p.w, h: p.h };
        if (playerBox.x + playerBox.w > platBox.x && playerBox.x < platBox.x + platBox.w) {
          if (playerBox.y + playerBox.h >= platBox.y && playerBox.y + playerBox.h <= platBox.y + platBox.h + 16) {
            // snap to platform
            this.y = platBox.y - this.h;
            this.vy = 0;
            grounded = true;
            this.jumps = 0;
          }
        }
      }
    }
    // Ground plane
    if (this.y + this.h >= this.groundY) {
      this.y = this.groundY - this.h;
      this.vy = 0;
      grounded = true;
      this.jumps = 0;
    }
    return grounded;
  }
  jump() {
    if (this.jumps < this.maxJumps) {
      this.vy = -this.jumpForce;
      this.jumps++;
      spawnParticles(this.x + this.w / 2, this.y + this.h, 12);
      if (audio.jump) { try { audio.jump.currentTime = 0; audio.jump.play(); } catch (e) {} }
    }
  }
  getBox() { return { x: this.x, y: this.y, w: this.w, h: this.h }; }
  draw(ctx) {
    // neon square with glow
    ctx.save();
    ctx.shadowBlur = 16; ctx.shadowColor = 'rgba(57,240,255,0.35)';
    ctx.fillStyle = '#00f0ff';
    roundRect(ctx, this.x, this.y, this.w, this.h, 6, true);
    ctx.restore();
  }
}

/* ===========================
   Obstacles & level objects
   =========================== */
class Obstacle {
  constructor(spec, levelOffsetX) {
    // spec: {type, x, y, w, h, params}
    this.type = spec.type;
    this.baseX = spec.x;
    this.x = spec.x; // will be offset by worldScroll
    this.y = spec.y;
    this.w = spec.w; this.h = spec.h;
    this.params = spec.params || {};
    this.levelOffsetX = levelOffsetX || 0;
    this.t = 0;
  }
  update(dt, worldSpeed) {
    this.x -= worldSpeed * dt; // world moves left
    this.t += dt;
    // moving type oscillation
    if (this.type === 'moving') {
      const p = this.params;
      if (p.dir === 'y') {
        this.y = this.params.origY + Math.sin(this.t * p.speed * 0.01) * p.range;
      }
      if (p.dir === 'x') {
        this.x = this.baseX + Math.sin(this.t * p.speed * 0.01) * p.range;
      }
    }
  }
  getBox() { return { x: this.x, y: this.y, w: this.w, h: this.h }; }
  draw(ctx) {
    ctx.save();
    if (this.type === 'spike') {
      // draw triangular spike
      ctx.fillStyle = '#ff5577';
      ctx.beginPath();
      ctx.moveTo(this.x, this.y + this.h);
      ctx.lineTo(this.x + this.w / 2, this.y);
      ctx.lineTo(this.x + this.w, this.y + this.h);
      ctx.closePath();
      ctx.fill();
    } else if (this.type === 'platform') {
      ctx.fillStyle = '#7d39ff';
      roundRect(ctx, this.x, this.y, this.w, this.h, 6, true);
    } else if (this.type === 'gap') {
      // gaps are invisible, but show a visual indicator (optional)
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      ctx.fillRect(this.x, GAME_HEIGHT - 36, this.w, 36);
    } else if (this.type === 'moving') {
      ctx.fillStyle = '#ffcc33';
      roundRect(ctx, this.x, this.y, this.w, this.h, 8, true);
    } else {
      // generic
      ctx.fillStyle = '#ff77aa';
      ctx.fillRect(this.x, this.y, this.w, this.h);
    }
    ctx.restore();
  }
}

/* ===========================
   Particle system (small, object-pooled)
   =========================== */
const particles = [];
function spawnParticles(x, y, amount = 8) {
  for (let i = 0; i < amount; i++) {
    particles.push({
      x, y,
      vx: (Math.random() - 0.5) * 300,
      vy: (Math.random() - 1.6) * 300,
      life: 0.6 + Math.random() * 0.6,
      size: 2 + Math.random() * 3
    });
  }
}
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) particles.splice(i, 1);
    p.vy += 1000 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
}
function drawParticles(ctx) {
  ctx.save();
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life / 1.2);
    roundRect(ctx, p.x, p.y, p.size, p.size, 2, true);
  }
  ctx.restore();
}

/* ===========================
   Camera / World
   =========================== */
class World {
  constructor(level) {
    this.level = level;
    this.scroll = 0; // pixels scrolled
    this.speed = 450; // base px/s (scales over time)
    this.scale = 1;
    this.baseSpeed = 450;
    this.spawned = [];
    this.finished = false;
    this.particles = [];
    // create Obstacles from level specs
    this.obstacles = level.obstacles.map(s => {
      // ensure moving has origY
      if (s.type === 'moving') s.params.origY = s.y;
      return new Obstacle(s, 0);
    });
  }
  update(dt) {
    // slowly increase difficulty
    this.speed = this.baseSpeed + Math.floor(this.scroll / 1200) * 40;
    this.scroll += this.speed * dt;
    for (const o of this.obstacles) o.update(dt, this.speed);

    // check finished
    if (this.scroll >= this.level.length) this.finished = true;
  }
  getActiveObstacles() {
    // return obstacles visible on canvas (with some buffer)
    return this.obstacles.filter(o => o.x + o.w > -200 && o.x < GAME_WIDTH + 200);
  }
}

/* ===========================
   Game manager + loop
   =========================== */
let input = new Input();
let player = new Player(160, GAME_HEIGHT - 40 - 36);
let world = null;
let lastTime = 0;
let running = false;
let paused = false;
let attempts = 0;
let currentLevel = LEVELS[0];

function startLevel(level) {
  currentLevel = level;
  world = new World(level);
  player = new Player(160, GAME_HEIGHT - 40 - 36);
  player.maxJumps = SAVE.options.doubleJump ? 2 : 1;
  attempts = (SAVE.attempts[level.id] || 0);
  attempts++;
  SAVE.attempts[level.id] = attempts;
  Save.save(SAVE);
  ui.attempts.textContent = attempts;
  ui.hud.classList.remove('hidden');
  hideAllOverlays();
  resumeGame();
  try { audio.music.src = level.music; audio.music.currentTime = 0; audio.music.play().catch(()=>{}); } catch(e){}
}

// input tap wiring
input.onTap = () => {
  if (running && !paused) {
    player.jump();
  } else if (!running) {
    // start default level
    startLevel(currentLevel);
  }
};

function toggleDoubleJump(enabled) {
  SAVE.options.doubleJump = enabled;
  Save.save(SAVE);
  player.maxJumps = enabled ? 2 : 1;
}
ui.toggleDouble.addEventListener('change', (e) => toggleDoubleJump(e.target.checked));

function gameLoop(t) {
  if (!lastTime) lastTime = t;
  const dt = Math.min(0.033, (t - lastTime) / 1000); // clamp dt to avoid large jumps
  lastTime = t;

  if (!paused && running) {
    update(dt);
    render();
  } else {
    render(); // still render paused frame for UI
  }
  requestAnimationFrame(gameLoop);
}

function update(dt) {
  world.update(dt);
  const active = world.getActiveObstacles();
  // create platform list for player
  const platforms = active.filter(o => o.type === 'platform').map(o => ({...o.getBox()}));
  // add ground as platform
  platforms.push({ x: -9999, y: GAME_HEIGHT - 40, w: 99999, h: 999 });

  const grounded = player.update(dt, world.speed, platforms);

  // collision detection with spikes/moving/gap
  for (const o of active) {
    if (o.type === 'gap') {
      // gap type: if player x inside gap region and player bottom at ground => fall (we let gravity handle)
      // visualize gap separately, no collision to detect.
      continue;
    }
    if (o.type === 'spike' || o.type === 'moving') {
      if (rectIntersect(player.getBox(), o.getBox())) {
        // death
        die();
        return;
      }
    }
  }

  // progress bar
  const progress = clamp(world.scroll / world.level.length, 0, 1);
  ui.progressBar.style.width = `${progress * 100}%`;

  // finish
  if (world.finished) {
    // level complete
    onComplete();
  }

  updateParticles(dt);
}

function render() {
  // resize/backbuffers
  resizeCanvasIfNeeded();

  // Clear
  ctx.fillStyle = '#071022';
  ctx.fillRect(0, 0, CANVAS.width, CANVAS.height);

  // Parallax background
  drawParallax(ctx, world ? world.level.bgSpeed : 0.15);

  // ground
  ctx.fillStyle = '#071c2b';
  ctx.fillRect(0, GAME_HEIGHT - 40, GAME_WIDTH, 40);

  // obstacles
  if (world) {
    for (const o of world.getActiveObstacles()) o.draw(ctx);
  }

  // player
  player.draw(ctx);

  // particles
  drawParticles(ctx);

  // HUD overlay helper (scale transforms)
  // (we rely on DOM for actual HUD)
}

/* ===========================
   Controls for death/complete/pause
   =========================== */
function die() {
  running = false;
  player.dead = true;
  spawnParticles(player.x + player.w / 2, player.y + player.h / 2, 40);
  try { audio.death.currentTime = 0; audio.death.play().catch(()=>{}); } catch(e){}
  ui.deathAttempts.textContent = attempts;
  const best = SAVE.best[currentLevel.id] || 0;
  ui.bestScore.textContent = best;
  ui.deathScreen.classList.remove('hidden');
  ui.hud.classList.add('hidden');
  // unlock nothing on death
}

function restartLevel() {
  ui.deathScreen.classList.add('hidden');
  startLevel(currentLevel);
}

function onComplete() {
  running = false;
  // track best (time to complete)
  const score = Date.now(); // crude; you could store attempts/time
  SAVE.best[currentLevel.id] = Math.max(SAVE.best[currentLevel.id] || 0, world.scroll);
  // unlock next
  const idx = LEVELS.findIndex(l => l.id === currentLevel.id);
  if (idx >= 0 && idx + 1 < LEVELS.length) {
    const nextId = LEVELS[idx + 1].id;
    if (!SAVE.unlocked.includes(nextId)) {
      SAVE.unlocked.push(nextId);
    }
  }
  Save.save(SAVE);
  ui.overlayTitle.textContent = 'Level Complete';
  ui.overlayBody.innerHTML = `<div>Nice. Progress saved.</div>`;
  showOverlay();
}

function showOverlay() {
  ui.overlay.classList.remove('hidden');
  paused = true;
}
function hideAllOverlays() {
  ui.overlay.classList.add('hidden');
  ui.deathScreen.classList.add('hidden');
}
ui.overlayResume.addEventListener('click', () => { paused = false; ui.overlay.classList.add('hidden'); });
ui.overlayRestart.addEventListener('click', () => { ui.overlay.classList.add('hidden'); restartLevel(); });
ui.overlayMenu.addEventListener('click', () => { ui.overlay.classList.add('hidden'); gotoMenu(); });

ui.restartNow.addEventListener('click', restartLevel);
ui.backToMenu.addEventListener('click', gotoMenu);

function togglePause() {
  paused = !paused;
  ui.overlayTitle.textContent = paused ? 'Paused' : '';
  if (paused) ui.overlay.classList.remove('hidden'); else ui.overlay.classList.add('hidden');
}
ui.btnPause.addEventListener('click', () => togglePause());
window.game = { togglePause };

/* ===========================
   Basic menu / DOM wiring
   =========================== */
ui.btnPlay.addEventListener('click', () => {
  startLevel(LEVELS[0]);
  running = true;
});
ui.btnLevels.addEventListener('click', () => showLevelSelect());
ui.btnBackLevels.addEventListener('click', () => { ui.levelSelect.classList.add('hidden'); });
ui.btnEditor.addEventListener('click', () => openEditor());

function showLevelSelect() {
  ui.levelsList.innerHTML = '';
  LEVELS.forEach(l => {
    const btn = document.createElement('button');
    btn.className = 'btn small';
    btn.textContent = `${l.name} ${SAVE.unlocked.includes(l.id) ? '' : '(locked)'}`;
    btn.disabled = !SAVE.unlocked.includes(l.id);
    btn.addEventListener('click', () => {
      ui.levelSelect.classList.add('hidden');
      startLevel(l);
      running = true;
    });
    ui.levelsList.appendChild(btn);
  });
  ui.levelSelect.classList.remove('hidden');
}

function gotoMenu() {
  hideAllOverlays();
  running = false;
  paused = false;
  ui.hud.classList.add('hidden');
}

/* ===========================
   Level Editor (basic)
   =========================== */
let editor = {
  active: false,
  gridSize: 40,
  data: []
};
function openEditor() {
  editor.active = true;
  ui.editorPanel.classList.remove('hidden');
  ui.editorPanel.style.left = 'calc(50% - 160px)';
  ui.editorPanel.style.top = '70px';
  // attach canvas events
  CANVAS.style.cursor = 'crosshair';
  CANVAS.addEventListener('click', editorClick);
  CANVAS.addEventListener('contextmenu', e => { e.preventDefault(); editorErase(e); });
}
function closeEditor() {
  editor.active = false;
  ui.editorPanel.classList.add('hidden');
  CANVAS.style.cursor = 'default';
  CANVAS.removeEventListener('click', editorClick);
}
ui.editorExit.addEventListener('click', closeEditor);
ui.editorClear.addEventListener('click', () => { editor.data = []; });
ui.editorSave.addEventListener('click', () => {
  const custom = { id: `custom_${Date.now()}`, name: 'Custom Level', length: 2000, bgSpeed: 0.2, music: '', obstacles: editor.data.slice() };
  LEVELS.push(custom);
  alert('Saved local custom level. Pick it from Levels.');
});
ui.editorLoad.addEventListener('click', () => {
  if (LEVELS.length) {
    editor.data = LEVELS[0].obstacles.map(o => ({...o}));
    alert('Loaded first level into editor buffer (demo).');
  }
});

function editorClick(e) {
  const rect = CANVAS.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (CANVAS.width / rect.width);
  const y = (e.clientY - rect.top) * (CANVAS.height / rect.height);
  const gx = Math.floor(x / editor.gridSize) * editor.gridSize;
  const gy = Math.floor(y / editor.gridSize) * editor.gridSize;
  // toggle a platform for demo
  editor.data.push({ type: 'platform', x: gx, y: gy, w: editor.gridSize * 2, h: 16 });
}
function editorErase(e) {
  const rect = CANVAS.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (CANVAS.width / rect.width);
  const y = (e.clientY - rect.top) * (CANVAS.height / rect.height);
  editor.data = editor.data.filter(o => !(x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h));
}

/* ===========================
   Helpers & misc
   =========================== */
function resizeCanvasIfNeeded() {
  const parentRect = CANVAS.getBoundingClientRect();
  const desiredWidth = parentRect.width * DPR;
  const desiredHeight = parentRect.height * DPR;
  if (CANVAS.width !== desiredWidth || CANVAS.height !== desiredHeight) {
    CANVAS.width = desiredWidth;
    CANVAS.height = desiredHeight;
    // logical coordinate transform: map GAME_WIDTH x GAME_HEIGHT to canvas
    ctx.setTransform(CANVAS.width / GAME_WIDTH, 0, 0, CANVAS.height / GAME_HEIGHT, 0, 0);
  }
}

function roundRect(ctx, x, y, w, h, r = 6, fill = true) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  if (fill) ctx.fill(); else ctx.stroke();
}

// Parallax backgrounds (simple)
function drawParallax(ctx, speed = 0.2) {
  // starfield layers
  const t = performance.now() * 0.001;
  // layer 1
  for (let i = 0; i < 30; i++) {
    const x = (i * 123 + t * 10 * speed) % GAME_WIDTH;
    const y = (i * 73 + Math.sin(i + t) * 40) % (GAME_HEIGHT - 120);
    ctx.globalAlpha = 0.12;
    roundRect(ctx, x, y, 2, 2, 1, true);
  }
  ctx.globalAlpha = 1;
}

/* ===========================
   Start the loop
   =========================== */
function init() {
  // UI init
  populateUnlocked();
  window.addEventListener('resize', () => { DPR = Math.max(1, window.devicePixelRatio || 1); resizeCanvasIfNeeded(); });
  // map input tap to player jump in play mode
  input.onTap = () => {
    if (editor.active) return; // editor uses its own handler
    if (!running) {
      // open level select
      showLevelSelect();
      return;
    }
    if (!paused) player.jump();
  };

  // start main loop
  requestAnimationFrame(gameLoop);
}

function populateUnlocked() {
  // ensure at least level1 unlocked
  if (!SAVE.unlocked || SAVE.unlocked.length === 0) SAVE.unlocked = [LEVELS[0].id];
  Save.save(SAVE);
}

init();
