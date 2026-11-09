"""Recorta as folhas originais (assets/originais) e gera os assets do jogo.

Saída:
  assets/game/atlas.png + atlas.json  -> sprites (personagem, objetos, prédios...)
  assets/game/tiles.png + tiles.json  -> tiles de chão 64x64

Uso:  python3 tools/build_assets.py
"""
import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from spritelib import components, fg_mask  # noqa: E402

TILE = 64
OUT = 'assets/game'
CHAR_H = 76  # altura do personagem em pé, em px de jogo

# ---------------------------------------------------------------------------
# Configuração por folha: parâmetros do recorte e escala (px de jogo / px original)
# ---------------------------------------------------------------------------
SHEETS = {
    # personagem
    'rei-parado': dict(grid=False, ref=0),
    'rei-andando': dict(grid=True, ref=0),
    'rei-correndo': dict(grid=True, ref=0),
    'rei-ataque': dict(grid=True, ref_h=880),
    'rei-dano': dict(grid=True, ref=1),
    'rei-desmaio': dict(grid=True, ref_h=600),
    'rei-agachado': dict(grid=True, ref_h=880),
    'rei-dormindo': dict(grid=True, ref=3),
    'rei-bau': dict(grid=True, ref=0, ref_scale=1.12),
    'rei-pocao': dict(grid=True, line_rgb=(86, 54, 76), ref=0),
    'rei-nadando': dict(grid=True, water=True, ref_h=820),
    'rei-emocoes': dict(grid=True, ref=0, target=96),
    'rei-retratos': dict(grid=False, ref=0, target=120),
    'relogio': dict(grid=True, ref=0, target=84, char=True, circle=186,
                    cells=[(x, y) for y in (352, 794, 1282, 1748) for x in (254, 636, 1028, 1414, 1790)]),
    # cenário
    'arvores': dict(merge=0, scale=0.30),
    'casas-01': dict(scale=0.34),
    'casas-02': dict(scale=0.34),
    'casa-estados': dict(scale=0.34),
    'taverna-estados': dict(scale=0.36),
    'catedral-estados': dict(scale=0.46),
    'torre-sino': dict(scale=0.25),
    'predios-comercio': dict(merge=0, scale=0.34),
    'predios-vila': dict(scale=0.34),
    'predios-torres-objetos': dict(scale=0.30),
    'vegetacao': dict(merge=0, scale=0.24),
    'mercado': dict(merge=0, scale=0.40, glow=True),
    'praca': dict(merge=0, scale=0.38, glow=True),
    'cercas': dict(merge=0, scale=0.26),
}

