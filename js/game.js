'use strict';
/* global ATLAS, TILES, buildWorld, DIALOGS, T, isWater, NIGHT_SPRITES, LIGHTS */

// ============================================================
//  Blue Castle — RPG 2D visto de cima
// ============================================================

const VIEW_W = 960;
const VIEW_H = 540;
const WALK_SPEED = 140;
const RUN_SPEED = 250;
const SWIM_SPEED = 85;
const MAX_HP = 5;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
canvas.width = VIEW_W;
canvas.height = VIEW_H;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

const storage = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sem armazenamento */ } },
};

// ------------------------------------------------------------
//  Imagens
// ------------------------------------------------------------
const images = { atlas: new Image(), tiles: new Image() };
let loaded = 0;
images.atlas.onload = () => { loaded += 1; };
images.tiles.onload = () => { loaded += 1; };
images.atlas.src = 'assets/game/atlas.webp';
images.tiles.src = 'assets/game/tiles.webp';

function spriteSize(name) {
  const r = ATLAS[name];
  return r ? { w: r[2], h: r[3] } : { w: 0, h: 0 };
}

// Desenha um sprite ancorado pela base (centro-baixo) em (x, y) da tela
function drawSprite(name, x, y, { flip = false, scale = 1, alpha = 1, w = null, h = null } = {}) {
  const r = ATLAS[name];
  if (!r) return;
  const dw = w || Math.round(r[2] * scale);
  const dh = h || Math.round(r[3] * scale);
  ctx.save();
  if (alpha !== 1) ctx.globalAlpha *= alpha;
  ctx.translate(Math.round(x), Math.round(y));
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(images.atlas, r[0], r[1], r[2], r[3], -Math.floor(dw / 2), -dh, dw, dh);
  ctx.restore();
}

// ------------------------------------------------------------
//  Áudio sintetizado (sem arquivos externos)
// ------------------------------------------------------------
const Sound = {
  ctx: null,
  muted: storage.get('bluecastle.muted', false),
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ctx = null; }
  },
  tone(freq, dur, { type = 'square', vol = 0.06, slide = 0, delay = 0 } = {}) {
    if (this.muted || !this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.linearRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  },
  noise(dur, vol = 0.08) {
    if (this.muted || !this.ctx) return;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = this.ctx.createBufferSource();
    const g = this.ctx.createGain();
    g.gain.value = vol;
    s.buffer = buf;
    s.connect(g).connect(this.ctx.destination);
    s.start();
  },
  swing() { this.noise(0.12, 0.07); this.tone(500, 0.1, { type: 'triangle', vol: 0.03, slide: -300 }); },
  cut() { this.noise(0.18, 0.1); },
  coin() { this.tone(988, 0.07, { type: 'triangle' }); this.tone(1319, 0.14, { type: 'triangle', delay: 0.06 }); },
  chest() { [392, 494, 587, 784].forEach((f, i) => this.tone(f, 0.16, { type: 'triangle', delay: i * 0.08 })); },
  hurt() { this.tone(200, 0.3, { type: 'sawtooth', vol: 0.08, slide: -120 }); },
  potion() { [300, 380, 460, 560].forEach((f, i) => this.tone(f, 0.12, { type: 'sine', vol: 0.08, delay: i * 0.1 })); },
  splash() { this.noise(0.25, 0.06); },
  blip() { this.tone(660, 0.04, { vol: 0.03 }); },
  bell() {
    [0, 0.6].forEach((d) => {
      this.tone(523, 1.2, { type: 'sine', vol: 0.1, delay: d });
      this.tone(1051, 0.8, { type: 'sine', vol: 0.03, delay: d });
    });
  },
  faint() { [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.35, { type: 'triangle', vol: 0.08, delay: i * 0.2 })); },
  sleep() { [262, 330, 392, 330].forEach((f, i) => this.tone(f, 0.5, { type: 'sine', vol: 0.06, delay: i * 0.35 })); },
  toggleMute() { this.muted = !this.muted; storage.set('bluecastle.muted', this.muted); },
};

// ------------------------------------------------------------
//  Entrada (teclado + botões de toque)
// ------------------------------------------------------------
const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  ShiftLeft: 'run', ShiftRight: 'run', KeyX: 'run',
  Space: 'attack', KeyJ: 'attack',
  KeyE: 'action', Enter: 'action', KeyK: 'action',
  KeyQ: 'potion', KeyC: 'sit',
  KeyP: 'pause', Escape: 'pause', KeyM: 'mute',
};

const Input = {
  down: new Set(),
  pressed: new Set(),
  count: new Map(),
  press(a) {
    const n = this.count.get(a) || 0;
    if (!n) { this.down.add(a); this.pressed.add(a); }
    this.count.set(a, n + 1);
  },
  release(a) {
    const n = (this.count.get(a) || 0) - 1;
    if (n <= 0) { this.count.delete(a); this.down.delete(a); } else this.count.set(a, n);
  },
  is(a) { return this.down.has(a); },
  hit(a) { return this.pressed.has(a); },
  reset() { this.down.clear(); this.pressed.clear(); this.count.clear(); },
};

window.addEventListener('keydown', (e) => {
  const a = KEYMAP[e.code];
  if (!a) return;
  e.preventDefault();
  Sound.init();
  if (!e.repeat) Input.press(a);
});
window.addEventListener('keyup', (e) => {
  const a = KEYMAP[e.code];
  if (a) { e.preventDefault(); Input.release(a); }
});
window.addEventListener('blur', () => Input.reset());

