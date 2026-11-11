/**
 * 号码出口的打码：企业版字段权限里电话设成「看不到」（藏）的角色，号码打码；其余原样返回。
 *
 * 页面、导出、AI 助手、MCP 出号码都过这一个出口。返回的是函数而不是布尔值，调用点就不必各写一遍三元表达式，
 * 也不会出现「这一页记得打码、那一页忘了」的漂移。
 *
 * 规则「字段权限」没开时 字段权限of 不读库、全是「改」，这里就原样返回。
 * 不走 cookie 的入口（MCP 令牌）必须传 userId：不传就按 cookie 认人，认不到 = 全能改 = 不打码。
 *
 * （原在 lib/shared-ws/current.ts，连同网页共享试用区那一半打码；企业版没有共享区，那一半随之去掉。）
 */
import { 字段权限of } from "./field-perm";
import { maskPhone } from "@/lib/utils";

export async function 号码脱敏器(userId?: string): Promise<<T extends string | null>(p: T) => T> {
  const 藏 = (await 字段权限of(userId))("电话") === "藏";
  return <T extends string | null>(p: T): T => (藏 && p ? (maskPhone(p) as T) : p);
}
