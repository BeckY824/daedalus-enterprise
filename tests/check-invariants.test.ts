/**
 * 数据不变量核对（scripts/check-invariants.mjs，只读）：11-17 复盘「不变量查询套件」。
 * 用 build-template.mjs 现建一份和正式库同结构的空库（每条 SQL 的表、列名跟着 schema 走，改了 schema 这里先红），
 * 造一条违反，断言查得出来、退出码 1、库文件没被改。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { 不变量们, 不过, 字典默认, 跑不变量 } from "../scripts/check-invariants.mjs";
import { 字典定义 } from "@/lib/enterprise/dict-kinds";

const ROOT = path.resolve(__dirname, "..");
const 脚本 = path.join(ROOT, "scripts/check-invariants.mjs");
let dir = "";
let 空库 = "";

beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "invariants-"));
  空库 = path.join(dir, "empty.db");
  execFileSync(process.execPath, ["--experimental-sqlite", "--no-warnings", path.join(ROOT, "scripts/build-template.mjs"), 空库], { cwd: ROOT, stdio: "pipe" });
}, 60_000);
afterAll(() => dir && rmSync(dir, { recursive: true, force: true }));

const 复制 = (名: string) => {
  const 库 = path.join(dir, `${名}.db`);
  const src = new DatabaseSync(空库);
  src.exec(`VACUUM INTO '${库.replaceAll("'", "''")}'`);
  src.close();
  return 库;
};
const 跑 = (库: string, ...参数: string[]) => {
  try {
    return { 码: 0, 出: execFileSync(process.execPath, ["--no-warnings", 脚本, 库, ...参数], { encoding: "utf8" }) };
  } catch (e) {
    const x = e as { status: number; stdout: string; stderr: string };
    return { 码: x.status, 出: x.stdout + x.stderr };
  }
};
const 哈希 = (f: string) => createHash("sha256").update(readFileSync(f)).digest("hex");
const 毫秒 = (d: string) => new Date(d).getTime();

/** 两位客户 A、B，同一位在职销售负责；B 名下一个项目 pB */
function 造基础(db: DatabaseSync) {
  const t = 毫秒("2026-11-01T00:00:00Z");
  db.prepare(`INSERT INTO "User" (id, email, password, name, updatedAt) VALUES ('u1', 'u1@t', 'x', '销售一', ?)`).run(t);
  for (const id of ["cA", "cB"]) db.prepare(`INSERT INTO "Customer" (id, name, phone, salesOwnerId, createdAt, updatedAt) VALUES (?, ?, '', 'u1', ?, ?)`).run(id, id, t, t);
  db.prepare(`INSERT INTO "Project" (id, name, customerId, ownerId, creatorId, createdAt, updatedAt) VALUES ('pB', 'pB', 'cB', 'u1', 'u1', ?, ?)`).run(t, t);
}

describe("空库全过", () => {
  it("每条 SQL 在当前 schema 上都能跑（没有一条「跳过」），全 0，退出码 0", () => {
    const db = new DatabaseSync(空库);
    const 结果 = 跑不变量(db);
    db.close();
    expect(结果.filter((r) => r.跳过).map((r) => `${r.键}：${r.跳过}`)).toEqual([]);
    expect(结果.every((r) => r.违反数 === 0)).toBe(true);
    expect(结果).toHaveLength(不变量们.length);
    expect(不过(结果, true)).toBe(false);
    expect(跑(空库).码).toBe(0);
  });

  it("每条都写了依据；项里不带「|」（报告按「|」分列）；键不重", () => {
    for (const x of 不变量们) {
      expect(x.依据.trim(), x.键).not.toBe("");
      expect(x.项, x.键).not.toContain("|");
    }
    expect(new Set(不变量们.map((x) => x.键)).size).toBe(不变量们.length);
  });

  it("脚本里抄的两类字典默认项和 dict-kinds.ts 一样（脚本要单独 scp 去跑，不 import ts）", () => {
    expect(字典默认.custAssign).toEqual([...字典定义.custAssign.默认]);
    expect(字典默认.followMethod).toEqual([...字典定义.followMethod.默认]);
  });
});

