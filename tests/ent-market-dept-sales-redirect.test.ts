/**
 * 按部门认的市场成员、没有市场角色（P-看-17，用户 11-24；X-165 11-25 扩到不论兼什么业务角色：兼销管、兼项目组员的一样；现库 0 人）：
 *   - 点进自己建的、已分给同事的项目详情：不落 404，跳市场视角页（P-界面-11，同市场成员那条：/customers?q=项目名&hl=id）
 *   - 客户页带 hl 转来：给他画同一套项目页（搜上项目名、高亮那一行）；不带 hl 的客户页照销售那套
 *   - 不相干的照旧 404；有市场角色的兼任（渠运兼销售）照旧进详情；不在市场部的销售照旧 404
 *   - 兼销管的：按销管口径本来能进的（负责人是他的下属）照常进，不跳；只有 能看项目 不过的才跳
 * 列表口径不变（照 P-看-05 放开，见 ent-list-detail-scope ①）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ReactElement } from "react";

const mocks = vi.hoisted(() => ({ user: { id: "", name: "", email: "a@x", role: "SALES", title: "", avatar: null as string | null }, 在请求: false }));
vi.mock("next/headers", async (原) => ({
  ...(await 原<object>()),
  cookies: async () => {
    if (!mocks.在请求) throw new Error("不在请求里");
    return { get: () => undefined };
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
}));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});
vi.mock("@/app/(app)/customers/CustomersView", () => ({ default: () => null }));
vi.mock("@/app/(app)/customers/HandoverPending", () => ({ default: () => null }));
vi.mock("@/app/(app)/projects/ProjectsView", () => ({ default: () => null }));
vi.mock("@/app/(app)/projects/[id]/ProjectDetail", () => ({ default: () => null }));
vi.mock("@/app/(app)/projects/[id]/SameNumberBanner", () => ({ default: () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 规则 } from "@/lib/enterprise/rules";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import ProjectPage from "@/app/(app)/projects/[id]/page";
import CustomersPage from "@/app/(app)/customers/page";
import { 读项目列表 } from "@/lib/project/list";

let 市场部销售: string, 渠运兼销售: string, 普通销售: string, 同事: string, 市场部销管: string, 市场部销管组员: string, 下属: string, 组员下属: string;
let 序 = 0;
async function 人(name: string, bizRole: string, deptId: string | null = null, managerId: string | null = null) {
  const id = (await prisma.user.create({ data: { email: `${name}@t`, name, title: "", role: "SALES", password: "x" } })).id;
  await prisma.entMember.create({ data: { userId: id, bizRole, deptId, managerId } });
  return id;
}
/** 客户建档人 = 项目建的人（市场相关客户按客户建档人认） */
async function 项目(名: string, 负责: string, 建的: string) {
  序++;
  const c = (await prisma.customer.create({ data: { name: `客户${序}`, phone: `1390000${String(序).padStart(4, "0")}`, salesOwnerId: 负责, creator: { create: { userId: 建的 } } } })).id;
  return (await prisma.project.create({ data: { name: 名, customerId: c, ownerId: 负责, creatorId: 建的, phase: "线索", node: "线索验证" } })).id;
}
const 当 = (谁: string) => { mocks.user = { ...mocks.user, id: 谁, name: 谁 }; };
async function 打开(谁: string, id: string) {
  当(谁);
  try {
    await 以谁的身份(谁, () => ProjectPage({ params: Promise.resolve({ id }) } as never));
    return "OK";
  } catch (e) {
    return (e as Error).message;
  }
}
type 页属性 = { 高亮?: string; 行?: { id: string; name: string; 只看进度?: boolean }[]; total?: number };
async function 客户页(谁: string, sp: Record<string, string>): Promise<页属性> {
  当(谁);
  mocks.在请求 = true;
  try {
    return ((await 以谁的身份(谁, () => CustomersPage({ searchParams: Promise.resolve(sp) } as never))) as ReactElement<页属性>).props;
  } finally {
    mocks.在请求 = false;
  }
}

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  序 = 0;
  const 市场部 = (await prisma.entDept.create({ data: { name: "市场部" } })).id;
  市场部销售 = await 人("mkts", "sales", 市场部);
  渠运兼销售 = await 人("chansales", "channel_ops,sales", 市场部);
  普通销售 = await 人("plain", "sales");
  同事 = await 人("peer", "sales");
  // X-165：兼销售 + 销管、兼项目组员（销管 + 项目组员）的，各带一个实线下属
  市场部销管 = await 人("mktmgr2", "sales,sales_mgr", 市场部);
  下属 = await 人("sub", "sales", null, 市场部销管);
  市场部销管组员 = await 人("mktpo", "sales_mgr,project_ops", 市场部);
  组员下属 = await 人("posub", "sales", null, 市场部销管组员);
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await setSetting(规则.按组织看客户.key, true);
  忘掉企业版范围();
});
afterEach(() => { vi.unstubAllEnvs(); invalidateSettingsCache(); 忘掉企业版范围(); });

