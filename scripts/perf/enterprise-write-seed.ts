/**
 * 企业版写入压测（S5 / S6，2026-10-29）的准备：在 enterprise-seed.ts（可再加 enterprise-org-seed.ts）造好的库上，补写入压测要用的东西。
 * 只写进 DATABASE_URL 指的那份一次性库（enterprise-write.mjs 在 --out 里新建的），不碰任何正式库。
 *
 *   DATABASE_URL=file:<crm.db> OUT_DIR=<输出目录> npx tsx scripts/perf/enterprise-write-seed.ts
 *
 * 做三件事，每次压测前都跑一遍（--reuse-db 时库里可能已经被上一轮写过，按库里现在的样子重算）：
 *   1. 给 30 个 perf 用户设同一个随机测试密码（bcrypt 10 轮，和 settings 里改密码同一个强度）。
 *      种子里的密码是 "!"，永远比对不上，S6 登录要一个真能登进去的。明文只写进 <输出目录>/.perf-password（600），不打印
 *   2. 每人在自己名下、不在公海的客户上建 2 个项目，停在 商机·明确需求（已经建过的就复用）。
 *      企业版锁死项目模式（business-config 的 企业版锁定：projectMode = true），不用另开；
 *      组织规则「阶段.推进权限」默认就是「负责人可推」，销售本人往前推一步不会被挡，这里不改规则
 *   3. 写 <输出目录>/write-targets.json：每人记跟进用哪几位、改客户用哪几位、改阶段用哪几个项目、领公海分到哪几位。
 *      全都挑本人名下、不在公海的（公海里的客户记跟进会顺手领走，不是这一类写要量的东西）；
 *      公海客户按人分好、不分给原负责人（企业版拦原负责人领回），两个人不会抢同一位
 */
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../../src/generated/prisma";

const p = new PrismaClient();
const OUT_DIR = process.env.OUT_DIR;
const 每人跟进 = 10;
const 每人改客户 = 5;
const 每人项目 = 2;
const 项目名前缀 = "压测项目";

async function main() {
  if (!OUT_DIR) throw new Error("要 OUT_DIR=<输出目录>");
  const 人们 = await p.user.findMany({ where: { id: { startsWith: "perf-u" } }, select: { id: true, email: true, role: true }, orderBy: { id: "asc" } });
  if (人们.length !== 30) throw new Error(`库里 perf 用户是 ${人们.length} 个，不是 30 个：先用 enterprise-seed.ts 造库`);

  // 1. 测试密码
  const 密码 = randomBytes(12).toString("base64url");
  const 哈希 = await bcrypt.hash(密码, 10);
  await p.user.updateMany({ where: { id: { in: 人们.map((u) => u.id) } }, data: { password: 哈希 } });
  writeFileSync(join(OUT_DIR, ".perf-password"), 密码, { mode: 0o600 });

  type 人目标 = { id: string; email: string; role: string; follow: string[]; patch: string[]; projects: { id: string; node: string }[]; pool: string[] };
  const 目标: 人目标[] = [];
  let 新建项目 = 0;
  for (const u of 人们) {
    // 本人名下、不在公海；够用就行，按 id 取前面这些
    const 客户们 = (await p.customer.findMany({
      where: { salesOwnerId: u.id, pool: { is: null } },
      select: { id: true },
      orderBy: { id: "asc" },
      take: 每人跟进 + 每人改客户 + 每人项目,
    })).map((c) => c.id);
    if (客户们.length < 每人跟进 + 每人改客户 + 每人项目) throw new Error(`${u.id} 名下不在公海的客户不够`);
    const 跟进 = 客户们.slice(0, 每人跟进);
    const 改 = 客户们.slice(每人跟进, 每人跟进 + 每人改客户);
    const 项目客户 = 客户们.slice(每人跟进 + 每人改客户);

    const 项目们: 人目标["projects"] = [];
    for (const [k, cid] of 项目客户.entries()) {
      const 名 = `${项目名前缀}-${u.id}-${k}`;
      let 项 = await p.project.findFirst({ where: { name: 名, ownerId: u.id }, select: { id: true, phase: true, node: true, result: true } });
      if (!项) {
        项 = await p.project.create({
          data: { name: 名, customerId: cid, ownerId: u.id, creatorId: u.id, phase: "商机", node: "明确需求" },
          select: { id: true, phase: true, node: true, result: true },
        });
        await p.projectNodeLog.create({ data: { projectId: 项.id, userId: u.id, toPhase: "商机", toNode: "明确需求" } });
        新建项目++;
      }
      // 上一轮停在别处（--reuse-db）：拉回 明确需求，压测只在 明确需求 ↔ 共识方案 之间来回
      if (项.phase !== "商机" || (项.node !== "明确需求" && 项.node !== "共识方案") || 项.result) {
        await p.project.update({ where: { id: 项.id }, data: { phase: "商机", node: "明确需求", result: null, closedAt: null } });
        项 = { ...项, phase: "商机", node: "明确需求", result: null };
      }
      项目们.push({ id: 项.id, node: 项.node });
    }
    目标.push({ id: u.id, email: u.email, role: u.role, follow: 跟进, patch: 改, projects: 项目们, pool: [] });
  }

  // 3. 公海按人分：第 k 位给第 k % 30 个人，正好是原负责人就往后挪一位
  const 公海 = await p.customer.findMany({ where: { pool: { isNot: null } }, select: { id: true, salesOwnerId: true }, orderBy: { id: "asc" } });
  公海.forEach((c, k) => {
    let i = k % 目标.length;
    if (目标[i].id === c.salesOwnerId) i = (i + 1) % 目标.length;
    目标[i].pool.push(c.id);
  });

  const 组织 = (await p.entMember.count()) > 0;
  writeFileSync(join(OUT_DIR, "write-targets.json"), JSON.stringify({ org: 组织, pool: 公海.length, projectsCreated: 新建项目, users: 目标 }, null, 2));
  console.log(`写入压测准备好了：30 人、项目 ${目标.length * 每人项目} 个（这次新建 ${新建项目}）、公海 ${公海.length} 位、组织架构 ${组织 ? "有" : "没有"}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