document.querySelectorAll('[data-action]').forEach((btn) => {
  const a = btn.dataset.action;
  let on = false;
  const start = (e) => { e.preventDefault(); Sound.init(); if (on) return; on = true; btn.classList.add('active'); Input.press(a); };
  const end = (e) => { e.preventDefault(); if (!on) return; on = false; btn.classList.remove('active'); Input.release(a); };
  btn.addEventListener('pointerdown', start);
  btn.addEventListener('pointerup', end);
  btn.addEventListener('pointercancel', end);
  btn.addEventListener('pointerleave', end);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
});
canvas.addEventListener('pointerdown', () => { Sound.init(); Input.pressed.add('action'); });
if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');
window.addEventListener('touchstart', () => document.body.classList.add('touch'), { once: true, passive: true });

// ------------------------------------------------------------
//  Animações do personagem: [quadros, fps, espelhar?]
// ------------------------------------------------------------
const RUN_SIDE = ['correr-lado-e0', 'correr-lado-e1', 'correr-lado-e2', 'correr-lado-e3'];
const SWIM_CYCLE = ['nadar-cima-0', 'nadar-cima-1', 'nadar-cima-2', 'nadar-cima-1'];
const ANIM = {
  idle: {
    down: [['parado-baixo'], 1], up: [['parado-cima'], 1],
    left: [['parado-esquerda'], 1], right: [['parado-direita'], 1],
  },
  walk: {
    down: [['andar-baixo-0', 'andar-baixo-1', 'andar-baixo-2', 'andar-baixo-3'], 7],
    up: [['andar-cima-0', 'andar-cima-1', 'andar-cima-2', 'andar-cima-3'], 7],
    left: [['andar-lado-e0', 'andar-lado-e1'], 5],
    right: [['andar-lado-d0', 'andar-lado-d1'], 5],
  },
  run: {
    down: [['correr-baixo-0', 'correr-baixo-1', 'correr-baixo-2', 'correr-baixo-3'], 11],
    up: [['correr-cima-0', 'correr-cima-1', 'correr-cima-2', 'correr-cima-3'], 11],
    left: [RUN_SIDE, 11],
    right: [RUN_SIDE, 11, true],
  },
  attack: {
    down: [['ataque-baixo'], 1], up: [['ataque-cima'], 1],
    left: [['ataque-lado-0', 'ataque-lado-1'], 10, true], right: [['ataque-lado-0', 'ataque-lado-1'], 10],
  },
  sit: {
    down: [['agachado-baixo'], 1], up: [['agachado-cima'], 1],
    left: [['agachado-direita'], 1, true], right: [['agachado-direita'], 1],
  },
  swim: {
    down: [['nadar-baixo'], 1], up: [SWIM_CYCLE, 5], left: [SWIM_CYCLE, 5], right: [SWIM_CYCLE, 5],
  },
  sleepy: { all: [['olhos-fechados-baixo'], 1] },
  hurt: { all: [['dano-golpe', 'dano-ferido'], 5] },
  faint: { all: [['desmaio-0', 'desmaio-1', 'desmaio-2', 'desmaio-3'], 2.4] },
  potion: { all: [['pocao-0', 'pocao-1', 'pocao-2', 'pocao-2', 'pocao-3'], 4] },
  chest: { all: [['bau-perto', 'bau-abaixar', 'bau-abrir-1', 'bau-abrir-2', 'bau-abrir-2'], 4] },
};
const ONE_SHOT = ['faint', 'potion', 'chest'];

// ------------------------------------------------------------
//  Estado
// ------------------------------------------------------------
const game = {
  state: 'loading', // loading | title | play | dialog | pause | fade
  time: 0,
  night: false,
  coins: 0,
  potions: 0,
  chestsOpened: 0,
  dialog: null,
  fade: null,
  shake: 0,
};

let world = null;
let player = null;
const camera = { x: 0, y: 0 };
let particles = [];

function newPlayer() {
  return {
    x: world.spawn.x, y: world.spawn.y, vx: 0, vy: 0,
    facing: 'down', state: 'idle', t: 0, stateT: 0,
    hp: MAX_HP, inv: 0, idleT: 0, attackHit: false, target: null, chest: null,
  };
}

function startGame() {
  world = buildWorld();
  world.chestsTotal = world.objects.filter((o) => o.kind === 'bau').length;
  player = newPlayer();
  game.coins = 0;
  game.potions = 0;
  game.chestsOpened = 0;
  game.night = false;
  particles = [];
  snapCamera();
  game.state = 'play';
  openDialog('intro');
}

// ------------------------------------------------------------
//  Colisão
// ------------------------------------------------------------
function footBox(o) {
  if (!o.solid || !o.foot) return null;
  if (!o.fb) {
    const s = spriteSize(o.sprite);
    const w = (o.w || s.w * o.scale) * o.foot[0];
    const h = Math.max(10, (o.h || s.h * o.scale) * o.foot[1]);
    o.fb = { x: o.x - w / 2, y: o.y - h, w, h };
  }
  return o.fb;
}

function groundAt(px, py) {
  const tx = Math.floor(px / T);
  const ty = Math.floor(py / T);
  if (tx < 0 || ty < 0 || tx >= world.w || ty >= world.h) return null;
  return world.ground[ty][tx];
}

