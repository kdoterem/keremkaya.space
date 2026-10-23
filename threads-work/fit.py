# Criss-cross fitter: every word crosses another; no filler words; letters only
# touch at real crossings. Tries many orders, keeps the most compact grid.
import random, sys, json

def fits(grid, w, r, c, d):
    dr, dc = (0, 1) if d == "A" else (1, 0)
    if (r - dr, c - dc) in grid or (r + dr * len(w), c + dc * len(w)) in grid: return -1
    cross = 0
    for i, ch in enumerate(w):
        rr, cc = r + dr * i, c + dc * i
        g = grid.get((rr, cc))
        if g:
            if g[0] != ch or g[1] == d: return -1
            cross += 1
        else:
            for sr, sc in ((dc, dr), (-dc, -dr)):
                if (rr + sr, cc + sc) in grid: return -1
    return cross

def place(grid, w, r, c, d):
    dr, dc = (0, 1) if d == "A" else (1, 0)
    for i, ch in enumerate(w):
        k = (r + dr * i, c + dc * i)
        grid[k] = (ch, "X") if k in grid else (ch, d)

def build(words, rnd, maxw):
    order = sorted(words, key=lambda w: -len(w))
    order = order[:1] + rnd.sample(order[1:], len(order) - 1)
    grid, placed = {}, [(order[0], 0, 0, "A")]
    place(grid, order[0], 0, 0, "A")
    left = order[1:]
    for _ in range(4):
        nxt = []
        for w in left:
            best = None
            for (r, c), (ch, _) in list(grid.items()):
                for i, wc in enumerate(w):
                    if wc != ch: continue
                    for d in "AD":
                        rr, cc = (r, c - i) if d == "A" else (r - i, c)
                        x = fits(grid, w, rr, cc, d)
                        if x <= 0: continue
                        rs = [k[0] for k in grid] + [rr, rr + (len(w) - 1) * (d == "D")]
                        cs = [k[1] for k in grid] + [cc, cc + (len(w) - 1) * (d == "A")]
                        H, W = max(rs) - min(rs) + 1, max(cs) - min(cs) + 1
                        if W > maxw: continue   # keep it phone-width
                        score = (x, -(H * W), rnd.random())
                        if best is None or score > best[0]: best = (score, rr, cc, d)
            if best:
                place(grid, w, best[1], best[2], best[3]); placed.append((w, best[1], best[2], best[3]))
            else: nxt.append(w)
        left = nxt
    rs = [k[0] for k in grid]; cs = [k[1] for k in grid]
    return grid, placed, left, (max(rs) - min(rs) + 1, max(cs) - min(cs) + 1)

maxw = int(sys.argv[1]); words = [w.upper() for w in sys.argv[2:]]
best = None
for seed in range(3000):
    g, p, left, (h, w) = build(words, random.Random(seed), maxw)
    key = (len(left), h * w, h)
    if best is None or key < best[0]: best = (key, g, p, left, h, w, seed)
key, g, p, left, h, w, seed = best
r0 = min(k[0] for k in g); c0 = min(k[1] for k in g)
print(f"{len(p)}/{len(words)} placed · grid {h} rows × {w} cols" + (f" · not placed: {left}" if left else ""))
for r in range(h):
    print(" ".join(g.get((r + r0, c + c0), (".",))[0] for c in range(w)))
json.dump({"h": h, "w": w, "words": [(wd, r - r0, c - c0, d) for wd, r, c, d in p], "left": left},
          open("grid.json", "w"))