# Nomes dos recortes (índice do componente na folha -> nome).
# Componentes sem nome também são exportados como "<folha>-<n>".
NAMES = {
    'rei-parado': ['parado-baixo', 'parado-direita', 'parado-esquerda', 'parado-cima'],
    'rei-andando': [f'andar-baixo-{i}' for i in range(4)] + [f'andar-baixo-b{i}' for i in range(4)]
    + ['andar-lado-e0', 'andar-lado-d0', 'andar-lado-e1', 'andar-lado-d1']
    + [f'andar-cima-{i}' for i in range(4)],
    'rei-correndo': [f'correr-baixo-{i}' for i in range(4)]
    + ['correr-lado-e0', 'correr-lado-e1', 'correr-lado-d0', 'correr-lado-d1']
    + ['correr-lado-e2', 'correr-lado-e3', 'correr-lado-d2', 'correr-lado-d3']
    + [f'correr-cima-{i}' for i in range(4)],
    'rei-ataque': ['ataque-baixo', 'ataque-cima', 'ataque-lado-0', 'ataque-lado-1'],
    'rei-dano': ['dano-golpe', 'dano-ferido', 'dano-ajoelhado', 'dano-empurrado', 'dano-capa'],
    'rei-desmaio': ['desmaio-0', 'desmaio-1', 'desmaio-2', 'desmaio-3'],
    'rei-agachado': ['agachado-baixo', 'agachado-direita', 'agachado-direita-b', 'agachado-cima'],
    'rei-dormindo': ['cama', 'sonambulo-direita', 'sonambulo-esquerda', 'olhos-fechados-baixo', 'olhos-fechados-cima'],
    'rei-bau': ['bau-perto', 'bau-abaixar', 'bau-fechado', None, 'bau-abrir-0', 'bau-abrir-1', 'bau-abrir-2'],
    'rei-pocao': ['pocao-0', 'pocao-1', 'pocao-2', 'pocao-3'],
    'rei-nadando': ['nadar-baixo', 'nadar-cima-0', 'nadar-cima-1', 'nadar-cima-2'],
    'rei-emocoes': ['corpo-neutro', 'corpo-feliz', 'corpo-assustado', 'corpo-bravo', 'corpo-cansado'],
    'rei-retratos': ['retrato-neutro', 'retrato-feliz', 'retrato-assustado', 'retrato-bravo', 'retrato-cansado'],
    'relogio': [f'relogio-{i}' for i in range(20)],
    'arvores': ['arvore-carvalho', 'arvore-copa', 'arvore-betula', 'arvore-pinheiro', 'arbusto-0', 'arbusto-1',
                'arbusto-2', 'arvore-pinheiro-2', 'arvore-seca', 'arvore-outono', 'arvore-pinheiro-outono',
                'arvore-florida', 'arvore-pinheiro-neve', 'arvore-neve', 'toco', 'tronco', 'tronco-2', 'toco-broto'],
    'casas-01': ['casa-madeira', 'casa-pedra', 'casa-azul', 'casa-telhado-grama', 'casa-escada', 'casa-pescador'],
    'casas-02': ['casa-palha', 'casa-enxaimel-azul', 'casa-vermelha-galpao', 'casa-pedra-grama',
                 'casa-escada-2', 'casa-pescador-2'],
    'casa-estados': ['casa-dia', 'casa-hera', 'casa-ruina', 'casa-neve-aberta', 'casa-neve', 'casa-noite'],
    'taverna-estados': ['taverna-dia', 'taverna-aberta', 'taverna-noite', 'taverna-noite-2',
                        'taverna-lareira', 'taverna-tochas'],
    'catedral-estados': ['catedral-dia', 'catedral-aberta', 'catedral-noite', 'catedral-dia-2',
                         'catedral-fogo', 'catedral-ruina'],
    'torre-sino': [f'sino-{i}' for i in range(5)],
    'predios-comercio': ['loja-taverna', 'ferreiro', 'padaria', 'armazem', 'capela', 'estabulo'],
    'predios-vila': ['moinho', 'torre-guarda', 'loja-pocoes', 'mina', 'serraria', 'feira'],
    'predios-torres-objetos': [None, 'torre-pedra', 'torre-vigia', 'torre-sino-casa', 'placa-pocoes',
                               'poco', 'carroca', 'carruagem', None],
}

# Recortes manuais (folha, caixa em px originais, nome, escala opcional)
MANUAL = [
    ('rei-bau', (1540, 1330, 1796, 1644), 'bau-aberto', None),
    ('pontes', (30, 0, 255, 250), 'ponte-curta', 0.36),
    ('pontes', (300, 0, 525, 250), 'ponte-curta-2', 0.36),
    # barra de vida: peças avulsas (a barra é montada no jogo)
    ('vida', (93, 276, 256, 430), 'hp-cheio', None),
    ('vida', (1256, 276, 1417, 430), 'hp-meio', None),
    ('vida', (1436, 276, 1597, 430), 'hp-vazio', None),
    ('vida', (100, 176, 218, 258), 'hp-rotulo', None),
    ('botao-pausa', (470, 470, 1580, 1580), 'botao-pausa', None),
]

# Grades de tiles de chão: folha -> (colunas, linhas)
# 'grade' = células regulares; 'ilhas' = cada tile é uma ilha separada por magenta
TILE_GRIDS = {
    'chao-01': (10, 6, 'grade'),
    'chao-02': (8, 7, 'ilhas'),
    'chao-03': (10, 6, 'grade'),
    'plantacao': (10, 6, 'grade'),
}


# Altura final (px de jogo) de quadros de folhas com escala irregular
TARGET_H = {
    'ataque-baixo': 96, 'ataque-cima': 98, 'ataque-lado-0': 80, 'ataque-lado-1': 80,
    'agachado-baixo': 52, 'agachado-cima': 60, 'agachado-direita': 50, 'agachado-direita-b': 58,
    'bau-perto': 76, 'bau-abaixar': 70, 'bau-abrir-0': 66, 'bau-abrir-1': 66, 'bau-abrir-2': 66,
    'bau-fechado': 30, 'bau-aberto': 36,
    'dano-golpe': 78, 'dano-ferido': 76, 'dano-ajoelhado': 50, 'dano-empurrado': 64, 'dano-capa': 80,
    'desmaio-0': 72, 'desmaio-1': 62, 'desmaio-2': 36, 'desmaio-3': 36,
    'cama': 104, 'sonambulo-direita': 76, 'sonambulo-esquerda': 76,
    'olhos-fechados-baixo': 76, 'olhos-fechados-cima': 76,
    'hp-cheio': 30, 'hp-meio': 30, 'hp-vazio': 30, 'hp-rotulo': 18, 'botao-pausa': 44,
    'nadar-baixo': 50, 'nadar-cima-0': 54, 'nadar-cima-1': 54, 'nadar-cima-2': 54,
}