describe("部门认的市场成员只挂销售：点进已分给同事的项目（P-看-17）", () => {
  it("自己建的、分给同事的：跳市场视角页（q 带项目名、hl 带 id），不是 404", async () => {
    const 名 = "华东 A&B 采购/二期";
    const id = await 项目(名, 同事, 市场部销售);
    expect(await 打开(市场部销售, id)).toBe(`REDIRECT:/customers?q=${encodeURIComponent(名)}&hl=${encodeURIComponent(id)}`);
  });

  it("客户页带 hl 转来：画同一套项目页，那一行在、高亮；不带 hl 照销售的客户列表", async () => {
    const 名 = "市场部销售建的";
    const id = await 项目(名, 同事, 市场部销售);
    await 项目("别的", 同事, 同事);
    const 落 = await 客户页(市场部销售, { q: 名, hl: id });
    expect(落.高亮).toBe(id);
    expect((落.行 ?? []).map((r) => r.name)).toEqual([名]);
    const 平常 = await 客户页(市场部销售, {});
    expect(平常.高亮).toBeUndefined();
    expect(typeof 平常.total).toBe("number");
  });

  it("落地页那一行标「只看进度」、点不进（同市场视角 P-看-06）；同页别的行、普通销售、渠运兼销售的行不受影响", async () => {
    const 转 = await 项目("华东一期", 同事, 市场部销售);
    const 进组 = await 项目("华东二期", 同事, 市场部销售);
    await prisma.projectMember.create({ data: { projectId: 进组, userId: 市场部销售, inviteStatus: "JOINED" } });
    const 自己 = await 项目("华东三期", 市场部销售, 市场部销售);
    const 落 = await 客户页(市场部销售, { q: "华东", hl: 转 });
    const 标 = Object.fromEntries((落.行 ?? []).map((r) => [r.id, !!r.只看进度]));
    // 列表条数和内容不变：三行都在，只有转回这一页的那行点不进
    expect(标).toEqual({ [转]: true, [进组]: false, [自己]: false });
    // 点得进的照旧进详情，标点不进的那行点进去确实跳回这一页
    expect(await 打开(市场部销售, 进组)).toMatch(/^REDIRECT:\/customers\/[^?]+\?project=/);
    expect(await 打开(市场部销售, 转)).toMatch(/^REDIRECT:\/customers\?q=/);
    const 渠 = await 项目("渠运兼销售建的", 同事, 渠运兼销售);
    const 普 = await 项目("普通销售建的", 同事, 普通销售);
    for (const [谁, id] of [[渠运兼销售, 渠], [普通销售, 普]] as const) {
      当(谁);
      const 行 = (await 以谁的身份(谁, () => 读项目列表(mocks.user, { pageSize: "100" }))).行;
      expect(行.find((r) => r.id === id)?.只看进度 ?? false).toBe(false);
    }
  });

  it("不相干的照旧 404（不借跳转露项目名）：同事建的；自己负责的照常进客户页项目页签", async () => {
    const 别人的 = await 项目("同事建的", 同事, 同事);
    expect(await 打开(市场部销售, 别人的)).toBe("NOT_FOUND");
    const 自己的 = await 项目("自己负责的", 市场部销售, 市场部销售);
    const c = (await prisma.project.findUniqueOrThrow({ where: { id: 自己的 } })).customerId;
    expect(await 打开(市场部销售, 自己的)).toBe(`REDIRECT:/customers/${c}?project=${自己的}`);
  });

  it("别的角色不变：渠运兼销售（有市场角色）照旧进详情；不在市场部的销售自己建的、分给同事的照旧 404；客户页带 hl 照销售那套", async () => {
    const 渠 = await 项目("渠运兼销售建的", 同事, 渠运兼销售);
    const c = (await prisma.project.findUniqueOrThrow({ where: { id: 渠 } })).customerId;
    expect(await 打开(渠运兼销售, 渠)).toBe(`REDIRECT:/customers/${c}?project=${渠}`);
    const 普 = await 项目("普通销售建的", 同事, 普通销售);
    expect(await 打开(普通销售, 普)).toBe("NOT_FOUND");
    expect((await 客户页(普通销售, { q: "普通销售建的", hl: 普 })).高亮).toBeUndefined();
  });
});

