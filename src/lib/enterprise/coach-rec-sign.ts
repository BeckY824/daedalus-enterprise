/**
 * 录音点评 · 给腾讯云取录音文件的签名地址（11-22，录音点评 PR2；PR4 转写 >5MB 时用，方案 §4.3）。
 *
 * /api/coach-rec/fetch/<id>?exp=<秒>&sig=<HMAC>：
 *   - 不认会话，只认签名：HMAC-SHA256(子密钥, "<id>.<exp>")，子密钥 = sha256("coach-rec-fetch:" + 会话密钥)，和会话签名、设置加密不共用一把
 *   - 30 分钟过期；只能下签名里那一条录音（id 在签名串里）；路由里另判状态 = 转写中（没在转写的签了也不给）
 *   - 比对用 timingSafeEqual；日志、报错里不带签名串
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { readSecret } from "@/lib/secret";
import { 是录音编号 } from "./coach-rec";

export const 取文件有效秒 = 30 * 60;

function 子密钥(): Buffer {
  return createHash("sha256").update(`coach-rec-fetch:${readSecret()}`).digest();
}
const 签 = (id: string, exp: number): string => createHmac("sha256", 子密钥()).update(`${id}.${exp}`).digest("base64url");

/** 签一个取文件的地址（站内路径 + 查询串；PR4 前面拼 ENT_PUBLIC_URL） */
export function 签取文件地址(id: string, 现在: Date = new Date()): string {
  if (!是录音编号(id)) throw new Error("录音编号不对");
  const exp = Math.floor(现在.getTime() / 1000) + 取文件有效秒;
  return `/api/coach-rec/fetch/${id}?exp=${exp}&sig=${签(id, exp)}`;
}

/** 验签：编号像样、没过期（也不能远在 30 分钟以后）、签名对得上 */
export function 验取文件签名(id: unknown, exp: unknown, sig: unknown, 现在: Date = new Date()): boolean {
  if (!是录音编号(id) || typeof exp !== "string" || typeof sig !== "string" || !/^\d{9,11}$/.test(exp) || !/^[\w-]{43}$/.test(sig)) return false;
  const 秒 = Number(exp);
  const 今 = Math.floor(现在.getTime() / 1000);
  if (秒 < 今 || 秒 > 今 + 取文件有效秒 + 60) return false;
  const 要 = Buffer.from(签(id, 秒));
  const 给 = Buffer.from(sig);
  return 要.length === 给.length && timingSafeEqual(要, 给);
}
