/**
 * 无感更新（11-17）：部署后没刷新的老标签页照样能保存。
 *
 * 两头钉住：
 *   - next.config.ts 的 部署号：构建时取 commit（环境变量 > git archive 的 export-subst 文件 > git），
 *     next start 时用构建产物里记的号，next dev 不设
 *   - deploy/enterprise/tools/skew-check.mjs：部署时判断这次迁移是不是「只加」，只加才留上一版接老标签页的 server action
 */
import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from "next/constants";
import config, { nextConfig, 部署号 } from "../next.config";
import { 切语句, 判一句, 新加的, 判断 } from "../deploy/enterprise/tools/skew-check.mjs";

const 临时: string[] = [];
function 目录() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "skew-"));
  临时.push(d);
  return d;
}
afterEach(() => {
  for (const d of 临时.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** 建一个有一次提交的 git 仓库，返回完整 commit（子进程不带外面的 GIT_*，免得写进别的仓库） */
function 建仓库(d: string): string {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith("GIT_")) delete env[k];
  const git = (...a: string[]) => execFileSync("git", a, { cwd: d, env, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  git("init", "-q");
  fs.writeFileSync(path.join(d, "a.txt"), "a");
  git("add", "a.txt");
  git("-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "x");
  return git("rev-parse", "HEAD");
}

/** 模拟 git 钩子里跑（pre-push 会带着 GIT_DIR）：临时设上，跑完还原 */
function 带GIT_DIR<T>(gitDir: string, f: () => T): T {
  const 原 = process.env.GIT_DIR;
  process.env.GIT_DIR = gitDir;
  try {
    return f();
  } finally {
    if (原 === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = 原;
  }
}
const 本仓库GIT_DIR = execFileSync("git", ["rev-parse", "--absolute-git-dir"]).toString().trim();

describe("next.config 部署号", () => {
  it("构建时：环境变量优先；off = 不设；不合法直接报错", () => {
    const cwd = 目录();
    expect(部署号(PHASE_PRODUCTION_BUILD, { env: { CRM_DEPLOYMENT_ID: "abc123_x-y" }, cwd })).toBe("abc123_x-y");
    expect(部署号(PHASE_PRODUCTION_BUILD, { env: { CRM_DEPLOYMENT_ID: "off" }, cwd })).toBeUndefined();
    expect(() => 部署号(PHASE_PRODUCTION_BUILD, { env: { CRM_DEPLOYMENT_ID: "a b" }, cwd })).toThrow(/CRM_DEPLOYMENT_ID/);
  });

  it("构建时：git archive 导出的目录用 deploy/enterprise/COMMIT（export-subst 换好的 commit），取前 12 位", () => {
    const cwd = 目录();
    fs.mkdirSync(path.join(cwd, "deploy/enterprise"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "deploy/enterprise/COMMIT"), "0123456789abcdef0123456789abcdef01234567\n");
    expect(部署号(PHASE_PRODUCTION_BUILD, { env: {}, cwd })).toBe("0123456789ab");
  });

  it("构建时：没导出过的占位（$Format…$）、又不是 git 目录 → 不设", () => {
    const cwd = 目录();
    fs.mkdirSync(path.join(cwd, "deploy/enterprise"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "deploy/enterprise/COMMIT"), "$Format:%H$\n");
    expect(部署号(PHASE_PRODUCTION_BUILD, { env: {}, cwd })).toBeUndefined();
    // git 钩子里（父进程带 GIT_DIR 指着本仓库）也不能把本仓库的 commit 当成这个目录的（11-17 pre-push 挂在这）
    expect(带GIT_DIR(本仓库GIT_DIR, () => 部署号(PHASE_PRODUCTION_BUILD, { env: {}, cwd }))).toBeUndefined();
  });

  it("构建时：cwd 是仓库根目录 → 用它自己的 HEAD，父进程带的 GIT_DIR 不算；在别的仓库里面的子目录 → 不设", () => {
    const cwd = 目录();
    const sha = 建仓库(cwd);
    expect(部署号(PHASE_PRODUCTION_BUILD, { env: {}, cwd })).toBe(sha.slice(0, 12));
    expect(带GIT_DIR(本仓库GIT_DIR, () => 部署号(PHASE_PRODUCTION_BUILD, { env: {}, cwd }))).toBe(sha.slice(0, 12));
    const 子目录 = path.join(cwd, "export");
    fs.mkdirSync(子目录);
    expect(部署号(PHASE_PRODUCTION_BUILD, { env: {}, cwd: 子目录 })).toBeUndefined();
  });

  it("仓库里那份 COMMIT 是 export-subst 占位，.gitattributes 登记了", () => {
    expect(fs.readFileSync("deploy/enterprise/COMMIT", "utf8").trim()).toBe("$Format:%H$");
    expect(fs.readFileSync(".gitattributes", "utf8")).toMatch(/^deploy\/enterprise\/COMMIT export-subst$/m);
  });

  it("next start：用构建产物 required-server-files.json 里记的号（构建后 HEAD 动了也不变）；没有产物 → 不设", () => {
    const cwd = 目录();
    expect(部署号(PHASE_PRODUCTION_SERVER, { env: { CRM_DEPLOYMENT_ID: "x" }, cwd })).toBeUndefined();
    fs.mkdirSync(path.join(cwd, ".next"));
    fs.writeFileSync(path.join(cwd, ".next/required-server-files.json"), JSON.stringify({ config: { deploymentId: "built1" } }));
    expect(部署号(PHASE_PRODUCTION_SERVER, { env: { CRM_DEPLOYMENT_ID: "other" }, cwd })).toBe("built1");
  });

  it("next dev 不设；默认导出按阶段补 deploymentId，其余配置原样", () => {
    expect(部署号(PHASE_DEVELOPMENT_SERVER, { env: { CRM_DEPLOYMENT_ID: "x" } })).toBeUndefined();
    const dev = config(PHASE_DEVELOPMENT_SERVER);
    expect(dev.deploymentId).toBeUndefined();
    expect(dev.output).toBe(nextConfig.output);
  });
});

describe("skew-check：迁移是不是只加", () => {
  const 判 = (sql: string) => {
    const ss = 切语句(sql);
    const 新 = 新加的(ss);
    return ss.map((s: string) => 判一句(s, 新)).filter(Boolean);
  };

  it("只加的都放行：建表 / 普通索引 / 加可空或有默认值的列 / 新表新列上的唯一索引 / 不拦写入的触发器 / INSERT", () => {
    expect(
      判(`-- 注释里的 DROP TABLE x; 不算
CREATE TABLE IF NOT EXISTS "A" ("id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS "A_name_key" ON "A"("name");
CREATE INDEX IF NOT EXISTS "B_x_idx" ON "B"("x");
ALTER TABLE "Customer" ADD COLUMN "customerNo" TEXT;
ALTER TABLE "Customer" ADD COLUMN "level" TEXT NOT NULL DEFAULT 'C';
CREATE UNIQUE INDEX IF NOT EXISTS "Customer_customerNo_key" ON "Customer"("customerNo");
CREATE TRIGGER IF NOT EXISTS "t1" AFTER INSERT ON "Customer" BEGIN INSERT INTO "S"(rowid) VALUES (new.rowid); END;
INSERT OR IGNORE INTO "A" ("id","name") VALUES ('1', 'a;b');
PRAGMA foreign_keys=ON;`),
    ).toEqual([]);
  });

  it("会让上一版出错的都拦下：删表、改名、改数据、重建表、老表老列唯一索引、加不许空没默认值的列、拦写入的触发器", () => {
    const r = 判(`DROP TABLE IF EXISTS "X";
ALTER TABLE "A" RENAME TO "B";
ALTER TABLE "A" DROP COLUMN "c";
UPDATE "Customer" SET "level" = 'C';
DELETE FROM "Customer";
CREATE TABLE "new_EntBlocker" ("id" TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS "Customer_name_key" ON "Customer"("name");
ALTER TABLE "Customer" ADD COLUMN "must" TEXT NOT NULL;
CREATE INDEX "marker" ON "X"("y");
CREATE TRIGGER IF NOT EXISTS "t2" BEFORE INSERT ON "Customer" BEGIN SELECT RAISE(ABORT, 'no'); END;`);
    expect(r).toHaveLength(10);
  });

  it("仓库现有迁移里只有三个已知例外（066 删表、107 重建、141 回填删索引行）不算只加", () => {
    const 不只加: string[] = [];
    for (const d of ["migrations", "control-migrations"]) {
      for (const f of fs.readdirSync(d).filter((x) => x.endsWith(".sql"))) {
        if (判(fs.readFileSync(path.join(d, f), "utf8")).length) 不只加.push(f);
      }
    }
    expect(不只加.sort()).toEqual(["066-drop-trade-tables.sql", "107-ent-blocker-title.sql", "141-search-trigram.sql"]);
  });

  it("整体判断：两版部署号不同、新迁移只加 → keep；号一样 / 缺号 / 迁移不只加 → skip 并写原因", () => {
    const 建 = (id: string, migs: Record<string, string>) => {
      const d = 目录();
      fs.mkdirSync(path.join(d, ".next"), { recursive: true });
      fs.mkdirSync(path.join(d, "migrations"));
      fs.writeFileSync(path.join(d, "server.js"), "");
      fs.writeFileSync(path.join(d, ".next/required-server-files.json"), JSON.stringify({ config: id ? { deploymentId: id } : {} }));
      for (const [f, sql] of Object.entries(migs)) fs.writeFileSync(path.join(d, "migrations", f), sql);
      return d;
    };
    const 老 = 建("aaa", { "001-a.sql": 'CREATE TABLE IF NOT EXISTS "A" ("id" TEXT);' });
    const 只加 = 建("bbb", { "001-a.sql": 'CREATE TABLE IF NOT EXISTS "A" ("id" TEXT);', "002-b.sql": 'ALTER TABLE "A" ADD COLUMN "b" TEXT;' });
    expect(判断(老, 只加)).toMatchObject({ oldId: "aaa", newId: "bbb", keep: true, files: ["migrations/002-b.sql"] });

    const 删表 = 建("ccc", { "001-a.sql": 'CREATE TABLE IF NOT EXISTS "A" ("id" TEXT);', "002-c.sql": 'DROP TABLE "A";' });
    const r = 判断(老, 删表);
    expect(r.keep).toBe(false);
    expect(r.reasons.join("\n")).toMatch(/002-c\.sql：DROP TABLE/);

    // 改了老迁移文件的内容也算这次的迁移
    const 改老文件 = 建("ddd", { "001-a.sql": 'CREATE TABLE IF NOT EXISTS "A" ("id" TEXT); DELETE FROM "A";' });
    expect(判断(老, 改老文件).keep).toBe(false);

    expect(判断(老, 建("aaa", {})).keep).toBe(false); // 同一个号
    expect(判断(建("", {}), 只加).reasons.join()).toMatch(/上一版没有部署号/);
  });
});