def key_water(a, fg):
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    water = (g > 115) & (b > 165) & (b > r + 45) & (g > r + 10)
    return fg & ~water


def fill_holes(rgb, al, radius=3):
    """Fecha buracos finos (restos de linhas de grade) e pinta com a cor vizinha."""
    m = al > 0
    d = m.copy()
    for _ in range(radius):
        d = d | np.roll(d, 1, 0) | np.roll(d, -1, 0) | np.roll(d, 1, 1) | np.roll(d, -1, 1)
    e = d.copy()
    for _ in range(radius):
        e = e & np.roll(e, 1, 0) & np.roll(e, -1, 0) & np.roll(e, 1, 1) & np.roll(e, -1, 1)
    holes = e & ~m
    if not holes.any():
        return rgb, al
    rgb = rgb.copy()
    todo = holes.copy()
    for k in range(1, radius * 3):
        for dy, dx in ((0, k), (0, -k), (k, 0), (-k, 0)):
            src = np.roll(m, (dy, dx), (0, 1))
            sel = todo & src
            if sel.any():
                rgb[sel] = np.roll(rgb, (dy, dx), (0, 1))[sel]
                todo &= ~sel
    al = np.where(e, 255, al).astype(np.uint8)
    return rgb, al


def resize(im, s):
    nw, nh = max(1, round(im.width * s)), max(1, round(im.height * s))
    small = im.convert('RGBa').resize((nw, nh), Image.BOX).convert('RGBA')
    arr = np.asarray(small).copy()
    arr[..., 3] = np.where(arr[..., 3] >= 120, 255, 0)
    return Image.fromarray(arr, 'RGBA')


def crop_rgba(a, fg, box, holes=False):
    x0, y0, x1, y1 = box
    rgb = a[y0:y1, x0:x1].astype(np.uint8)
    al = (fg[y0:y1, x0:x1] * 255).astype(np.uint8)
    if holes:
        rgb, al = fill_holes(rgb, al)
    im = Image.fromarray(np.dstack([rgb, al]), 'RGBA')
    bb = im.getbbox()
    return im.crop(bb) if bb else im