describe("造违反，查得出", () => {
  it("沟通挂在别家客户的项目上 → 违反数 1、列出这条沟通、退出码 1、库文件没被改", () => {
    const 库 = 复制("follow");
    const db = new DatabaseSync(库);
    造基础(db);
    const t = 毫秒("2026-11-02T00:00:00Z");
    // 沟通记在客户 A 上，却挂到客户 B 的项目 pB
    db.prepare(`INSERT INTO "FollowUp" (id, type, title, content, customerId, ownerId, createdAt, updatedAt) VALUES ('f-bad', 'PHONE', '', '', 'cA', 'u1', ?, ?)`).run(t, t);
    db.prepare(`INSERT INTO "FollowUpProject" (followUpId, projectId, node) VALUES ('f-bad', 'pB', '潜客培育')`).run();
    // 对照：挂自己客户的项目，不算
    db.prepare(`INSERT INTO "FollowUp" (id, type, title, content, customerId, ownerId, createdAt, updatedAt) VALUES ('f-ok', 'PHONE', '', '', 'cB', 'u1', ?, ?)`).run(t, t);
    db.prepare(`INSERT INTO "FollowUpProject" (followUpId, projectId, node) VALUES ('f-ok', 'pB', '潜客培育')`).run();
    db.close();

    const 前 = 哈希(库);
    const r = 跑(库);
    expect(r.码).toBe(1);
    expect(r.出).toMatch(/✗ \[违规\] 沟通记录挂的项目属于同一位客户 \| 1 \| f-bad/);
    expect(r.出).toMatch(/结论：不过/);
    expect(哈希(库)).toBe(前);

    const ro = new DatabaseSync(库);
    const 这条 = 跑不变量(ro).find((x) => x.键 === "沟通挂别家客户的项目")!;
    ro.close();
    expect(这条).toMatchObject({ 违反数: 1, 前几: ["f-bad"] });
  });

  it("补建项目晚于首条节点日志：时间列一边整数毫秒、一边 ISO 文本也比得对", () => {
    const 库 = 复制("system");
    const db = new DatabaseSync(库);
    造基础(db);
    const 插项目 = db.prepare(`INSERT INTO "Project" (id, name, customerId, ownerId, creatorId, createdAt, updatedAt) VALUES (?, ?, 'cA', 'u1', 'system', ?, ?)`);
    const 插日志 = db.prepare(`INSERT INTO "ProjectNodeLog" (id, projectId, userId, at, toPhase, toNode) VALUES (?, ?, 'system', ?, '线索', '潜客培育')`);
    插项目.run("p-late", "晚", 毫秒("2026-11-10T00:00:00Z"), 毫秒("2026-11-10T00:00:00Z"));
    插日志.run("l1", "p-late", "2026-11-01T00:00:00.000Z");
    插项目.run("p-ok", "准", 毫秒("2026-11-01T00:00:00Z"), 毫秒("2026-11-01T00:00:00Z"));
    插日志.run("l2", "p-ok", "2026-11-05T00:00:00.000Z");
    插项目.run("p-nolog", "没日志", 毫秒("2026-11-01T00:00:00Z"), 毫秒("2026-11-01T00:00:00Z"));
    db.close();

    const ro = new DatabaseSync(库);
    const 这条 = 跑不变量(ro).find((x) => x.键 === "补建项目晚于首条节点日志")!;
    ro.close();
    expect(这条).toMatchObject({ 违反数: 2, 前几: ["p-late", "p-nolog"] });
  });

  it("只有「待核」非 0 时默认退出码 0，--strict 时 1", () => {
    const 库 = 复制("pending");
    const db = new DatabaseSync(库);
    造基础(db);
    db.prepare(`UPDATE "User" SET active = 0 WHERE id = 'u1'`).run();
    db.close();
    const r = 跑(库);
    expect(r.出).toMatch(/\? \[待核\] 不在公海的客户，负责人在职/);
    expect(r.码).toBe(0);
    expect(跑(库, "--strict").码).toBe(1);
  });

  it("「仅提示」的待核非 0：默认、--strict 退出码都是 0，报告里标「待核·仅提示」", () => {
    const 库 = 复制("hint-only");
    const db = new DatabaseSync(库);
    db.prepare(`INSERT INTO "User" (id, email, password, name, updatedAt) VALUES ('u1', 'u1@t', 'x', '销售一', ?)`).run(毫秒("2026-11-01T00:00:00Z"));
    db.prepare(`INSERT INTO "EntChannelMain" (id, name, updatedAt) VALUES ('m-empty', '空主渠道', ?)`).run(毫秒("2026-11-01T00:00:00Z"));
    db.close();
    const r = 跑(库);
    expect(r.出).toMatch(/\? \[待核·仅提示\] 每个主渠道下面至少挂着一个渠道.* \| 1 \| m-empty/);
    expect(r.码).toBe(0);
    expect(跑(库, "--strict").码).toBe(0);
  });

  it("不给库 → 退出码 2", () => {
    expect(跑("").码).toBe(2);
  });
});

