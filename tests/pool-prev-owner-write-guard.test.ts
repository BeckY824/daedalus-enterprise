/**
 * 守卫（E-417 包 1，迁移 194）：仓里每一处写 pool-release 留痕的地方，都要同时写 poolPrevOwnerId（最近一次放进公海时的原负责人）。
 * 源码扫描，不连库：src 和 scripts 里凡是出现 "pool-release" 字样的文件都必须在下面归类——
 *   写  = 自己写这一列（含必须出现的记号）；
 *   走公共写法 = 只通过 记转让 / 记换负责人 写留痕，列由公共函数写；
 *   读  = 只读留痕或只在注释里提到；
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

const 写: Record<string, { 记号: RegExp; 至少: number }> = {
  "src/lib/project/db.ts": { 记号: /kind === "pool-release"\) await 记放回人\(/, 至少: 1 },
  "src/lib/offboard-move.ts": { 记号: /await 记放回人\(/, 至少: 1 },
  "src/lib/enterprise-import/project-target.ts": { 记号: /await 记放回人\(/, 至少: 2 },
  "src/lib/owner-log-db.ts": { 记号: /kind === "pool-release"\) \{\s*await 记客户放回人\(/, 至少: 1 },
  "src/lib/enterprise/pool-owner-backfill.ts": { 记号: /poolPrevOwnerId: c\.salesOwnerId/, 至少: 1 },
};
/** 只通过 记转让 / 记换负责人 写，必须真的调到它们 */
const 走公共写法: Record<string, RegExp> = {
  "src/lib/enterprise/pool-link.ts": /(记转让|记换负责人)\([^\n]*"pool-release"/g,
  "src/lib/enterprise-import/apply.ts": /记换负责人\([^\n]*"pool-release"/g,
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

  for (const [f, { 记号, 至少 }] of Object.entries(写)) {
    it(`${f} 写留痕的同时写这一列`, () => {
      const 命中 = 源(f).match(new RegExp(记号.source, "g"))?.length ?? 0;
      expect(命中).toBeGreaterThanOrEqual(至少);
    });
  }

  for (const [f, re] of Object.entries(走公共写法)) {
    it(`${f} 只走 记转让 / 记换负责人 写（列由公共函数写）`, () => {
      expect(源(f).match(re)?.length ?? 0).toBeGreaterThan(0);
      expect(源(f)).not.toMatch(/(projectNodeLog|customerOwnerLog)\.create/);
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
