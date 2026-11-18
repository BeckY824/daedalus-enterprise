/**
 * 系统建项目（补潜客培育、线索转化、老线索转项目）按「谁建给谁」定分配方式，要读库的那一半（11-18 总控追加，P-转-15 / X-93）：
 *   - 建给别人 = 指定分配；
 *   - 建给自己：市场成员（业务角色有市场管理 / 渠道运营，或按部门 / 逐人认定的市场成员，同 assign-line.ts 算市场）= 暂不分配（叫法按字典当前的），
 *     别人（销售自建等）= 个人自持。原来一律个人自持：市场成员在新建客户页建给自己，补的潜客培育记成个人自持，
 *     客户转让框里的「指定分配 / 自动分配」出不来（cust-auto-assign.ts 暂不分配项目of 只认暂不分配）。
 * 事务里调（传 tx），只读；一次事务里要判很多条的传 记 复用（同一个建的人只读一遍组织）。服务端用，别在客户端 import
 */
import type { Prisma } from "@/generated/prisma";
import { 企业版 } from "@/lib/enterprise/switch";
import { 读组织于 } from "@/lib/enterprise/org";
import { 市场部门key, 市场成员key, 市场成员们, 规整市场部门 } from "@/lib/enterprise/market";
import { 算市场 } from "@/lib/enterprise/assign-line";
import { 分配方式叫法 } from "@/lib/enterprise/dict";
import { 系统分配方式, 建给谁的分配方式 } from "./proj-fields";

type 库 = Prisma.TransactionClient;
export type 建给自己记 = Map<string, string>;

async function 读设的(db: 库, key: string): Promise<string[] | null> {
  const v = await db.setting.findUnique({ where: { key }, select: { value: true } });
  if (!v) return null;
  try {
    return 规整市场部门(JSON.parse(v.value));
  } catch {
    return null;
  }
}

/** 建的人建给自己时记哪种：市场成员 = 暂不分配（字典叫法），别人 = 个人自持。不是企业版 = 个人自持（新项目默认值 本来也不写） */
export async function 建给自己的分配方式(db: 库, 建的人: string, 记?: 建给自己记): Promise<string> {
  const 有 = 记?.get(建的人);
  if (有) return 有;
  let 出: string = 系统分配方式.个人自持;
  if (企业版()) {
    const org = await 读组织于(db);
    const 部门市场 = 市场成员们(org, await 读设的(db, 市场部门key), await 读设的(db, 市场成员key)).has(建的人);
    if (算市场(org.成员.get(建的人)?.角色们 ?? [], 部门市场)) 出 = await 分配方式叫法(3, db);
  }
  记?.set(建的人, 出);
  return 出;
}

/** 系统建项目的分配方式：建给别人 = 指定分配；建给自己按 建给自己的分配方式 */
export async function 系统建项目分配方式(db: 库, 负责人: string, 建的人: string, 记?: 建给自己记): Promise<string> {
  return 负责人 && 负责人 === 建的人 ? 建给自己的分配方式(db, 建的人, 记) : 建给谁的分配方式(负责人, 建的人);
}