/**
 * 11-18 批次 27B 补的附录 C 13 条：每条造一行违反、再造一两行不该算的，断言违反数 1、列出的正是那一行。
 * 都在 造基础 上加（cA 零项目、不在公海；cB 名下有 pB）
 */
describe("附录 C 补的 13 条（待核·仅提示）：命中 1 行、对照 0 行", () => {
  const t = 毫秒("2026-11-02T00:00:00Z");
  const 插客户 = (db: DatabaseSync, id: string, 列: Record<string, string | number | null> = {}) => {
    const 名们 = ["id", "name", "phone", "salesOwnerId", "createdAt", "updatedAt", ...Object.keys(列)];
    const 值们 = [id, id, "", "u1", t, t, ...Object.values(列)];
    db.prepare(`INSERT INTO "Customer" (${名们.map((x) => `"${x}"`).join(", ")}) VALUES (${名们.map(() => "?").join(", ")})`).run(...值们);
  };
  const 插沟通 = (db: DatabaseSync, id: string, customerId: string, 列: { type?: string; title?: string; method?: string | null; occurredAt?: number | string; deletedAt?: number | null } = {}) =>
    db
      .prepare(`INSERT INTO "FollowUp" (id, type, title, content, customerId, ownerId, method, occurredAt, deletedAt, createdAt, updatedAt) VALUES (?, ?, ?, '', ?, 'u1', ?, ?, ?, ?, ?)`)
      .run(id, 列.type ?? "PHONE", 列.title ?? "", customerId, 列.method ?? null, 列.occurredAt ?? t, 列.deletedAt ?? null, t, t);
  const 插号 = (db: DatabaseSync, id: string, customerId: string, kind: string, numberKey: string, formatStatus = "ok") =>
    db.prepare(`INSERT INTO "ContactMethod" (id, customerId, kind, value, numberKey, formatStatus) VALUES (?, ?, ?, ?, ?, ?)`).run(id, customerId, kind, numberKey, numberKey, formatStatus);

  const 用例: { 键: string; 造: (db: DatabaseSync) => void; 命中: string }[] = [
    {
      键: "非公海零项目客户",
      // cA 零项目不在公海 → 命中；cB 有项目、cP 零项目但在公海 → 不算
      造: (db) => {
        插客户(db, "cP");
        db.prepare(`INSERT INTO "CustomerPool" (customerId) VALUES ('cP')`).run();
      },
      命中: "cA",
    },
    {
      键: "沟通没挂项目",
      造: (db) => {
        插沟通(db, "f-bad", "cB");
        插沟通(db, "f-task", "cB", { type: "TASK" });
        插沟通(db, "f-ok", "cB");
        db.prepare(`INSERT INTO "FollowUpProject" (followUpId, projectId, node) VALUES ('f-ok', 'pB', '潜客培育')`).run();
        插沟通(db, "f-del", "cB", { deletedAt: t });
        // 同号再次录入的系统留痕：客户没项目时只挂客户，不算没挂
        插沟通(db, "f-mark", "cB", { title: "同号再次录入" });
        插沟通(db, "f-mark2", "cB", { title: "同号再次录入（来源不同）" });
      },
      命中: "f-bad",
    },
    {
      键: "联系人缺挂靠行",
      造: (db) => {
        for (const [id, cid] of [["ct-bad", "cA"], ["ct-ok", "cB"]]) db.prepare(`INSERT INTO "Contact" (id, name, customerId, updatedAt) VALUES (?, ?, ?, ?)`).run(id, id, cid, t);
        db.prepare(`INSERT INTO "ContactCustomer" (id, contactId, customerId) VALUES ('cc1', 'ct-ok', 'cB')`).run();
        // 只挂在别的客户上、没有主客户那一行：也算缺
        db.prepare(`INSERT INTO "ContactCustomer" (id, contactId, customerId) VALUES ('cc2', 'ct-bad', 'cB')`).run();
      },
      命中: "ct-bad",
    },
    {
      键: "客户分配字典外",
      // cA 乱写 → 命中；cB 是库里自建的一项、cC 是默认项（库里这一类没建过）→ 不算
      造: (db) => {
        db.prepare(`UPDATE "Customer" SET assignWay = '乱写' WHERE id = 'cA'`).run();
        db.prepare(`INSERT INTO "EntDictItem" (id, kind, name) VALUES ('d1', 'custAssign', '自建一项')`).run();
        db.prepare(`UPDATE "Customer" SET assignWay = '自建一项' WHERE id = 'cB'`).run();
        插客户(db, "cC", { assignWay: "非自持" });
      },
      命中: "cA",
    },
    {
      键: "沟通方式字典外",
      造: (db) => {
        插沟通(db, "f-bad", "cB", { method: "未注明" });
        插沟通(db, "f-ok", "cB", { method: "微信沟通" });
        插沟通(db, "f-null", "cB", { type: "TASK", method: null });
      },
      命中: "f-bad",
    },
    {
      键: "客户电话带字母",
      造: (db) => {
        db.prepare(`UPDATE "Customer" SET phone = 'abc12345' WHERE id = 'cA'`).run();
        db.prepare(`UPDATE "Customer" SET phone = '+85291234567' WHERE id = 'cB'`).run();
      },
      命中: "cA",
    },
    {
      键: "号码格式待核对",
      造: (db) => {
        插号(db, "cm-bad", "cA", "wechat", "x", "待核对");
        插号(db, "cm-ok", "cA", "wechat", "y");
      },
      命中: "cm-bad",
    },
    {
      键: "同号多客户",
      // cm1 / cm2 同种类同键、两位客户 → 一组，记组里最小的 cm1；同一位客户自己两行同键、种类不同的同键 → 不算
      造: (db) => {
        插号(db, "cm1", "cA", "phone", "13800000001");
        插号(db, "cm2", "cB", "phone", "13800000001");
        插号(db, "cm3", "cA", "wechat", "wx1");
        插号(db, "cm4", "cA", "wechat", "wx1");
        插号(db, "cm5", "cB", "whatsapp", "wx1");
      },
      命中: "cm1",
    },
    {
      键: "客户电话没清空",
      // cA 电话还有号 → 命中；cB 只剩空白 → 算清空了；cC 电话空串 → 不算
      造: (db) => {
        db.prepare(`UPDATE "Customer" SET phone = '13800000001' WHERE id = 'cA'`).run();
        db.prepare(`UPDATE "Customer" SET phone = '  ' WHERE id = 'cB'`).run();
        插客户(db, "cC");
      },
      命中: "cA",
    },
    {
      键: "最近跟进对不上",
      // cA：最近跟进存整数毫秒、沟通发生时间存 ISO 文本，同一刻 → 对得上；
      // cB：最近跟进比实际最后一条晚（删了的那条、未来的那条都不算）→ 命中；cC 没沟通、最近跟进空 → 对得上；
      // cD：最后两条是同号再次录入的系统留痕（两种标题），最近跟进停在前一条真沟通 → 对得上（same-number-mark.ts：留痕不续最近跟进）
      造: (db) => {
        db.prepare(`UPDATE "Customer" SET lastFollowAt = ? WHERE id = 'cA'`).run(t);
        插沟通(db, "f-a", "cA", { occurredAt: "2026-11-02T00:00:00.000Z" });
        db.prepare(`UPDATE "Customer" SET lastFollowAt = ? WHERE id = 'cB'`).run(毫秒("2026-11-05T00:00:00Z"));
        插沟通(db, "f-b", "cB");
        插沟通(db, "f-b-del", "cB", { occurredAt: 毫秒("2026-11-05T00:00:00Z"), deletedAt: t });
        插沟通(db, "f-b-future", "cB", { occurredAt: 毫秒("2099-01-01T00:00:00Z") });
        插客户(db, "cC");
        插客户(db, "cD");
        db.prepare(`UPDATE "Customer" SET lastFollowAt = ? WHERE id = 'cD'`).run(t);
        插沟通(db, "f-d", "cD");
        插沟通(db, "f-d-mark", "cD", { title: "同号再次录入", occurredAt: 毫秒("2026-11-03T00:00:00Z") });
        插沟通(db, "f-d-mark2", "cD", { title: "同号再次录入（来源不同）", occurredAt: 毫秒("2026-11-04T00:00:00Z") });
      },
      命中: "cB",
    },
    {
      键: "渠道全称和主渠道名对不上",
      造: (db) => {
        db.prepare(`INSERT INTO "EntChannelMain" (id, name, updatedAt) VALUES ('m1', '广交会', ?)`).run(t);
        for (const [id, name] of [["ch-bad", "2026春季广交会"], ["ch-same", "广交会"], ["ch-half", "广交会|2026春季"], ["ch-full", "广交会｜2026秋季"]])
          db.prepare(`INSERT INTO "Channel" (id, name, channelOwnerId, mainId, updatedAt) VALUES (?, ?, 'u1', 'm1', ?)`).run(id, name, t);
        // 没挂主渠道的老渠道不查
        db.prepare(`INSERT INTO "Channel" (id, name, channelOwnerId, updatedAt) VALUES ('ch-old', '随便', 'u1', ?)`).run(t);
      },
      命中: "ch-bad",
    },
    {
      键: "主渠道下没有渠道",
      造: (db) => {
        db.prepare(`INSERT INTO "EntChannelMain" (id, name, allowSub, updatedAt) VALUES ('m-empty', '单一入口', 0, ?)`).run(t);
        db.prepare(`INSERT INTO "EntChannelMain" (id, name, updatedAt) VALUES ('m-ok', '有渠道', ?)`).run(t);
        db.prepare(`INSERT INTO "Channel" (id, name, channelOwnerId, mainId, updatedAt) VALUES ('ch1', '有渠道', 'u1', 'm-ok', ?)`).run(t);
      },
      命中: "m-empty",
    },
    {
      键: "客户名夹手机号",
      造: (db) => {
        db.prepare(`UPDATE "Customer" SET name = '王先生13800138000' WHERE id = 'cA'`).run();
        插客户(db, "cC");
        db.prepare(`UPDATE "Customer" SET name = '门店1234567' WHERE id = 'cC'`).run();
        插客户(db, "cD");
        db.prepare(`UPDATE "Customer" SET name = '王先生13900139000', deletedAt = ? WHERE id = 'cD'`).run(t);
      },
      命中: "cA",
    },
  ];

  it("13 条都在、都是待核·仅提示", () => {
    for (const { 键 } of 用例) expect(不变量们.find((x) => x.键 === 键), 键).toMatchObject({ 级别: "待核", 仅提示: true });
    expect(不变量们.filter((x) => x.仅提示).map((x) => x.键).sort()).toEqual(用例.map((x) => x.键).sort());
  });

  for (const 例 of 用例) {
    it(例.键, () => {
      const 库 = 复制(`b27-${用例.indexOf(例)}`);
      const db = new DatabaseSync(库);
      造基础(db);
      例.造(db);
      db.close();
      const ro = new DatabaseSync(库);
      const 这条 = 跑不变量(ro).find((x) => x.键 === 例.键)!;
      ro.close();
      expect(这条).toMatchObject({ 违反数: 1, 前几: [例.命中], 仅提示: true });
    });
  }
});
