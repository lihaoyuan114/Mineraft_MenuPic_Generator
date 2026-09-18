#!/usr/bin/env python3
"""
用【官方 Minecraft 1.20.1 client.jar 里提取的原版 panorama 图】检验本项目的面序约定。
判据：原版 6 张图本身就是一个真实、无缝的立方体贴图。因此
  score(每个面的旋转组合) = 所有棱两侧像素的平均绝对差
最优解若为「全部旋转 0°，槽位 = 文件名下标」，则说明本项目的约定与官方一致。

用法：
  mkdir -p /tmp/verify && cd /tmp/verify
  # 需要同目录下有 raw_0.rgb .. raw_5.rgb，生成方法见下
  python3 /path/to/tools/verify_vanilla_convention.py

如何生成 raw_0.rgb .. raw_5.rgb（无需登录，用 Mojang 官方下载源）：
  1) 版本清单：      curl -s https://piston-meta.mojang.com/mc/game/version_manifest_v2.json
     找到目标版本（例如 1.20.1）的 version json 地址，取其中的 downloads.client.url
  2) 下载 client.jar：curl -sL -o client.jar <那个 url>
  3) 取出 6 张原版贴图：
       unzip -j client.jar 'assets/minecraft/textures/gui/title/background/panorama_*.png'
  4) 转成 64x64 原始 RGB（ImageMagick）：
       for i in 0 1 2 3 4 5; do
         convert panorama_$i.png -resize 64x64! -depth 8 rgb:raw_$i.rgb
       done

注意：原版贴图版权属于 Mojang，请只在本地做验证，
不要把 panorama_*.png / raw_*.rgb 提交到仓库。

实测结果（Minecraft Java 1.20.1 官方 client.jar 内的原版全景图）：
  恒等映射得分 171.15（每条棱 7.13） vs 面内相邻像素噪声基准 6.51  ->  1.10x
  第二好解 (0,0,0,0,0,2) 得分 250.08  ->  差 1.46 倍
  最差解   (2,3,2,3,2,3) 得分 1119.85 ->  差 6.54 倍
  => 最优解恰好是“不做任何变换”，本项目的面序与图内朝向与官方完全一致。
"""
import itertools
import math
import os
import sys

N = 64

HERE = os.path.dirname(os.path.abspath(__file__))


def load():
    faces = []
    for i in range(6):
        p = os.path.join(HERE, 'raw_%d.rgb' % i)
        d = open(p, 'rb').read()
        assert len(d) == N * N * 3, (p, len(d))
        faces.append(d)
    return faces


# 世界坐标 +X=东 +Y=上 +Z=南；dir(u,v) ∝ F + R(2u-1) + U(1-2v)
FACES = [
    ((0, 0, -1), (1, 0, 0), (0, 1, 0)),     # 0 north
    ((1, 0, 0), (0, 0, 1), (0, 1, 0)),      # 1 east
    ((0, 0, 1), (-1, 0, 0), (0, 1, 0)),     # 2 south
    ((-1, 0, 0), (0, 0, -1), (0, 1, 0)),    # 3 west
    ((0, 1, 0), (1, 0, 0), (0, 0, 1)),      # 4 up
    ((0, -1, 0), (1, 0, 0), (0, 0, -1)),    # 5 down
]


def dir_of(f, u, v):
    F, R, U = FACES[f]
    s, t = 2 * u - 1, 1 - 2 * v
    x = F[0] + R[0] * s + U[0] * t
    y = F[1] + R[1] * s + U[1] * t
    z = F[2] + R[2] * s + U[2] * t
    n = math.sqrt(x * x + y * y + z * z)
    return x / n, y / n, z / n


def face_uv(x, y, z):
    ax, ay, az = abs(x), abs(y), abs(z)
    if ax >= ay and ax >= az:
        f = 1 if x > 0 else 3
    elif ay >= az:
        f = 4 if y > 0 else 5
    else:
        f = 2 if z > 0 else 0
    m = max(ax, ay, az)
    x, y, z = x / m, y / m, z / m
    F, R, U = FACES[f]
    return f, 0.5 + 0.5 * (x * R[0] + y * R[1] + z * R[2]), 0.5 - 0.5 * (x * U[0] + y * U[1] + z * U[2])


def edge_pixel(f, e, k):
    """面 f 的第 e 条棱上第 k 个采样点（面内像素坐标）"""
    t = (k + 0.5) / N
    if e == 0:   return N - 1, int(t * N)          # 右
    if e == 1:   return 0, int(t * N)              # 左
    if e == 2:   return int(t * N), 0              # 上
    return int(t * N), N - 1                        # 下


def outside_uv(f, e, k):
    """从该棱再向外走一个纹素后的 (u,v)"""
    t = (k + 0.5) / N
    if e == 0:   return (N + 0.5) / N, (int(t * N) + 0.5) / N
    if e == 1:   return -0.5 / N, (int(t * N) + 0.5) / N
    if e == 2:   return (int(t * N) + 0.5) / N, -0.5 / N
    return (int(t * N) + 0.5) / N, (N + 0.5) / N


