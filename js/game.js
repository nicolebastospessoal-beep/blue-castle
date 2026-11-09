'use strict';
/* global LEVELS */

// ============================================================
//  Blue Castle — jogo de plataforma 2D em HTML5 Canvas
// ============================================================

const TILE = 32;
const VIEW_W = 960;
const VIEW_H = 540;

// Física do jogador
const GRAVITY = 1800;
const MOVE_SPEED = 230;
const GROUND_ACCEL = 2200;
const GROUND_FRICTION = 2600;
const AIR_ACCEL = 1500;
const JUMP_VEL = 660;
const STOMP_BOUNCE = 430;
const MAX_FALL = 900;
const COYOTE_TIME = 0.1;
const JUMP_BUFFER = 0.12;
const MAX_HP = 5;
const START_HP = 3;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
canvas.width = VIEW_W;
canvas.height = VIEW_H;

// ------------------------------------------------------------
//  Utilidades
// ------------------------------------------------------------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const approach = (v, target, step) => (v < target ? Math.min(v + step, target) : Math.max(v - step, target));
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const rand = (a, b) => a + Math.random() * (b - a);

function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) >>> 0;
  h = ((h ^ (h >>> 13)) * 1274126177) >>> 0;
  return (h ^ (h >>> 16)) / 4294967296;
}

function formatTime(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const storage = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch (e) {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* armazenamento indisponível */ }
  },
};

// ------------------------------------------------------------
//  Áudio (sintetizado com WebAudio, sem arquivos externos)
// ------------------------------------------------------------
const Sound = {
  ctx: null,
  muted: storage.get('bluecastle.muted', false),
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      this.ctx = null;
    }
  },
  tone(freq, dur, { type = 'square', vol = 0.08, slide = 0, delay = 0 } = {}) {
    if (this.muted || !this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.linearRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  },
  jump() { this.tone(330, 0.16, { vol: 0.05, slide: 320 }); },
  gem() {
    this.tone(988, 0.08, { type: 'triangle', vol: 0.09 });
    this.tone(1480, 0.14, { type: 'triangle', vol: 0.08, delay: 0.06 });
  },
  stomp() { this.tone(220, 0.14, { vol: 0.08, slide: -140 }); },
  hurt() { this.tone(180, 0.3, { type: 'sawtooth', vol: 0.09, slide: -120 }); },
  heart() { [523, 659, 784].forEach((f, i) => this.tone(f, 0.12, { type: 'triangle', delay: i * 0.07 })); },
  checkpoint() { [440, 554, 659].forEach((f, i) => this.tone(f, 0.1, { type: 'triangle', delay: i * 0.06 })); },
  doorOpen() { [392, 523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.18, { type: 'triangle', vol: 0.07, delay: i * 0.08 })); },
  clear() { [523, 659, 784, 1046, 784, 1046].forEach((f, i) => this.tone(f, 0.2, { type: 'square', vol: 0.05, delay: i * 0.11 })); },
  gameOver() { [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.3, { type: 'triangle', vol: 0.09, delay: i * 0.18 })); },
  select() { this.tone(660, 0.07, { type: 'square', vol: 0.05 }); },
  toggleMute() {
    this.muted = !this.muted;
    storage.set('bluecastle.muted', this.muted);
  },
};

// ------------------------------------------------------------
//  Entrada (teclado + toque)
// ------------------------------------------------------------
const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'jump', KeyW: 'jump', Space: 'jump', KeyZ: 'jump', KeyK: 'jump',
  ArrowDown: 'down', KeyS: 'down',
  Enter: 'confirm',
  Escape: 'pause', KeyP: 'pause',
  KeyM: 'mute',
  KeyR: 'restart',
};

const Input = {
  down: new Set(),
  pressed: new Set(),
  sources: new Map(), // contagem por ação (teclado + botões de toque)
  press(action) {
    const n = this.sources.get(action) || 0;
    if (n === 0) {
      this.down.add(action);
      this.pressed.add(action);
    }
    this.sources.set(action, n + 1);
  },
  release(action) {
    const n = (this.sources.get(action) || 0) - 1;
    if (n <= 0) {
      this.sources.delete(action);
      this.down.delete(action);
    } else {
      this.sources.set(action, n);
    }
  },
  isDown(a) { return this.down.has(a); },
  wasPressed(a) { return this.pressed.has(a); },
  endFrame() { this.pressed.clear(); },
  reset() {
    this.down.clear();
    this.pressed.clear();
    this.sources.clear();
  },
};

window.addEventListener('keydown', (e) => {
  const action = KEYMAP[e.code];
  if (!action) return;
  e.preventDefault();
  Sound.init();
  if (e.repeat) return;
  Input.press(action);
  // Espaço também confirma nos menus
  if (action === 'jump') Input.pressed.add('menu');
  if (action === 'confirm') Input.pressed.add('menu');
});
window.addEventListener('keyup', (e) => {
  const action = KEYMAP[e.code];
  if (!action) return;
  e.preventDefault();
  Input.release(action);
});
window.addEventListener('blur', () => {
  Input.reset();
  if (game.state === 'playing') game.state = 'paused';
});

// Botões de toque
document.querySelectorAll('[data-action]').forEach((btn) => {
  const action = btn.dataset.action;
  let active = false;
  const start = (e) => {
    e.preventDefault();
    Sound.init();
    if (active) return;
    active = true;
    btn.classList.add('active');
    Input.press(action);
    if (action === 'jump') Input.pressed.add('menu');
  };
  const end = (e) => {
    e.preventDefault();
    if (!active) return;
    active = false;
    btn.classList.remove('active');
    Input.release(action);
  };
  btn.addEventListener('pointerdown', start);
  btn.addEventListener('pointerup', end);
  btn.addEventListener('pointercancel', end);
  btn.addEventListener('pointerleave', end);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
});

canvas.addEventListener('pointerdown', () => {
  Sound.init();
  Input.pressed.add('menu');
});

if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
  document.body.classList.add('touch');
}
window.addEventListener('touchstart', () => document.body.classList.add('touch'), { once: true, passive: true });

// ------------------------------------------------------------
//  Estado do jogo
// ------------------------------------------------------------
const game = {
  state: 'title', // title | playing | paused | levelclear | gameover | victory
  levelIndex: 0,
  score: 0,
  levelStartScore: 0,
  time: 0, // tempo de jogo total (animações)
  levelTime: 0,
  stateTimer: 0,
  shake: 0,
  banner: null,
  bestScore: storage.get('bluecastle.best', 0),
  clearInfo: null,
};

let level = null;
let player = null;
const camera = { x: 0, y: 0 };
let particles = [];
let floaters = [];