describe("X-165：部门认的市场成员兼销管、兼项目组员（没有市场角色），同样跳转", () => {
  const 只看进度of = async (谁: string, id: string) => {
    当(谁);
    const 行 = (await 以谁的身份(谁, () => 读项目列表(mocks.user, { pageSize: "100" }))).行.find((r) => r.id === id);
    expect(行).toBeDefined();
    return !!行?.只看进度;
  };
  for (const [叫法, 谁of, 下属of] of [["兼销售 + 销管", () => 市场部销管, () => 下属], ["兼项目组员（销管 + 项目组员）", () => 市场部销管组员, () => 组员下属]] as const) {
    it(`${叫法}：自己建的、分给同事的跳市场视角页、那一行标只看进度；分给自己下属的照销管口径进详情、不跳`, async () => {
      const 谁 = 谁of();
      const 名 = `${叫法}建的 A&B/二期`;
      const 转 = await 项目(名, 同事, 谁);
      expect(await 打开(谁, 转)).toBe(`REDIRECT:/customers?q=${encodeURIComponent(名)}&hl=${encodeURIComponent(转)}`);
      expect(await 只看进度of(谁, 转)).toBe(true);
      const 落 = await 客户页(谁, { q: 名, hl: 转 });
      expect(落.高亮).toBe(转);
      expect((落.行 ?? []).map((r) => [r.id, !!r.只看进度])).toEqual([[转, true]]);

      const 下 = await 项目(`${叫法}分给下属的`, 下属of(), 谁);
      const c = (await prisma.project.findUniqueOrThrow({ where: { id: 下 } })).customerId;
      expect(await 打开(谁, 下)).toBe(`REDIRECT:/customers/${c}?project=${下}`);
      expect(await 只看进度of(谁, 下)).toBe(false);
      // 不相干的照旧 404
      expect(await 打开(谁, await 项目(`${叫法}看不到的`, 同事, 同事))).toBe("NOT_FOUND");
    });
  }

  it("有市场角色的兼任、普通销售行为不变（扩了以后回归）", async () => {
    const 渠 = await 项目("渠运兼销售建的", 同事, 渠运兼销售);
    const c = (await prisma.project.findUniqueOrThrow({ where: { id: 渠 } })).customerId;
    expect(await 打开(渠运兼销售, 渠)).toBe(`REDIRECT:/customers/${c}?project=${渠}`);
    expect(await 只看进度of(渠运兼销售, 渠)).toBe(false);
    const 普 = await 项目("普通销售建的", 同事, 普通销售);
    expect(await 打开(普通销售, 普)).toBe("NOT_FOUND");
  });
});
