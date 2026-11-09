"""Funções de apoio para recortar as folhas de sprites (fundo magenta)."""
import numpy as np
from PIL import Image, ImageDraw

ORIG = 'assets/originais'


_WM = None


def remove_watermark(a):
    """Desfaz a estrela semitransparente (branca) do canto inferior direito.
    observado = (1-α)·original + α·255  ->  original = (observado - α·255) / (1-α)"""
    global _WM
    if _WM is None:
        import os
        _WM = np.load(os.path.join(os.path.dirname(__file__), 'watermark_alpha.npy'))
    H, W = a.shape[:2]
    al = _WM[..., None]
    reg = a[H - 180:H - 40, W - 180:W - 40].astype(np.float32)
    fixed = (reg - al * 255) / np.maximum(1 - al, 0.15)
    a[H - 180:H - 40, W - 180:W - 40] = np.clip(fixed, 0, 255).astype(a.dtype)
    return a


def load(name):
    a = np.asarray(Image.open(f'{ORIG}/{name}.png').convert('RGB')).astype(np.int16).copy()
    return remove_watermark(a)


def bg_mask(a, loose=False):
    """True onde é fundo: magenta (com ruído) ou linhas de grade escuras arroxeadas."""
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    lo = min(r.min(), 0)
    mag = (r > 150) & (b > 140) & (g < 0.45 * np.minimum(r, b)) & (np.abs(r - b) < 90)
    if loose:
        mag |= (r > 110) & (b > 100) & (g < 0.5 * np.minimum(r, b)) & (np.abs(r - b) < 70)
    return mag


def _runs(line, minlen):
    """Máscara das sequências de True com comprimento >= minlen num vetor 1D."""
    out = np.zeros_like(line)
    d = np.diff(np.concatenate([[0], line.astype(np.int8), [0]]))
    starts, ends = np.nonzero(d == 1)[0], np.nonzero(d == -1)[0]
    for s0, e0 in zip(starts, ends):
        if e0 - s0 >= minlen:
            out[s0:e0] = True
    return out


def grid_lines(a, bg, minlen=90):
    """Linhas retas de grade (escuras/arroxeadas) com pelo menos minlen px seguidos."""
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    dark = (np.maximum(np.maximum(r, g), b) < 120) & (b >= r - 12) & (b <= r + 15) & (g <= np.minimum(r, b) - 6)
    lines = np.zeros_like(bg)
    H, W = bg.shape
    for x in range(W):
        lines[:, x] |= _runs(dark[:, x], minlen)
    for y in range(H):
        lines[y, :] |= _runs(dark[y, :], minlen)
    # engrossa 2px para pegar a borda antisserrilhada da linha
    for _ in range(2):
        lines = lines | np.roll(lines, 1, 0) | np.roll(lines, -1, 0) | np.roll(lines, 1, 1) | np.roll(lines, -1, 1)
    return lines & ~((np.maximum(np.maximum(r, g), b) > 170) & ~bg)


