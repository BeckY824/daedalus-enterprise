/**
 * 项目详情（/projects/[id]）沟通上的截图、录音只给记在本项目客户名下的（11-24，同客户页汇总的做法，customer-follow-feed.ts）。
 * 关联客户带进来、记在别的客户名下的沟通：附件接口 认沟通 要看得到那位客户，销售看不到同事的客户 → 接口拒 → 页面上是破图，所以不带。
 * 本客户名下的照旧带；那条沟通本身照旧列出来（只是不带附件）。「按组织看客户」开着（c2 的组合）
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "QA", email: "qa-xatt", role: "SALES", title: "", avatar: null } as { id: string; name: string; email: string; role: string; title: string; avatar: null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, redirect: (u: string) => { throw new Error(`REDIRECT:${u}`); } }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), getCurrentUser: async () => mocks.user, requireUser: async () => mocks.user }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});
vi.mock("@/app/(app)/projects/[id]/ProjectDetail", () => ({ default: () => null }));

import { prisma, defaultClient as raw } from "@/lib/prisma";
import { 规则 } from "@/lib/enterprise/rules";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 读项目详情 } from "@/app/(app)/projects/[id]/load";
import { 认附件父记录 } from "@/app/api/attachments/access";

afterAll(async () => { await prisma.$disconnect(); });

let 销售: string, 项目: string, 本客户沟通: string, 跨客户沟通: string;
const 当 = (id: string) => { mocks.user = { ...mocks.user, id, name: id }; };

async function 记(customerId: string, ownerId: string, title: string, projectId: string, 附件 = 0) {
  const f = await raw.followUp.create({ data: { type: "PHONE", title, content: title, customerId, ownerId, occurredAt: new Date("2026-11-20T02:00:00Z") } });
  await raw.followUpProject.create({ data: { followUpId: f.id, projectId, node: "潜客培育" } });
  for (let i = 0; i < 附件; i++) await raw.attachment.create({ data: { followUpId: f.id, name: `${title}-${i}.png`, mime: "image/png", size: 100 + i, sha256: `${f.id}-${i}`, userId: ownerId } });
  return f.id;
}

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  const 人 = async (email: string, bizRole: string) => {
    const id = (await prisma.user.create({ data: { email, name: email, title: "", role: "SALES", password: "x" } })).id;
    await prisma.entMember.create({ data: { userId: id, bizRole } });
    return id;
  };
  销售 = await 人("xatt-s1", "sales");
  const 同事 = await 人("xatt-s2", "sales");
  const 甲 = (await raw.customer.create({ data: { name: "QA-本客户", phone: "13800004801", salesOwnerId: 销售 } })).id;
  const 丙 = (await raw.customer.create({ data: { name: "QA-同事的客户", phone: "13800004802", salesOwnerId: 同事 } })).id;
  项目 = (await raw.project.create({ data: { customerId: 甲, ownerId: 销售, creatorId: 销售, name: "QA-跨客户附件项目", phase: "线索", node: "潜客培育" } })).id;
  await raw.projectCustomer.create({ data: { projectId: 项目, customerId: 丙 } });
  本客户沟通 = await 记(甲, 销售, "本客户名下", 项目, 1);
  跨客户沟通 = await 记(丙, 同事, "别的客户名下", 项目, 2);
  await raw.setting.upsert({ where: { key: 规则.按组织看客户.key }, update: { value: "true" }, create: { key: 规则.按组织看客户.key, value: "true" } });
  invalidateSettingsCache();
  忘掉企业版范围();
  当(销售);
});
afterEach(() => { vi.unstubAllEnvs(); 忘掉企业版范围(); });

describe("项目详情沟通附件只给本客户名下的", () => {
  it("本客户名下的带附件；记在别的客户名下的照列、不带附件（接口那边确实拒）", async () => {
    const 载 = await 以谁的身份(销售, () => 读项目详情(mocks.user as never, 项目));
    if (载.种 !== "有") throw new Error("没给详情");
    const 行 = (id: string) => 载.props.p.followUps.find((f) => f.id === id);
    expect(行(本客户沟通)?.附件?.map((a) => a.name)).toEqual(["本客户名下-0.png"]);
    expect(行(跨客户沟通), "这条沟通照旧列出来").toBeTruthy();
    expect(行(跨客户沟通)?.附件).toEqual([]);
    // 前提：本客户的接口放行，别的客户名下的接口拒（带了就是破图）
    const 认 = (followUpId: string) => 以谁的身份(销售, () => 认附件父记录({ opportunityId: null, leadId: null, contactId: null, projectId: null, followUpId }, false));
    expect("错" in (await 认(本客户沟通))).toBe(false);
    expect("错" in (await 认(跨客户沟通))).toBe(true);
  });
});
