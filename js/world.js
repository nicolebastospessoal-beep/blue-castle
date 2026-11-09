'use strict';
/*
 * Mapa da vila (visão de cima). Gerado por código a partir de regras simples:
 * chão em uma grade de tiles 64x64 e objetos (prédios, árvores, decoração)
 * posicionados pela base (ponto do pé, centralizado).
 */

const T = 64;
const MAP_W = 44;
const MAP_H = 33;

// Tipos de chão
const G = {
  GRASS: '.', STONE: '#', DIRT: ':', SAND: 's', RIVER: '~', POND: 'w', FLOWER: 'f',
  PLOW: 'p', CROP: 'c', BRIDGE: 'b',
};

const TILESETS = {
  [G.GRASS]: ['chao-01-0-1', 'chao-01-0-2', 'chao-01-0-3', 'chao-01-0-1', 'chao-01-0-2', 'chao-01-0-3',
    'chao-01-0-0', 'chao-01-0-4', 'chao-01-5-0', 'chao-03-0-0', 'chao-03-5-0', 'chao-02-4-3'],
  [G.STONE]: ['chao-01-2-0', 'chao-01-2-1', 'chao-01-2-2', 'chao-01-2-3', 'chao-01-2-4', 'chao-01-2-5'],
  [G.DIRT]: ['chao-01-1-0', 'chao-01-1-1', 'chao-01-1-2', 'chao-01-1-3'],
  [G.SAND]: ['chao-01-3-0', 'chao-01-3-1', 'chao-01-3-2', 'chao-01-3-3', 'chao-01-3-4', 'chao-01-3-5'],
  [G.RIVER]: ['chao-01-4-0', 'chao-01-4-1', 'chao-01-4-2', 'chao-01-4-3', 'chao-01-4-4'],
  [G.POND]: ['chao-01-4-5', 'chao-01-4-6', 'chao-01-4-7', 'chao-01-4-8', 'chao-01-4-9'],
  [G.BRIDGE]: ['chao-01-4-2'],
  [G.FLOWER]: ['chao-02-4-0', 'chao-02-4-1', 'chao-02-4-2'],
  [G.PLOW]: ['plantacao-0-0', 'plantacao-0-4'],
  [G.CROP]: ['plantacao-1-3', 'plantacao-1-4', 'plantacao-2-3', 'plantacao-2-4', 'plantacao-2-7',
    'plantacao-3-6', 'plantacao-3-7', 'plantacao-4-4', 'plantacao-5-4', 'plantacao-4-7', 'plantacao-5-7'],
};

const isWater = (g) => g === G.RIVER || g === G.POND;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Variações noturnas dos sprites (dia -> noite)
const NIGHT_SPRITES = {
  'casa-dia': 'casa-noite',
  'taverna-dia': 'taverna-noite',
  'catedral-dia': 'catedral-noite',
  'praca-21': 'praca-22', // poste apagado -> aceso
};

// Fontes de luz à noite (sprite -> raio)
const LIGHTS = {
  'praca-21': 150, 'mercado-61': 190, 'mercado-39': 120, 'taverna-dia': 170, 'casa-dia': 130,
  'catedral-dia': 220, 'loja-pocoes': 120, 'ferreiro': 140, 'padaria': 110,
};