def components(mask, step=4, min_area=30, merge=2):
    """Componentes conexos (em resolução reduzida) -> lista de bboxes (x0,y0,x1,y1) em px originais."""
    H, W = mask.shape
    h, w = H // step, W // step
    small = mask[:h * step, :w * step].reshape(h, step, w, step).mean(axis=(1, 3)) > 0.25
    if merge:
        # dilata para juntar partes próximas do mesmo objeto
        d = small.copy()
        for _ in range(merge):
            d = d | np.roll(d, 1, 0) | np.roll(d, -1, 0) | np.roll(d, 1, 1) | np.roll(d, -1, 1)
        small = d
    label = np.zeros((h, w), np.int32)
    boxes = []
    n = 0
    ys, xs = np.nonzero(small)
    for sy, sx in zip(ys, xs):
        if label[sy, sx]:
            continue
        n += 1
        stack = [(sy, sx)]
        label[sy, sx] = n
        x0 = x1 = sx
        y0 = y1 = sy
        cnt = 0
        while stack:
            y, x = stack.pop()
            cnt += 1
            x0, x1, y0, y1 = min(x0, x), max(x1, x), min(y0, y), max(y1, y)
            for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= ny < h and 0 <= nx < w and small[ny, nx] and not label[ny, nx]:
                    label[ny, nx] = n
                    stack.append((ny, nx))
        if cnt >= min_area:
            boxes.append((x0 * step, y0 * step, (x1 + 1) * step, (y1 + 1) * step))
    boxes.sort(key=lambda b: (b[1] // 150, b[0]))
    return boxes


def watermark(a):
    """Estrela da marca d'água no canto inferior direito (clara e rosada)."""
    H, W = a.shape[:2]
    m = np.zeros((H, W), bool)
    y0, x0 = int(H * 0.86), int(W * 0.88)
    r, g, b = a[y0:, x0:, 0], a[y0:, x0:, 1], a[y0:, x0:, 2]
    m[y0:, x0:] = (r > 190) & (b > 195) & (g > 120)
    return m


def colored_lines(a, rgb, frac=0.45, tol=60):
    """Linhas de grade de uma cor conhecida: colunas/linhas onde essa cor domina."""
    d = np.abs(a - np.array(rgb)).sum(axis=2) < tol
    m = np.zeros(d.shape, bool)
    for x in np.nonzero(d.mean(axis=0) > frac)[0]:
        m[:, x] = d[:, x]
    for y in np.nonzero(d.mean(axis=1) > frac)[0]:
        m[y, :] |= d[y, :]
    for _ in range(2):
        m = m | np.roll(m, 1, 0) | np.roll(m, -1, 0) | np.roll(m, 1, 1) | np.roll(m, -1, 1)
    return m & (d | bg_mask(a, True) | (np.abs(a - np.array(rgb)).sum(axis=2) < tol * 2.5))


def glow_mask(a):
    """Brilho de lampião misturado ao magenta (rosa-lilás: r≈b e verde baixo)."""
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    lilac = (np.abs(r - b) < 45) & (g < 0.72 * np.minimum(r, b)) & (np.minimum(r, b) > 110)
    pink = (r > 185) & (b > 115) & (r > b) & (r - b < 115) & (g < 0.68 * b)
    return lilac | pink


def fg_mask(name, loose=True, grid=False, line_rgb=None, glow=False):
    a = load(name)
    bg = bg_mask(a, loose)
    if glow:
        bg |= glow_mask(a)
    if line_rgb is not None:
        bg |= colored_lines(a, line_rgb)
    if grid:
        bg |= grid_lines(a, bg)
    return a, ~bg


def contact(name, boxes, out):
    im = Image.open(f'{ORIG}/{name}.png').convert('RGB')
    d = ImageDraw.Draw(im)
    for i, (x0, y0, x1, y1) in enumerate(boxes):
        d.rectangle((x0, y0, x1, y1), outline=(0, 255, 0), width=4)
        d.rectangle((x0, y0, x0 + 60, y0 + 34), fill=(0, 0, 0))
        d.text((x0 + 4, y0 + 2), str(i), fill=(255, 255, 0), font_size=30)
    im.thumbnail((1600, 1600))
    im.save(out)


def cut(a, fgmask, box, size, pad=0):
    """Recorta box, aplica transparência, reduz para caber em size=(w,h) mantendo proporção,
    alinhado embaixo e centralizado. Retorna Image RGBA."""
    x0, y0, x1, y1 = box
    rgb = a[y0:y1, x0:x1].astype(np.uint8)
    al = (fgmask[y0:y1, x0:x1] * 255).astype(np.uint8)
    im = Image.fromarray(np.dstack([rgb, al]), 'RGBA')
    bb = im.getbbox()
    if bb:
        im = im.crop(bb)
    tw, th = size
    tw -= 2 * pad
    th -= pad
    s = min(tw / im.width, th / im.height)
    nw, nh = max(1, round(im.width * s)), max(1, round(im.height * s))
    small = im.convert('RGBa').resize((nw, nh), Image.BOX).convert('RGBA')
    arr = np.asarray(small).copy()
    arr[..., 3] = np.where(arr[..., 3] >= 110, 255, 0)
    small = Image.fromarray(arr, 'RGBA')
    out = Image.new('RGBA', size, (0, 0, 0, 0))
    out.paste(small, ((size[0] - nw) // 2, size[1] - nh - (0 if pad == 0 else 0)), small)
    return out