function blocked(x, y) {
  const b = { x: x - 12, y: y - 12, w: 24, h: 12 };
  if (b.x < 8 || b.y < 8 || b.x + b.w > world.w * T - 8 || b.y + b.h > world.h * T - 4) return true;
  for (const o of world.objects) {
    const f = footBox(o);
    if (f && overlap(b, f)) return true;
  }
  return false;
}

// ------------------------------------------------------------
//  Diálogos
// ------------------------------------------------------------
function openDialog(key, onClose) {
  const lines = typeof key === 'string' ? DIALOGS[key] : key;
  game.dialog = { lines, i: 0, chars: 0, onClose };
  game.state = 'dialog';
  if (player) { player.vx = 0; player.vy = 0; }
}

function updateDialog(dt) {
  const d = game.dialog;
  const full = d.lines[d.i][1];
  const before = Math.floor(d.chars);
  d.chars = Math.min(full.length, d.chars + dt * 55);
  if (Math.floor(d.chars) > before && Math.floor(d.chars) % 3 === 0) Sound.blip();
  if (Input.hit('action') || Input.hit('attack')) {
    if (d.chars < full.length) d.chars = full.length;
    else if (d.i < d.lines.length - 1) { d.i += 1; d.chars = 0; } else {
      game.dialog = null;
      game.state = 'play';
      if (d.onClose) d.onClose();
    }
  }
}

// ------------------------------------------------------------
//  Transição (escurece -> ação -> clareia)
// ------------------------------------------------------------
function fadeTo(mid, { hold = 0.6, scene = null, after = null } = {}) {
  game.fade = { t: 0, mid, hold, done: false, scene, after };
  game.state = 'fade';
}

function updateFade(dt) {
  const f = game.fade;
  f.t += dt;
  if (!f.done && f.t >= 0.6) { f.done = true; f.mid(); }
  if (f.t >= 1.2 + f.hold) {
    game.fade = null;
    game.state = 'play';
    if (f.after) openDialog(f.after);
  }
}

function fadeAlpha() {
  const f = game.fade;
  if (!f) return 0;
  if (f.t < 0.6) return f.t / 0.6;
  if (f.t < 0.6 + f.hold) return 1;
  return Math.max(0, 1 - (f.t - 0.6 - f.hold) / 0.6);
}

// ------------------------------------------------------------
//  Partículas
// ------------------------------------------------------------
function burst(x, y, color, n = 10, speed = 120, life = 0.6, grav = 300) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = speed * rand(0.3, 1);
    particles.push({
      x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - speed * 0.4,
      life: life * rand(0.6, 1.2), max: life, color, size: rand(2, 4), grav,
    });
  }
}

function floatText(str, x, y, color) {
  particles.push({ x, y, vx: 0, vy: -40, life: 1.1, max: 1.1, text: str, color, grav: 0 });
}

function updateParticles(dt) {
  for (const p of particles) {
    p.life -= dt;
    p.vy += p.grav * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
  particles = particles.filter((p) => p.life > 0);
}

// ------------------------------------------------------------
//  Jogador
// ------------------------------------------------------------
const DIRS = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] };

function setState(s) {
  if (player.state !== s) { player.state = s; player.stateT = 0; }
}

const busy = () => ['attack', 'hurt', 'faint', 'potion', 'chest'].includes(player.state);

function frontPoint(dist = 34) {
  const [dx, dy] = DIRS[player.facing];
  return { x: player.x + dx * dist, y: player.y - 8 + dy * dist };
}

function findTarget() {
  const fp = frontPoint();
  let best = null;
  let bestD = 1e9;
  for (const o of world.objects) {
    if (!o.talk && !o.kind) continue;
    if (o.kind === 'mato' || o.kind === 'fogo') continue;
    const f = footBox(o) || { x: o.x - 20, y: o.y - 20, w: 40, h: 20 };
    const pad = 22;
    if (fp.x > f.x - pad && fp.x < f.x + f.w + pad && fp.y > f.y - pad && fp.y < f.y + f.h + pad) {
      const d = Math.hypot(fp.x - (f.x + f.w / 2), fp.y - (f.y + f.h / 2));
      if (d < bestD) { bestD = d; best = o; }
    }
  }
  return best;
}

function interact(o) {
  const p = player;
  if (o.kind === 'bau') {
    if (o.opened) { openDialog('bauVazio'); return; }
    p.chest = o;
    if (p.facing === 'down') {
      // animação completa com o baú (o baú do mapa some enquanto isso)
      o.hidden = true;
      p.x = o.x;
      setState('chest');
    } else {
      setState('sit');
      p.stateT = 0;
      p.chestQuick = true;
    }
    return;
  }
  if (o.kind === 'banco') {
    p.x = o.x;
    p.y = o.y + 2;
    p.facing = o.facing || 'down';
    setState('sit');
    return;
  }
  if (o.kind === 'casa') { openDialog('casa', () => sleep()); return; }
  if (o.kind === 'poco') {
    p.hp = Math.min(MAX_HP, p.hp + 1);
    openDialog('poco');
    return;
  }
  if (o.kind === 'sino') {
    o.ringT = 2.4;
    Sound.bell();
    openDialog('sino');
    return;
  }
  if (o.talk) openDialog(o.talk);
}

