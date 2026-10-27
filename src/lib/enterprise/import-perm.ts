/**
 * 企业版导入导出、新建客户给谁（10-27 会议）。
 *
 *   导入、导出只给最高级管理员：老板（ADMIN）或业务角色是总管理员的。客户大多是公共的，由他们整批导进来；
 *   普通销售只有自拓客户，在客户页一条条新建，负责人只能是自己。
 *   「普通销售」= 不是老板、组织里也没有任何管理员类别（销售管理 / 市场管理照旧能选负责人）。
 *
 * 不是企业版一律不管（个人版、团队版照旧谁都能导入导出、新建时随便选负责人）。
 * 服务端动作和页面都从这里取，别各写一份。
 */
import { 企业版 } from "./switch";
import { 管理员类别 } from "./org";

type 谁 = { id: string; role: string };

/** 老板，或业务角色是总管理员 */
export async function 最高管理(me: 谁): Promise<boolean> {
  return me.role === "ADMIN" || (await 管理员类别(me.id)) === "总管理员";
}

export async function 能导入导出(me: 谁): Promise<boolean> {
  return !企业版() || (await 最高管理(me));
}

export async function 新建只给自己(me: 谁): Promise<boolean> {
  return 企业版() && me.role !== "ADMIN" && (await 管理员类别(me.id)) === null;
}

export const 不能导入导出 = "导入、导出只有老板和总管理员能用";
