# 任意图片 -> Synapsis 图标：app/electron/icon.png（托盘 / 窗口）+ icon.ico（多尺寸）+ 根目录快捷方式
# 用法：python core/tools/make_icon.py <图片> [--desktop <图片2>]
#   第一张给「打开本项目」(Synapsis.lnk)，--desktop 给「打开客户端」(Synapsis 客户端.lnk) 和托盘；不给就共用第一张。
# 透明底或黑底都行：黑底（没有透明像素）的图自动把黑色转成透明。
# .vbs 本身不能换图标，所以生成 .lnk 快捷方式（图标 + 直接调 electron，不经过 vbs）。
import sys, os, subprocess
from PIL import Image

HOME = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ELEC = os.path.join(HOME, 'app', 'electron')
EXE = os.path.join(HOME, 'app', 'node_modules', 'electron', 'dist', 'electron.exe')
MAIN = os.path.join(ELEC, 'main.mjs')
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
    bb = im.getbbox()  # 裁掉全透明边
    if bb: im = im.crop(bb)
    s = max(im.size)
    out = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    out.paste(im, ((s - im.width) // 2, (s - im.height) // 2))
    return out.resize((256, 256), Image.LANCZOS)

def save(im, stem):
    png, ico = os.path.join(ELEC, stem + '.png'), os.path.join(ELEC, stem + '.ico')
    im.save(png)
    im.save(ico, sizes=[(s, s) for s in SIZES])
    return ico

def lnk(name, args, ico):
    # PowerShell 5.1 + 中文名 -> 用 ASCII 的 COM 调用，路径走环境变量避免编码问题
    env = dict(os.environ, L=os.path.join(HOME, name), T=EXE, A=args, I=ico, W=os.path.join(HOME, 'app'))
    ps = "$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:L);$s.TargetPath=$env:T;$s.Arguments=$env:A;$s.IconLocation=$env:I+',0';$s.WorkingDirectory=$env:W;$s.Save()"
    subprocess.run(['powershell', '-NoProfile', '-Command', ps], env=env, check=True)

if __name__ == '__main__':
    a = sys.argv[1:]
    if not a: sys.exit(__doc__ or 'python make_icon.py <图片> [--desktop <图片2>]')
    proj = a[0]
    desk = a[a.index('--desktop') + 1] if '--desktop' in a else proj
    ico_p = save(square(proj), 'icon_project')
    ico_d = save(square(desk), 'icon')  # icon.png = 托盘 / 窗口
    lnk('Synapsis.lnk', '"%s" --ws "%s"' % (MAIN, HOME), ico_p)
    lnk('Synapsis 客户端.lnk', '"%s"' % MAIN, ico_d)
    print('ok:', ico_p, ico_d)