function buildWorld() {
  const rnd = mulberry32(2026);
  const ground = [];
  for (let y = 0; y < MAP_H; y++) ground.push(new Array(MAP_W).fill(G.GRASS));
  const set = (x0, y0, x1, y1, g) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) ground[y][x] = g;
    }
  };

  // Estradas e praça
  set(2, 15, 41, 16, G.STONE);
  set(21, 10, 22, 31, G.STONE);
  set(15, 11, 28, 21, G.STONE);
  set(15, 11, 16, 12, G.FLOWER); set(27, 11, 28, 12, G.FLOWER);
  set(15, 20, 16, 21, G.FLOWER); set(27, 20, 28, 21, G.FLOWER);
  // Rio com ponte
  set(0, 24, MAP_W - 1, 24, G.RIVER);
  set(21, 24, 22, 24, G.BRIDGE);
  // Lago com praia
  set(30, 26, 40, 31, G.SAND);
  set(32, 27, 38, 30, G.POND);
  // Fazenda
  set(3, 26, 15, 31, G.DIRT);
  for (let y = 27; y <= 30; y++) set(4, y, 14, y, y % 2 ? G.CROP : G.PLOW);
  // Trilha de terra até a fazenda
  set(15, 28, 20, 28, G.DIRT);

  // Escolhe a variação de cada tile uma vez
  const tiles = ground.map((row) => row.map((g) => {
    const list = TILESETS[g];
    return list[Math.floor(rnd() * list.length)];
  }));

  const objects = [];
  const add = (sprite, tx, ty, opt = {}) => {
    const o = {
      sprite, x: tx * T, y: ty * T, solid: true, foot: null, scale: 1, ...opt,
    };
    objects.push(o);
    return o;
  };

  // ---- Prédios (x = centro em tiles, y = linha da base em tiles) ----
  const B = { foot: [0.86, 0.42] };
  add('catedral-dia', 22, 10.2, { ...B, scale: 1.25, kind: 'catedral', talk: 'catedral' });
  add('sino-0', 27.6, 10.2, { foot: [0.7, 0.18], kind: 'sino', anim: ['sino-0', 'sino-1', 'sino-2', 'sino-3', 'sino-4'] });
  add('casa-dia', 4.2, 14.9, { ...B, kind: 'casa', talk: 'casa' });
  add('casa-azul', 9, 14.9, B);
  add('taverna-dia', 13.6, 14.9, { ...B, talk: 'taverna' });
  add('ferreiro', 31, 14.9, { ...B, talk: 'ferreiro' });
  add('padaria', 35.6, 14.9, { ...B, talk: 'padaria' });
  add('loja-pocoes', 40.3, 14.9, { ...B, talk: 'pocoes', kind: 'pocoes' });
  add('casa-madeira', 4.5, 22.6, B);
  add('casa-pedra', 9.3, 22.6, B);
  add('capela', 31.5, 22.6, B);
  add('estabulo', 36.4, 22.6, B);
  add('armazem', 40.8, 22.6, B);
  add('moinho', 17.8, 31.7, { foot: [0.5, 0.25] });
  add('poco', 13.6, 22.4, { foot: [0.6, 0.3], scale: 0.62, talk: 'poco', kind: 'poco' });
  add('carroca', 26.4, 22.5, { foot: [0.8, 0.3], scale: 0.62 });

  // ---- Praça ----
  add('praca-0', 21.5, 18.2, { foot: [0.85, 0.5], talk: 'fonte' });
  add('praca-2', 18.2, 13.5, { foot: [0.7, 0.45], scale: 0.62, talk: 'relogio' });
  add('praca-23', 25.4, 13.3, { foot: [0.9, 0.25], scale: 0.7, talk: 'avisos' });
  add('praca-6', 18, 20.4, { foot: [0.9, 0.5], kind: 'banco', facing: 'down' });
  add('praca-6', 25.5, 20.4, { foot: [0.9, 0.5], kind: 'banco', facing: 'down' });
  for (const [x, y] of [[17.5, 12.6], [26.5, 12.6], [17.5, 20.8], [26.5, 20.8]]) {
    add('praca-21', x, y, { foot: [0.25, 0.08], scale: 0.7 });
  }
  add('mercado-0', 24.2, 17.4, { foot: [0.95, 0.4], talk: 'feira' });
  add('mercado-1', 26.2, 17.4, { foot: [0.95, 0.4], talk: 'feira' });
  add('mercado-2', 17.2, 17.4, { foot: [0.95, 0.4], talk: 'feira' });
  add('mercado-3', 19.2, 17.4, { foot: [0.95, 0.4], talk: 'feira' });
  add('mercado-5', 28.6, 17.3, { foot: [0.9, 0.4], scale: 0.7 });
  add('mercado-41', 18.5, 22.8, { foot: [0.7, 0.2], scale: 0.7 });

  // ---- Sul do rio ----
  add('ponte-curta', 21.5, 25.25, { solid: false, ground: true, w: 2 * T + 12, h: T + 26 });
  add('mercado-61', 27.5, 28.4, { foot: [0.7, 0.5], kind: 'fogo', solid: false });
  add('mercado-4', 25.6, 27.6, { foot: [0.8, 0.4], scale: 0.6 });
  for (let x = 4; x <= 14; x += 2.6) add('cercas-0', x + 0.3, 26.15, { foot: [1, 0.3], scale: 1.08 });

  // ---- Baús ----
  add('bau-fechado', 2.5, 19.2, { kind: 'bau', foot: [0.9, 0.6], scale: 1.4, loot: { coins: 25, potion: 1 } });
  add('bau-fechado', 40.5, 29.5, { kind: 'bau', foot: [0.9, 0.6], scale: 1.4, loot: { coins: 40 } });
  add('bau-fechado', 17.5, 8.6, { kind: 'bau', foot: [0.9, 0.6], scale: 1.4, loot: { coins: 15, potion: 1 } });
  add('bau-fechado', 11.5, 32.4, { kind: 'bau', foot: [0.9, 0.6], scale: 1.4, loot: { coins: 60, potion: 1 } });

  // ---- Árvores na borda e bosques ----
  const TREES = ['arvore-carvalho', 'arvore-copa', 'arvore-pinheiro', 'arvore-betula', 'arvore-copa', 'arvore-pinheiro'];
  const tree = (x, y) => {
    const name = TREES[Math.floor(rnd() * TREES.length)];
    add(name, x, y, { foot: [0.28, 0.12], scale: 0.85 + rnd() * 0.25 });
  };
  for (let x = 0.6; x < MAP_W; x += 1.5 + rnd() * 0.7) {
    tree(x, 1.5 + rnd() * 1.2);
    if (rnd() < 0.5) tree(x + 0.6, 4.2 + rnd() * 1.5);
  }
  for (let y = 6; y < MAP_H; y += 1.6 + rnd() * 0.6) {
    if (y > 14.5 && y < 17.5) continue; // saídas da estrada
    if (y > 23.5 && y < 25.2) continue; // rio
    tree(0.5 + rnd() * 0.4, y);
    tree(MAP_W - 0.5 - rnd() * 0.4, y);
  }
  // bosque ao norte, entre as casas e a borda
  for (const [x, y] of [[3, 8], [6.5, 9], [9.5, 7.6], [12.8, 9.2], [29.5, 7.5], [33, 9], [36.5, 7.8], [40, 9.4], [32, 5.8], [7, 5.6]]) {
    tree(x, y);
  }
  // pequeno bosque ao sul
  for (const [x, y] of [[24.5, 31.3], [27.8, 31.8], [29.5, 30], [42, 26.5], [16.5, 26.5]]) tree(x, y);

  // ---- Vegetação (não sólida; mato alto pode ser cortado) ----
  const free = (tx, ty) => ground[ty] && ground[ty][tx] === G.GRASS
    && !objects.some((o) => o.solid && Math.abs(o.x - (tx + 0.5) * T) < 150 && Math.abs(o.y - (ty + 0.5) * T) < 110);
  const DECOR = ['vegetacao-23', 'vegetacao-24', 'vegetacao-25', 'vegetacao-26', 'vegetacao-33', 'vegetacao-35',
    'vegetacao-43', 'vegetacao-45', 'vegetacao-0', 'vegetacao-1', 'vegetacao-20', 'vegetacao-47', 'vegetacao-31'];
  const TALL = ['vegetacao-2', 'vegetacao-11', 'vegetacao-12', 'vegetacao-13'];
  for (let i = 0; i < 260; i++) {
    const tx = 1 + Math.floor(rnd() * (MAP_W - 2));
    const ty = 5 + Math.floor(rnd() * (MAP_H - 6));
    if (!free(tx, ty)) continue;
    const x = tx + 0.2 + rnd() * 0.6;
    const y = ty + 0.5 + rnd() * 0.5;
    if (rnd() < 0.35) {
      add(TALL[Math.floor(rnd() * TALL.length)], x, y, { solid: false, kind: 'mato', scale: 0.85 });
    } else {
      add(DECOR[Math.floor(rnd() * DECOR.length)], x, y, { solid: false, scale: 0.6 + rnd() * 0.2 });
    }
  }
  // pedras com musgo e taboas no lago
  for (const [x, y] of [[31.2, 27.2], [39.4, 30.8], [30.6, 30.6]]) add('vegetacao-52', x, y, { foot: [0.7, 0.4], scale: 0.8 });
  for (const [x, y] of [[33.2, 28.4], [36.8, 29.6], [35, 27.8]]) add('vegetacao-58', x, y, { solid: false, scale: 0.6, ground: true });

  return {
    w: MAP_W, h: MAP_H, ground, tiles, objects,
    spawn: { x: 4.2 * T, y: 16.2 * T },
    home: { x: 4.2 * T, y: 15.6 * T },
  };
}

