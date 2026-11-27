/**
 * 回避名单根因（E-417 包 1）上 c2 回填后的只读对拍：每位在职员工，旧算法的回避集合（留痕现算）
 * 和「在公海里且 poolPrevOwnerId 是我」（含客户 / 项目连带）必须完全相同。
 *
 *   CRM_ENTERPRISE=1 npx tsx --env-file=.env scripts/pool-prev-owner-compare.ts
 *
 * 只读，不写库。打印不一致的人数和前几条 id（旧多出 = 旧算法有、按列没有；新多出反之）；全部一致退出码 0，否则 1。
 * 口径和可空列的坑见 src/lib/enterprise/pool-prev-owner-compare.ts。输出只有 id，不写名字。
 */
import { defaultClient as db } from "@/lib/prisma";
import { 企业版 } from "@/lib/enterprise/switch";
import { 对拍 } from "@/lib/enterprise/pool-prev-owner-compare";
import { 北京时刻 } from "@/lib/enterprise/pool-prev-owner-backfill";

async function main() {
  if (!企业版()) {
    console.error("只给企业版用：先设 CRM_ENTERPRISE=1");
    process.exit(2);
  }
  const r = await 对拍(db);
  console.log(`数于（北京时刻）${北京时刻(r.数于)}`);
  console.log(`在职员工 ${r.在职人数} 人；不一致 ${r.不一致人数} 人；互补核对（包 2 的「为空或不是我」写法数 + 是我 = 总数）不成立 ${r.互补不成立人数} 人`);
  for (const x of r.不一致.slice(0, 20)) {
    console.log(`${x.userId}\t${x.实体}\t旧多出 ${x.旧多出.join(",") || "无"}\t新多出 ${x.新多出.join(",") || "无"}`);
  }
  if (r.不一致.length > 20) console.log(`……还有 ${r.不一致.length - 20} 条`);
  process.exitCode = r.不一致人数 || r.互补不成立人数 ? 1 : 0;
}

main().finally(() => db.$disconnect());