function loadLevel(index) {
  const def = LEVELS[index];
  const width = Math.max(...def.map.map((r) => r.length));
  const grid = def.map.map((r) => r.padEnd(width, '.').split(''));
  level = {
    index,
    name: def.name,
    par: def.par,
    w: width,
    h: grid.length,
    grid,
    gems: [],
    hearts: [],
    enemies: [],
    torches: [],
    checkpoints: [],
    door: null,
    start: { x: TILE, y: TILE },
    gemsTotal: 0,
    gemsTaken: 0,
    doorOpen: false,
    stomps: 0,
    hits: 0,
  };

  for (let y = 0; y < level.h; y++) {
    for (let x = 0; x < level.w; x++) {
      const c = grid[y][x];
      const px = x * TILE;
      const py = y * TILE;
      let keep = false;
      switch (c) {
        case 'P':
          level.start = { x: px + 6, y: py + 4 };
          break;
        case 'o':
          level.gems.push({ x: px + 16, y: py + 16, taken: false, t: Math.random() * 6 });
          break;
        case 'h':
          level.hearts.push({ x: px + 16, y: py + 16, taken: false, t: Math.random() * 6 });
          break;
        case 'S':
          level.enemies.push({
            type: 'slime', x: px + 3, y: py + 12, w: 26, h: 20,
            vx: -55, vy: 0, onGround: false, alive: true, deadTimer: 0, t: Math.random() * 6,
          });
          break;
        case 'B':
          level.enemies.push({
            type: 'bat', x: px + 4, y: py + 8, w: 24, h: 16, ox: px + 4, oy: py + 8,
            range: 80 + Math.random() * 40, speed: 1.1 + Math.random() * 0.4,
            alive: true, deadTimer: 0, vy: 0, t: Math.random() * 6, dir: 1,
          });
          break;
        case 'T':
          level.torches.push({ x: px + 16, y: py + 12, t: Math.random() * 10 });
          break;
        case 'C':
          level.checkpoints.push({ x: px + 4, y: py - 32, w: 24, h: 64, active: false, t: 0 });
          break;
        case 'D':
          level.door = { x: px, y: py - TILE, w: TILE, h: TILE * 2, glow: 0 };
          break;
        default:
          keep = true;
      }
      if (!keep) grid[y][x] = '.';
    }
  }
  level.gemsTotal = level.gems.length;
  if (level.gemsTotal === 0) level.doorOpen = true;
  level.respawn = { ...level.start };

  player = createPlayer(level.start.x, level.start.y, player ? player.hp : START_HP);
  particles = [];
  floaters = [];
  game.levelTime = 0;
  game.levelStartScore = game.score;
  game.banner = { text: def.name, sub: `Fase ${index + 1} de ${LEVELS.length}`, t: 2.6 };
  snapCamera();
}

function createPlayer(x, y, hp) {
  return {
    x, y, w: 20, h: 28, vx: 0, vy: 0,
    onGround: false, onPlatform: false, facing: 1,
    coyote: 0, jumpBuf: 0, dropTimer: 0,
    hp, inv: 0, stun: 0, anim: 0, dead: false, deadTimer: 0,
    squash: 1,
  };
}

function startGame() {
  game.score = 0;
  player = null;
  game.levelIndex = 0;
  loadLevel(0);
  game.state = 'playing';
}

function restartLevel() {
  game.score = game.levelStartScore;
  player = null;
  loadLevel(game.levelIndex);
  game.state = 'playing';
}

// ------------------------------------------------------------
//  Mapa / colisão
// ------------------------------------------------------------
function tileAt(cx, cy) {
  if (cx < 0 || cx >= level.w || cy < 0) return '#';
  if (cy >= level.h) return '.';
  return level.grid[cy][cx];
}
const isSolid = (t) => t === '#' || t === '^';

function moveX(b, dx) {
  b.x += dx;
  const top = Math.floor(b.y / TILE);
  const bottom = Math.floor((b.y + b.h - 0.01) / TILE);
  if (dx > 0) {
    const col = Math.floor((b.x + b.w - 0.01) / TILE);
    for (let r = top; r <= bottom; r++) {
      if (isSolid(tileAt(col, r))) {
        b.x = col * TILE - b.w;
        return true;
      }
    }
  } else if (dx < 0) {
    const col = Math.floor(b.x / TILE);
    for (let r = top; r <= bottom; r++) {
      if (isSolid(tileAt(col, r))) {
        b.x = (col + 1) * TILE;
        return true;
      }
    }
  }
  return false;
}

// Retorna o tipo do bloco em que pousou (ou null)
function moveY(b, dy) {
  const prevBottom = b.y + b.h;
  b.y += dy;
  b.onGround = false;
  b.onPlatform = false;
  const left = Math.floor(b.x / TILE);
  const right = Math.floor((b.x + b.w - 0.01) / TILE);
  if (dy > 0) {
    const row = Math.floor((b.y + b.h - 0.01) / TILE);
    let landed = null;
    for (let c = left; c <= right; c++) {
      const t = tileAt(c, row);
      const platform = t === '=' && prevBottom <= row * TILE + 0.5 && !(b.dropTimer > 0);
      if (isSolid(t) || platform) {
        if (!landed || landed === '^' || landed === '=') landed = t;
      }
    }
    if (landed) {
      b.y = row * TILE - b.h;
      b.vy = 0;
      b.onGround = true;
      b.onPlatform = landed === '=';
      return landed;
    }
  } else if (dy < 0) {
    const row = Math.floor(b.y / TILE);
    for (let c = left; c <= right; c++) {
      if (isSolid(tileAt(c, row))) {
        b.y = (row + 1) * TILE;
        b.vy = 0;
        return 'ceiling';
      }
    }
  }
  return null;
}

// Está apenas sobre espinhos (sem chão firme por baixo)?
function standingOnlyOnSpikes(b) {
  const row = Math.floor((b.y + b.h + 1) / TILE);
  const left = Math.floor((b.x + 3) / TILE);
  const right = Math.floor((b.x + b.w - 3) / TILE);
  let spikes = false;
  for (let c = left; c <= right; c++) {
    const t = tileAt(c, row);
    if (t === '^') spikes = true;
    else if (t === '#' || t === '=') return false;
  }
  return spikes;
}

// ------------------------------------------------------------
//  Partículas e textos flutuantes
// ------------------------------------------------------------
function burst(x, y, color, count = 12, speed = 160, life = 0.6, gravity = 400) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.3 + Math.random() * 0.7);
    particles.push({
      x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - speed * 0.3,
      life: life * (0.6 + Math.random() * 0.6), max: life, color, size: rand(2, 4), gravity,
    });
  }
}

function dust(x, y, count = 6) {
  for (let i = 0; i < count; i++) {
    particles.push({
      x: x + rand(-8, 8), y, vx: rand(-60, 60), vy: rand(-60, -10),
      life: rand(0.25, 0.45), max: 0.45, color: '#a9b8de', size: rand(2, 3.5), gravity: 100,
    });
  }
}

function floatText(text, x, y, color = '#fff') {
  floaters.push({ text, x, y, t: 1, color });
}

