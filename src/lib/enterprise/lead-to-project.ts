/**
 * 企业版老线索批量转成线索阶段的项目（2026-10-28 用户：「批量转成线索阶段的项目」）。
 *
 * 企业版只用项目以后，「新线索」页只列线索阶段的项目，老 Lead 表里还在推的线索就看不见了。
 * 这里把它们照导入那样（enterprise-import/apply.ts 线索落项目）一条条建成线索阶段的项目：
 *   - 客户：线索已经连着客户就用它；否则唯一的同号客户挂它；都没有按线索名新建一位
 *   - 联系人：新建的客户、线索上有联系人名字才建一位主要联系人，项目挂上它
 *   - 项目负责人跟线索负责人走（线索没负责人：最早的管理员）；没有首条沟通，项目不带下一步时间；来源线索记这条 Lead
 * 已转化 / 已放弃的不转；已经有项目记它为来源线索的跳过（导入建过的、转化建过的、上次转过的）。
 * Lead 行不动（不标已转化、不连客户）。
 *
 * 只做一次：跟着服务启动（instrumentation.ts）跑，做完记一个记号。不是企业版只用项目：什么都不做
 */
import { prisma } from "../prisma";
import { getSetting, setSetting } from "../settings";
import { 分机留存起, 同号条件 } from "../phone-dedupe";
import { 线索建项目 } from "../project/from-lead";
import { 企业版只用项目 } from "./project-only";
import { 重算客户状态 } from "./cust-status-auto-db";

export const 转项目记号键 = "entLeadToProject.v1";

export type 转项目计数 = { 项目: number; 新客户: number; 新联系人: number };

const g = globalThis as unknown as { __entLeadToProject?: Promise<转项目计数 | null> };

/** 转一遍，返回各建了多少。不是企业版只用项目、或已经做过：返回 null，一行不动 */
export async function 老线索转项目(): Promise<转项目计数 | null> {
  if (!(await 企业版只用项目())) return null;
  if (await getSetting<boolean>(转项目记号键)) return null;

  const 起 = await 分机留存起();
  const 计 = await prisma.$transaction(
    async (tx) => {
      const 计: 转项目计数 = { 项目: 0, 新客户: 0, 新联系人: 0 };
      const 已有 = new Set(
        (await tx.project.findMany({ where: { sourceLeadId: { not: null } }, select: { sourceLeadId: true } })).map((p) => p.sourceLeadId!),
      );
      const 线索们 = (
        await tx.lead.findMany({ where: { status: { notIn: ["已转化", "已放弃"] } }, orderBy: { createdAt: "asc" } })
      ).filter((l) => !已有.has(l.id));
      if (!线索们.length) return 计;
      const 兜底 = await tx.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" }, select: { id: true } });
      const 挂了项目的客户 = new Set<string>();

      for (const l of 线索们) {
        const 负责人 = l.ownerId ?? 兜底?.id;
        if (!负责人) continue;
        let customerId = l.customerId;
        let 联系人Id: string | null | undefined;
        if (!customerId && l.phone?.trim()) {
          const 同号 = await tx.customer.findMany({ where: await 同号条件(tx, l.phone, 起), select: { id: true }, take: 2 });
          if (同号.length === 1) customerId = 同号[0].id;
        }
        if (!customerId) {
          customerId = (await tx.customer.create({ data: { name: l.name, phone: l.phone?.trim() ?? "", salesOwnerId: 负责人 }, select: { id: true } })).id;
          计.新客户++;
          联系人Id = null;
          if (l.contact?.trim()) {
            联系人Id = (
              await tx.contact.create({
                data: { name: l.contact.trim(), phone: l.phone, email: l.email, isPrimary: true, customerId },
                select: { id: true },
              })
            ).id;
            计.新联系人++;
          }
        }
        // 挂老客户时 联系人Id 不给：照转化那样挂客户的主要联系人
        await 线索建项目(tx, { 线索名: l.name, leadId: l.id, customerId, ownerId: 负责人, creatorId: 负责人, 联系人Id });
        挂了项目的客户.add(customerId);
        计.项目++;
      }
      // 客户状态跟着项目算（cust-status-auto-db.ts；开头已经确认是企业版只用项目）
      await 重算客户状态(tx, 挂了项目的客户);
      return 计;
    },
    { timeout: 120_000 },
  );

  await setSetting(转项目记号键, true);
  console.log(`[老线索转项目] 项目 ${计.项目}、新客户 ${计.新客户}、新联系人 ${计.新联系人}`);
  return 计;
}

/** 同一个进程里只跑一遍；出错下次启动再试（事务没提交，一行没建） */
export function 转项目一次(): Promise<转项目计数 | null> {
  g.__entLeadToProject ??= 老线索转项目().catch((e) => {
    g.__entLeadToProject = undefined;
    console.error("[老线索转项目] 出错，下次再试", e);
    return null;
  });
  return g.__entLeadToProject;
}

/** 测试用：忘掉这个进程跑过 */
export function 忘掉转项目(): void {
  g.__entLeadToProject = undefined;
}