function finishChest(o) {
  o.opened = true;
  o.hidden = false;
  o.sprite = 'bau-aberto';
  o.daySprite = 'bau-aberto';
  game.chestsOpened += 1;
  const loot = o.loot || { coins: 10 };
  game.coins += loot.coins || 0;
  game.potions += loot.potion || 0;
  Sound.chest();
  burst(o.x, o.y - 20, '#ffd34d', 18, 140, 0.8, 200);
  floatText(`+${loot.coins} moedas`, o.x, o.y - 40, '#ffe58a');
  const lines = [['feliz', `Encontrei ${loot.coins} moedas de ouro${loot.potion ? ' e uma poção de vida' : ''}!`]];
  if (game.chestsOpened === world.chestsTotal) lines.push(...DIALOGS.todosBaus);
  else lines.push(['neutro', `Baús encontrados: ${game.chestsOpened} de ${world.chestsTotal}.`]);
  openDialog(lines);
}

function sleep() {
  Sound.sleep();
  fadeTo(() => {
    game.night = !game.night;
    applyDayNight();
    player.hp = MAX_HP;
    player.x = world.home.x;
    player.y = world.home.y + 40;
    player.facing = 'down';
    setState('idle');
    snapCamera();
  }, { hold: 2.2, scene: 'sleep' });
}

function applyDayNight() {
  for (const o of world.objects) {
    if (!o.daySprite) o.daySprite = o.sprite;
    o.sprite = game.night && NIGHT_SPRITES[o.daySprite] ? NIGHT_SPRITES[o.daySprite] : o.daySprite;
  }
}

function hurt(fromX, fromY) {
  const p = player;
  if (p.inv > 0 || p.state === 'faint') return;
  p.hp -= 1;
  p.inv = 1.3;
  game.shake = 8;
  Sound.hurt();
  burst(p.x, p.y - 40, '#ff6b7d', 12, 140);
  floatText('-1 ♥', p.x, p.y - 80, '#ff8a9a');
  const d = Math.hypot(p.x - fromX, p.y - fromY) || 1;
  p.vx = ((p.x - fromX) / d) * 260;
  p.vy = ((p.y - fromY) / d) * 260;
  if (p.hp <= 0) {
    p.hp = 0;
    setState('faint');
    Sound.faint();
  } else {
    setState('hurt');
  }
}

function tryMove(dx, dy) {
  const p = player;
  if (dx && !blocked(p.x + dx, p.y)) p.x += dx;
  if (dy && !blocked(p.x, p.y + dy)) p.y += dy;
}

function slash() {
  const fp = frontPoint(40);
  const hit = { x: fp.x - 36, y: fp.y - 34, w: 72, h: 76 };
  let cut = 0;
  for (const o of world.objects) {
    if (o.kind !== 'mato' || o.cut) continue;
    if (o.x > hit.x && o.x < hit.x + hit.w && o.y > hit.y && o.y < hit.y + hit.h) {
      o.cut = true;
      cut += 1;
      burst(o.x, o.y - 14, '#5fbf4a', 14, 150, 0.6, 350);
      if (Math.random() < 0.35) {
        const c = 1 + Math.floor(Math.random() * 3);
        game.coins += c;
        floatText(`+${c}`, o.x, o.y - 30, '#ffe58a');
        Sound.coin();
      }
    }
  }
  if (cut) {
    Sound.cut();
    world.objects = world.objects.filter((o) => !o.cut);
  }
}