function updateParticles(dt) {
  for (const p of particles) {
    p.life -= dt;
    p.vy += p.gravity * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
  particles = particles.filter((p) => p.life > 0);
  for (const f of floaters) {
    f.t -= dt;
    f.y -= 40 * dt;
  }
  floaters = floaters.filter((f) => f.t > 0);
}

// ------------------------------------------------------------
//  Jogador
// ------------------------------------------------------------
function hurtPlayer(sourceX) {
  const p = player;
  if (p.inv > 0 || p.dead) return;
  p.hp -= 1;
  level.hits += 1;
  p.inv = 1.4;
  p.stun = 0.25;
  const dir = p.x + p.w / 2 < sourceX ? -1 : 1;
  p.vx = dir * 260;
  p.vy = -380;
  game.shake = 8;
  Sound.hurt();
  burst(p.x + p.w / 2, p.y + p.h / 2, '#ff6b7d', 14, 180);
  if (p.hp <= 0) killPlayer();
}

function killPlayer() {
  const p = player;
  p.dead = true;
  p.deadTimer = 1.6;
  p.vy = -520;
  p.vx = 0;
  game.shake = 12;
  Sound.gameOver();
}

function fellOut() {
  const p = player;
  p.hp -= 1;
  level.hits += 1;
  game.shake = 10;
  Sound.hurt();
  if (p.hp <= 0) {
    p.hp = 0;
    p.dead = true;
    p.deadTimer = 1.2;
    Sound.gameOver();
    return;
  }
  p.x = level.respawn.x;
  p.y = level.respawn.y;
  p.vx = 0;
  p.vy = 0;
  p.inv = 1.4;
  floatText('-1 ♥', p.x + p.w / 2, p.y - 10, '#ff8a9a');
}

function updatePlayer(dt) {
  const p = player;
  p.anim += dt;
  p.squash = lerp(p.squash, 1, Math.min(1, dt * 12));

  if (p.dead) {
    p.deadTimer -= dt;
    p.vy = Math.min(p.vy + GRAVITY * dt, MAX_FALL);
    p.y += p.vy * dt;
    if (p.deadTimer <= 0) {
      game.state = 'gameover';
      game.stateTimer = 0;
    }
    return;
  }

  if (p.inv > 0) p.inv -= dt;
  if (p.stun > 0) p.stun -= dt;
  if (p.dropTimer > 0) p.dropTimer -= dt;

  let dir = (Input.isDown('right') ? 1 : 0) - (Input.isDown('left') ? 1 : 0);
  if (p.stun > 0) dir = 0;

  if (dir !== 0) {
    p.vx = approach(p.vx, dir * MOVE_SPEED, (p.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt);
    p.facing = dir;
  } else if (p.stun <= 0) {
    p.vx = approach(p.vx, 0, (p.onGround ? GROUND_FRICTION : AIR_ACCEL * 0.4) * dt);
  }

  // Atravessar plataforma de madeira para baixo
  if (Input.wasPressed('down') && p.onPlatform) {
    p.dropTimer = 0.22;
    p.onGround = false;
    p.coyote = 0;
  }

  if (Input.wasPressed('jump')) p.jumpBuf = JUMP_BUFFER;
  else p.jumpBuf -= dt;
  p.coyote = p.onGround ? COYOTE_TIME : p.coyote - dt;

  if (p.jumpBuf > 0 && p.coyote > 0 && p.stun <= 0) {
    if (Input.isDown('down') && p.onPlatform) {
      p.dropTimer = 0.22;
    } else {
      p.vy = -JUMP_VEL;
      p.squash = 0.7;
      Sound.jump();
      dust(p.x + p.w / 2, p.y + p.h, 5);
    }
    p.jumpBuf = 0;
    p.coyote = 0;
  }

  // Pulo variável: soltar o botão corta a subida
  if (!Input.isDown('jump') && p.vy < 0) p.vy += GRAVITY * 1.4 * dt;
  p.vy = Math.min(p.vy + GRAVITY * dt, MAX_FALL);

  const wasGround = p.onGround;
  const fallSpeed = p.vy;
  if (moveX(p, p.vx * dt)) p.vx = 0;
  const landed = moveY(p, p.vy * dt);

  if (p.onGround && !wasGround) {
    if (fallSpeed > 500) {
      p.squash = 1.3;
      dust(p.x + p.w / 2, p.y + p.h, 7);
    }
  }

  if (landed && standingOnlyOnSpikes(p)) {
    hurtPlayer(p.x + p.w / 2 - p.facing);
    p.vy = -460;
    p.onGround = false;
  }

  if (p.y > level.h * TILE + 64) fellOut();
}

// ------------------------------------------------------------
//  Inimigos
// ------------------------------------------------------------
function updateEnemies(dt) {
  const p = player;
  for (const e of level.enemies) {
    e.t += dt;
    if (!e.alive) {
      e.deadTimer -= dt;
      continue;
    }

    if (e.type === 'slime') {
      e.vy = Math.min(e.vy + GRAVITY * dt, MAX_FALL);
      if (moveX(e, e.vx * dt)) e.vx = -e.vx;
      moveY(e, e.vy * dt);
      if (e.onGround) {
        // Vira na beirada
        const aheadX = e.vx > 0 ? e.x + e.w + 2 : e.x - 2;
        const col = Math.floor(aheadX / TILE);
        const row = Math.floor((e.y + e.h + 2) / TILE);
        const t = tileAt(col, row);
        if (!(t === '#' || t === '=')) e.vx = -e.vx;
      }
      if (e.y > level.h * TILE + 100) e.alive = false;
    } else if (e.type === 'bat') {
      const prevX = e.x;
      e.x = e.ox + Math.sin(e.t * e.speed) * e.range;
      e.y = e.oy + Math.sin(e.t * 3.2) * 12;
      e.dir = e.x >= prevX ? 1 : -1;
    }

    if (p.dead || !overlap(p, e)) continue;

    const prevBottom = p.y + p.h - p.vy * dt;
    if (p.vy > 0 && prevBottom <= e.y + 10) {
      // Pisão!
      e.alive = false;
      e.deadTimer = 0.5;
      p.vy = -(Input.isDown('jump') ? STOMP_BOUNCE * 1.3 : STOMP_BOUNCE);
      p.coyote = 0;
      level.stomps += 1;
      game.score += 50;
      game.shake = 4;
      Sound.stomp();
      burst(e.x + e.w / 2, e.y + e.h / 2, e.type === 'slime' ? '#5fe07a' : '#9c6ad6', 16, 200);
      floatText('+50', e.x + e.w / 2, e.y - 6, '#ffe58a');
    } else {
      hurtPlayer(e.x + e.w / 2);
    }
  }
  level.enemies = level.enemies.filter((e) => e.alive || e.deadTimer > 0);
}

// ------------------------------------------------------------
//  Itens, checkpoints e portão
// ------------------------------------------------------------
function updateItems(dt) {
  const p = player;
  if (p.dead) return;
  const cx = p.x + p.w / 2;
  const cy = p.y + p.h / 2;

  for (const g of level.gems) {
    g.t += dt;
    if (g.taken) continue;
    if (Math.abs(g.x - cx) < 20 && Math.abs(g.y - cy) < 24) {
      g.taken = true;
      level.gemsTaken += 1;
      game.score += 100;
      Sound.gem();
      burst(g.x, g.y, '#7fd4ff', 12, 140, 0.5, 120);
      floatText('+100', g.x, g.y - 12, '#bfe9ff');
      if (level.gemsTaken === level.gemsTotal) {
        level.doorOpen = true;
        Sound.doorOpen();
        game.banner = { text: 'O portão se abriu!', sub: 'Encontre a saída', t: 2.2 };
        if (level.door) burst(level.door.x + 16, level.door.y + 32, '#bfe9ff', 30, 220, 0.9, 50);
      }
    }
  }

  for (const h of level.hearts) {
    h.t += dt;
    if (h.taken) continue;
    if (Math.abs(h.x - cx) < 20 && Math.abs(h.y - cy) < 24) {
      if (p.hp < MAX_HP) {
        h.taken = true;
        p.hp += 1;
        Sound.heart();
        burst(h.x, h.y, '#ff6b8a', 12, 120, 0.5, 100);
        floatText('+1 ♥', h.x, h.y - 12, '#ff9fb2');
      }
    }
  }

  for (const c of level.checkpoints) {
    c.t += dt;
    if (!c.active && overlap(p, c)) {
      for (const o of level.checkpoints) o.active = false;
      c.active = true;
      level.respawn = { x: c.x + 2, y: c.y + c.h - p.h };
      Sound.checkpoint();
      burst(c.x + 12, c.y + 8, '#7fb8ff', 14, 120, 0.6, 80);
      floatText('Checkpoint!', c.x + 12, c.y - 4, '#bcd6ff');
    }
  }

  const d = level.door;
  if (d) {
    d.glow += dt;
    if (level.doorOpen && overlap(p, { x: d.x + 6, y: d.y + 8, w: d.w - 12, h: d.h - 8 })) {
      completeLevel();
    }
  }
}

function completeLevel() {
  const timeBonus = Math.max(0, Math.round((level.par - game.levelTime) * 10));
  const noHitBonus = level.hits === 0 ? 500 : 0;
  game.score += timeBonus + noHitBonus;
  game.clearInfo = {
    name: level.name,
    time: game.levelTime,
    gems: level.gemsTaken,
    gemsTotal: level.gemsTotal,
    stomps: level.stomps,
    timeBonus,
    noHitBonus,
  };
  Sound.clear();
  game.stateTimer = 0;
  if (game.levelIndex >= LEVELS.length - 1) {
    game.state = 'victory';
    saveBest();
  } else {
    game.state = 'levelclear';
  }
}

function saveBest() {
  if (game.score > game.bestScore) {
    game.bestScore = game.score;
    storage.set('bluecastle.best', game.bestScore);
    game.newRecord = true;
  } else {
    game.newRecord = false;
  }
}

// ------------------------------------------------------------
//  Câmera
// ------------------------------------------------------------
function cameraTarget() {
  const lw = level.w * TILE;
  const lh = level.h * TILE;
  let tx = player.x + player.w / 2 - VIEW_W / 2 + player.facing * 40;
  let ty = player.y + player.h / 2 - VIEW_H / 2 - 20;
  tx = lw <= VIEW_W ? (lw - VIEW_W) / 2 : clamp(tx, 0, lw - VIEW_W);
  ty = lh <= VIEW_H ? lh - VIEW_H : clamp(ty, 0, lh - VIEW_H);
  return { x: tx, y: ty };
}

function snapCamera() {
  const t = cameraTarget();
  camera.x = t.x;
  camera.y = t.y;
}

function updateCamera(dt) {
  const t = cameraTarget();
  camera.x = lerp(camera.x, t.x, Math.min(1, dt * 6));
  camera.y = lerp(camera.y, t.y, Math.min(1, dt * 5));
}

// ------------------------------------------------------------
//  Loop de atualização
// ------------------------------------------------------------
function update(dt) {
  game.time += dt;
  game.stateTimer += dt;
  if (game.shake > 0) game.shake = Math.max(0, game.shake - dt * 30);

  if (Input.wasPressed('mute')) Sound.toggleMute();

  switch (game.state) {
    case 'title':
      if (Input.wasPressed('menu')) {
        Sound.select();
        startGame();
        Input.endFrame();
      }
      break;

    case 'playing':
      if (Input.wasPressed('pause')) {
        game.state = 'paused';
        Sound.select();
        break;
      }
      if (Input.wasPressed('restart')) {
        restartLevel();
        break;
      }
      game.levelTime += dt;
      updatePlayer(dt);
      updateEnemies(dt);
      if (game.state === 'playing') updateItems(dt);
      for (const t of level.torches) t.t += dt;
      updateParticles(dt);
      updateCamera(dt);
      if (game.banner) {
        game.banner.t -= dt;
        if (game.banner.t <= 0) game.banner = null;
      }
      break;

    case 'paused':
      if (Input.wasPressed('pause') || Input.wasPressed('menu')) {
        game.state = 'playing';
        Sound.select();
        Input.endFrame();
      } else if (Input.wasPressed('restart')) {
        restartLevel();
      }
      break;

    case 'levelclear':
      updateParticles(dt);
      if (game.stateTimer > 0.8 && Input.wasPressed('menu')) {
        Sound.select();
        game.levelIndex += 1;
        loadLevel(game.levelIndex);
        game.state = 'playing';
        Input.endFrame();
      }
      break;

    case 'gameover':
      if (game.stateTimer > 0.8 && Input.wasPressed('menu')) {
        Sound.select();
        restartLevel();
        Input.endFrame();
      }
      break;

    case 'victory':
      updateParticles(dt);
      if (Math.random() < dt * 4) {
        burst(camera.x + rand(100, VIEW_W - 100), camera.y + rand(60, 260),
          ['#7fd4ff', '#ffe58a', '#ff9fb2', '#b6ff9f'][Math.floor(Math.random() * 4)], 24, 220, 1, 120);
      }
      if (game.stateTimer > 1.2 && Input.wasPressed('menu')) {
        Sound.select();
        game.state = 'title';
        game.stateTimer = 0;
        Input.endFrame();
      }
      break;
    default:
      break;
  }
}

// ============================================================
//  Renderização
// ============================================================
const STARS = (() => {
  const rnd = seededRandom(7);
  const arr = [];
  for (let i = 0; i < 120; i++) arr.push({ x: rnd() * 1600, y: rnd() * 360, s: rnd() * 1.6 + 0.4, p: rnd() * 6 });
  return arr;
})();

const SKYLINES = [
  { factor: 0.15, color: '#142454', window: '#3d5fae', seed: 3, base: 0.78, minH: 120, maxH: 260 },
  { factor: 0.35, color: '#0f1c44', window: '#f2c866', seed: 11, base: 0.88, minH: 80, maxH: 200 },
].map((layer) => {
  const rnd = seededRandom(layer.seed);
  const towers = [];
  let x = 0;
  const period = 1400;
  while (x < period) {
    const w = 60 + rnd() * 80;
    towers.push({ x, w, h: layer.minH + rnd() * (layer.maxH - layer.minH), roof: rnd() < 0.45, windows: Math.floor(rnd() * 4) + 1, seed: rnd() });
    x += w + 20 + rnd() * 90;
  }
  return { ...layer, towers, period };
});

function drawBackground(camX, camY, lh) {
  const sky = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  sky.addColorStop(0, '#060b24');
  sky.addColorStop(0.55, '#16306e');
  sky.addColorStop(1, '#2c58a8');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // Estrelas
  for (const s of STARS) {
    const x = ((s.x - camX * 0.05) % 1600 + 1600) % 1600;
    if (x > VIEW_W) continue;
    const tw = 0.5 + Math.sin(game.time * 2 + s.p) * 0.5;
    ctx.globalAlpha = 0.35 + tw * 0.6;
    ctx.fillStyle = '#dfe9ff';
    ctx.fillRect(x, s.y - camY * 0.03, s.s, s.s);
  }
  ctx.globalAlpha = 1;

  // Lua
  const mx = 780 - camX * 0.02;
  const my = 95 - camY * 0.03;
  const glow = ctx.createRadialGradient(mx, my, 10, mx, my, 120);
  glow.addColorStop(0, 'rgba(200,220,255,0.35)');
  glow.addColorStop(1, 'rgba(200,220,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(mx - 120, my - 120, 240, 240);
  ctx.fillStyle = '#e8efff';
  ctx.beginPath();
  ctx.arc(mx, my, 34, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(160,180,220,0.5)';
  ctx.beginPath();
  ctx.arc(mx - 10, my - 8, 7, 0, Math.PI * 2);
  ctx.arc(mx + 12, my + 10, 5, 0, Math.PI * 2);
  ctx.fill();

  // Silhuetas de torres em paralaxe
  const bottomCam = Math.max(0, lh - VIEW_H);
  for (const layer of SKYLINES) {
    const baseY = VIEW_H * layer.base + (bottomCam - camY) * layer.factor * 0.6;
    const offset = -((camX * layer.factor) % layer.period);
    for (let k = -1; k <= Math.ceil(VIEW_W / layer.period) + 1; k++) {
      for (const t of layer.towers) {
        const x = offset + k * layer.period + t.x;
        if (x > VIEW_W || x + t.w < 0) continue;
        const top = baseY - t.h;
        ctx.fillStyle = layer.color;
        ctx.fillRect(x, top, t.w, VIEW_H - top + 400);
        if (t.roof) {
          ctx.beginPath();
          ctx.moveTo(x - 8, top);
          ctx.lineTo(x + t.w / 2, top - t.w * 0.9);
          ctx.lineTo(x + t.w + 8, top);
          ctx.fill();
        } else {
          const n = Math.max(3, Math.floor(t.w / 18));
          const cw = t.w / (n * 2 - 1);
          for (let i = 0; i < n; i++) ctx.fillRect(x + i * cw * 2, top - 12, cw, 12);
        }
        ctx.fillStyle = layer.window;
        for (let i = 0; i < t.windows; i++) {
          const wy = top + 24 + i * 38;
          const lit = layer.factor < 0.3 || Math.sin(game.time * 0.7 + t.seed * 20 + i) > -0.6;
          if (!lit) continue;
          ctx.globalAlpha = layer.factor < 0.3 ? 0.5 : 0.85;
          ctx.fillRect(x + t.w / 2 - 4, wy, 8, 14);
          ctx.beginPath();
          ctx.arc(x + t.w / 2, wy, 4, Math.PI, 0);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  // Névoa
  const fog = ctx.createLinearGradient(0, VIEW_H * 0.6, 0, VIEW_H);
  fog.addColorStop(0, 'rgba(60,100,180,0)');
  fog.addColorStop(1, 'rgba(60,100,180,0.25)');
  ctx.fillStyle = fog;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

function drawTiles(camX, camY) {
  const c0 = Math.floor(camX / TILE) - 1;
  const c1 = Math.ceil((camX + VIEW_W) / TILE) + 1;
  const r0 = Math.floor(camY / TILE) - 1;
  const r1 = Math.ceil((camY + VIEW_H) / TILE) + 1;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (c < 0 || c >= level.w || r < 0 || r >= level.h) continue;
      const t = level.grid[r][c];
      const x = Math.round(c * TILE - camX);
      const y = Math.round(r * TILE - camY);
      if (t === '#') drawStone(x, y, c, r);
      else if (t === '=') drawPlank(x, y, c, r);
      else if (t === '^') drawSpikes(x, y);
    }
  }
}

function drawStone(x, y, c, r) {
  const exposedTop = tileAt(c, r - 1) !== '#' && tileAt(c, r - 1) !== '^';
  const interior = !exposedTop && tileAt(c - 1, r) === '#' && tileAt(c + 1, r) === '#' && tileAt(c, r + 1) !== '.';
  const v = hash2(c, r);
  const shade = interior ? 0 : 1;
  ctx.fillStyle = shade ? `hsl(222, 45%, ${30 + v * 6}%)` : `hsl(224, 45%, ${18 + v * 4}%)`;
  ctx.fillRect(x, y, TILE, TILE);
  // Juntas dos tijolos
  ctx.fillStyle = shade ? 'rgba(10,20,50,0.55)' : 'rgba(5,10,30,0.5)';
  ctx.fillRect(x, y + 15, TILE, 2);
  const off = r % 2 === 0 ? 0 : 16;
  ctx.fillRect(x + ((off + 8) % 32), y, 2, 15);
  ctx.fillRect(x + ((off + 24) % 32), y + 17, 2, 15);
  // Brilho
  ctx.fillStyle = 'rgba(160,190,255,0.12)';
  ctx.fillRect(x, y, TILE, 2);
  if (exposedTop) {
    ctx.fillStyle = '#7fa6f0';
    ctx.fillRect(x, y, TILE, 4);
    ctx.fillStyle = '#b7cdfb';
    ctx.fillRect(x, y, TILE, 1);
  }
  if (v > 0.86 && !interior) {
    ctx.fillStyle = 'rgba(120,200,255,0.35)';
    ctx.fillRect(x + 6 + v * 10, y + 20, 3, 3);
  }
}

function drawPlank(x, y, c, r) {
  ctx.fillStyle = '#7a4d26';
  ctx.fillRect(x, y, TILE, 10);
  ctx.fillStyle = '#a06a35';
  ctx.fillRect(x, y, TILE, 3);
  ctx.fillStyle = '#4e2f15';
  ctx.fillRect(x, y + 9, TILE, 2);
  ctx.fillRect(x + (c % 2 ? 4 : 20), y + 3, 2, 6);
  // Suportes nas pontas
  const leftEnd = tileAt(c - 1, r) !== '=';
  const rightEnd = tileAt(c + 1, r) !== '=';
  ctx.fillStyle = '#5a3719';
  if (leftEnd) {
    ctx.beginPath();
    ctx.moveTo(x + 2, y + 10);
    ctx.lineTo(x + 12, y + 10);
    ctx.lineTo(x + 2, y + 20);
    ctx.fill();
  }
  if (rightEnd) {
    ctx.beginPath();
    ctx.moveTo(x + TILE - 2, y + 10);
    ctx.lineTo(x + TILE - 12, y + 10);
    ctx.lineTo(x + TILE - 2, y + 20);
    ctx.fill();
  }
}

function drawSpikes(x, y) {
  ctx.fillStyle = '#26324f';
  ctx.fillRect(x, y + 24, TILE, 8);
  for (let i = 0; i < 4; i++) {
    const sx = x + i * 8;
    ctx.fillStyle = '#c4cfe6';
    ctx.beginPath();
    ctx.moveTo(sx, y + 26);
    ctx.lineTo(sx + 4, y + 6);
    ctx.lineTo(sx + 8, y + 26);
    ctx.fill();
    ctx.fillStyle = '#7f8bab';
    ctx.beginPath();
    ctx.moveTo(sx + 4, y + 6);
    ctx.lineTo(sx + 8, y + 26);
    ctx.lineTo(sx + 5, y + 26);
    ctx.fill();
  }
}

function drawTorch(t, camX, camY) {
  const x = t.x - camX;
  const y = t.y - camY;
  if (x < -100 || x > VIEW_W + 100 || y < -100 || y > VIEW_H + 100) return;
  const flick = Math.sin(t.t * 13) * 0.15 + Math.sin(t.t * 7.3) * 0.1;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(x, y - 6, 4, x, y - 6, 90 + flick * 30);
  g.addColorStop(0, 'rgba(255,170,80,0.35)');
  g.addColorStop(1, 'rgba(255,120,40,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - 120, y - 126, 240, 240);
  ctx.restore();
  ctx.fillStyle = '#3b2a1a';
  ctx.fillRect(x - 3, y, 6, 14);
  ctx.fillStyle = '#6b6f80';
  ctx.fillRect(x - 6, y - 2, 12, 4);
  const h = 12 + flick * 8;
  ctx.fillStyle = '#ff8a2a';
  ctx.beginPath();
  ctx.moveTo(x - 6, y - 2);
  ctx.quadraticCurveTo(x, y - 2 - h * 1.6, x + 6, y - 2);
  ctx.fill();
  ctx.fillStyle = '#ffe07a';
  ctx.beginPath();
  ctx.moveTo(x - 3, y - 2);
  ctx.quadraticCurveTo(x, y - 2 - h, x + 3, y - 2);
  ctx.fill();
}

function drawDoor(camX, camY) {
  const d = level.door;
  if (!d) return;
  const x = Math.round(d.x - camX);
  const y = Math.round(d.y - camY);
  // Moldura em arco
  ctx.fillStyle = '#5b6f9e';
  ctx.beginPath();
  ctx.moveTo(x - 6, y + d.h);
  ctx.lineTo(x - 6, y + 14);
  ctx.arc(x + 16, y + 14, 22, Math.PI, 0);
  ctx.lineTo(x + 38, y + d.h);
  ctx.fill();
  ctx.fillStyle = '#8ea4d6';
  ctx.fillRect(x + 12, y - 9, 8, 6);

  if (level.doorOpen) {
    const pulse = 0.6 + Math.sin(d.glow * 4) * 0.2;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(x + 16, y + 32, 4, x + 16, y + 32, 80);
    g.addColorStop(0, `rgba(140,210,255,${0.45 * pulse})`);
    g.addColorStop(1, 'rgba(140,210,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 70, y - 50, 172, 172);
    ctx.restore();
    const inner = ctx.createLinearGradient(0, y, 0, y + d.h);
    inner.addColorStop(0, '#e6f6ff');
    inner.addColorStop(1, '#5fb4ff');
    ctx.fillStyle = inner;
    ctx.beginPath();
    ctx.moveTo(x, y + d.h);
    ctx.lineTo(x, y + 14);
    ctx.arc(x + 16, y + 14, 16, Math.PI, 0);
    ctx.lineTo(x + 32, y + d.h);
    ctx.fill();
    for (let i = 0; i < 3; i++) {
      const py = y + d.h - ((d.glow * 40 + i * 21) % d.h);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillRect(x + 6 + ((i * 9 + Math.floor(d.glow * 3)) % 20), py, 2, 2);
    }
  } else {
    ctx.fillStyle = '#3a2716';
    ctx.beginPath();
    ctx.moveTo(x, y + d.h);
    ctx.lineTo(x, y + 14);
    ctx.arc(x + 16, y + 14, 16, Math.PI, 0);
    ctx.lineTo(x + 32, y + d.h);
    ctx.fill();
    ctx.fillStyle = '#25180c';
    for (let i = 1; i < 4; i++) ctx.fillRect(x + i * 8 - 1, y + 2, 2, d.h - 2);
    ctx.fillStyle = '#7d8597';
    ctx.fillRect(x, y + 22, 32, 3);
    ctx.fillRect(x, y + 46, 32, 3);
    // Cadeado
    ctx.fillStyle = '#f2c866';
    ctx.fillRect(x + 11, y + 32, 10, 9);
    ctx.strokeStyle = '#f2c866';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x + 16, y + 32, 4, Math.PI, 0);
    ctx.stroke();
    ctx.fillStyle = '#3a2716';
    ctx.fillRect(x + 15, y + 35, 2, 3);
  }
}

function drawCheckpoint(c, camX, camY) {
  const x = Math.round(c.x - camX);
  const y = Math.round(c.y - camY);
  ctx.fillStyle = '#9aa4bd';
  ctx.fillRect(x + 4, y + 8, 3, c.h - 8);
  ctx.fillStyle = '#d3dbef';
  ctx.beginPath();
  ctx.arc(x + 5.5, y + 7, 3, 0, Math.PI * 2);
  ctx.fill();
  const wave = Math.sin(c.t * 6) * 3;
  ctx.fillStyle = c.active ? '#4f9dff' : '#59607a';
  ctx.beginPath();
  ctx.moveTo(x + 7, y + 10);
  ctx.quadraticCurveTo(x + 15, y + 10 + wave, x + 24, y + 14);
  ctx.quadraticCurveTo(x + 15, y + 20 + wave, x + 7, y + 24);
  ctx.fill();
  if (c.active) {
    ctx.fillStyle = '#dff0ff';
    ctx.fillRect(x + 12, y + 15, 4, 4);
  }
}

function drawGem(g, camX, camY) {
  if (g.taken) return;
  const bob = Math.sin(g.t * 3) * 3;
  const x = g.x - camX;
  const y = g.y - camY + bob;
  if (x < -40 || x > VIEW_W + 40 || y < -40 || y > VIEW_H + 40) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const glow = ctx.createRadialGradient(x, y, 2, x, y, 22);
  glow.addColorStop(0, 'rgba(110,200,255,0.55)');
  glow.addColorStop(1, 'rgba(110,200,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(x - 22, y - 22, 44, 44);
  ctx.restore();
  const s = Math.abs(Math.cos(g.t * 2)) * 0.35 + 0.65; // giro
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, 1);
  ctx.fillStyle = '#2f8cff';
  ctx.beginPath();
  ctx.moveTo(0, -10);
  ctx.lineTo(8, -2);
  ctx.lineTo(0, 11);
  ctx.lineTo(-8, -2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#8fd8ff';
  ctx.beginPath();
  ctx.moveTo(0, -10);
  ctx.lineTo(8, -2);
  ctx.lineTo(0, -2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#1b5fd6';
  ctx.beginPath();
  ctx.moveTo(0, -2);
  ctx.lineTo(8, -2);
  ctx.lineTo(0, 11);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-4, -5, 2, 2);
  ctx.restore();
}

function heartPath(x, y, s) {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.35);
  ctx.bezierCurveTo(x, y, x - s * 0.5, y, x - s * 0.5, y + s * 0.3);
  ctx.bezierCurveTo(x - s * 0.5, y + s * 0.6, x, y + s * 0.8, x, y + s);
  ctx.bezierCurveTo(x, y + s * 0.8, x + s * 0.5, y + s * 0.6, x + s * 0.5, y + s * 0.3);
  ctx.bezierCurveTo(x + s * 0.5, y, x, y, x, y + s * 0.35);
  ctx.closePath();
}

function drawHeartPickup(h, camX, camY) {
  if (h.taken) return;
  const bob = Math.sin(h.t * 3) * 3;
  const x = h.x - camX;
  const y = h.y - camY + bob;
  const beat = 1 + Math.max(0, Math.sin(h.t * 6)) * 0.12;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(beat, beat);
  ctx.fillStyle = '#ff4d6d';
  heartPath(0, -9, 18);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillRect(-6, -5, 3, 3);
  ctx.restore();
}

function drawSlime(e, camX, camY) {
  const x = e.x - camX + e.w / 2;
  const y = e.y - camY + e.h;
  let sx = 1 + Math.sin(e.t * 8) * 0.08;
  let sy = 1 - Math.sin(e.t * 8) * 0.08;
  if (!e.alive) {
    sx = 1.5;
    sy = Math.max(0.05, e.deadTimer / 0.5) * 0.4;
    ctx.globalAlpha = Math.max(0, e.deadTimer / 0.5);
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sx, sy);
  ctx.fillStyle = '#3cbf5a';
  ctx.beginPath();
  ctx.moveTo(-13, 0);
  ctx.quadraticCurveTo(-14, -20, 0, -21);
  ctx.quadraticCurveTo(14, -20, 13, 0);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#7ef09a';
  ctx.beginPath();
  ctx.ellipse(-5, -14, 4, 3, -0.5, 0, Math.PI * 2);
  ctx.fill();
  const look = e.vx > 0 ? 2 : -2;
  ctx.fillStyle = '#fff';
  ctx.fillRect(-7 + look, -13, 5, 6);
  ctx.fillRect(2 + look, -13, 5, 6);
  ctx.fillStyle = '#10301a';
  ctx.fillRect(-5 + look + (look > 0 ? 1 : -1), -11, 2, 3);
  ctx.fillRect(4 + look + (look > 0 ? 1 : -1), -11, 2, 3);
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawBat(e, camX, camY) {
  const x = e.x - camX + e.w / 2;
  const y = e.y - camY + e.h / 2;
  const flap = Math.sin(e.t * 18);
  ctx.save();
  ctx.translate(x, y);
  if (!e.alive) {
    ctx.globalAlpha = Math.max(0, e.deadTimer / 0.5);
    ctx.rotate((0.5 - e.deadTimer) * 8);
  }
  ctx.scale(e.dir, 1);
  ctx.fillStyle = '#4a2d73';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * 4, -2);
    ctx.lineTo(side * 16, -6 - flap * 7);
    ctx.lineTo(side * 13, 1 - flap * 3);
    ctx.lineTo(side * 9, 0);
    ctx.lineTo(side * 6, 4);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = '#6a46a0';
  ctx.beginPath();
  ctx.ellipse(0, 0, 7, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-5, -5);
  ctx.lineTo(-3, -11);
  ctx.lineTo(-1, -6);
  ctx.moveTo(5, -5);
  ctx.lineTo(3, -11);
  ctx.lineTo(1, -6);
  ctx.fill();
  ctx.fillStyle = '#ff5a6e';
  ctx.fillRect(1, -2, 3, 2);
  ctx.fillRect(-3, -2, 2, 2);
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawPlayer(camX, camY) {
  const p = player;
  if (!p.dead && p.inv > 0 && Math.floor(p.inv * 14) % 2 === 0) return;
  const x = Math.round(p.x - camX + p.w / 2);
  const y = Math.round(p.y - camY + p.h);
  const running = p.onGround && Math.abs(p.vx) > 30;
  const legPhase = running ? Math.sin(p.anim * 16) : 0;
  const sy = p.squash;
  const sx = 1 / Math.sqrt(sy);

  ctx.save();
  ctx.translate(x, y);
  if (p.dead) ctx.rotate(Math.min(1.5, (1.6 - p.deadTimer) * 3) * -p.facing);
  ctx.scale(sx * p.facing, sy);

  // Capa
  const capeWave = Math.sin(p.anim * (running ? 14 : 4)) * (running ? 3 : 1.2);
  const capeLift = clamp(-p.vy / 200, -2, 4);
  ctx.fillStyle = '#1f5fe0';
  ctx.beginPath();
  ctx.moveTo(-5, -18);
  ctx.lineTo(-7, -6);
  ctx.lineTo(-13 - capeWave - Math.abs(p.vx) / 60, -4 - capeLift);
  ctx.lineTo(-9, -19);
  ctx.closePath();
  ctx.fill();

  // Pernas
  ctx.fillStyle = '#4b5878';
  if (!p.onGround) {
    ctx.fillRect(-7, -8, 5, 7);
    ctx.fillRect(2, -9, 5, 6);
  } else {
    ctx.fillRect(-7 + legPhase * 2, -8, 5, 8);
    ctx.fillRect(2 - legPhase * 2, -8, 5, 8);
  }
  ctx.fillStyle = '#2a3045';
  if (p.onGround) {
    ctx.fillRect(-7 + legPhase * 2, -2, 6, 2);
    ctx.fillRect(2 - legPhase * 2, -2, 6, 2);
  }

  // Corpo (armadura)
  ctx.fillStyle = '#b8c4dc';
  ctx.fillRect(-8, -19, 16, 12);
  ctx.fillStyle = '#e1e8f7';
  ctx.fillRect(-8, -19, 16, 2);
  ctx.fillStyle = '#2f6df0';
  ctx.fillRect(-2, -17, 4, 8); // emblema
  ctx.fillStyle = '#5a3d1e';
  ctx.fillRect(-8, -10, 16, 2);

  // Braço
  const arm = running ? -legPhase * 2 : 0;
  ctx.fillStyle = '#9ea9c4';
  ctx.fillRect(3 + arm, -17, 4, 8);

  // Elmo
  ctx.fillStyle = '#d5ddef';
  ctx.fillRect(-7, -29, 14, 11);
  ctx.fillStyle = '#f2f6ff';
  ctx.fillRect(-7, -29, 14, 2);
  ctx.fillStyle = '#1a2340';
  ctx.fillRect(0, -25, 7, 2);
  ctx.fillRect(3, -23, 2, 3);
  // Penacho
  ctx.fillStyle = '#3d8bff';
  ctx.beginPath();
  ctx.moveTo(-1, -29);
  ctx.quadraticCurveTo(-4, -37, -12 - capeWave * 0.5, -33);
  ctx.quadraticCurveTo(-6, -32, -4, -28);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function drawParticles(camX, camY) {
  for (const p of particles) {
    ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - camX - p.size / 2, p.y - camY - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'center';
  ctx.font = 'bold 14px "Trebuchet MS", sans-serif';
  for (const f of floaters) {
    ctx.globalAlpha = clamp(f.t * 1.5, 0, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillText(f.text, f.x - camX + 1, f.y - camY + 1);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x - camX, f.y - camY);
  }
  ctx.globalAlpha = 1;
}

function drawWorld() {
  const sx = game.shake > 0 ? rand(-game.shake, game.shake) : 0;
  const sy = game.shake > 0 ? rand(-game.shake, game.shake) : 0;
  const camX = Math.round(camera.x + sx);
  const camY = Math.round(camera.y + sy);

  drawBackground(camX, camY, level.h * TILE);
  for (const t of level.torches) drawTorch(t, camX, camY);
  drawDoor(camX, camY);
  drawTiles(camX, camY);
  for (const c of level.checkpoints) drawCheckpoint(c, camX, camY);
  for (const g of level.gems) drawGem(g, camX, camY);
  for (const h of level.hearts) drawHeartPickup(h, camX, camY);
  for (const e of level.enemies) {
    if (e.type === 'slime') drawSlime(e, camX, camY);
    else drawBat(e, camX, camY);
  }
  drawPlayer(camX, camY);
  drawParticles(camX, camY);

  // Vinheta
  const vg = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.45, VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.95);
  vg.addColorStop(0, 'rgba(0,0,20,0)');
  vg.addColorStop(1, 'rgba(0,0,20,0.45)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

// ------------------------------------------------------------
//  HUD e telas
// ------------------------------------------------------------
function text(str, x, y, { size = 20, color = '#fff', align = 'left', weight = 'bold', shadow = true } = {}) {
  ctx.font = `${weight} ${size}px "Trebuchet MS", "Segoe UI", sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  if (shadow) {
    ctx.fillStyle = 'rgba(0,0,30,0.6)';
    ctx.fillText(str, x + 2, y + 2);
  }
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

function drawHUD() {
  // Painel
  ctx.fillStyle = 'rgba(6,12,36,0.55)';
  roundRect(12, 10, 300, 46, 10);
  ctx.fill();

  for (let i = 0; i < MAX_HP; i++) {
    ctx.fillStyle = i < player.hp ? '#ff4d6d' : 'rgba(255,255,255,0.15)';
    heartPath(34 + i * 26, 22, 20);
    ctx.fill();
  }

  // Cristais
  ctx.save();
  ctx.translate(178, 33);
  ctx.fillStyle = level.doorOpen ? '#8fd8ff' : '#2f8cff';
  ctx.beginPath();
  ctx.moveTo(0, -10);
  ctx.lineTo(8, -2);
  ctx.lineTo(0, 11);
  ctx.lineTo(-8, -2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  text(`${level.gemsTaken}/${level.gemsTotal}`, 194, 41, { size: 20, color: level.doorOpen ? '#bfe9ff' : '#fff' });

  ctx.fillStyle = 'rgba(6,12,36,0.55)';
  roundRect(VIEW_W - 252, 10, 240, 46, 10);
  ctx.fill();
  text(`${game.score}`.padStart(6, '0'), VIEW_W - 236, 41, { size: 22, color: '#ffe58a' });
  text(formatTime(game.levelTime), VIEW_W - 26, 41, { size: 20, align: 'right' });

  text(`Fase ${level.index + 1} · ${level.name}`, VIEW_W / 2, 36, { size: 16, align: 'center', color: '#c6d6ff' });
  if (Sound.muted) text('🔇', VIEW_W - 26, 82, { size: 18, align: 'right' });

  if (game.banner) {
    const a = clamp(game.banner.t, 0, 1) * clamp((3 - game.banner.t) * 3, 0, 1);
    ctx.globalAlpha = a;
    text(game.banner.text, VIEW_W / 2, 150, { size: 40, align: 'center', color: '#e6f0ff' });
    if (game.banner.sub) text(game.banner.sub, VIEW_W / 2, 182, { size: 18, align: 'center', color: '#9fb8ee' });
    ctx.globalAlpha = 1;
  }
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function overlay(alpha = 0.6) {
  ctx.fillStyle = `rgba(4,8,28,${alpha})`;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

function panel(w, h) {
  const x = (VIEW_W - w) / 2;
  const y = (VIEW_H - h) / 2;
  ctx.fillStyle = 'rgba(14,26,66,0.92)';
  roundRect(x, y, w, h, 16);
  ctx.fill();
  ctx.strokeStyle = '#4f7fe0';
  ctx.lineWidth = 2;
  ctx.stroke();
  return { x, y };
}

const blink = () => Math.sin(game.time * 5) > -0.3;
const isTouch = () => document.body.classList.contains('touch');
const confirmHint = () => (isTouch() ? 'Toque na tela' : 'Pressione Enter');

function drawTitle() {
  const camX = game.time * 30;
  drawBackground(camX, 0, VIEW_H);

  // Castelo ao centro
  const cx = VIEW_W / 2;
  const base = VIEW_H + 50;
  ctx.fillStyle = '#1d3a85';
  ctx.fillRect(cx - 170, base - 150, 340, 190);
  ctx.fillRect(cx - 230, base - 210, 70, 250);
  ctx.fillRect(cx + 160, base - 210, 70, 250);
  ctx.fillRect(cx - 45, base - 260, 90, 300);
  ctx.fillStyle = '#2a4fa8';
  for (const [tx, tw, ty] of [[cx - 230, 70, base - 210], [cx + 160, 70, base - 210], [cx - 45, 90, base - 260]]) {
    ctx.beginPath();
    ctx.moveTo(tx - 10, ty);
    ctx.lineTo(tx + tw / 2, ty - tw * 1.1);
    ctx.lineTo(tx + tw + 10, ty);
    ctx.fill();
  }
  ctx.fillStyle = '#1d3a85';
  for (let i = 0; i < 8; i++) ctx.fillRect(cx - 170 + i * 44, base - 168, 24, 18);
  ctx.fillStyle = '#f2c866';
  for (const [wx, wy] of [[cx - 200, base - 160], [cx + 190, base - 160], [cx - 10, base - 210], [cx - 120, base - 100], [cx + 100, base - 100]]) {
    if (Math.sin(game.time * 1.3 + wx) > -0.8) {
      ctx.fillRect(wx, wy, 20, 28);
      ctx.beginPath();
      ctx.arc(wx + 10, wy, 10, Math.PI, 0);
      ctx.fill();
    }
  }
  ctx.fillStyle = '#0c1430';
  ctx.beginPath();
  ctx.moveTo(cx - 40, base + 40);
  ctx.lineTo(cx - 40, base - 40);
  ctx.arc(cx, base - 40, 40, Math.PI, 0);
  ctx.lineTo(cx + 40, base + 40);
  ctx.fill();
  // Bandeira
  ctx.fillStyle = '#c9d3e6';
  ctx.fillRect(cx - 1, base - 380, 3, 50);
  ctx.fillStyle = '#3d8bff';
  const w = Math.sin(game.time * 4) * 4;
  ctx.beginPath();
  ctx.moveTo(cx + 2, base - 380);
  ctx.quadraticCurveTo(cx + 20, base - 378 + w, cx + 38, base - 372);
  ctx.quadraticCurveTo(cx + 20, base - 362 + w, cx + 2, base - 362);
  ctx.fill();

  overlay(0.4);
  const bounce = Math.sin(game.time * 2) * 4;
  text('BLUE CASTLE', VIEW_W / 2, 110 + bounce, { size: 72, align: 'center', color: '#e6f0ff' });
  text('O Castelo Azul', VIEW_W / 2, 148 + bounce, { size: 22, align: 'center', color: '#8fb4ff' });

  if (blink()) text(`${confirmHint()} para começar`, VIEW_W / 2, 300, { size: 24, align: 'center', color: '#ffe58a' });

  const lines = isTouch()
    ? ['◀ ▶ mover · ▲ pular · ▼ descer da plataforma']
    : ['← → / A D  mover    ↑ / W / Espaço  pular    ↓ / S  descer da plataforma', 'P / Esc  pausar    R  reiniciar fase    M  som'];
  lines.forEach((l, i) => text(l, VIEW_W / 2, 350 + i * 26, { size: 16, align: 'center', color: '#c6d6ff', weight: 'normal' }));
  text('Colete todos os cristais para abrir o portão. Pule sobre os inimigos!', VIEW_W / 2, 420, { size: 16, align: 'center', color: '#9fb8ee', weight: 'normal' });
  if (game.bestScore > 0) text(`Recorde: ${game.bestScore}`, VIEW_W / 2, 455, { size: 18, align: 'center', color: '#ffe58a' });
}

function drawPaused() {
  overlay(0.55);
  const { y } = panel(420, 220);
  text('Pausado', VIEW_W / 2, y + 70, { size: 44, align: 'center' });
  text(isTouch() ? 'Toque para continuar' : 'P / Esc / Enter para continuar', VIEW_W / 2, y + 120, { size: 18, align: 'center', color: '#c6d6ff', weight: 'normal' });
  text('R para reiniciar a fase', VIEW_W / 2, y + 150, { size: 18, align: 'center', color: '#c6d6ff', weight: 'normal' });
  text(Sound.muted ? 'Som: desligado (M)' : 'Som: ligado (M)', VIEW_W / 2, y + 185, { size: 16, align: 'center', color: '#8fa6d6', weight: 'normal' });
}

function drawLevelClear(final) {
  overlay(0.55);
  const info = game.clearInfo;
  const { y } = panel(480, final ? 380 : 340);
  text(final ? 'Vitória!' : 'Fase concluída!', VIEW_W / 2, y + 62, { size: 42, align: 'center', color: final ? '#ffe58a' : '#e6f0ff' });
  if (final) text('Você conquistou o Castelo Azul!', VIEW_W / 2, y + 96, { size: 18, align: 'center', color: '#bfe9ff' });
  const rows = [
    ['Tempo', formatTime(info.time)],
    ['Cristais', `${info.gems}/${info.gemsTotal}`],
    ['Inimigos derrotados', `${info.stomps}`],
    ['Bônus de tempo', `+${info.timeBonus}`],
    ['Sem dano', info.noHitBonus ? `+${info.noHitBonus}` : '—'],
    ['Pontuação', `${game.score}`],
  ];
  const top = y + (final ? 135 : 110);
  const reveal = Math.floor(game.stateTimer / 0.12);
  rows.forEach(([k, v], i) => {
    if (i > reveal) return;
    text(k, VIEW_W / 2 - 180, top + i * 30, { size: 18, color: '#c6d6ff', weight: 'normal' });
    text(v, VIEW_W / 2 + 180, top + i * 30, { size: 18, align: 'right', color: i === rows.length - 1 ? '#ffe58a' : '#fff' });
  });
  if (final && game.newRecord) text('Novo recorde!', VIEW_W / 2, top + rows.length * 30 + 6, { size: 20, align: 'center', color: '#ff9fb2' });
  const ready = game.stateTimer > (final ? 1.2 : 0.8);
  if (ready && blink()) {
    text(`${confirmHint()} ${final ? 'para voltar ao início' : 'para continuar'}`, VIEW_W / 2, y + (final ? 360 : 318), { size: 18, align: 'center', color: '#ffe58a' });
  }
}

function drawGameOver() {
  overlay(0.65);
  const { y } = panel(440, 220);
  text('Fim de jogo', VIEW_W / 2, y + 75, { size: 46, align: 'center', color: '#ff8a9a' });
  text(`Pontuação: ${game.score}`, VIEW_W / 2, y + 120, { size: 20, align: 'center', color: '#c6d6ff' });
  if (game.stateTimer > 0.8 && blink()) {
    text(`${confirmHint()} para tentar de novo`, VIEW_W / 2, y + 175, { size: 18, align: 'center', color: '#ffe58a' });
  }
}

function render() {
  ctx.clearRect(0, 0, VIEW_W, VIEW_H);
  if (game.state === 'title') {
    drawTitle();
    return;
  }
  drawWorld();
  drawHUD();
  if (game.state === 'paused') drawPaused();
  else if (game.state === 'levelclear') drawLevelClear(false);
  else if (game.state === 'victory') drawLevelClear(true);
  else if (game.state === 'gameover') drawGameOver();
}

// ------------------------------------------------------------
//  Loop principal
// ------------------------------------------------------------
let lastTime = performance.now();
function frame(now) {
  const dt = Math.min((now - lastTime) / 1000, 1 / 30);
  lastTime = now;
  update(dt);
  render();
  Input.endFrame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Exposto para depuração/testes
window.BlueCastle = { game, get level() { return level; }, get player() { return player; }, Input, loadLevel };