def src_pixel_after_rotation(r, i, j):
    """面顺时针旋转 r*90° 后，位于 (i,j) 的像素来自原图的哪个像素。
    T(i,j)=(N-1-j, i) 是“内容顺时针转 90°”，这里取 T^-1 迭代 r 次。"""
    for _ in range(r):
        i, j = j, N - 1 - i
    return i, j


def pix(face_data, i, j):
    o = (j * N + i) * 3
    return face_data[o], face_data[o + 1], face_data[o + 2]


def main():
    faces = load()

    # ---- 1. 用几何算出邻接关系与权重表 W[f][e][rf][rg] ----
    W = [[[[0.0] * 4 for _ in range(4)] for _ in range(4)] for _ in range(6)]
    nbr = {}
    same = 0
    for f in range(6):
        for e in range(4):
            n = -1
            for k in range(N):
                g, gu, gv = face_uv(*dir_of(f, *outside_uv(f, e, k)))
                if g == f:
                    same += 1
                    continue
                if n < 0:
                    n = g
                elif n != g:
                    raise AssertionError('同一棱出现两个邻面 %d/%d' % (n, g))
                gi = min(N - 1, max(0, int(gu * N)))
                gj = min(N - 1, max(0, int(gv * N)))
                for rf in range(4):
                    si, sj = src_pixel_after_rotation(rf, *edge_pixel(f, e, k))
                    a = pix(faces[f], si, sj)
                    for rg in range(4):
                        ti, tj = src_pixel_after_rotation(rg, gi, gj)
                        b = pix(faces[g], ti, tj)
                        W[f][e][rf][rg] += (abs(a[0] - b[0]) + abs(a[1] - b[1]) + abs(a[2] - b[2])) / 3.0
            nbr[(f, e)] = n
            W[f][e] = [[v / N for v in row] for row in W[f][e]]
            if n < 0:
                print('!! 面 %d 的棱 %d 没有跨到别的面上' % (f, e))

    print('几何推出的邻接表：')
    names = ['北', '东', '南', '西', '上', '下']
    for f in range(6):
        print('  面%d(%s): 右->%d 左->%d 上->%d 下->%d' % (
            f, names[f], nbr[(f, 0)], nbr[(f, 1)], nbr[(f, 2)], nbr[(f, 3)]))

    # ---- 2. 暴力枚举 4^6 种旋转组合 ----
    best = None
    scores = {}
    for combo in itertools.product(range(4), repeat=6):
        s = 0.0
        for f in range(6):
            for e in range(4):
                g = nbr[(f, e)]
                if g < 0:
                    continue
                s += W[f][e][combo[f]][combo[g]]
        scores[combo] = s
        if best is None or s < best[1]:
            best = (combo, s)

    ranked = sorted(scores.items(), key=lambda kv: kv[1])
    ident = scores[(0, 0, 0, 0, 0, 0)]
    print()
    print('原版 1.20.1 panorama 在“槽位=下标”下的结果：')
    print('  恒等映射(全部 0° 旋转)得分        : %.4f' % ident)
    print('  全部旋转组合中的最优解            : %s 得分 %.4f' % (best[0], best[1]))
    print('  第二好解                          : %s 得分 %.4f' % (ranked[1][0], ranked[1][1]))
    print('  最差解                            : %s 得分 %.4f' % (ranked[-1][0], ranked[-1][1]))

    # 面内相邻像素的平均差异（作为“噪声基准”）
    base = 0.0
    cnt = 0
    for f in range(6):
        for j in range(0, N, 4):
            for i in range(0, N - 1, 4):
                a = pix(faces[f], i, j)
                b = pix(faces[f], i + 1, j)
                base += (abs(a[0] - b[0]) + abs(a[1] - b[1]) + abs(a[2] - b[2])) / 3.0
                cnt += 1
    base /= cnt
    print('  面内相邻像素平均差异(基准噪声)    : %.4f' % base)

    per_edge = best[1] / 24.0
    ok_ident = best[0] == (0, 0, 0, 0, 0, 0)
    ratio = ranked[1][1] / max(best[1], 1e-9)
    print('  每条棱的平均差异 (最优解)         : %.4f  ->  与基准噪声之比 %.2fx' % (per_edge, per_edge / base))
    print()
    if ok_ident:
        print('  ==> 结论：官方面序/朝向与本项目约定【完全一致】')
        print('      最优解就是“不做任何变换”，每条棱的接缝差异已降到面内噪声水平，')
        print('      且比第二好解优 %.2f 倍、比最差解优 %.1f 倍，无歧义。' % (ratio, ranked[-1][1] / max(best[1], 1e-9)))
    else:
        print('  ==> 结论：本项目约定与官方【不一致】！最优解为 %s' % (best[0],))
    return 0 if ok_ident else 1


if __name__ == '__main__':
    sys.exit(main())
