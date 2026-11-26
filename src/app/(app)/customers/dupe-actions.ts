"use server";

/**
 * 疑似重复清单（12-15 第三批 C，P-合并-06）· 服务端动作：清单页只调这里。前端只传 id，谁看哪些组、能标 / 撤哪几对全在 lib/enterprise/dupe-groups.ts 按登录的人重新判。
 * 「合并」不在这里：清单上开的是客户详情那只合并框（MergeHost），走 merge-actions.ts 的 预览合并 / 合并客户 / 合并申请。
 * 首页 AI 不给这些动作（判定稿：AI 默认不加）：lib/ai 不引这个文件。不是企业版一律空 / 拦。
 */
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { 企业版 } from "@/lib/enterprise/switch";
import { 权限组织 } from "@/lib/enterprise/org";
import {
  疑似重复页, 标不是同一个人, 撤销不是同一个人, 已标的对, 一组最多, 公海对能不能并,
  type 清单页, type 已标一对, type 清单栏,
} from "@/lib/enterprise/dupe-groups";

type 结果<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const 坏参数 = { ok: false as const, error: "参数不对，刷新再试" };
const 不是企业版 = { ok: false as const, error: "这个功能只在企业版里有" };
const 是id们 = (v: unknown, 最多: number): v is string[] =>
  Array.isArray(v) && v.length > 0 && v.length <= 最多 && v.every((x) => typeof x === "string" && x.length > 0 && x.length <= 140);

const 刷新 = () => revalidatePath("/customers/dupes");

/** 清单的一页（换页用；第一页页面直接取） */
export async function 疑似重复清单(页: number, 栏: 清单栏 = "普通"): Promise<结果<{ 清单: 清单页 }>> {
  const me = await requireUser();
  if (!企业版()) return 不是企业版;
  if (typeof 页 !== "number" || !Number.isFinite(页) || (栏 !== "普通" && 栏 !== "公海")) return 坏参数;
  return { ok: true, 清单: await 疑似重复页(prisma, me, await 权限组织(), 页, 栏) };
}

/**
 * 清单上点「合并」前核一遍（12-15 D，P-合并-07）：两家都在公海的只有系统管理员能并，普通角色调用直接拒；一家公海一家有主回「先领出来再并」。
 * 过了才开合并框（框里预览 / 执行还会在 customer-merge 再判一次）
 */
export async function 核对清单合并(留下id: string, 并掉id: string): Promise<结果> {
  const me = await requireUser();
  if (!企业版()) return 不是企业版;
  if (!是id们([留下id, 并掉id], 2) || 留下id === 并掉id) return 坏参数;
  const 话 = await 公海对能不能并(prisma, me, await 权限组织(), 留下id, 并掉id);
  return 话 ? { ok: false, error: 话 } : { ok: true };
}

/** 一组标「不是同一个人」：传那一行的几家客户 id；回标了的几对（撤销条上的「撤销」用） */
export async function 标为不是同一个人(ids: string[]): Promise<结果<{ 对们: string[] }>> {
  const me = await requireUser();
  if (!企业版()) return 不是企业版;
  if (!是id们(ids, 一组最多)) return 坏参数;
  const r = await 标不是同一个人(prisma, me, await 权限组织(), ids);
  if (r.ok) 刷新();
  return r;
}

/** 撤销「不是同一个人」：传对的编号（两个客户编号排好、用 __ 连） */
export async function 撤销不是同一个人标记(对们: string[]): Promise<结果<{ 撤了: number }>> {
  const me = await requireUser();
  if (!企业版()) return 不是企业版;
  if (!是id们(对们, 一组最多 * 一组最多)) return 坏参数;
  const r = await 撤销不是同一个人(prisma, me, await 权限组织(), 对们);
  if (r.ok) 刷新();
  return r;
}

/** 「已标不是同一个人」那一栏：登录的人能撤的那些 */
export async function 已标不是同一个人(): Promise<已标一对[]> {
  const me = await requireUser();
  if (!企业版()) return [];
  return 已标的对(prisma, me, await 权限组织());
}
