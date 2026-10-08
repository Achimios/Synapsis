# 平面 acid 图标草稿（👤 2026-10-08 「you know i like acid」）：PIL 4x 超采样画几何，出 cand_*.png + 对比图到 _pics/图标候选/
import math, glob, os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), '_pics', '图标候选')
os.makedirs(OUT, exist_ok=True)
N = 1024
ACID, MAG, VIO, BLK, WHT = (182, 255, 0, 255), (255, 0, 170, 255), (140, 60, 255, 255), (10, 10, 10, 255), (255, 255, 255, 255)

def canvas(): return Image.new('RGBA', (N, N), (0, 0, 0, 0))
def dot(d, x, y, r, fill, ring=None, rw=0):
    if ring: d.ellipse((x - r - rw, y - r - rw, x + r + rw, y + r + rw), fill=ring)
    d.ellipse((x - r, y - r, x + r, y + r), fill=fill)
def line(d, a, b, w, fill):
    d.line([a, b], fill=fill, width=w)
    for p in (a, b): d.ellipse((p[0] - w / 2, p[1] - w / 2, p[0] + w / 2, p[1] + w / 2), fill=fill)
def bez(p0, p1, p2, p3, n=80):
    return [tuple((1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t * t * c + t ** 3 * e for a, b, c, e in zip(p0, p1, p2, p3)) for t in [i / n for i in range(n + 1)]]
def poly(d, pts, w, fill):
    for a, b in zip(pts, pts[1:]): line(d, a, b, w, fill)

def tri():  # 三节点：酸绿节点 + 品红连线，黑描边保证浅色底也清楚
    im = canvas(); d = ImageDraw.Draw(im)
    P = [(512, 190), (230, 800), (800, 760)]
    for a, b in [(0, 1), (1, 2), (2, 0)]: line(d, P[a], P[b], 96, BLK)
    for a, b in [(0, 1), (1, 2), (2, 0)]: line(d, P[a], P[b], 60, MAG)
    for (x, y), r, c in zip(P, [170, 140, 120], [ACID, ACID, VIO]): dot(d, x, y, r, c, BLK, 22)
    return im

def s_path():  # 节点连成的 S：两端大点，S 曲线粗描
    im = canvas(); d = ImageDraw.Draw(im)
    pts = bez((760, 230), (250, 120), (200, 470), (512, 512)) + bez((512, 512), (830, 555), (780, 910), (260, 790))[1:]
    poly(d, pts, 190, BLK); poly(d, pts, 130, MAG)
    dot(d, 760, 230, 150, ACID, BLK, 24); dot(d, 260, 790, 150, ACID, BLK, 24)
    return im

def synapse():  # 突触：两个节点之间的缝 + 闪电
    im = canvas(); d = ImageDraw.Draw(im)
    dot(d, 290, 512, 230, ACID, BLK, 26); dot(d, 734, 512, 230, MAG, BLK, 26)
    bolt = [(560, 250), (470, 520), (570, 500), (470, 780)]
    poly(d, bolt, 110, BLK); poly(d, bolt, 64, WHT)
    return im

def badge():  # 黑圆底 + 酸绿 S 节点（任务栏深浅都稳）
    im = canvas(); d = ImageDraw.Draw(im)
    dot(d, 512, 512, 500, BLK)
    pts = bez((700, 290), (330, 200), (290, 470), (512, 512)) + bez((512, 512), (740, 555), (700, 830), (330, 740))[1:]
    poly(d, pts, 120, ACID)
    dot(d, 700, 290, 105, MAG); dot(d, 330, 740, 105, MAG)
    return im

def gpt(path):  # GPT 透明图：bbox 只认 alpha>40，扔掉边上的杂点
    im = Image.open(path).convert('RGBA')
    a = im.getchannel('A').point(lambda v: 255 if v > 40 else 0)
    return im.crop(a.getbbox())

def sq(im):
    s = max(im.size); o = Image.new('RGBA', (s, s)); o.paste(im, ((s - im.width) // 2, (s - im.height) // 2))
    return o.resize((256, 256), Image.LANCZOS)

if __name__ == '__main__':
    pics = sorted(glob.glob(r'C:\Users\Administrator\Desktop\Obsidian_V_Synapsis\_pics\*.png'))
    items = [('A 三节点', tri()), ('B S路径', s_path()), ('C 突触', synapse()), ('D 黑圆徽章', badge())] + [('GPT%d' % i, gpt(p)) for i, p in enumerate(pics, 1)]
    W = 300
    sheet = Image.new('RGBA', (W * len(items), 400), (0, 0, 0, 255))
    for i, (name, im) in enumerate(items):
        t = sq(im); t.save(os.path.join(OUT, 'cand_%d.png' % i))
        for row, bg in enumerate([(32, 32, 32, 255), (238, 238, 238, 255)]):
            p = Image.new('RGBA', (W, 200), bg)
            p.alpha_composite(t.resize((128, 128), Image.LANCZOS), (10, 36))
            p.alpha_composite(t.resize((32, 32), Image.LANCZOS), (170, 36))
            p.alpha_composite(t.resize((16, 16), Image.LANCZOS), (220, 36))
            ImageDraw.Draw(p).text((10, 8), name.encode('ascii', 'ignore').decode() or name, fill=(128, 128, 128, 255))
            sheet.paste(p, (i * W, row * 200))
    sheet.save(os.path.join(OUT, 'acid_preview.png'))
    print(len(items))
