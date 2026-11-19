/**
 * F-017（员工反馈）：推过「线索验证」的补填提示（app/(app)/projects/[id]/load.ts 线索验证缺沟通 + lib/project/stage-gates.ts 缺有效沟通还差）。
 *   - 只差需求状态时，服务端拦下的话写明在「项目画像」里选；差好几项照列
 *   - 项目页的「并在线索验证记一条沟通」半句读的是同一个开关（组织规则.阶段.前两节点要沟通），和 企业版推进关 同一个判法：
 *     开着、停在线索验证、这个节点上没沟通 → 给；开关关、不在线索验证、线索验证上记过沟通 → 不给
 *   - 判定逻辑不动：拦不拦照旧由 改节点 → 企业版推进关 说了算
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "", name: "乙", email: "yi", role: "SALES", title: "", avatar: null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 默认组织规则 } from "@/lib/project/org-rules";
import { 改节点 } from "@/lib/project/db";
import { 缺有效沟通还差, 缺本节点沟通 } from "@/lib/project/stage-gates";
import { 读项目详情 } from "@/app/(app)/projects/[id]/load";
import { 记有效沟通 } from "./helpers/ent-valid-followup";

describe("缺有效沟通还差：只差需求状态时写明在哪选", () => {
  it("两种写法（没配必填的「需求状态」、配了的「需求（需求状态）」）都指到「项目画像」；差好几项照列；不差给原话", () => {
    for (const 差 of [["需求状态"], ["需求（需求状态）"]]) {
      expect(缺有效沟通还差(差)).toBe("线索验证合格要先填好「线索验证」的必填项：还差需求状态（在「项目画像」里选）");
    }
    expect(缺有效沟通还差(["所属联系人", "需求（需求状态）"])).toBe("线索验证合格要先填好「线索验证」的必填项：还差所属联系人、需求（需求状态）");
    expect(缺有效沟通还差([])).toBe("线索验证合格要先填好「线索验证」的必填项");
  });
});

describe("项目页：线索验证缺沟通（只管提示）", () => {
  let 乙: { id: string; name: string; role: string };
  let 客户: string;
  const 项目 = (补: Record<string, unknown> = {}) =>
    prisma.project.create({ data: { name: "一号项目", customerId: 客户, ownerId: 乙.id, creatorId: 乙.id, phase: "线索", node: "线索验证", ...补 } });
  const 开关 = (开: boolean) => setSetting("orgRules", { ...默认组织规则, 阶段: { ...默认组织规则.阶段, 前两节点要沟通: 开 } });
  const 详 = async (id: string) => {
    const r = await 读项目详情(mocks.user as never, id);
    if (r.种 !== "有") throw new Error("没读到项目");
    return r.props.p;
  };

  beforeEach(async () => {
    await resetDb();
    invalidateSettingsCache();
    vi.stubEnv("CRM_ENTERPRISE", "1");
    await setSetting("business", { projectMode: true });
    const u = await prisma.user.create({ data: { email: "yi", name: "乙", title: "", role: "SALES", password: "x" } });
    乙 = { id: u.id, name: u.name, role: "SALES" };
    await prisma.entMember.create({ data: { userId: 乙.id, bizRole: "sales" } });
    mocks.user = { ...mocks.user, id: 乙.id };
    客户 = (await prisma.customer.create({ data: { name: "客户甲", phone: "13800000001", salesOwnerId: 乙.id } })).id;
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("开关开、停在线索验证、没沟通：给；服务端照旧拦需求状态，话里指到项目画像", async () => {
    await 开关(true);
    const p = await 项目();
    const 页 = await 详(p.id);
    expect(页.线索验证缺沟通).toBe(true);
    expect(页.有效沟通差).toEqual(["需求（需求状态）"]);
    expect(await 改节点(乙, p.id, { phase: "线索", node: "线索推进" })).toEqual({ ok: false, error: 缺本节点沟通("线索验证") });
  });

  it("线索验证上记过一条沟通：不给（需求状态选上就能推，和服务端一致）", async () => {
    await 开关(true);
    const p = await 项目();
    await 记有效沟通(p.id, false);
    expect((await 详(p.id)).线索验证缺沟通).toBeUndefined();
    expect(await 改节点(乙, p.id, { phase: "线索", node: "线索推进" })).toEqual({ ok: false, error: 缺有效沟通还差(["需求（需求状态）"]) });
    await prisma.project.update({ where: { id: p.id }, data: { demandStatus: "明确需求" } });
    expect(await 改节点(乙, p.id, { phase: "线索", node: "线索推进" })).toMatchObject({ ok: true });
  });

  it("开关关（默认）：不给，服务端也只拦需求状态；开着但在潜客培育：也不给", async () => {
    await 开关(false);
    const p = await 项目();
    expect((await 详(p.id)).线索验证缺沟通).toBeUndefined();
    expect(await 改节点(乙, p.id, { phase: "线索", node: "线索推进" })).toEqual({ ok: false, error: 缺有效沟通还差(["需求（需求状态）"]) });
    await 开关(true);
    const q = await 项目({ node: "潜客培育" });
    expect((await 详(q.id)).线索验证缺沟通).toBeUndefined();
  });
});
