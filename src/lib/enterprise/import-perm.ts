/**
 * 企业版导入导出、新建客户给谁（10-27 会议）。
 *
 *   导入、导出只给总管理（业务角色 director，11-01 只认业务角色；管理员 admin 只读，导入是写，导出一并不给）。客户大多是公共的，由他们整批导进来；
 *   普通销售只有自拓客户，在客户页一条条新建，负责人只能是自己。
 *   「普通销售」= 组织里没有任何管理员类别（销售管理 / 市场管理照旧能选负责人）；没设业务角色的也算，只能给自己。
 *
 * 不是企业版一律不管（个人版、团队版照旧谁都能导入导出、新建时随便选负责人）。
 * 服务端动作和页面都从这里取，别各写一份。
 */
import { 企业版 } from "./switch";
import { 管理员类别, 权限组织 } from "./org";
import { 是总管理 } from "./permissions";

type 谁 = { id: string; role: string };

/** 总管理（不是企业版：账号管理员，见 permissions.ts 老规矩） */
export async function 最高管理(me: 谁): Promise<boolean> {
  return 是总管理(me, await 权限组织());
}

export async function 能导入导出(me: 谁): Promise<boolean> {
  return !企业版() || (await 最高管理(me));
}

export async function 新建只给自己(me: 谁): Promise<boolean> {
  return 企业版() && (await 管理员类别(me.id)) === null;
}

export const 不能导入导出 = "导入、导出只有总管理能用";