function updatePlayer(dt) {
  const p = player;
  p.t += dt;
  p.stateT += dt;
  if (p.inv > 0) p.inv -= dt;

  // Estados com duração própria
  switch (p.state) {
    case 'attack':
      if (!p.attackHit && p.stateT > 0.08) { p.attackHit = true; slash(); }
      if (p.stateT > 0.32) setState('idle');
      return;
    case 'hurt':
      tryMove(p.vx * dt, p.vy * dt);
      p.vx *= 0.85;
      p.vy *= 0.85;
      if (p.stateT > 0.45) setState('idle');
      return;
    case 'faint':
      if (p.stateT > 2.4 && !game.fade) {
        fadeTo(() => {
          p.hp = MAX_HP;
          p.inv = 0;
          p.x = world.home.x;
          p.y = world.home.y + 40;
          p.facing = 'down';
          setState('idle');
          snapCamera();
        }, { hold: 0.8, after: 'acordou' });
      }
      return;
    case 'potion':
      if (p.stateT > 1.25) {
        setState('idle');
        p.hp = Math.min(MAX_HP, p.hp + 2);
        burst(p.x, p.y - 40, '#ff6b8a', 16, 100, 0.8, -60);
        floatText('+2 ♥', p.x, p.y - 84, '#ff9fb2');
      }
      return;
    case 'chest':
      if (p.stateT > 1.25) { setState('idle'); finishChest(p.chest); }
      return;
    default:
      break;
  }
  if (p.chestQuick) {
    if (p.stateT > 0.5) { p.chestQuick = false; setState('idle'); finishChest(p.chest); }
    return;
  }

  // Comandos
  const inWater = isWater(groundAt(p.x, p.y - 6));
  if (Input.hit('attack') && !inWater) {
    setState('attack');
    p.attackHit = false;
    Sound.swing();
    return;
  }
  if (Input.hit('potion')) {
    if (game.potions <= 0) openDialog('semPocao');
    else if (p.hp >= MAX_HP) openDialog('vidaCheia');
    else { game.potions -= 1; p.facing = 'down'; setState('potion'); Sound.potion(); }
    return;
  }
  if (Input.hit('sit') && !inWater) {
    setState(p.state === 'sit' ? 'idle' : 'sit');
    return;
  }
  p.target = inWater ? null : findTarget();
  if (Input.hit('action') && p.target) {
    interact(p.target);
    return;
  }

  // Movimento
  let mx = (Input.is('right') ? 1 : 0) - (Input.is('left') ? 1 : 0);
  let my = (Input.is('down') ? 1 : 0) - (Input.is('up') ? 1 : 0);
  if (mx && my) { mx *= Math.SQRT1_2; my *= Math.SQRT1_2; }
  const moving = mx !== 0 || my !== 0;
  if (p.state === 'sit' && !moving) return;

  if (moving) {
    if (Math.abs(mx) > Math.abs(my)) p.facing = mx > 0 ? 'right' : 'left';
    else p.facing = my > 0 ? 'down' : 'up';
    const speed = inWater ? SWIM_SPEED : (Input.is('run') ? RUN_SPEED : WALK_SPEED);
    tryMove(mx * speed * dt, my * speed * dt);
    p.idleT = 0;
  } else {
    p.idleT += dt;
  }

  const nowWater = isWater(groundAt(p.x, p.y - 6));
  const wasSwim = p.state === 'swim';
  if (nowWater) setState('swim');
  else if (moving) setState(Input.is('run') ? 'run' : 'walk');
  else setState(p.idleT > 12 ? 'sleepy' : 'idle');

  if (nowWater && !wasSwim) { Sound.splash(); burst(p.x, p.y - 10, '#bfe9ff', 14, 120, 0.5, 300); }
  if (nowWater && moving && Math.random() < dt * 8) burst(p.x + rand(-14, 14), p.y - 6, '#dff4ff', 1, 30, 0.6, 0);
  if (!nowWater && p.state === 'run' && Math.random() < dt * 10) {
    particles.push({
      x: p.x + rand(-8, 8), y: p.y - 2, vx: rand(-20, 20), vy: rand(-30, -5),
      life: 0.4, max: 0.4, color: 'rgba(200,180,140,0.7)', size: 3, grav: 0,
    });
  }

  // A fogueira queima
  for (const o of world.objects) {
    if (o.kind === 'fogo' && Math.hypot(p.x - o.x, p.y - (o.y - 10)) < 30) hurt(o.x, o.y - 10);
  }
}

// ------------------------------------------------------------
//  Câmera
// ------------------------------------------------------------
function camTarget() {
  return {
    x: clamp(player.x - VIEW_W / 2, 0, world.w * T - VIEW_W),
    y: clamp(player.y - 40 - VIEW_H / 2, 0, world.h * T - VIEW_H),
  };
}
function snapCamera() { const t = camTarget(); camera.x = t.x; camera.y = t.y; }
function updateCamera(dt) {
  const t = camTarget();
  camera.x = lerp(camera.x, t.x, Math.min(1, dt * 7));
  camera.y = lerp(camera.y, t.y, Math.min(1, dt * 7));
}

// ------------------------------------------------------------
//  Atualização
// ------------------------------------------------------------
function update(dt) {
  game.time += dt;
  if (game.shake > 0) game.shake = Math.max(0, game.shake - dt * 30);
  if (Input.hit('mute')) Sound.toggleMute();

  switch (game.state) {
    case 'loading':
      if (loaded >= 2) game.state = 'title';
      break;
    case 'title':
      if (Input.hit('action') || Input.hit('attack')) { Sound.blip(); startGame(); }
      break;
    case 'play':
      if (Input.hit('pause')) { game.state = 'pause'; break; }
      updatePlayer(dt);
      break;
    case 'dialog':
      updateDialog(dt);
      break;
    case 'pause':
      if (Input.hit('pause') || Input.hit('action')) game.state = 'play';
      break;
    case 'fade':
      updateFade(dt);
      break;
    default:
      break;
  }

  if (world && player && game.state !== 'title') {
    for (const o of world.objects) if (o.ringT > 0) o.ringT -= dt;
    updateParticles(dt);
    updateCamera(dt);
  }
}

// ============================================================
//  Renderização
// ============================================================
function drawGround(cx, cy) {
  const x0 = Math.max(0, Math.floor(cx / T));
  const y0 = Math.max(0, Math.floor(cy / T));
  const x1 = Math.min(world.w - 1, Math.floor((cx + VIEW_W) / T));
  const y1 = Math.min(world.h - 1, Math.floor((cy + VIEW_H) / T));
  const per = TILES.perRow;
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const k = TILES.tiles[world.tiles[ty][tx]];
      if (k === undefined) continue;
      ctx.drawImage(images.tiles, (k % per) * T, Math.floor(k / per) * T, T, T, tx * T - cx, ty * T - cy, T, T);
    }
  }
  // reflexos na água
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (!isWater(world.ground[ty][tx])) continue;
      const off = (game.time * 18 + tx * 23 + ty * 7) % 48;
      ctx.fillRect(tx * T - cx + ((tx * 17) % 30), ty * T - cy + 8 + off, 22, 2);
    }
  }
}

