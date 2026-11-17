#!/usr/bin/env python3
"""
导入后填充率报告（只读）：对一份企业版库按字段算填充率（非空占比），重点字段低于阈值的标出来。

起因（11-17 复盘第 6 类）：「客户分配」8 万多位客户里只有 1 位有值、项目「分配方式」只有 1.8% 有值，
都是界面上显示、却没有系统路径写的字段，客户先发现。每次导入 / 回填之后跑一遍，重点字段低于阈值的逐个过：
是该由系统写却没人写（补写入方，见 tests/field-coverage.test.ts 的「系统事实」），还是本来就可空（在下面写明）。

用法：
  python3 scripts/fill-rate-report.py <crm.db 路径> [--threshold 5] [--all] [--tables Customer,Project]

  <crm.db 路径>  要查的库。**只读打开**（sqlite URI mode=ro），不写库；正式库请先拷一份副本再跑，别直接开原库
  --threshold   重点字段低于这个百分比标「⚠ 偏低」，默认 5（复盘定的线）
  --all         除了重点字段，把这几张表其余每一列的填充率也列出来
  --tables      只看哪几张表，逗号分隔，默认 Customer,Project,FollowUp,Channel,Contact

输出（纯文本，可直接贴进报告）：
  第一行写库路径、取数时间（UTC）、阈值；每张表一段，先写行数（已删的不算），再逐个字段：
  字段  中文名  有值 / 分母  填充率  占位值  标记
  - 分母默认是这张表没删的行；带「条件」的字段（比如渠道负责人只看有来源渠道的客户）分母是满足条件的行
  - 空值 = NULL、空串、只有空白；「占位值」= 未注明 / 暂未确认 / 暂不确认 / 未知 / — 这类，不算有值，单独数出来
    （全站约定没填就显示「—」，库里不该有占位值）
  - 末尾汇总：标了「⚠ 偏低」的重点字段一共几个
"""
import argparse
import datetime
import os
import sqlite3
import sys

# 占位值：看着像填了、其实没填（全站约定没填显示「—」，不该写进库）
占位值 = ("未注明", "暂未确认", "暂不确认", "未知", "—", "-")

# 每张表的「没删」条件（有 deletedAt 的表按它排掉回收站里的）
# 重点字段：界面上显示、导入或系统该写的。(列, 中文名, 额外条件 or None)
重点字段 = {
    "Customer": [
        ("phone", "电话", None),
        ("channelId", "来源渠道", None),
        ("salesOwnerId", "负责人", None),
        ("channelOwnerId", "渠道负责人（有来源渠道的）", '"channelId" IS NOT NULL'),
        ("assignWay", "客户分配", None),
        ("customerType", "客户类型", None),
        ("customerAttr", "客户属性", None),
        ("bizLine", "业务线", None),
        ("touchpoint", "渠道触点", None),
        ("addrProvince", "省份", None),
        ("addrCity", "城市", None),
        ("lastFollowAt", "最近跟进", None),
    ],
    "Project": [
        ("ownerId", "负责人", None),
        ("contactId", "联系人", None),
        ("channelId", "来源渠道", None),
        ("assignMode", "分配方式", None),
        ("bizLine", "业务线", None),
        ("nextStepAt", "下一步时间（进行中的）", '"result" IS NULL'),
        ("nextStepText", "下一步（进行中的）", '"result" IS NULL'),
        ("expectedDealAt", "预计成交时间（商机 / 订单）", '"phase" IN (\'商机\', \'订单\')'),
        ("amount", "商机金额（商机 / 订单）", '"phase" IN (\'商机\', \'订单\')'),
        ("closedAt", "结束时间（有结局的）", '"result" IS NOT NULL'),
    ],
    "FollowUp": [
        ("method", "沟通方式", None),
        ("contactId", "联系人", None),
        ("occurredAt", "发生时间", None),
    ],
    "Channel": [
        ("channelOwnerId", "渠道负责人", None),
        ("mainId", "主渠道", None),
        ("attr", "渠道属性", None),
        ("platform", "平台", None),
    ],
    "Contact": [
        ("phone", "电话", None),
        ("position", "职务", None),
    ],
}

