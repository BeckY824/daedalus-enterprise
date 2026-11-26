/**
 * 操作日志的「动作」「对象」两列（D6-2）：写进日志的英文动作、对象名，设置 → 操作日志里都要有中文叫法，
 * 不然页面上直接露出 EntBlockerReason 这类内部表名。新加一种 recordAudit 漏了对照，这里会红。
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const 读 = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

function 全部源码(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (n === "generated" || n === "node_modules") continue;
    if (statSync(p).isDirectory()) out.push(...全部源码(p));
    else if (/\.(ts|tsx)$/.test(n)) out.push(p);
  }
  return out;
}

const 页 = 读("src/app/(app)/settings/AuditTab.tsx");
const 表里有 = (表名: string) => {
  const m = 页.match(new RegExp(`const ${表名}: Record<string, string> = \\{([\\s\\S]*?)\\n\\};`));
  expect(m, `${表名} 没找到`).toBeTruthy();
  return new Set([...m![1].matchAll(/(\w+):\s*"/g)].map((x) => x[1]));
};

describe("操作日志：写进去的动作、对象都有中文叫法（D6-2）", () => {
  const 动作们 = new Set<string>();
  const 对象们 = new Set<string>();
  for (const f of 全部源码(path.join(ROOT, "src"))) {
    const 文 = readFileSync(f, "utf8");
    for (const m of 文.matchAll(/recordAudit\(\{([\s\S]{0,400}?)\}\)/g)) {
      const a = m[1].match(/action:\s*"(\w+)"/);
      const e = m[1].match(/entity:\s*"(\w+)"/);
      if (a) 动作们.add(a[1]);
      if (e) 对象们.add(e[1]);
    }
  }

  it("扫到了日志调用", () => {
    expect(对象们.size).toBeGreaterThan(10);
  });

  it("每个对象名都在 ENTITY_LABEL 里", () => {
    const 有 = 表里有("ENTITY_LABEL");
    expect([...对象们].filter((e) => !有.has(e))).toEqual([]);
  });

  it("每个动作都在 ACTION_LABEL 里", () => {
    const 有 = 表里有("ACTION_LABEL");
    expect([...动作们].filter((a) => !有.has(a))).toEqual([]);
  });

  it("删阻碍原因记成「删除」、合并记成「合并」，不是「修改」", () => {
    const 文 = 读("src/app/(app)/projects/blocker-actions.ts");
    const 段 = (名: string) => 文.slice(文.indexOf(`export async function ${名}`)).split("\nexport ")[0];
    expect(段("删原因Action")).toMatch(/"delete"/);
    expect(段("合并原因Action")).toMatch(/"merge"/);
    expect(段("新增原因Action")).toMatch(/"create"/);
  });

  it("合并客户第一批（11-25）：auditLog.createMany 直接写的 merge / merge-undo / project-move-customer（-undo）也有叫法", () => {
    const 写的 = new Set<string>();
    for (const f of ["src/lib/enterprise/customer-merge.ts", "src/lib/enterprise/project-move-customer.ts"]) {
      // 直接写的 action: "…"，和项目换客户那两个常量（换客户动作 / 撤销换客户动作 = "…"）
      for (const m of 读(f).matchAll(/(?:action:\s*|动作 = )"([\w-]+)"/g)) 写的.add(m[1]);
    }
    expect([...写的].sort()).toEqual(["merge", "merge-undo", "project-move-customer", "project-move-customer-undo"]);
    const 表 = 页.match(/const ACTION_LABEL: Record<string, string> = \{([\s\S]*?)\n\};/)![1];
    expect(表).toMatch(/\bmerge: "合并"/);
    expect(表).toMatch(/"merge-undo": "撤回合并"/);
    expect(表).toMatch(/"project-move-customer": "项目换客户"/);
    expect(表).toMatch(/"project-move-customer-undo": "撤销换客户"/);
  });

  it("合并客户第二批 2a：项目上的 merge / merge-undo 叫「合并项目」「撤回合并项目」，和客户的分开", () => {
    const 写的 = new Set<string>();
    for (const m of 读("src/lib/enterprise/project-merge.ts").matchAll(/action:\s*"([\w-]+)",\s*entity:\s*"(\w+)"/g)) 写的.add(`${m[2]}.${m[1]}`);
    expect([...写的].sort()).toEqual(["Project.merge", "Project.merge-undo"]);
    const 表 = 页.match(/const ACTION_LABEL_BY_ENTITY: Record<string, Record<string, string>> = \{([\s\S]*?)\n\};/)![1];
    expect(表).toMatch(/Project: \{ merge: "合并项目", "merge-undo": "撤回合并项目" \}/);
    expect(页).toMatch(/\{动作叫法\(v, r\.entity\)\}/);
  });
});
