/**
 * 市场成员打开已分给销售的项目详情（客户 11-05）：
 *   - 被「市场视角进不了详情」挡住、但这行在他的项目列表里 → 不再 404，跳回项目页：带项目名做搜索（q）、带 id 高亮那行（hl）
 *   - 没权限（列表里也没有这行）、不存在、已删除 → 照旧 404，不因为跳转把项目名露出去
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "a@x", role: "SALES", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
}));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));
vi.mock("@/lib/shared-ws/current", () => ({ 当前是共享区: async () => false }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});
vi.mock("@/app/(app)/projects/[id]/ProjectDetail", () => ({ default: () => null }));
vi.mock("@/app/(app)/projects/[id]/SameNumberBanner", () => ({ default: () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 市场成员key } from "@/lib/enterprise/market";
import ProjectPage from "@/app/(app)/projects/[id]/page";

let 主管: string, 小市: string, 小李: string, 小王: string, 外人: string;
let 序 = 0;
const 人 = async (name: string) => (await prisma.user.create({ data: { email: `${name}@t`, name, title: "", role: "SALES", password: "x" } })).id;
async function 项目(名: string, 负责: string, 建的: string) {
  序++;
  const c = (await prisma.customer.create({ data: { name: `客户${序}`, phone: `1390000${String(序).padStart(4, "0")}`, salesOwnerId: 负责 } })).id;
  return (await prisma.project.create({ data: { name: 名, customerId: c, ownerId: 负责, creatorId: 建的, phase: "线索", node: "线索验证" } })).id;
}
/** 按谁的身份打开详情：成功渲染回 "OK"，否则回 notFound / redirect 抛出来的那句 */
async function 打开(谁: string, id: string) {
  mocks.user = { ...mocks.user, id: 谁, name: 谁 };
  try {
    await 以谁的身份(谁, () => ProjectPage({ params: Promise.resolve({ id }) } as never));
    return "OK";
  } catch (e) {
    return (e as Error).message;
  }
}

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  序 = 0;
  主管 = await 人("主管");
  小市 = await 人("小市");
  小李 = await 人("小李");
  小王 = await 人("小王");
  外人 = await 人("外人");
  await prisma.entMember.createMany({
    data: [
      { userId: 主管, bizRole: "marketing_mgr" },
      { userId: 小市, bizRole: "channel_ops", managerId: 主管 },
      { userId: 小李, bizRole: "channel_ops" },
      { userId: 小王, bizRole: "sales" },
      { userId: 外人, bizRole: "sales" },
    ],
  });
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await setSetting("enterprise.rule.org_scope", true);
  await setSetting(市场成员key, [小市, 小李]);
  忘掉企业版范围();
});
afterEach(() => { vi.unstubAllEnvs(); invalidateSettingsCache(); });

describe("市场成员打开已分给销售的项目", () => {
  it("建的人、他的实线上级被市场视角挡住 → 跳回项目页，q 带项目名（编码）、hl 带 id", async () => {
    const 名 = "华东 A&B 采购/二期";
    const id = await 项目(名, 小王, 小市);
    const 去 = `REDIRECT:/projects?q=${encodeURIComponent(名)}&hl=${encodeURIComponent(id)}`;
    expect(await 打开(小市, id)).toBe(去);
    expect(await 打开(主管, id)).toBe(去);
  });

  it("没权限的照旧 404：不相干的销售、别的市场成员（不是他建的）", async () => {
    const id = await 项目("甲项目", 小王, 小市);
    expect(await 打开(外人, id)).toBe("NOT_FOUND");
    expect(await 打开(小李, id)).toBe("NOT_FOUND");
  });

  it("不存在、已删除的照旧 404，建的人也一样", async () => {
    expect(await 打开(小市, "没有这个id")).toBe("NOT_FOUND");
    const id = await 项目("乙项目", 小王, 小市);
    await prisma.project.update({ where: { id }, data: { deletedAt: new Date() } });
    expect(await 打开(小市, id)).toBe("NOT_FOUND");
  });

  it("负责的销售自己打开照常进详情，不跳", async () => {
    const id = await 项目("丙项目", 小王, 小市);
    expect(await 打开(小王, id)).toBe("OK");
  });
});
