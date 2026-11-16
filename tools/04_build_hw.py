#!/usr/bin/env python3
"""Build data/hw.bin: 8-point stroke shapes for the handwriting pad.

Derived from data/strokes/*.json (KanjiVG, CC BY-SA 3.0). One record per
Jōyō kanji, in data/kanji.json order:

  uint8  stroke count
  then for each stroke, 8 points of uint8 x, uint8 y in a 0–255 box

The matcher (hw.js) is stroke-order free and tolerates a few extra or
missing strokes, in the spirit of KanjiCanvas (Dominik Klein, MIT).
"""
import json, math, re, struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NPTS = 8

def tokenize(d):
    return re.findall(r'[MmCcSs]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?', d)

def cub(p0, p1, p2, p3, steps=6):
    x0, y0 = p0; x1, y1 = p1; x2, y2 = p2; x3, y3 = p3
    out = []
    for t in range(1, steps + 1):
        u = t / steps
        a = 1 - u
        out.append((
            a*a*a*x0 + 3*a*a*u*x1 + 3*a*u*u*x2 + u*u*u*x3,
            a*a*a*y0 + 3*a*a*u*y1 + 3*a*u*u*y2 + u*u*u*y3,
        ))
    return out

def sample_path(d):
    tok = tokenize(d)
    i = 0
    x = y = 0.0
    px = py = None
    pts = []
    cmd = None
    while i < len(tok):
        t = tok[i]
        if re.fullmatch(r'[MmCcSs]', t):
            cmd = t
            i += 1
            if cmd not in 'CcSs':
                px = py = None
            continue
        if cmd == 'M':
            x, y = float(tok[i]), float(tok[i + 1]); i += 2
            pts.append((x, y))
        elif cmd == 'm':
            x += float(tok[i]); y += float(tok[i + 1]); i += 2
            pts.append((x, y))
        elif cmd == 'C':
            nums = list(map(float, tok[i:i + 6])); i += 6
            x1, y1, x2, y2, x3, y3 = nums
            pts.extend(cub((x, y), (x1, y1), (x2, y2), (x3, y3)))
            px, py, x, y = x2, y2, x3, y3
        elif cmd == 'c':
            dx1, dy1, dx2, dy2, dx3, dy3 = map(float, tok[i:i + 6]); i += 6
            x1, y1, x2, y2, x3, y3 = x + dx1, y + dy1, x + dx2, y + dy2, x + dx3, y + dy3
            pts.extend(cub((x, y), (x1, y1), (x2, y2), (x3, y3)))
            px, py, x, y = x2, y2, x3, y3
        elif cmd == 'S':
            x2, y2, x3, y3 = map(float, tok[i:i + 4]); i += 4
            x1, y1 = (x, y) if px is None else (2 * x - px, 2 * y - py)
            pts.extend(cub((x, y), (x1, y1), (x2, y2), (x3, y3)))
            px, py, x, y = x2, y2, x3, y3
        elif cmd == 's':
            dx2, dy2, dx3, dy3 = map(float, tok[i:i + 4]); i += 4
            x2, y2, x3, y3 = x + dx2, y + dy2, x + dx3, y + dy3
            x1, y1 = (x, y) if px is None else (2 * x - px, 2 * y - py)
            pts.extend(cub((x, y), (x1, y1), (x2, y2), (x3, y3)))
            px, py, x, y = x2, y2, x3, y3
        else:
            raise SystemExit('bad path command ' + str(cmd))
    return pts

def resample(pts, n=NPTS):
    if not pts:
        return [(0.0, 0.0)] * n
    if len(pts) == 1:
        return [pts[0]] * n
    seg, total = [], 0.0
    for i in range(1, len(pts)):
        L = math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
        seg.append(L)
        total += L
    if total < 1e-6:
        return [pts[0]] * n
    out = []
    for k in range(n):
        target = total * k / (n - 1)
        acc = 0.0
        placed = False
        for i, L in enumerate(seg):
            if acc + L >= target - 1e-9:
                t = 0 if L < 1e-9 else (target - acc) / L
                out.append((
                    pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t,
                    pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t,
                ))
                placed = True
                break
            acc += L
        if not placed:
            out.append(pts[-1])
    return out

def normalize(strokes):
    xs = [p[0] for s in strokes for p in s]
    ys = [p[1] for s in strokes for p in s]
    minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
    span = max(maxx - minx, maxy - miny, 1e-6)
    scale = 255.0 / span
    ox = (255 - (maxx - minx) * scale) / 2 - minx * scale
    oy = (255 - (maxy - miny) * scale) / 2 - miny * scale
    out = []
    for s in strokes:
        pts = []
        for x, y in resample(s):
            pts.append((
                max(0, min(255, int(round(x * scale + ox)))),
                max(0, min(255, int(round(y * scale + oy)))),
            ))
        out.append(pts)
    return out

def main():
    data = json.load(open(ROOT / 'data/kanji.json', encoding='utf-8'))
    blob = bytearray()
    for d in data:
        h = format(ord(d['k']), 'x').zfill(5)
        raw = json.load(open(ROOT / 'data/strokes' / (h + '.json'), encoding='utf-8'))
        strokes = normalize([sample_path(p) for p in raw['p']])
        if len(strokes) > 255:
            raise SystemExit('too many strokes ' + d['k'])
        blob.append(len(strokes))
        for s in strokes:
            if len(s) != NPTS:
                raise SystemExit('resample')
            for x, y in s:
                blob.append(x)
                blob.append(y)
    out = ROOT / 'data' / 'hw.bin'
    out.write_bytes(blob)
    print('wrote', out, 'bytes', len(blob), 'kanji', len(data))

if __name__ == '__main__':
    main()
