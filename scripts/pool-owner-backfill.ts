/**
 * 把 M-公海-03 上线前进客户公海的老客户补成「负责人清空、原负责人记历史」。
 *
 *   CRM_ENTERPRISE=1 npx tsx --env-file=.env scripts/pool-owner-backfill.ts [--apply]
 *
 * - 默认是演练：只打印会改几位客户，库不动。确认后加 --apply 再跑。
 * - 可以重复跑，已补过的不再动。
 * - 部署顺序：先上代码，再备份，再跑这个（代码同时认旧字段，空档里不会放错人）。
 * 规矩在 src/lib/enterprise/pool-owner-backfill.ts（有单测），这里只管开关和打印。
 */
import { prisma } from "@/lib/prisma";
import { 企业版 } from "@/lib/enterprise/switch";
import { 补记存量公海客户 } from "@/lib/enterprise/pool-owner-backfill";

async function main() {
  if (!企业版()) {
    console.error("只给企业版用：先设 CRM_ENTERPRISE=1");
    process.exit(2);
  }
  const 真写 = process.argv.includes("--apply");
  const r = await 补记存量公海客户(真写);
  console.log(`${真写 ? "已改" : "演练，将改"} ${r.客户} 位公海客户；这些客户上还归原负责人、没进线索公海的项目 ${r.没进线索公海的项目} 个（不动，领客户时带走）`);
}

main().finally(() => prisma.$disconnect());