# amount 这类数字列 0 也算「没填」（库里默认 0）
数字默认零 = {("Project", "amount")}


def 列们(con, 表):
    return [r[1] for r in con.execute(f'PRAGMA table_info("{表}")')]


def 有值条件(表, 列):
    q = f'"{列}"'
    基本 = f"{q} IS NOT NULL AND TRIM(CAST({q} AS TEXT)) <> ''"
    if (表, 列) in 数字默认零:
        基本 += f" AND {q} <> 0"
    占 = ", ".join("'" + v + "'" for v in 占位值)
    return 基本 + f" AND TRIM(CAST({q} AS TEXT)) NOT IN ({占})"


def 占位条件(列):
    占 = ", ".join("'" + v + "'" for v in 占位值)
    return f'TRIM(CAST("{列}" AS TEXT)) IN ({占})'


def 算一列(con, 表, 列, 底, 条件):
    where = " AND ".join(x for x in (底, 条件) if x) or "1=1"
    分母 = con.execute(f'SELECT COUNT(*) FROM "{表}" WHERE {where}').fetchone()[0]
    有 = con.execute(f'SELECT COUNT(*) FROM "{表}" WHERE {where} AND {有值条件(表, 列)}').fetchone()[0]
    占 = con.execute(f'SELECT COUNT(*) FROM "{表}" WHERE {where} AND {占位条件(列)}').fetchone()[0]
    return 有, 分母, 占


def 百分比(有, 分母):
    return (有 * 100.0 / 分母) if 分母 else 0.0


def main():
    ap = argparse.ArgumentParser(description="导入后填充率报告（只读）")
    ap.add_argument("db")
    ap.add_argument("--threshold", type=float, default=5.0)
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--tables", default="Customer,Project,FollowUp,Channel,Contact")
    a = ap.parse_args()

    if not os.path.exists(a.db):
        sys.exit(f"找不到库：{a.db}")
    con = sqlite3.connect(f"file:{os.path.abspath(a.db)}?mode=ro", uri=True)
    现在 = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    print(f"填充率报告  库={a.db}  取数={现在}  阈值={a.threshold:g}%  （只读）")

    偏低 = []
    for 表 in [t.strip() for t in a.tables.split(",") if t.strip()]:
        有的列 = 列们(con, 表)
        if not 有的列:
            print(f"\n[{表}] 库里没有这张表，跳过")
            continue
        底 = '"deletedAt" IS NULL' if "deletedAt" in 有的列 else ""
        总 = con.execute(f'SELECT COUNT(*) FROM "{表}"' + (f" WHERE {底}" if 底 else "")).fetchone()[0]
        print(f"\n[{表}] {总} 行" + ("（不含回收站）" if 底 else ""))
        看过 = set()
        for 列, 名, 条件 in 重点字段.get(表, []):
            if 列 not in 有的列:
                print(f"  {列:<16} {名:<20} 库里没有这一列")
                continue
            看过.add(列)
            有, 分母, 占 = 算一列(con, 表, 列, 底, 条件)
            率 = 百分比(有, 分母)
            标 = "⚠ 偏低" if 分母 and 率 < a.threshold else ""
            if 标:
                偏低.append(f"{表}.{列}（{名}）{率:.1f}%")
            print(f"  {列:<16} {名:<20} {有:>7} / {分母:<7} {率:6.1f}%  占位 {占:<6} {标}".rstrip())
        if a.all:
            for 列 in 有的列:
                if 列 in 看过 or 列 == "id":
                    continue
                有, 分母, 占 = 算一列(con, 表, 列, 底, None)
                print(f"  {列:<16} {'(其余列)':<20} {有:>7} / {分母:<7} {百分比(有, 分母):6.1f}%  占位 {占}")

    print(f"\n重点字段低于 {a.threshold:g}% 的：{len(偏低)} 个" + ("：" + "；".join(偏低) if 偏低 else ""))
    con.close()


if __name__ == "__main__":
    main()
