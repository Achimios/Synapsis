# 任意图片 -> Synapsis 图标，放在 <Synapsis>/_图标/：
#   项目.ico / 项目.png      「在Synapsis打开本项目」快捷方式
#   客户端.ico / 客户端.png  「Synapsis 客户端」快捷方式 + 托盘 + 窗口（托盘读 png，重启客户端生效）
# 用法：python core/tools/make_icon.py <项目图> [--desktop <客户端图>]   （不给 --desktop 就共用一张）
# 透明底或黑底都行：黑底（没有透明像素）的图自动把黑色转成透明。
# 生成后重建 Synapsis 根目录的快捷方式（node core/cli.js launcher），并刷新 Windows 图标缓存（不然资源管理器还显示旧图）。
# 其它项目的快捷方式也指向 _图标/项目.ico，缓存刷新后自动跟着变。
import sys, os, subprocess
from PIL import Image

HOME = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DIR = os.path.join(HOME, '_图标')
SIZES = [16, 24, 32, 48, 64, 128, 256]

def unblack(im):
    # 黑底发光图 -> 透明：alpha = 最亮通道，颜色除回去（加色混合的逆运算，发光边缘不会留黑圈）
    import numpy as np
    a = np.asarray(im.convert('RGB')).astype(float) / 255
    al = np.clip((a.max(axis=2) - 0.03) / 0.97, 0, 1)  # 压掉黑底噪点
    rgb = np.clip(a / np.maximum(al[..., None], 1e-6), 0, 1) * (al[..., None] > 0)
    out = Image.fromarray((np.dstack([rgb, al]) * 255).astype('uint8'), 'RGBA')
    return out.crop(Image.fromarray((al > 0.08).astype('uint8') * 255).getbbox())

def square(path):
    im = Image.open(path).convert('RGBA')
    if im.getextrema()[3][0] == 255: im = unblack(im)  # 没有透明像素 = 黑底图
    bb = im.getchannel('A').point(lambda v: 255 if v > 40 else 0).getbbox()  # 裁掉透明边（alpha≤40 的杂点不算，GPT 透明图边上常有）
    if bb: im = im.crop(bb)
    s = max(im.size)
    out = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    out.paste(im, ((s - im.width) // 2, (s - im.height) // 2))
    return out.resize((256, 256), Image.LANCZOS)

def save(im, stem):
    os.makedirs(DIR, exist_ok=True)
    im.save(os.path.join(DIR, stem + '.png'))
    ico = os.path.join(DIR, stem + '.ico')
    im.save(ico, sizes=[(s, s) for s in SIZES])
    return ico

if __name__ == '__main__':
    a = sys.argv[1:]
    if not a: sys.exit('python core/tools/make_icon.py <项目图> [--desktop <客户端图>]')
    proj = a[0]
    desk = a[a.index('--desktop') + 1] if '--desktop' in a else proj
    print('ok:', save(square(proj), '项目'), save(square(desk), '客户端'))
    subprocess.run(['node', os.path.join(HOME, 'core', 'cli.js'), 'launcher', HOME])
    subprocess.run(['ie4uinit.exe', '-show'])  # 刷新图标缓存
