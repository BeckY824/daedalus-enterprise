/**
 * 守卫（E-417 包 1，迁移 194）：仓里每一处写 pool-release 留痕的地方，都要同时写 poolPrevOwnerId（最近一次放进公海时的原负责人）。
 * 源码扫描，不连库：src 和 scripts 里凡是出现 "pool-release" 字样的文件都必须在下面归类——
 *   写  = 自己写这一列（含必须出现的记号）；
 *   走公共写法 = 只通过 记转让 / 记换负责人 写留痕，列由公共函数写；
 *   读  = 只读留痕或只在注释里提到（断言里面没有 create / createMany / INSERT 写 pool-release）；
 *   豁免 = 一次性脚本，写明理由。
 * 新加的文件提到 pool-release 没归类就红：要么写列，要么归到读 / 走公共写法并想清楚。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");

function 扫(dir: string, 出: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "generated" || e.name === "node_modules") continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) 扫(f, 出);
    else if (/\.(ts|tsx|mjs|cjs|js)$/.test(e.name)) 出.push(path.relative(ROOT, f));
  }
  return 出;
}

/**
 * 写 / 走公共写法的文件把写形态的次数钉死（多一处就红，逼着人去看有没有同时写列）。
 * 扫不到的：不写 "pool-release" 字面量、从常量取 kind 再传给 转让痕 / 记转让 / 记换负责人 的新写法——这种要靠 review，
 * 所以不要这样写（要加一处就改这张表，让守卫看得见）。
 */
