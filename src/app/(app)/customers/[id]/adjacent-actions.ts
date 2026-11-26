"use server";

/**
 * 客户详情「上一条 / 下一条」要相邻两位的 id（E-332，规矩见 adjacent.ts）。
 * 只给 id 和它在第几页，不给名单；可见范围走列表同一套查询（限定层），这里不另判权限。
 * 这一期只认客户列表（/customers）的地址，别的一律 null
 */
import { requireUser } from "@/lib/auth";
import { 找相邻, 查询串of, 客户列表取页, type 相邻 } from "./adjacent";

export async function 相邻客户(来源: { href: string; page: number }, id: string): Promise<相邻 | null> {
  await requireUser();
  if (typeof id !== "string" || !id || id.length > 64) return null;
  const href = typeof 来源?.href === "string" && 来源.href.length <= 4000 ? 来源.href : "";
  if (href.split("?")[0] !== "/customers") return null;
  const page = Number.isSafeInteger(来源?.page) && 来源.page > 0 ? 来源.page : 1;
  const 取页 = await 客户列表取页(查询串of(href));
  return 取页 ? 找相邻(id, page, 取页) : null;
}