// Textos das conversas (retrato, texto)
const DIALOGS = {
  intro: [
    ['feliz', 'Que manhã linda no reino! Hora de dar uma volta pela vila.'],
    ['neutro', 'Setas/WASD andam, Shift corre, Espaço ataca, E interage. Q bebe poção.'],
  ],
  casa: [['cansado', 'Minha casa... Uma soneca cairia bem. (Você dorme e o tempo passa.)']],
  taverna: [['feliz', 'A Taverna do Javali! Cheiro de pão quente e sopa de abóbora.']],
  catedral: [['neutro', 'A Catedral Azul, coração do reino. Os vitrais brilham à noite.']],
  ferreiro: [['bravo', 'O ferreiro está ocupado martelando. Melhor não atrapalhar!']],
  padaria: [['feliz', 'Pães fresquinhos! Quem sabe depois de juntar umas moedas...']],
  pocoes: [['neutro', 'Loja de poções. Lá dentro borbulha algo de cor duvidosa.']],
  poco: [['feliz', 'Água fresquinha do poço. Você se sente melhor! (+1 ♥)']],
  fonte: [['neutro', 'A fonte da praça. Dizem que dá sorte jogar uma moeda.']],
  relogio: [['neutro', 'Um relógio de sol. Só funciona de dia, naturalmente.']],
  avisos: [
    ['neutro', 'QUADRO DE AVISOS: "Procura-se: tesouros esquecidos pela vila."'],
    ['assustado', '"Cuidado com a fogueira perto do lago. Ela queima!"'],
  ],
  feira: [['feliz', 'Frutas, peixes e quinquilharias. A feira está animada hoje.']],
  sino: [['assustado', 'BLÉM! BLÉM! O sino ecoa pela vila inteira.']],
  bauVazio: [['neutro', 'Este baú já está vazio.']],
  semPocao: [['cansado', 'Não tenho nenhuma poção...']],
  vidaCheia: [['neutro', 'Estou bem, não preciso de poção agora.']],
  acordou: [['cansado', 'Ugh... Acordei em casa. Preciso tomar mais cuidado.']],
  todosBaus: [['feliz', 'Encontrei todos os tesouros da vila! Que dia!']],
};

if (typeof module !== 'undefined') module.exports = { buildWorld, DIALOGS, G, T };
