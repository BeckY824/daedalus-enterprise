/**
 * 运营分发客户的提醒（11-06）：接手人收到「分给你」，点开直达客户详情（看得到联系方式）。
 * 四个分发口：直接换负责人、新建时指定别人、编辑换负责人、整格改负责人；建档向导指定别人。
 * 钉住：不发给自己、不带手机号、一次分发只一条（不和 分配通知 / 交接通知 双发）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "a@x", role: "SALES", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/shared-ws/current", () => ({ 当前是共享区: async () => false }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 规则 } from "@/lib/enterprise/rules";
import { 等通知推完 } from "@/lib/enterprise/notify";
import { 分给你通知 } from "@/lib/enterprise/notice-sources";
import { 飞书推送开关键, 清飞书推送令牌 } from "@/lib/enterprise/feishu-push";
import { assignSalesOwner, patchCustomer, saveCustomer } from "@/app/(app)/customers/actions";
import { 建档向导, type 建档向导输入 } from "@/app/(app)/projects/actions";

let 运营: string;
let 销售: string;
let 另一销售: string;
let 老板: string;

const 建人 = async (email: string, name: string, role = "SALES") =>
  (await prisma.user.create({ data: { email, name, title: "", role, password: "x" } })).id;
const 当 = (id: string, name: string, role = "SALES") => {
  mocks.user = { ...mocks.user, id, name, role };
};
const 分配通知们 = () => prisma.entNotice.findMany({ where: { kind: "分配" }, orderBy: { createdAt: "asc" } });

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  老板 = await 建人("boss", "老板", "ADMIN");
  运营 = await 建人("ops", "运营");
  销售 = await 建人("sale", "销售甲");
  另一销售 = await 建人("sale2", "销售乙");
  await prisma.entMember.createMany({
    data: [
      { userId: 老板, bizRole: "director" },
      { userId: 运营, bizRole: "marketing_mgr" },
      { userId: 销售, bizRole: "sales" },
      { userId: 另一销售, bizRole: "sales" },
    ],
  });
  await setSetting(规则.线索分配.key, true);
  当(运营, "运营");
});
afterEach(async () => {
  await 等通知推完();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const 客户 = async (name: string, salesOwnerId: string, phone = "13900000001") =>
  (await prisma.customer.create({ data: { name, phone, salesOwnerId } })).id;

describe("分给你通知", () => {
  it("一位客户：链客户详情，标题有客户名、不带手机号", async () => {
    const c = await 客户("客户一", 运营, "13812345678");
    await 分给你通知(mocks.user, 销售, [c]);
    const [n, ...多] = await 分配通知们();
    expect(多).toEqual([]);
    expect(n).toMatchObject({ userId: 销售, kind: "分配", link: `/customers/${c}` });
    expect(n.title).toContain("运营");
    expect(n.title).toContain("客户一");
    expect(`${n.title}${n.body}`).not.toContain("13812345678");
  });

  it("推到飞书：接手人绑了飞书就收到一条，带能点开客户详情的完整链接，不带手机号", async () => {
    清飞书推送令牌();
    vi.stubEnv("ENT_FEISHU_APP_ID", "cli_test");
    vi.stubEnv("ENT_FEISHU_APP_SECRET", "secret");
    vi.stubEnv("ENT_PUBLIC_URL", "https://crm.example.test/");
    await setSetting(飞书推送开关键, true);
    await prisma.user.update({ where: { id: 销售 }, data: { feishuOpenId: "ou_sale" } });
    const 发出: { url: string; body: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      发出.push({ url, body: String(init?.body ?? "") });
      return new Response(JSON.stringify({ code: 0, tenant_access_token: "t", expire: 7200 }), { status: 200 });
    });
    try {
      const c = await 客户("客户一", 运营, "13812345678");
      await 分给你通知(mocks.user, 销售, [c]);
      await 等通知推完();
      const 消息 = 发出.filter((f) => f.url.includes("/im/v1/messages"));
      expect(消息).toHaveLength(1);
      const b = JSON.parse(消息[0].body) as { receive_id: string; content: string };
      expect(b.receive_id).toBe("ou_sale");
      expect(b.content).toContain(`https://crm.example.test/customers/${c}`);
      expect(b.content).toContain("客户一");
      expect(b.content).not.toContain("13812345678");
      expect((await 分配通知们())[0].feishuStatus).toBe("已推");
    } finally {
      vi.unstubAllGlobals();
      清飞书推送令牌();
    }
  });

  it("多位客户：链客户列表，标题说人数，正文列名字", async () => {
    const a = await 客户("客户一", 运营);
    const b = await 客户("客户二", 运营, "13900000002");
    await 分给你通知(mocks.user, 销售, [a, b]);
    const [n] = await 分配通知们();
    expect(n).toMatchObject({ userId: 销售, link: "/customers" });
    expect(n.title).toContain("2 位客户");
    expect(n.body).toContain("客户一");
    expect(n.body).toContain("客户二");
  });

  it("分给自己不发；同一批点两次只记一条；空名单不发", async () => {
    const c = await 客户("客户一", 运营);
    await 分给你通知(mocks.user, 运营, [c]);
    await 分给你通知(mocks.user, 销售, []);
    expect(await 分配通知们()).toEqual([]);
    await 分给你通知(mocks.user, 销售, [c, c]);
    await 分给你通知(mocks.user, 销售, [c]);
    expect(await 分配通知们()).toHaveLength(1);
  });

  it("写库出错不往外抛：通知挡不住分配", async () => {
    const c = await 客户("客户一", 运营);
    vi.spyOn(prisma.customer, "findMany").mockRejectedValueOnce(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(分给你通知(mocks.user, 销售, [c])).resolves.toBeUndefined();
  });
});

describe("assignSalesOwner（直接换负责人）", () => {
  it("单条：接手人收一条，链客户详情", async () => {
    const c = await 客户("客户一", 运营);
    expect(await assignSalesOwner([c], 销售)).toMatchObject({ ok: true });
    expect(await 分配通知们()).toMatchObject([{ userId: 销售, link: `/customers/${c}` }]);
  });

  it("多条：只一条汇总，链列表", async () => {
    const a = await 客户("客户一", 运营);
    const b = await 客户("客户二", 运营, "13900000002");
    expect(await assignSalesOwner([a, b], 销售)).toMatchObject({ ok: true });
    expect(await 分配通知们()).toMatchObject([{ userId: 销售, link: "/customers" }]);
  });

  it("本来就是他的：不发", async () => {
    const c = await 客户("客户一", 销售);
    当(老板, "老板", "ADMIN");
    await assignSalesOwner([c], 销售);
    expect(await 分配通知们()).toEqual([]);
  });

  it("「交接要确认」开着：走交接通知，不发分给你（确认前还不是他的）", async () => {
    await setSetting(规则.交接要确认.key, true);
    invalidateSettingsCache();
    const c = await 客户("客户一", 运营);
    expect(await assignSalesOwner([c], 销售)).toMatchObject({ ok: true });
    expect(await 分配通知们()).toEqual([]);
    expect(await prisma.entNotice.count({ where: { kind: "交接", userId: 销售 } })).toBe(1);
  });
});

describe("saveCustomer / patchCustomer", () => {
  const 基本 = { school: null, grade: null, major: null, followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: null, channelId: null, referrerCustomerId: null };
  const 编辑 = async (id: string, patch: object) => {
    const r = await prisma.customer.findUniqueOrThrow({ where: { id } });
    const base = { name: r.name, phone: r.phone, school: r.school, grade: r.grade, major: r.major, followStatus: r.followStatus, decisionStatus: r.decisionStatus, expectedSignAt: r.expectedSignAt, remark: r.remark, salesOwnerId: r.salesOwnerId, channelId: r.channelId, referrerCustomerId: r.referrerCustomerId };
    return saveCustomer({ id, updatedAt: r.updatedAt.toISOString(), base, ...base, ...patch } as Parameters<typeof saveCustomer>[0]);
  };

  it("新建指定别人：接手人收一条；记在自己名下不发", async () => {
    const r = await saveCustomer({ ...基本, name: "新客户", phone: "13900000011", salesOwnerId: 销售 } as Parameters<typeof saveCustomer>[0]);
    expect(r).toMatchObject({ ok: true });
    const 新 = await prisma.customer.findFirstOrThrow({ where: { name: "新客户" } });
    expect(await 分配通知们()).toMatchObject([{ userId: 销售, link: `/customers/${新.id}` }]);

    await prisma.entNotice.deleteMany();
    await saveCustomer({ ...基本, name: "我的客户", phone: "13900000012", salesOwnerId: 运营 } as Parameters<typeof saveCustomer>[0]);
    expect(await 分配通知们()).toEqual([]);
  });

  it("编辑换负责人：新负责人收一条；只改别的不发", async () => {
    当(老板, "老板", "ADMIN");
    const c = await 客户("客户一", 销售);
    expect(await 编辑(c, { remark: "改备注" })).toMatchObject({ ok: true });
    expect(await 分配通知们()).toEqual([]);
    expect(await 编辑(c, { salesOwnerId: 另一销售 })).toMatchObject({ ok: true });
    expect(await 分配通知们()).toMatchObject([{ userId: 另一销售, link: `/customers/${c}` }]);
  });

  it("整格改负责人：新负责人收一条；改成原来的、改别的字段不发", async () => {
    当(老板, "老板", "ADMIN");
    const c = await 客户("客户一", 销售);
    await patchCustomer(c, "remark", "改备注");
    await patchCustomer(c, "salesOwnerId", 销售);
    expect(await 分配通知们()).toEqual([]);
    await patchCustomer(c, "salesOwnerId", 另一销售);
    expect(await 分配通知们()).toMatchObject([{ userId: 另一销售, link: `/customers/${c}` }]);
  });
});

describe("建档向导", () => {
  let 号 = 0;
  const 向导 = async (项目: Partial<建档向导输入["项目"]>) => {
    号++;
    const 渠 = (await prisma.channel.findFirst()) ?? (await prisma.channel.create({ data: { name: "小红", channelOwnerId: 老板 } }));
    return 建档向导({
      客户: {
        name: `向导客户${号}`, phone: `1391111${String(号).padStart(4, "0")}`, school: null, grade: null, major: null,
        followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: null,
        salesOwnerId: 项目.ownerId ?? mocks.user.id, channelId: 渠.id, referrerCustomerId: null,
      },
      联系人: { name: "王经理", position: "采购", phone: "" },
      项目: { name: `向导项目${号}`, amount: 0, currency: "CNY", ownerId: mocks.user.id, 业务线: "内贸", ...项目 },
      跟进: { type: "PHONE", content: "聊了需求", occurredAt: "2026-10-20 10:00", 节点: "潜客培育", 明确回复: false },
    } as 建档向导输入);
  };

  it("指定给别人：只一条，链客户详情，正文带项目名", async () => {
    const r = await 向导({ 分配方式: 0, ownerId: 销售 });
    expect(r).toMatchObject({ ok: true, 转走: true });
    const 新 = await prisma.customer.findFirstOrThrow({ where: { salesOwnerId: 销售 } });
    const 们 = await 分配通知们();
    expect(们).toHaveLength(1);
    expect(们[0]).toMatchObject({ userId: 销售, link: `/customers/${新.id}` });
    expect(们[0].body).toContain("向导项目");
  });

  it("指定给自己 / 暂不分配：不发", async () => {
    expect(await 向导({ 分配方式: 0, ownerId: 运营 })).toMatchObject({ ok: true });
    expect(await 向导({ 分配方式: 3 })).toMatchObject({ ok: true });
    expect(await 分配通知们()).toEqual([]);
  });

  it("自动分配：只有 建好再分 自己那条，不多发分给你", async () => {
    const r = await 向导({ 分配方式: 1 });
    expect(r).toMatchObject({ ok: true });
    // 自动分配的那条链项目；分给你那条才链客户详情，这里不该有
    expect(await prisma.entNotice.findMany({ where: { link: { startsWith: "/customers" } } })).toEqual([]);
    expect(await prisma.customer.count({ where: { salesOwnerId: { in: [销售, 另一销售] } } })).toBe(1);
    expect(await 分配通知们()).toEqual([]);
    const 自动的 = await prisma.entNotice.findMany({ where: { kind: "自动分配" } });
    expect(自动的).toHaveLength(1);
    expect(自动的[0].link).toMatch(/^\/projects\//);
  });
});