def main():
    os.makedirs(OUT, exist_ok=True)
    sprites = {}
    for sheet, cfg in SHEETS.items():
        a, fg = fg_mask(sheet, grid=cfg.get('grid', False), line_rgb=cfg.get('line_rgb'), glow=cfg.get('glow', False))
        if cfg.get('water'):
            fg = key_water(a, fg)
        char = sheet.startswith('rei') or cfg.get('char', False)
        if 'cells' in cfg:  # grade fixa: recorta em volta de cada centro
            boxes = [(x - 196, y - 200, x + 196, y + 200) for x, y in cfg['cells']]
            if cfg.get('circle'):  # objeto redondo: descarta tudo fora do círculo
                yy, xx = np.mgrid[0:fg.shape[0], 0:fg.shape[1]]
                keep = np.zeros_like(fg)
                for x, y in cfg['cells']:
                    keep |= (xx - x) ** 2 + (yy - y) ** 2 <= cfg['circle'] ** 2
                fg = fg & keep
        else:
            boxes = [b for b in components(fg, merge=cfg.get('merge', 1 if char else 2))
                     if (b[2] - b[0]) * (b[3] - b[1]) > (20000 if char else 3000)]
        crops = [crop_rgba(a, fg, b, holes=char) for b in boxes]
        if 'scale' in cfg:
            s = cfg['scale']
        else:
            ref_h = cfg.get('ref_h') or crops[cfg['ref']].height
            s = cfg.get('target', CHAR_H) / ref_h * cfg.get('ref_scale', 1)
        names = NAMES.get(sheet, [])
        for i, im in enumerate(crops):
            name = names[i] if i < len(names) else f'{sheet}-{i}'
            if name is None:
                continue
            if im.width * im.height < 400:
                continue
            sprites[name] = resize(im, TARGET_H[name] / im.height if name in TARGET_H else s)
        print(f'{sheet}: {len(crops)} recortes, escala {s:.3f}')

    for sheet, box, name, s in MANUAL:
        # HUD: máscara estrita (o roxo-escuro dos corações vazios não é fundo)
        a, fg = fg_mask(sheet, loose=sheet not in ('vida', 'botao-pausa'))
        im = crop_rgba(a, fg, box)
        if s is None:
            s = TARGET_H[name] / im.height
        sprites[name] = resize(im, s)

    # Empacota o atlas (prateleiras)
    order = sorted(sprites, key=lambda n: -sprites[n].height)
    W = 2048
    x = y = shelf = 0
    pos = {}
    for n in order:
        im = sprites[n]
        if x + im.width + 2 > W:
            x, y, shelf = 0, y + shelf + 2, 0
        pos[n] = (x, y)
        x += im.width + 2
        shelf = max(shelf, im.height)
    H = y + shelf
    atlas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    meta = {}
    for n, (px, py) in pos.items():
        im = sprites[n]
        atlas.paste(im, (px, py))
        meta[n] = [px, py, im.width, im.height]
    atlas.save(f'{OUT}/atlas.webp', quality=92, method=6, exact=True)
    # JS em vez de JSON: funciona abrindo o index.html direto do disco (file://)
    with open(f'{OUT}/atlas.js', 'w') as f:
        f.write('window.ATLAS = ' + json.dumps(meta, separators=(',', ':'), sort_keys=True) + ';\n')
    print(f'atlas: {len(meta)} sprites, {W}x{H}')

    # Tiles de chão
    tiles = []
    tmeta = {}
    for sheet, (cols, rows, mode) in TILE_GRIDS.items():
        a, fg = fg_mask(sheet)
        H0, W0 = fg.shape
        cw, ch = W0 / cols, H0 / rows
        found = {}
        if mode == 'ilhas':
            for (bx0, by0, bx1, by1) in components(fg, step=4, merge=0, min_area=int(cw * ch / 16 * 0.35)):
                if bx1 - bx0 > cw * 1.4 or by1 - by0 > ch * 1.4:
                    continue  # ilhas grudadas: ignora
                found[(int((by0 + by1) / 2 / ch), int((bx0 + bx1) / 2 / cw))] = (bx0, by0, bx1, by1)
        else:
            for r in range(rows):
                for c in range(cols):
                    x0, y0 = int(c * cw), int(r * ch)
                    sub = fg[y0:int((r + 1) * ch), x0:int((c + 1) * cw)]
                    if sub.mean() < 0.5:
                        continue
                    ys, xs = np.nonzero(sub)
                    found[(r, c)] = (x0 + xs.min(), y0 + ys.min(), x0 + xs.max(), y0 + ys.max())
        for (r, c), (bx0, by0, bx1, by1) in sorted(found.items()):
            ix, iy = int((bx1 - bx0) * 0.085), int((by1 - by0) * 0.085)
            box = (bx0 + ix, by0 + iy, bx1 - ix, by1 - iy)
            im = Image.fromarray(a[box[1]:box[3], box[0]:box[2]].astype(np.uint8), 'RGB')
            im = im.resize((TILE, TILE), Image.BOX)
            tmeta[f'{sheet}-{r}-{c}'] = len(tiles)
            tiles.append(im)
    per_row = 16
    timg = Image.new('RGB', (per_row * TILE, ((len(tiles) + per_row - 1) // per_row) * TILE))
    for i, im in enumerate(tiles):
        timg.paste(im, ((i % per_row) * TILE, (i // per_row) * TILE))
    timg.save(f'{OUT}/tiles.webp', quality=92, method=6)
    with open(f'{OUT}/tiles.js', 'w') as f:
        f.write('window.TILES = ' + json.dumps({'size': TILE, 'perRow': per_row, 'tiles': tmeta},
                                               separators=(',', ':')) + ';\n')
    print(f'tiles: {len(tiles)}')


# Telas cheias (imagem inteira, sem recorte de fundo)
SCREENS = {'tela-morte': 960}


def build_screens():
    sys.path.insert(0, os.path.dirname(__file__))
    from spritelib import load
    for name, size in SCREENS.items():
        a = load(name)  # já remove a marca d'água
        im = Image.fromarray(a.astype(np.uint8), 'RGB').resize((size, size), Image.BOX)
        im.save(f'{OUT}/{name}.webp', quality=90, method=6)
        print(f'tela: {name}')


if __name__ == '__main__':
    main()
    build_screens()