function objectSprite(o) {
  if (o.anim && o.ringT > 0) return o.anim[Math.floor(game.time * 6) % o.anim.length];
  return o.sprite;
}

function drawObject(o, cx, cy) {
  const s = spriteSize(o.sprite);
  const w = o.w || s.w * o.scale;
  const h = o.h || s.h * o.scale;
  const sx = o.x - cx;
  const sy = o.y - cy;
  if (sx + w / 2 < -20 || sx - w / 2 > VIEW_W + 20 || sy < -20 || sy - h > VIEW_H + 20) return;
  if (o.kind === 'mato') {
    // balança ao vento
    ctx.save();
    ctx.translate(sx, sy);
    ctx.transform(1, 0, Math.sin(game.time * 2 + o.x * 0.05) * 0.08, 1, 0, 0);
    drawSprite(o.sprite, 0, 0, { scale: o.scale });
    ctx.restore();
    return;
  }
  if (o.solid && o.foot) {
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.ellipse(sx, sy - 4, w * 0.42, Math.min(14, h * 0.08), 0, 0, Math.PI * 2);
    ctx.fill();
  }
  drawSprite(objectSprite(o), sx, sy, { scale: o.scale, w: o.w, h: o.h });
  if (o.kind === 'fogo' && Math.random() < 0.25) {
    particles.push({
      x: o.x + rand(-10, 10), y: o.y - 30, vx: rand(-10, 10), vy: rand(-60, -30), life: 0.8, max: 0.8,
      color: Math.random() < 0.5 ? '#ffb347' : '#ff6a2a', size: rand(2, 3.5), grav: -20,
    });
  }
}

function playerFrame() {
  const p = player;
  const set = ANIM[p.state] || ANIM.idle;
  const [frames, fps, flip] = set.all || set[p.facing];
  const i = ONE_SHOT.includes(p.state)
    ? Math.min(frames.length - 1, Math.floor(p.stateT * fps))
    : Math.floor(p.t * fps) % frames.length;
  return { name: frames[i], flip: !!flip };
}