type 形态 = { re: RegExp; n: number; /** true = 这一处是「直接写留痕」，必须各有一次 记放回人 / 记客户放回人 / 直接写列 对上 */ 对应?: boolean };
/** 字面量 "pool-release" 在文件里出现的总次数（不管换行、先赋值再写、createMany，多写一处就红）；无主留痕( 同理 */
const 字面量总数: Record<string, { 总: number; 无主留痕?: number }> = {
  "src/lib/project/db.ts": { 总: 6 },
  "src/lib/offboard-move.ts": { 总: 1 },
  "src/lib/enterprise-import/project-target.ts": { 总: 3, 无主留痕: 3 }, // 定义 1 + 调用 2
  "src/lib/owner-log-db.ts": { 总: 5 },
  "src/lib/enterprise/pool-owner-backfill.ts": { 总: 1 },
  "src/lib/enterprise/pool-link.ts": { 总: 2 },
  "src/lib/enterprise-import/apply.ts": { 总: 2 },
};
const 写: Record<string, { 形态: 形态[]; 放回人: RegExp; 放回人次数: number }> = {
  // 记转让 里 kind 是变量，pool-release 时调 记放回人（一处）；调用方只传 "pool-release"，次数钉死
  "src/lib/project/db.ts": {
    形态: [
      { re: /转让痕\([^\n]*"pool-release"/g, n: 0 },
      { re: /记转让\([^\n]*"pool-release"/g, n: 2 },
      { re: /kind === "pool-release"\) await 记放回人\(/g, n: 1, 对应: true },
      { re: /kind: "pool-release"/g, n: 0 },
    ],
    放回人: /await 记放回人\(/g, 放回人次数: 1,
  },
  "src/lib/offboard-move.ts": {
    形态: [{ re: /转让痕\([^\n]*"pool-release"/g, n: 1, 对应: true }, { re: /kind: "pool-release"/g, n: 0 }],
    放回人: /await 记放回人\(/g, 放回人次数: 1,
  },
  "src/lib/enterprise-import/project-target.ts": {
    形态: [
      { re: /projectNodeLog\.create\(\{ data: 无主留痕\(/g, n: 2, 对应: true },
      { re: /转让痕\([^\n]*"pool-release"/g, n: 0 },
      { re: /kind: "pool-release"/g, n: 1 }, // 无主留痕 里那一处
    ],
    放回人: /await 记放回人\(/g, 放回人次数: 2,
  },
  // 记换负责人 里 kind 是变量，pool-release 时调 记客户放回人（一处）；kind: "pool-release" 的 3 处都是读（where）
  "src/lib/owner-log-db.ts": {
    形态: [
      { re: /customerOwnerLog\.create(Many)?\(/g, n: 1 },
      { re: /kind === "pool-release"\) \{\s*await 记客户放回人\(/g, n: 1, 对应: true },
      { re: /kind: "pool-release"/g, n: 3 },
    ],
    放回人: /await 记客户放回人\(/g, 放回人次数: 1,
  },
  "src/lib/enterprise/pool-owner-backfill.ts": {
    形态: [{ re: /customerOwnerLog\.create\([\s\S]{0,300}kind: "pool-release"/g, n: 1, 对应: true }],
    放回人: /poolPrevOwnerId: c\.salesOwnerId/g, 放回人次数: 1,
  },
};
/** 只通过 记转让 / 记换负责人 写，次数钉死，必须真的调到它们 */
const 走公共写法: Record<string, { re: RegExp; n: number }> = {
  "src/lib/enterprise/pool-link.ts": { re: /(记转让|记换负责人)\([^\n]*"pool-release"/g, n: 2 },
  "src/lib/enterprise-import/apply.ts": { re: /记换负责人\([^\n]*"pool-release"/g, n: 1 },
};
const 豁免: Record<string, string> = {
  "scripts/ent-x147-record-only-backfill.ts": "一次性导入脚本（已跑完）：直接插 pool-release 且 fromOwnerId 恒为 null，新列默认就是 null，值一致",
};
const 读 = new Set([
  "scripts/backfill-direct-assign-202611.cjs",
  "scripts/check-invariants.mjs",
  "src/app/(app)/customers/[id]/history-data.ts",
  "src/app/(app)/customers/handover-actions.ts",
  "src/app/(app)/customers/pool-actions.ts",
  "src/app/(app)/pool/actions.ts",
  "src/app/(app)/projects/[id]/ProjectDetail.tsx",
  "src/app/(app)/projects/[id]/load.ts",
  "src/lib/agent/query.ts",
  "src/lib/enterprise/channel-dash-db.ts",
  "src/lib/enterprise/channel-dash.ts",
  "src/lib/enterprise/contact-dedupe.ts",
  "src/lib/enterprise/cust-status-undo.ts",
  "src/lib/enterprise/line-viewer.ts",
  "src/lib/enterprise/merge-moved-logs.ts",
  "src/lib/enterprise/notice-sources.ts",
  "src/lib/enterprise/pool-prev-owner-backfill.ts", // 回填脚本的逻辑：读最近一条 pool-release 回填，只写列、不写留痕
  "src/lib/enterprise/pool-rules.ts",
  "src/lib/enterprise/pool-undo.ts",
  "src/lib/enterprise/restore-inactive-owner.ts",
  "src/lib/enterprise/tri-state-db.ts",
  "src/lib/enterprise/tri-state-label.ts",
  "src/lib/enterprise/unbuilt-record.ts",
  "src/lib/enterprise/unified-pool-db.ts",
  "src/lib/enterprise/unified-pool.ts",
  "src/lib/enterprise/visibility.ts",
  "src/lib/offboard-db.ts",
  "src/lib/owner-log.ts",
  "src/lib/project/carry-tasks.ts",
  "src/lib/project/customer-detail-direct.ts",
  "src/lib/project/node-log-text.ts",
  "src/lib/project/pool-owner.ts",
  "src/lib/project/recycle-count.ts",
  "src/lib/team-scope.ts",
]);

const 源 = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const 提到 = [...扫(path.join(ROOT, "src")), ...扫(path.join(ROOT, "scripts"))].filter((f) => 源(f).includes("pool-release")).sort();

describe("每处写 pool-release 都要同时写 poolPrevOwnerId（迁移 194）", () => {
  it("提到 pool-release 的文件都已归类（新文件没归类 = 红）", () => {
    const 已归 = new Set([...Object.keys(写), ...Object.keys(走公共写法), ...Object.keys(豁免), ...读]);
    expect(提到.filter((f) => !已归.has(f))).toEqual([]);
    // 归类里的文件不能已经不存在或不再提到（改名了要同步）
    expect([...已归].filter((f) => !提到.includes(f))).toEqual([]);
  });

  for (const [f, { 形态: 们, 放回人, 放回人次数 }] of Object.entries(写)) {
    it(`${f} 写形态的次数钉死，且和 记放回人 / 写列的次数对上（多一处就红）`, () => {
      const 次 = (re: RegExp) => 源(f).match(re)?.length ?? 0;
      for (const { re, n } of 们) expect({ 形态: re.source, 次数: 次(re) }).toEqual({ 形态: re.source, 次数: n });
      expect(次(放回人)).toBe(放回人次数);
      expect(们.filter((x) => x.对应).reduce((和, x) => 和 + x.n, 0)).toBe(放回人次数);
    });
  }

  for (const [f, { 总, 无主留痕 }] of Object.entries(字面量总数)) {
    it(`${f} 里 "pool-release" 字面量总次数钉死（跨行 / createMany / 先赋值再写也拦得住）`, () => {
      expect(源(f).match(/"pool-release"/g)?.length ?? 0).toBe(总);
      if (无主留痕 !== undefined) expect(源(f).match(/无主留痕\(/g)?.length ?? 0).toBe(无主留痕);
    });
  }
  it("字面量总数表覆盖所有写 / 走公共写法的文件", () => {
    expect(Object.keys(字面量总数).sort()).toEqual([...Object.keys(写), ...Object.keys(走公共写法)].sort());
  });

  for (const [f, { re, n }] of Object.entries(走公共写法)) {
    it(`${f} 只走 记转让 / 记换负责人 写（列由公共函数写），次数钉死`, () => {
      expect(源(f).match(re)?.length ?? 0).toBe(n);
      expect(源(f)).not.toMatch(/(projectNodeLog|customerOwnerLog)\.create/);
      expect(源(f)).not.toMatch(/INSERT INTO "(ProjectNodeLog|CustomerOwnerLog)"/);
    });
  }

  for (const f of 读) {
    it(`${f}（读）没有写 pool-release 留痕的地方`, () => {
      const t = 源(f);
      expect(t).not.toMatch(/转让痕\([^\n]*"pool-release"/);
      expect(t).not.toMatch(/(记转让|记换负责人)\([^\n]*"pool-release"/);
      expect(t).not.toMatch(/INSERT INTO "(ProjectNodeLog|CustomerOwnerLog)"/i);
      // create / createMany 后面 600 字以内出现 pool-release（含 kind: "pool-release"）
      for (const m of t.matchAll(/(projectNodeLog|customerOwnerLog)\.create(Many)?\(/g)) {
        expect(t.slice(m.index!, m.index! + 600), `${f} 里 ${m[0]} 附近出现 pool-release`).not.toContain("pool-release");
      }
    });
  }

  it("公共函数里的列写法没被改掉：记转让 / 记换负责人 都调了 记放回人 / 记客户放回人，写的是 poolPrevOwnerId", () => {
    expect(源("src/lib/project/db.ts")).toMatch(/data: \{ poolPrevOwnerId: 人 \}/);
    expect(源("src/lib/owner-log-db.ts")).toMatch(/data: \{ poolPrevOwnerId: 人 \}/);
  });

  it("豁免的都写了理由", () => {
    for (const [, 理由] of Object.entries(豁免)) expect(理由.length).toBeGreaterThan(8);
  });
});
