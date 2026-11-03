#!/usr/bin/env python3
"""
生成复盘页「客户分布 · 按国家」世界地图用的国家边界 public/geo/world-chn.json（2026-11-03 客户反馈：客户分布要像地图那样呈现）。

来源：Natural Earth（公有领域）中国视角版本 ne_10m_admin_0_countries_chn.geojson，
  https://github.com/nvkelso/natural-earth-vector/blob/v5.1.2/geojson/ne_10m_admin_0_countries_chn.geojson
  （仓库 tag v5.1.2，文件自带版本 10m_cultural/ne_10m_admin_0_countries_chn.VERSION.txt = 5.1.1；
   下载时 sha256 a13bf5f310fde87bc0a5f994f8ce9bd706cc198d8ee37d221e61c2546b945372）
  Natural Earth 的各国视角（point-of-view）文件只出了 1:10m，没有 1:110m；这里拿 10m 的中国视角版自己抽稀到世界图够用的精度。

用法（只读数据、不跑下载目录里的任何东西）：
  python3 -I scripts/make-world-map.py <ne_10m_admin_0_countries_chn.geojson 路径> [输出路径，默认 public/geo/world-chn.json]

转换：
  - 只留 name（NAME_ZH，地图要素的中文名）、iso（ISO_A2_EH，没有的不写）、a3（ADM0_A3）
  - 去掉南极洲
  - 香港、澳门（中国视角版里还是单独的要素）、黄岩岛并进中国，成一个要素；台湾在中国视角版里本来就在中国要素里，脚本会核对
  - 每个环 Douglas-Peucker 抽稀（容差 0.28°），坐标保留 2 位小数；太小的岛和洞丢掉，但每个国家至少留它最大的那块（新加坡、巴林这类小国也在图上）
"""
import json, os, sys

src = sys.argv[1]
out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), "..", "public", "geo", "world-chn.json")

容差 = 0.28  # 度；世界图 1000px 宽时约 0.8px，产物控制在 150KB 内
最小岛 = 0.5  # 平方度：比它小的岛（不是这个国家最大那块）丢掉
最小洞 = 0.5
并进中国 = {"HKG", "MAC", "SCR"}


def 抽稀(点, eps):
    """Douglas-Peucker（非递归），首尾闭合的环先按首点和最远点切两半，免得整个环塌成一条线"""
    n = len(点)
    if n < 4:
        return 点
    留 = [False] * n
    留[0] = 留[-1] = True

    def 距离平方(p, a, b):
        dx, dy = b[0] - a[0], b[1] - a[1]
        if dx == 0 and dy == 0:
            return (p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2
        t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)))
        return (p[0] - a[0] - t * dx) ** 2 + (p[1] - a[1] - t * dy) ** 2

    far = max(range(1, n - 1), key=lambda i: (点[i][0] - 点[0][0]) ** 2 + (点[i][1] - 点[0][1]) ** 2)
    留[far] = True
    栈 = [(0, far), (far, n - 1)]
    e2 = eps * eps
    while 栈:
        s, e = 栈.pop()
        if e - s < 2:
            continue
        i_max, d_max = -1, -1.0
        for i in range(s + 1, e):
            d = 距离平方(点[i], 点[s], 点[e])
            if d > d_max:
                i_max, d_max = i, d
        if d_max > e2:
            留[i_max] = True
            栈.append((s, i_max))
            栈.append((i_max, e))
    return [p for p, k in zip(点, 留) if k]


def 面积(环):
    s = 0.0
    for (x1, y1), (x2, y2) in zip(环, 环[1:]):
        s += x1 * y2 - x2 * y1
    return abs(s) / 2


def 取整(环):
    出 = []
    for x, y in 环:
        p = [round(x, 2), round(y, 2)]
        if not 出 or 出[-1] != p:
            出.append(p)
    if 出 and 出[0] != 出[-1]:
        出.append(出[0])
    return 出


def 抽环(环, eps):
    r = 取整(抽稀(环, eps))
    return r if len(r) >= 4 else None


def 抽要素(多边形们):
    """多边形们 = [[外环, 洞...], ...]（原始坐标）→ 抽稀后的，丢掉小岛、小洞，至少留最大那块"""
    出 = []
    for poly in 多边形们:
        外 = 抽环(poly[0], 容差)
        if not 外 or 面积(外) < 最小岛:
            continue
        洞们 = [h for h in (抽环(h, 容差) for h in poly[1:]) if h and 面积(h) >= 最小洞]
        出.append([外, *洞们])
    if not 出:
        # 小国 / 小岛：整块都比门槛小，留原始面积最大的那块，容差按它的大小缩
        最大 = max(多边形们, key=lambda p: 面积(p[0]))
        外 = None
        for eps in (容差 / 4, 容差 / 16, 0):
            外 = 抽环(最大[0], eps) if eps else 取整(最大[0])
            if 外 and len(外) >= 4:
                break
        if 外 and len(外) >= 4:
            出.append([外])
    return 出


d = json.load(open(src, encoding="utf-8"))
要素 = {}
for f in d["features"]:
    p = f["properties"]
    a3 = p["ADM0_A3"]
    if a3 == "ATA":
        continue
    if a3 in ("TWN",) or "Taiwan" in str(p.get("ADMIN")):
        sys.exit("中国视角版里台湾不该是单独的要素，来源文件不对")
    g = f["geometry"]
    多 = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
    键 = "CHN" if a3 in 并进中国 else a3
    if 键 not in 要素:
        要素[键] = {"props": None, "polys": []}
    if a3 == 键:
        iso = p.get("ISO_A2_EH")
        要素[键]["props"] = {"name": p["NAME_ZH"], **({"iso": iso} if iso and iso != "-99" else {}), "a3": a3}
    要素[键]["polys"].extend(多)

features = []
for 键, v in 要素.items():
    polys = 抽要素(v["polys"])
    if not polys:
        print("丢掉（太小）：", v["props"]["name"], file=sys.stderr)
        continue
    geom = {"type": "Polygon", "coordinates": polys[0]} if len(polys) == 1 else {"type": "MultiPolygon", "coordinates": polys}
    features.append({"type": "Feature", "properties": v["props"], "geometry": geom})
features.sort(key=lambda f: f["properties"]["a3"])

os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
with open(out, "w", encoding="utf-8") as fp:
    json.dump({"type": "FeatureCollection", "features": features}, fp, ensure_ascii=False, separators=(",", ":"))
点数 = sum(len(r) for f in features for poly in (f["geometry"]["coordinates"] if f["geometry"]["type"] == "MultiPolygon" else [f["geometry"]["coordinates"]]) for r in poly)
print(f"{len(features)} 个要素、{点数} 个点 → {out}（{os.path.getsize(out) // 1024} KB）")
