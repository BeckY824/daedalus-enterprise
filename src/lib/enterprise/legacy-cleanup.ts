/**
 * 企业版清掉用不到的老数据（2026-10-28）：企业版只用项目一条线（project-only.ts），
 * 商机、合同 / 签约、外贸订单、供应商这几张桌面端的老表在企业版里没有入口，库里留着的只是占地方、导出时混进来。
 *
 * 一个事务里删：
 *   - 挂在商机 / 订单上的附件（行 + 磁盘上的文件；也挂在线索 / 联系人上的不动）
 *   - 订单、合同、商机、供应商（各自的子表随外键级联：报价、成交、回款、订单节点 / 单据 / 采购、供应商报价……）
 *   - 数据接入对照行里指向这些商机的（只删 targetId 是被删商机的，项目模式下 opportunity 这一类指向的是项目，不动）
 * 跟进不删，只把「挂在哪个商机」置空；客户、项目、联系人、线索一条不动（级联只往子表走，见 tests/ent-legacy-cleanup.test.ts）；
 * 线索里还在推的另由 lead-to-project.ts 转成线索阶段的项目。
 *
 * 只做一次：跟着服务启动（instrumentation.ts）跑，做完记一个记号。不是企业版：什么都不做
 */
import fs from "node:fs";
import { prisma } from "../prisma";
import { getSetting, setSetting } from "../settings";
import { 附件文件 } from "../attachments";
import { 企业版 } from "./switch";

// v2（10-28）：老入口加闸前可能又写进来的，再扫一次
export const 清理记号键 = "entLegacyCleanup.v2";

export type 清理计数 = { 附件: number; 订单: number; 合同: number; 商机: number; 供应商: number; 对照: number; 跟进解挂: number };

const g = globalThis as unknown as { __entLegacyCleanup?: Promise<清理计数 | null> };

/** 清一遍，返回各删了多少。不是企业版、或已经做过：返回 null，一行不动 */
export async function 清理老数据(): Promise<清理计数 | null> {
  if (!企业版()) return null;
  if (await getSetting<boolean>(清理记号键)) return null;

  const r = await prisma.$transaction(
    async (tx) => {
      const 商机Ids = (await tx.opportunity.findMany({ select: { id: true } })).map((x) => x.id);
      // 跟进挂商机的那一格没写 onDelete（默认挡删），先置空；跟进本身留着
      const 跟进解挂 = (await tx.followUp.updateMany({ where: { opportunityId: { not: null } }, data: { opportunityId: null } })).count;
      const 附件们 = await tx.attachment.findMany({
        where: { OR: [{ opportunityId: { not: null } }, { orderId: { not: null } }], leadId: null, contactId: null },
        select: { id: true },
      });
      const 附件 = (await tx.attachment.deleteMany({ where: { id: { in: 附件们.map((x) => x.id) } } })).count;
      const 订单 = (await tx.tradeOrder.deleteMany({})).count;
      const 合同 = (await tx.contract.deleteMany({})).count;
      const 商机 = (await tx.opportunity.deleteMany({ where: { id: { in: 商机Ids } } })).count;
      const 供应商 = (await tx.supplier.deleteMany({})).count;
      const 对照 = 商机Ids.length ? (await tx.entExternalRef.deleteMany({ where: { targetId: { in: 商机Ids } } })).count : 0;
      return { 计: { 附件, 订单, 合同, 商机, 供应商, 对照, 跟进解挂 }, 附件Ids: 附件们.map((x) => x.id) };
    },
    { timeout: 120_000 },
  );

  // 行删掉以后再删文件：事务没成功文件还在；文件删不掉（已经没了）不要紧，清孤儿会兜底
  for (const id of r.附件Ids) {
    try {
      fs.rmSync(附件文件(id), { force: true });
    } catch {
      /* 留给清孤儿 */
    }
  }
  await setSetting(清理记号键, true);
  const c = r.计;
  console.log(
    `[老数据清理] 附件 ${c.附件}、订单 ${c.订单}、合同 ${c.合同}、商机 ${c.商机}、供应商 ${c.供应商}、对照行 ${c.对照}；跟进解挂商机 ${c.跟进解挂}`,
  );
  return c;
}

/** 同一个进程里只跑一遍；出错下次启动再试（事务没提交，一行没删） */
export function 清理一次(): Promise<清理计数 | null> {
  g.__entLegacyCleanup ??= 清理老数据().catch((e) => {
    g.__entLegacyCleanup = undefined;
    console.error("[老数据清理] 出错，下次再试", e);
    return null;
  });
  return g.__entLegacyCleanup;
}

/** 测试用：忘掉这个进程跑过 */
export function 忘掉清理(): void {
  g.__entLegacyCleanup = undefined;
}
