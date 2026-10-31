import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { 客户看板分列, 未设置名 } from "@/lib/enterprise/cust-attr";
import { 字典定义, 字典种类们 } from "@/lib/enterprise/dict-kinds";
import { 同步计划, 同步客户属性, 定好的, 报告 } from "../scripts/sync-cust-attr.mjs";

const 十项 = ["自用非商用", "个人投资者", "个体工商户", "商贸代理公司", "文旅商业公司", "文旅主管单位", "科教文体单位", "国企国资平台", "园区管委会", "招标代理商"];

describe("客户属性字典（A-17）", () => {
  it("预设是定好的 10 项、按定好的顺序；同步脚本用的是同一份", () => {
    expect(字典种类们).toContain("custAttr");
    expect(字典定义.custAttr.默认).toEqual(十项);
    expect(定好的).toEqual(十项);
  });
});

describe("客户看板分列", () => {
  type 行 = { id: string; attr: string | null };
  const 字典 = 十项.map((name) => ({ name, active: true }));
  const 取 = (r: 行) => r.attr;

  it("启用的项按字典顺序全摆（空的也摆）；全有值时不摆「未设置」", () => {
    const 列们 = 客户看板分列<行>([{ id: "a", attr: "园区管委会" }, { id: "b", attr: "自用非商用" }], 取, 字典);
    expect(列们.map((c) => c.名)).toEqual(十项);
    expect(列们.find((c) => c.名 === "园区管委会")!.行们.map((r) => r.id)).toEqual(["a"]);
    expect(列们.some((c) => c.key === null)).toBe(false);
  });

  it("没填的进「未设置」，摆在最后", () => {
    const 列们 = 客户看板分列<行>([{ id: "a", attr: null }, { id: "b", attr: "  " }, { id: "c", attr: "个体工商户" }], 取, 字典);
    const 末 = 列们.at(-1)!;
    expect(末).toMatchObject({ key: null, 名: 未设置名 });
    expect(末.行们.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("停用的、字典里没有的旧值：有客户才摆，标停用，在启用项之后、未设置之前", () => {
    const 带旧 = [...字典, { name: "旧甲", active: false }, { name: "旧乙", active: false }];
    const 列们 = 客户看板分列<行>(
      [{ id: "a", attr: "字典外" }, { id: "b", attr: "旧乙" }, { id: "c", attr: null }],
      取,
      带旧,
    );
    expect(列们.map((c) => c.名)).toEqual([...十项, "旧乙", "字典外", 未设置名]);
    expect(列们.find((c) => c.名 === "旧乙")!.停用).toBe(true);
    expect(列们.some((c) => c.名 === "旧甲")).toBe(false);
  });

  it("管理员加的新属性（启用）跟在后面照样有列", () => {
    const 列们 = 客户看板分列<行>([], 取, [...字典, { name: "新加的", active: true }]);
    expect(列们.map((c) => c.名)).toEqual([...十项, "新加的"]);
  });
});

describe("scripts/sync-cust-attr.mjs", () => {
  const DDL = readFileSync(path.join(__dirname, "../migrations/057-ent-dict.sql"), "utf8");
  let dir = "";
  const 开库 = () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "cust-attr-"));
    const db = new DatabaseSync(path.join(dir, "t.db"));
    db.exec(DDL);
    db.exec(`CREATE TABLE "Customer" (id TEXT PRIMARY KEY, name TEXT, customerAttr TEXT)`);
    return db;
  };
  const 行们 = (db: DatabaseSync) =>
    db.prepare(`SELECT id, name, sort, active FROM "EntDictItem" WHERE kind = 'custAttr' ORDER BY sort`).all() as { id: string; name: string; sort: number; active: number }[];

  it("纯算：已经是 10 项启用、顺序对 → 没有要改的", () => {
    const 现有 = 十项.map((name, i) => ({ id: `x${i}`, name, sort: i, active: true }));
    expect(同步计划(现有)).toEqual({ 建: [], 改: [] });
  });

  it("空库：建 10 项，固定 id，演练不落库、第二遍演练照样是 10 项要建", () => {
    const db = 开库();
    try {
      const 演练 = 同步客户属性(db, { 写: false });
      expect(演练.建).toHaveLength(10);
      expect(行们(db)).toHaveLength(0);
      同步客户属性(db, { 写: true });
      const r = 行们(db);
      expect(r.map((x) => x.name)).toEqual(十项);
      expect(r.map((x) => x.id)).toEqual(十项.map((_, i) => `dict-custAttr-${i}`));
      expect(r.every((x) => x.active === 1)).toBe(true);
      const 第二遍 = 同步客户属性(db, { 写: false });
      expect(第二遍).toEqual({ 建: [], 改: [] });
      expect(报告(第二遍)).toMatch(/没有要改的/);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("旧的 12 项都标未启用、有客户用着旧值：10 项启用并排好，旧的停用不删，客户数据不动，可重复跑", () => {
    const db = 开库();
    try {
      const 旧 = ["旧一", "个体工商户", "旧二", "旧三", "旧四", "国企国资平台", "旧五", "旧六", "旧七", "旧八", "旧九", "旧十"];
      const ins = db.prepare(`INSERT INTO "EntDictItem" (id, kind, name, sort, active, createdAt) VALUES (?, 'custAttr', ?, ?, 0, ?)`);
      旧.forEach((n, i) => ins.run(i === 0 ? "dict-custAttr-0" : `old-${i}`, n, i, 1700000000000 + i));
      db.prepare(`INSERT INTO "EntDictItem" (id, kind, name, sort, active, createdAt) VALUES ('o', 'custStatus', '潜在', 0, 1, 1)`).run();
      db.prepare(`INSERT INTO "Customer" VALUES ('c1', '甲', '旧二'), ('c2', '乙', '个体工商户'), ('c3', '丙', NULL)`).run();

      同步客户属性(db, { 写: true });
      const r = 行们(db);
      expect(r).toHaveLength(10 + 10); // 10 项 + 留下的 10 个旧的（两个旧的本来就在 10 项里）
      expect(r.slice(0, 10).map((x) => x.name)).toEqual(十项);
      expect(r.slice(0, 10).every((x) => x.active === 1)).toBe(true);
      expect(r.slice(10).map((x) => x.name)).toEqual(["旧一", "旧二", "旧三", "旧四", "旧五", "旧六", "旧七", "旧八", "旧九", "旧十"]);
      expect(r.slice(10).every((x) => x.active === 0)).toBe(true);
      // 固定 id 被旧行占了：另起一个，不撞
      expect(new Set(r.map((x) => x.id)).size).toBe(r.length);
      // 别的种类、客户数据一格不动
      expect(db.prepare(`SELECT active FROM "EntDictItem" WHERE kind = 'custStatus'`).get()).toEqual({ active: 1 });
      expect(db.prepare(`SELECT id, customerAttr FROM "Customer" ORDER BY id`).all()).toEqual([
        { id: "c1", customerAttr: "旧二" },
        { id: "c2", customerAttr: "个体工商户" },
        { id: "c3", customerAttr: null },
      ]);
      // createdAt 跟库里已有的行一个存法（毫秒数）
      const 新 = db.prepare(`SELECT createdAt FROM "EntDictItem" WHERE name = '自用非商用'`).get() as { createdAt: unknown };
      expect(typeof 新.createdAt).toBe("number");
      expect(同步客户属性(db, { 写: false })).toEqual({ 建: [], 改: [] });
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