function drawPlayer(cx, cy) {
  const p = player;
  if (p.inv > 0 && p.state !== 'faint' && Math.floor(p.inv * 12) % 2 === 0) return;
  const sx = p.x - cx;
  const sy = p.y - cy;
  const f = playerFrame();
  if (p.state === 'swim') {
    // só a parte de cima aparece fora d'água
    ctx.save();
    ctx.beginPath();
    ctx.rect(sx - 60, sy - 130, 120, 112);
    ctx.clip();
    drawSprite(f.name, sx, sy + 4 + Math.sin(game.time * 4) * 2, { flip: f.flip });
    ctx.restore();
    ctx.strokeStyle = 'rgba(230,248,255,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(sx, sy - 18, 24 + Math.sin(game.time * 5) * 3, 7, 0, 0, Math.PI * 2);
    ctx.stroke();
    return;
  }
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(sx, sy - 2, 18, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  drawSprite(f.name, sx, sy, { flip: f.flip });
  // rastro do golpe
  if (p.state === 'attack' && p.stateT < 0.22) {
    const fp = frontPoint(30);
    const a = 1 - p.stateT / 0.22;
    const base = { down: Math.PI / 2, up: -Math.PI / 2, left: Math.PI, right: 0 }[p.facing];
    ctx.strokeStyle = `rgba(255,255,255,${0.8 * a})`;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(fp.x - cx, fp.y - cy - 20, 30, base - 1.1, base + 1.1);
    ctx.stroke();
  }
}

// Noite: escurece tudo e abre "buracos" de luz
const nightCanvas = document.createElement('canvas');
nightCanvas.width = VIEW_W;
nightCanvas.height = VIEW_H;
const nctx = nightCanvas.getContext('2d');

function drawNight(cx, cy) {
  nctx.globalCompositeOperation = 'source-over';
  nctx.clearRect(0, 0, VIEW_W, VIEW_H);
  nctx.fillStyle = 'rgba(8,14,48,0.62)';
  nctx.fillRect(0, 0, VIEW_W, VIEW_H);
  nctx.globalCompositeOperation = 'destination-out';
  const lights = [{ x: player.x, y: player.y - 40, r: 110, own: true }];
  for (const o of world.objects) {
    const r = LIGHTS[o.daySprite || o.sprite];
    if (!r) continue;
    const s = spriteSize(o.sprite);
    const lamp = (o.daySprite || o.sprite) === 'praca-21';
    const ly = o.kind === 'fogo' ? o.y - 20 : o.y - s.h * o.scale * (lamp ? 0.8 : 0.3);
    lights.push({ x: o.x, y: ly, r: r * (o.kind === 'fogo' ? 1 + Math.sin(game.time * 13) * 0.05 : 1) });
  }
  const visible = lights.filter((l) => {
    const x = l.x - cx;
    const y = l.y - cy;
    return x > -l.r && x < VIEW_W + l.r && y > -l.r && y < VIEW_H + l.r;
  });
  for (const l of visible) {
    const x = l.x - cx;
    const y = l.y - cy;
    const g = nctx.createRadialGradient(x, y, 0, x, y, l.r);
    g.addColorStop(0, 'rgba(0,0,0,0.95)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    nctx.fillStyle = g;
    nctx.fillRect(x - l.r, y - l.r, l.r * 2, l.r * 2);
  }
  ctx.drawImage(nightCanvas, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const l of visible) {
    if (l.own) continue;
    const x = l.x - cx;
    const y = l.y - cy;
    const g = ctx.createRadialGradient(x, y, 0, x, y, l.r * 0.6);
    g.addColorStop(0, 'rgba(255,170,70,0.18)');
    g.addColorStop(1, 'rgba(255,170,70,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - l.r, y - l.r, l.r * 2, l.r * 2);
  }
  ctx.restore();
}

function interactLabel(o) {
  if (o.kind === 'bau') return o.opened ? 'Olhar' : 'Abrir';
  if (o.kind === 'banco') return 'Sentar';
  if (o.kind === 'casa') return 'Dormir';
  if (o.kind === 'sino') return 'Tocar';
  if (o.kind === 'poco') return 'Beber';
  return 'Ver';
}

function drawWorld() {
  const sh = game.shake;
  const cx = Math.round(camera.x + (sh ? rand(-sh, sh) : 0));
  const cy = Math.round(camera.y + (sh ? rand(-sh, sh) : 0));
  ctx.fillStyle = '#2d5a27';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  drawGround(cx, cy);

  // decalques no chão (ponte, vitórias-régias)
  for (const o of world.objects) if (o.ground) drawObject(o, cx, cy);

  // ordena por profundidade (y da base)
  const list = world.objects.filter((o) => !o.ground && !o.hidden);
  list.push({ isPlayer: true, y: player.y });
  list.sort((a, b) => a.y - b.y);
  for (const o of list) {
    if (o.isPlayer) drawPlayer(cx, cy);
    else drawObject(o, cx, cy);
  }

  for (const p of particles) {
    ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
    if (p.text) text(p.text, p.x - cx, p.y - cy, { size: 16, align: 'center', color: p.color });
    else {
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - cx - p.size / 2, p.y - cy - p.size / 2, p.size, p.size);
    }
  }
  ctx.globalAlpha = 1;

  if (game.night) drawNight(cx, cy);

  // indicador de interação
  if (game.state === 'play' && player.target && !busy() && !player.chestQuick) {
    const o = player.target;
    const s = spriteSize(o.sprite);
    const top = o.y - (o.h || s.h * o.scale) - cy;
    const bob = Math.sin(game.time * 5) * 3;
    const key = isTouch() ? 'A' : 'E';
    const tx = clamp(o.x - cx, 60, VIEW_W - 60);
    const ty = clamp(top - 10 + bob, 84, VIEW_H - 20);
    ctx.fillStyle = 'rgba(10,16,40,0.85)';
    roundRect(tx - 50, ty - 22, 100, 28, 8);
    ctx.fill();
    text(`${key}: ${interactLabel(o)}`, tx, ty - 3, { size: 15, align: 'center' });
  }
}

// ------------------------------------------------------------
//  HUD, diálogo e telas
// ------------------------------------------------------------
function text(str, x, y, { size = 18, color = '#fff', align = 'left', weight = 'bold', shadow = true } = {}) {
  ctx.font = `${weight} ${size}px "Trebuchet MS", "Segoe UI", sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  if (shadow) { ctx.fillStyle = 'rgba(0,0,20,0.65)'; ctx.fillText(str, x + 2, y + 2); }
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
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

function heart(x, y, s, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.35);
  ctx.bezierCurveTo(x, y, x - s * 0.5, y, x - s * 0.5, y + s * 0.3);
  ctx.bezierCurveTo(x - s * 0.5, y + s * 0.6, x, y + s * 0.8, x, y + s);
  ctx.bezierCurveTo(x, y + s * 0.8, x + s * 0.5, y + s * 0.6, x + s * 0.5, y + s * 0.3);
  ctx.bezierCurveTo(x + s * 0.5, y, x, y, x, y + s * 0.35);
  ctx.fill();
}

function drawHUD() {
  ctx.fillStyle = 'rgba(8,14,40,0.62)';
  roundRect(12, 10, 400, 44, 10);
  ctx.fill();
  for (let i = 0; i < MAX_HP; i++) heart(34 + i * 26, 20, 22, i < player.hp ? '#ff4d6d' : 'rgba(255,255,255,0.18)');
  // moeda
  ctx.fillStyle = '#ffd34d';
  ctx.beginPath();
  ctx.arc(178, 32, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#c99a1e';
  ctx.fillRect(176, 27, 4, 10);
  text(`${game.coins}`, 194, 39);
  // poção
  ctx.fillStyle = '#e0365a';
  ctx.beginPath();
  ctx.arc(256, 35, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#d9e3f5';
  ctx.fillRect(253, 21, 6, 7);
  text(`${game.potions}`, 270, 39);
  text(game.night ? '☾ Noite' : '☀ Dia', 318, 39, { size: 16, color: game.night ? '#bcd0ff' : '#ffe58a' });
  ctx.fillStyle = 'rgba(8,14,40,0.62)';
  roundRect(VIEW_W - 140, 10, 128, 44, 10);
  ctx.fill();
  text(`Baús ${game.chestsOpened}/${world.chestsTotal}`, VIEW_W - 76, 38, { size: 17, align: 'center', color: '#e6f0ff' });
  if (Sound.muted) text('som desligado (M)', VIEW_W - 16, 74, { size: 12, align: 'right', color: '#9fb0d0', weight: 'normal' });
}

function wrap(str, maxW) {
  const words = str.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawDialog() {
  const d = game.dialog;
  const [mood, full] = d.lines[d.i];
  const shown = full.slice(0, Math.floor(d.chars));
  const h = 150;
  const x = 40;
  const y = VIEW_H - h - 16;
  const w = VIEW_W - 80;
  ctx.fillStyle = 'rgba(12,20,56,0.94)';
  roundRect(x, y, w, h, 14);
  ctx.fill();
  ctx.strokeStyle = '#7aa2ff';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  roundRect(x + 14, y + 14, 122, 122, 10);
  ctx.fill();
  const r = ATLAS[`retrato-${mood}`];
  if (r) {
    const s = Math.min(116 / r[2], 116 / r[3]);
    ctx.drawImage(images.atlas, r[0], r[1], r[2], r[3], x + 75 - (r[2] * s) / 2, y + 133 - r[3] * s, r[2] * s, r[3] * s);
  }
  text('Rei Azul', x + 156, y + 36, { size: 18, color: '#8fb4ff' });
  ctx.font = 'normal 20px "Trebuchet MS", sans-serif';
  wrap(shown, w - 180).forEach((ln, i) => text(ln, x + 156, y + 68 + i * 26, { size: 20, weight: 'normal' }));
  if (d.chars >= full.length && Math.sin(game.time * 6) > 0) {
    text('▼', x + w - 26, y + h - 14, { size: 16, align: 'center', color: '#ffe58a' });
  }
}

function drawFadeScene() {
  const a = fadeAlpha();
  if (a <= 0) return;
  ctx.fillStyle = `rgba(2,4,14,${a})`;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  if (game.fade && game.fade.scene === 'sleep' && a > 0.6) {
    ctx.globalAlpha = (a - 0.6) / 0.4;
    drawSprite('cama', VIEW_W / 2, VIEW_H / 2 + 110, { scale: 2.2 });
    for (let i = 0; i < 3; i++) {
      const t = (game.time * 0.8 + i / 3) % 1;
      text('z', VIEW_W / 2 + 70 + t * 50, VIEW_H / 2 - 70 - t * 80, { size: 18 + t * 22, color: `rgba(200,220,255,${1 - t})` });
    }
    ctx.globalAlpha = 1;
  }
}

const isTouch = () => document.body.classList.contains('touch');

let titleWorld = null;
function drawTitle() {
  if (!titleWorld) titleWorld = buildWorld();
  const w = titleWorld;
  const cx = Math.round((Math.sin(game.time * 0.05) * 0.5 + 0.5) * (w.w * T - VIEW_W));
  const cy = 10 * T;
  const saved = world;
  world = w;
  drawGround(cx, cy);
  for (const o of w.objects.filter((ob) => ob.ground)) drawObject(o, cx, cy);
  for (const o of w.objects.filter((ob) => !ob.ground).sort((a, b) => a.y - b.y)) drawObject(o, cx, cy);
  world = saved;
  ctx.fillStyle = 'rgba(6,10,36,0.55)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  const bob = Math.sin(game.time * 2) * 4;
  text('BLUE CASTLE', VIEW_W / 2, 140 + bob, { size: 76, align: 'center', color: '#e6f0ff' });
  text('O Reino Azul', VIEW_W / 2, 180 + bob, { size: 24, align: 'center', color: '#8fb4ff' });
  drawSprite('corpo-feliz', VIEW_W / 2, 350, { scale: 1.3 });
  if (Math.sin(game.time * 5) > -0.3) {
    text(isTouch() ? 'Toque para começar' : 'Pressione Enter para começar', VIEW_W / 2, 400, { size: 22, align: 'center', color: '#ffe58a' });
  }
  const help = isTouch()
    ? 'Direcional: andar · A: interagir · B: atacar · R: correr · ♥: poção'
    : 'WASD/Setas andar · Shift correr · Espaço atacar · E interagir · Q poção · C sentar · M som';
  text(help, VIEW_W / 2, 462, { size: 15, align: 'center', color: '#c6d6ff', weight: 'normal' });
  text('Explore a vila, encontre os 4 baús escondidos e cuidado com a fogueira!', VIEW_W / 2, 490, { size: 15, align: 'center', color: '#9fb8ee', weight: 'normal' });
}

function render() {
  ctx.imageSmoothingEnabled = false;
  if (game.state === 'loading') {
    ctx.fillStyle = '#060b24';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    text('Carregando...', VIEW_W / 2, VIEW_H / 2, { size: 24, align: 'center' });
    return;
  }
  if (game.state === 'title') { drawTitle(); return; }
  drawWorld();
  drawHUD();
  if (game.state === 'dialog') drawDialog();
  if (game.state === 'pause') {
    ctx.fillStyle = 'rgba(4,8,28,0.6)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    text('Pausado', VIEW_W / 2, VIEW_H / 2, { size: 48, align: 'center' });
    text('P / Esc para continuar', VIEW_W / 2, VIEW_H / 2 + 40, { size: 18, align: 'center', color: '#c6d6ff', weight: 'normal' });
  }
  drawFadeScene();
}

// ------------------------------------------------------------
//  Loop principal
// ------------------------------------------------------------
let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;
  update(dt);
  render();
  Input.pressed.clear();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Exposto para depuração/testes
window.BlueCastle = {
  game, Input, get world() { return world; }, get player() { return player; }, interact, sleep,
};
