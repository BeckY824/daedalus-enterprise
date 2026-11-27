/**
 * ④ 扫库检测 · 查询记录（2026-11-27，E-383 第 1 阶段，表 EntScanQuery）。
 * 只在三个「人主动查」的入口记一笔：首页「+」查重（查号码）、新建向导查号码（含离开号码框自动查）、新建向导查客户名（连公司名一起只算一次）。
 * 不记：保存客户时再挡一次、点「建好」兜底核、导入、首页 AI 建档、领取公海、客户详情加联系人号码、回收站捞回——这些不经 记查询。
 * 一行 = 同人同北京日同键；有一次撞上就把 hit 置真，只升不降。「撞上」= 撞别组同事负责的客户（撞自己名下、同组、公海不算，不分岗位；
 * 同组由 dupe-ledger 的 同组() 判，露出里带 同组 就不算）。库里不存号码 / 名字原文，只存 HMAC-SHA256 指纹。
 * 总开关 Setting `enterprise.scan4.on`（没存 = 开，存 false = 关），关了不记。记失败只打日志、不挡查重。
 */
import { createHash, createHmac } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";
import { beijingDay } from "@/lib/business-clock";
import { readSecret } from "@/lib/secret";
import { 企业版 } from "@/lib/enterprise/switch";
import type { 撞号露出, 名撞结论 } from "@/lib/enterprise/dupe-ledger";

export const 扫库检测开关key = "enterprise.scan4.on";

export type 查询键类型 = "号码" | "名字";

/** 开着没：没存过 = 开，存了 false 才关（同「不设配额」的读法） */
export async function 扫库检测开着(): Promise<boolean> {
  return (await getSetting<boolean>(扫库检测开关key)) !== false;
}

/** 指纹用的子密钥：= sha256("scan4-key:" + 会话密钥)，和会话签名、录音链接、设置加密不共用一把 */
const 子密钥 = (): Buffer => createHash("sha256").update(`scan4-key:${readSecret()}`).digest();

/** 键指纹：HMAC-SHA256(子密钥, 类型|键) 取 hex。号码传「号码类型|规整后的键」，名字传 trim 后的「名|公司」 */
export const 键指纹 = (键类型: 查询键类型, 键: string): string => createHmac("sha256", 子密钥()).update(`${键类型}|${键}`, "utf8").digest("hex");

/** 号码侧：撞上 = 露出里有负责人且不同组（撞自己名下、公海 撞上客户 本来就回 null） */
export const 号码撞别组 = (挂靠: 撞号露出 | null): boolean => !!挂靠 && !挂靠.同组;
/** 名字侧：{ 撞 } 且不同组；{ 我名下 } 或 null 不算 */
export const 名字撞别组 = (r: 名撞结论 | null): boolean => !!r && "撞" in r && !r.撞.同组;

/**
 * 记一笔查询（upsert：同人同日同键只一行，撞上只升不降）。关着 / 不是企业版不记；任何失败只打日志，不挡查重
 */
export async function 记查询(userId: string, 键类型: 查询键类型, 键: string, 撞上: boolean, 现在: Date = new Date()): Promise<void> {
  try {
    if (!企业版() || !键 || !(await 扫库检测开着())) return;
    const day = beijingDay(现在);
    const keyHash = 键指纹(键类型, 键);
    await prisma.entScanQuery.upsert({
      where: { userId_day_keyType_keyHash: { userId, day, keyType: 键类型, keyHash } },
      create: { userId, day, keyType: 键类型, keyHash, hit: 撞上 },
      update: 撞上 ? { hit: true } : {},
    });
  } catch (e) {
    console.error("[scan4] 记查询失败", e instanceof Error ? e.message : e);
  }
}
