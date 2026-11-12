/**
 * 联系人表单交上来的几格怎么规整（原在 actions.ts，11-12 挪出来）：客户详情的 saveContact 和受限客户详情的
 * 仅项目联系人动作（project-only-contact-actions.ts）共用一份，校验口径一处改。"use server" 文件只能导出异步函数，所以放这里
 */
import { 认回打码号 } from "@/lib/phone";
import { 是占位号, 占位号提示 } from "@/lib/placeholder-phone";
import { 性别们, 爱好上限, 联系人地址上限, 认生日 } from "@/lib/enterprise/customer-v2";
import type { 交上来的号 } from "@/lib/enterprise/customer-v2-db";

export type 联系人字段 = {
  name: string;
  position?: string | null;
  phone?: string | null;
  email?: string | null;
  wechat?: string | null;
  remark?: string | null;
};

/**
 * 联系人的电话：共享区表单交回的是打码的样子，认回原号（排查 A2）；认不回来又带 * 的不收。
 * 联系人电话一直不做格式校验（座机、分机、「找前台转」都有人写），这里只拦打码那一种。
 */
export function 联系人电话(交回: string | null | undefined, 原: string | null | undefined): { ok: true; phone: string | null } | { ok: false; error: string } {
  const v = String(认回打码号(交回, 原) ?? "").trim();
  if (v.includes("*")) return { ok: false, error: "电话里不能有 *" };
  // 占位假号（P-全局-06）：新填、改过的拦下；库里原样没动的老号照存
  if (v !== String(原 ?? "").trim() && 是占位号(v)) return { ok: false, error: 占位号提示("电话") };
  return { ok: true, phone: v || null };
}

export function 规整(input: 联系人字段) {
  return {
    name: input.name.trim(),
    position: input.position || null,
    phone: input.phone || null,
    email: input.email || null,
    wechat: input.wechat || null,
    remark: input.remark || null,
  };
}

/**
 * 企业版联系人新几格（2026-10-29，定稿 P5 第 24 条，迁移 073）：性别、生日、爱好、地址，外加联系方式几行（类型 + 号码）。
 * 开关关着一律不看
 */
export type 企业联系人资料 = {
  gender?: string | null;
  birthday?: string | null;
  hobby?: string | null;
  address?: string | null;
  /** 联系方式几行：kind 是存库的那种（号码种类表 的 kind）。给了就整组换掉；不给 = 不碰 */
  号码们?: 交上来的号[] | null;
};

/** 企业联系人资料 → 存库的四格（给了的才出现）。错了给一句话 */
export function 规整企业联系人(x: 企业联系人资料): { ok: true; data: { gender?: string | null; birthday?: string | null; hobby?: string | null; address?: string | null } } | { ok: false; error: string } {
  const data: { gender?: string | null; birthday?: string | null; hobby?: string | null; address?: string | null } = {};
  const 格 = (v: unknown) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "") || null;
  if (x.gender !== undefined) {
    const g = 格(x.gender);
    if (g && !(性别们 as readonly string[]).includes(g)) return { ok: false, error: "性别只能选男或女" };
    data.gender = g;
  }
  if (x.birthday !== undefined) {
    const d = 认生日(x.birthday);
    if (d === undefined) return { ok: false, error: "生日格式不对（要年-月-日，且是真实的日子）" };
    data.birthday = d;
  }
  if (x.hobby !== undefined) {
    const h = 格(x.hobby);
    if (h && h.length > 爱好上限) return { ok: false, error: `爱好最多 ${爱好上限} 个字` };
    data.hobby = h;
  }
  if (x.address !== undefined) {
    const a = 格(x.address);
    if (a && a.length > 联系人地址上限) return { ok: false, error: `地址最多 ${联系人地址上限} 个字` };
    data.address = a;
  }
  return { ok: true, data };
}

