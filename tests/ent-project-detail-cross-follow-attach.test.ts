/**
 * 项目详情（/projects/[id]）沟通上的截图、录音：记在本项目客户名下的，或记在别的客户名下、那位客户我也看得到的才给（11-24，审查后改）。
 * 关联客户带进来、记在别的客户名下的沟通：附件接口 认沟通 要看得到那位客户——看不到的（销售、链外客户的销管）接口拒，界面上不出附件框和上传入口
 * （不带 附件 这一格）；看得到的（总管理）接口放行，界面也照给。那条沟通本身照旧列出来。「按组织看客户」开着（c2 的组合）
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

let 销售: string, 销管: string, 总管理: string, 项目: string, 本客户沟通: string, 跨客户沟通: string;
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
  const 人 = async (email: string, bizRole: string, managerId: string | null = null) => {
    const id = (await prisma.user.create({ data: { email, name: email, title: "", role: "SALES", password: "x" } })).id;
    await prisma.entMember.create({ data: { userId: id, bizRole, managerId } });
    return id;
  };
  总管理 = await 人("xatt-d", "director");
  // 销管：本项目负责人是他的下属（看得到项目和本客户），对方客户的负责人不在他链上（看不到）
  销管 = await 人("xatt-m", "sales_mgr");
  销售 = await 人("xatt-s1", "sales", 销管);
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

const 认 = (谁: string, followUpId: string) => { 当(谁); return 以谁的身份(谁, () => 认附件父记录({ opportunityId: null, leadId: null, contactId: null, projectId: null, followUpId }, false)); };
async function 详情(谁: string) {
  当(谁);
  const 载 = await 以谁的身份(谁, () => 读项目详情(mocks.user as never, 项目));
  if (载.种 !== "有") throw new Error(`没给 ${谁} 详情`);
  return (id: string) => 载.props.p.followUps.find((f) => f.id === id);
}

describe("项目详情沟通附件：本客户的，或看得到那位客户的才给", () => {
  it("销售：本客户名下的带附件；记在同事客户名下的照列、不带附件这一格（接口那边确实拒）", async () => {
    const 行 = await 详情(销售);
    expect(行(本客户沟通)?.附件?.map((a) => a.name)).toEqual(["本客户名下-0.png"]);
    expect(行(跨客户沟通), "这条沟通照旧列出来").toBeTruthy();
    // 不给空数组：给了 [] 界面就出空附件框和「加截图 / 录音」入口（ProjectDetail f.附件 && …），传上去又被拒
    expect(行(跨客户沟通) && "附件" in 行(跨客户沟通)!).toBe(false);
    expect("错" in (await 认(销售, 本客户沟通))).toBe(false);
    expect("错" in (await 认(销售, 跨客户沟通))).toBe(true);
  });

  it("总管理看得到对方客户：跨客户那条也带附件，和接口放行一致", async () => {
    const 行 = await 详情(总管理);
    expect(行(本客户沟通)?.附件?.map((a) => a.name)).toEqual(["本客户名下-0.png"]);
    expect(行(跨客户沟通)?.附件?.map((a) => a.name).sort()).toEqual(["别的客户名下-0.png", "别的客户名下-1.png"]);
    expect("错" in (await 认(总管理, 跨客户沟通))).toBe(false);
  });

  it("销管看不到对方客户：跨客户那条不带附件这一格（不出附件框和上传入口）；本客户的照常", async () => {
    const 行 = await 详情(销管);
    expect(行(本客户沟通)?.附件?.map((a) => a.name)).toEqual(["本客户名下-0.png"]);
    expect(行(跨客户沟通), "这条沟通照旧列出来").toBeTruthy();
    expect(行(跨客户沟通) && "附件" in 行(跨客户沟通)!).toBe(false);
    expect("错" in (await 认(销管, 本客户沟通))).toBe(false);
    expect("错" in (await 认(销管, 跨客户沟通))).toBe(true);
  });
});
