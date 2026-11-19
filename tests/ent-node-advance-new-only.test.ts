/**
 * 节点推进管哪些项目。
 * 客户 11-19 最新口径推翻了第 25 题：「不论是存量项目还是新增项目都需要按这一规则执行」——范围默认「全部」，存量项目同样要补齐必填才推。
 * 第 25 题那版（只管开关打开之后新建的项目）留作设置项「开启之后新建的」（组织规则.节点推进.范围 = 新建），下面「各入口」整组按它钉：
 *   - 开关第一次从关变开记下生效时刻（组织规则.节点推进.生效于），关了再开不刷新
 *   - 开着：建在生效时刻之后（含同一毫秒）的项目按必填拦往前推、填齐自动推；之前建的照关着时一样手动推、不拦、不自动推
 *   - 关着：新老项目都不拦（现网默认，行为不变）
 *   - 入口：项目详情 / 节点下拉（改节点）、看板拖动（看板推进预检 + 改项目节点）、首页 AI 推进卡（做项目卡）、记沟通、客户资料齐了的连带推进、项目页的还差
 *   - 线索验证的有效沟通门槛不归这个开关管，存量项目照旧走（stage-gates.ts 企业版推进关）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "", name: "乙", email: "yi", role: "SALES", title: "", avatar: null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { dayjs } from "@/lib/utils";
import { 默认组织规则, 合上改动, 规整组织规则, type 组织规则 } from "@/lib/project/org-rules";
import { 节点推进管, 项目按必填走 } from "@/lib/project/required";
import { 改节点, 改项目, 记项目沟通, 客户项目按必填推进 } from "@/lib/project/db";
import { 看板推进预检, 改项目节点 } from "@/app/(app)/projects/actions";
import { 读项目详情 } from "@/app/(app)/projects/[id]/load";
import { 做项目卡 } from "@/lib/agent/apply-project";
import { DEFAULT_BUSINESS } from "@/lib/business-config";
import type { 项目卡 } from "@/lib/agent/project-proposals";

const 一小时前 = () => new Date(Date.now() - 3600_000).toISOString();
const 推进规则 = (必填: Record<string, string[]>, 开: boolean, 生效于: string | null, 范围: "全部" | "新建" = "新建"): 组织规则 => ({ ...默认组织规则, 节点推进: { 开, 必填, 生效于, 范围 } });

describe("生效时刻怎么记、怎么判（纯函数）", () => {
  const T1 = new Date("2026-11-20T02:00:00.000Z");
  const T2 = new Date("2026-11-25T02:00:00.000Z");

  it("第一次从关变开记下此刻；关了再开保留第一次的；开着再交一次开不改", () => {
    const 开 = 合上改动(默认组织规则, { 节点推进: { 开: true } }, T1) as 组织规则;
    expect(开.节点推进).toEqual({ 开: true, 必填: {}, 生效于: T1.toISOString(), 范围: "全部" });
    const 关 = 合上改动(开, { 节点推进: { 开: false } }, T2) as 组织规则;
    expect(关.节点推进).toEqual({ 开: false, 必填: {}, 生效于: T1.toISOString(), 范围: "全部" });
    const 再开 = 合上改动(关, { 节点推进: { 开: true } }, T2) as 组织规则;
    expect(再开.节点推进.生效于).toBe(T1.toISOString());
    expect((合上改动(再开, { 节点推进: { 开: true } }, T2) as 组织规则).节点推进.生效于).toBe(T1.toISOString());
    // 只改必填不碰生效时刻
    expect((合上改动(再开, { 节点推进: { 必填: { 潜客培育: ["金额"] } } }, T2) as 组织规则).节点推进.生效于).toBe(T1.toISOString());
  });

  it("这次改动前就开着的老数据（没记生效时刻）：照原来全管；再交开也不补记；开着改成「只管新建的」从此刻记", () => {
    const 老 = 推进规则({ 潜客培育: ["金额"] }, true, null, "全部");
    expect(节点推进管(老, { createdAt: new Date("2020-01-01") })).toBe(true);
    expect((合上改动(老, { 节点推进: { 开: true } }, T2) as 组织规则).节点推进.生效于).toBeNull();
    expect((合上改动(老, { 节点推进: { 范围: "新建" } }, T2) as 组织规则).节点推进).toMatchObject({ 范围: "新建", 生效于: T2.toISOString() });
    // 关着改范围不记（等第一次打开时记）
    expect((合上改动({ ...老, 节点推进: { ...老.节点推进, 开: false } }, { 节点推进: { 范围: "新建" } }, T2) as 组织规则).节点推进.生效于).toBeNull();
    expect(合上改动(老, { 节点推进: { 范围: "乱写" as never } }, T2)).toMatchObject({ error: expect.stringContaining("管哪些项目") });
  });

  it("范围（客户 11-19）：默认全部；存的不认得 = 全部；全部时生效时刻记着也不看，存量照管", () => {
    expect(默认组织规则.节点推进.范围).toBe("全部");
    expect(规整组织规则({ 节点推进: { 开: true } }).节点推进.范围).toBe("全部");
    expect(规整组织规则({ 节点推进: { 开: true, 范围: "乱写" } }).节点推进.范围).toBe("全部");
    expect(规整组织规则({ 节点推进: { 开: true, 范围: "新建" } }).节点推进.范围).toBe("新建");
    const 全部 = 推进规则({ 潜客培育: ["金额"] }, true, T1.toISOString(), "全部");
    expect(节点推进管(全部, { createdAt: new Date("2020-01-01") })).toBe(true);
    expect(项目按必填走(全部, { node: "潜客培育", createdAt: new Date("2020-01-01") })).toBe(true);
    // 手写的老规则对象没写范围 = 全部
    expect(节点推进管({ ...默认组织规则, 节点推进: { 开: true, 必填: {}, 生效于: T1.toISOString() } }, { createdAt: new Date("2020-01-01") })).toBe(true);
  });

  it("存着读回来：认得的 ISO 留着，坏的当没记过", () => {
    expect(规整组织规则({ 节点推进: { 开: true, 生效于: T1.toISOString() } }).节点推进.生效于).toBe(T1.toISOString());
    for (const 坏 of ["乱写", 3, "2026-11-20", null, undefined]) {
      expect(规整组织规则({ 节点推进: { 开: true, 生效于: 坏 } }).节点推进.生效于).toBeNull();
    }
  });

  it("建在生效时刻之后（同一毫秒算之后）才管，早一毫秒不管；关着谁都不管", () => {
    const r = 推进规则({ 潜客培育: ["金额"] }, true, T1.toISOString());
    expect(节点推进管(r, { createdAt: new Date(T1.getTime() + 1) })).toBe(true);
    expect(节点推进管(r, { createdAt: T1 })).toBe(true);
    expect(节点推进管(r, { createdAt: new Date(T1.getTime() - 1) })).toBe(false);
    expect(节点推进管(r, { createdAt: new Date(T1.getTime() - 1).toISOString() })).toBe(false);
    expect(项目按必填走(r, { node: "潜客培育", createdAt: T2 })).toBe(true);
    expect(项目按必填走(r, { node: "线索验证", createdAt: T2 })).toBe(false);
    expect(节点推进管({ ...r, 节点推进: { ...r.节点推进, 开: false } }, { createdAt: T2 })).toBe(false);
  });
});

describe("范围 = 开启之后新建的（第 25 题那版，设置项）：存量不管、新建的管", () => {
  let 乙: { id: string; name: string; role: string };
  let 客户: string;

  async function 项目(补: Record<string, unknown> = {}) {
    return prisma.project.create({ data: { name: "一号项目", customerId: 客户, ownerId: 乙.id, creatorId: 乙.id, phase: "线索", node: "潜客培育", ...补 } });
  }
  /** 生效时刻（一小时前）之前建的存量项目 */
  const 老项目 = (补: Record<string, unknown> = {}) => 项目({ name: "老项目", createdAt: new Date(Date.now() - 2 * 86400_000), ...补 });
  const 新项目 = (补: Record<string, unknown> = {}) => 项目({ name: "新项目", ...补 });
  const 现 = (id: string) => prisma.project.findUniqueOrThrow({ where: { id } });

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

  it("开关关（现网默认）：新老项目都不拦、不自动推", async () => {
    await setSetting("orgRules", 推进规则({ 潜客培育: ["金额"] }, false, 一小时前()));
    for (const p of [await 老项目(), await 新项目()]) {
      const r = await 改项目(乙, p.id, { name: p.name, amount: 100 });
      expect(r).toMatchObject({ ok: true });
      expect(r).not.toHaveProperty("自动推到");
      expect((await 现(p.id)).node).toBe("潜客培育");
    }
    for (const p of [await 老项目(), await 新项目()]) {
      expect(await 改节点(乙, p.id, { phase: "线索", node: "线索验证" })).toMatchObject({ ok: true, 变了: true });
    }
    // 默认那份（从没开过）同样
    await setSetting("orgRules", 默认组织规则);
    const q = await 新项目();
    expect(await 改节点(乙, q.id, { phase: "线索", node: "线索验证" })).toMatchObject({ ok: true, 变了: true });
  });

  it("开着 · 项目详情完成节点 / 节点下拉（改节点）：老项目缺必填照推，新项目被拦", async () => {
    await setSetting("orgRules", 推进规则({ 潜客培育: ["金额"] }, true, 一小时前()));
    const 老 = await 老项目(), 新 = await 新项目();
    expect(await 改节点(乙, 老.id, { phase: "线索", node: "线索验证" })).toMatchObject({ ok: true, 变了: true });
    const 拦 = await 改节点(乙, 新.id, { phase: "线索", node: "线索验证" });
    expect(拦.ok).toBe(false);
    expect(!拦.ok && 拦.error).toContain("还差必填");
    // 项目页：老项目不列必填，新项目列还差
    const 详 = async (id: string) => {
      const r = await 读项目详情(mocks.user as never, id);
      return r.种 === "有" ? r.props.p.必填 : "没读到";
    };
    expect(await 详(老.id)).toBeNull();
    expect(await 详(新.id)).toMatchObject({ 配了: ["金额"], 还差: ["金额"] });
  });

  it("开着 · 改字段填齐：老项目不自动推，新项目自动推", async () => {
    await setSetting("orgRules", 推进规则({ 潜客培育: ["金额"] }, true, 一小时前()));
    const 老 = await 老项目(), 新 = await 新项目();
    const 老r = await 改项目(乙, 老.id, { name: 老.name, amount: 100 });
    expect(老r).not.toHaveProperty("自动推到");
    expect((await 现(老.id)).node).toBe("潜客培育");
    expect(await 改项目(乙, 新.id, { name: 新.name, amount: 100 })).toMatchObject({ ok: true, 自动推到: ["线索验证"] });
  });

  it("开着 · 看板拖动：预检老项目不报还差、真推放行；新项目报还差、真推被拦", async () => {
    await setSetting("orgRules", 推进规则({ 潜客培育: ["金额"] }, true, 一小时前()));
    const 老 = await 老项目(), 新 = await 新项目();
    const 到 = { phase: "线索", node: "线索验证" };
    expect(await 看板推进预检(老.id, 到)).toEqual({ ok: true, 还差: [], 能留空推: false });
    const 预 = await 看板推进预检(新.id, 到);
    expect(预).toMatchObject({ ok: true, 能留空推: false });
    expect(预.ok && 预.还差.length).toBe(1);
    expect(await 改项目节点(老.id, { ...到, result: null })).toMatchObject({ ok: true, 变了: true });
    expect(await 改项目节点(新.id, { ...到, result: null })).toMatchObject({ ok: false });
  });

  it("开着 · 首页 AI 推进卡：老项目确认就推，新项目缺必填拦下", async () => {
    await setSetting("orgRules", 推进规则({ 潜客培育: ["金额"] }, true, 一小时前()));
    const 老 = await 老项目(), 新 = await 新项目();
    const 卡 = (p: { id: string; name: string }) => ({
      id: "t", kind: "project_node", customerId: 客户, customerName: "客户甲", reason: "人说推", targetId: p.id, targetName: p.name,
      目标: "下一步", 原因: "", 异常类别: "", 到: { phase: "线索", node: "线索验证", result: null },
    }) as unknown as 项目卡;
    const b = { ...DEFAULT_BUSINESS, projectMode: true };
    expect(await 做项目卡(卡(老), 乙, b)).toMatchObject({ ok: true });
    expect((await 现(老.id)).node).toBe("线索验证");
    const r = await 做项目卡(卡(新), 乙, b);
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.error).toContain("还差必填");
    expect((await 现(新.id)).node).toBe("潜客培育");
  });

  it("开着 · 记沟通后自动推进：老项目记了不推，新项目推", async () => {
    await setSetting("orgRules", 推进规则({ 潜客培育: ["本节点沟通", "下一步时间"] }, true, 一小时前()));
    const 老 = await 老项目(), 新 = await 新项目();
    const 记 = (id: string) => 记项目沟通(乙, id, { type: "PHONE", content: "聊了", occurredAt: dayjs().format("YYYY-MM-DD HH:mm"), 下一步时间: dayjs().add(2, "day").format("YYYY-MM-DD"), 阶段: "线索", 明确回复: false });
    const 老r = await 记(老.id);
    expect(老r).toMatchObject({ ok: true });
    expect(老r).not.toHaveProperty("自动推到");
    expect((await 现(老.id)).node).toBe("潜客培育");
    expect(await 记(新.id)).toMatchObject({ ok: true, 自动推到: ["线索验证"] });
  });

  it("开着 · 客户资料齐了的连带推进：只推新项目", async () => {
    await setSetting("orgRules", 推进规则({ 潜客培育: ["国家", "来源"] }, true, 一小时前()));
    const 老 = await 老项目(), 新 = await 新项目();
    await prisma.customerExtra.create({ data: { customerId: 客户, country: "德国", source: "展会" } });
    expect((await 客户项目按必填推进(乙, 客户)).map((x) => x.id)).toEqual([新.id]);
    expect((await 现(老.id)).node).toBe("潜客培育");
  });

  it("老数据（开着、没记生效时刻）：照原来全管，存量也拦", async () => {
    await setSetting("orgRules", 推进规则({ 潜客培育: ["金额"] }, true, null));
    const 老 = await 老项目();
    expect((await 改节点(乙, 老.id, { phase: "线索", node: "线索验证" })).ok).toBe(false);
  });
});
