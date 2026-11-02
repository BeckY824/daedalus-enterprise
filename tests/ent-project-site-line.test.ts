/**
 * 项目所在地 → 业务线建议（11-02：「项目所在地就是项目内的区域和地址，可以自动识别，但需要确认」）。
 *
 * 钉的是：
 *   - 所在地预填（纯函数）：有建议、没手动选过、和当前不一样才预填；手动选过不覆盖
 *   - 所在地提示（纯函数）：没选 / 一样 =「按项目所在地识别为「X」，请确认」；不一样 =「所在地看像X，当前选的是Y」；没建议不提示
 *   - 新项目所在地（纯函数）：没传 / 全空 = 五格 null；和编辑项目同一套规整（国内统一存「中国」、国外清省区县、超长报错、不是对象报错）
 *   - 建档向导 / 客户页新建项目（真库）：带所在地存进项目自己的五格；不带 = 和原来一样全空；坏的拦下、一行不写；
 *     业务线照人选的存，服务端不按地址改线
 *   - 改项目 业务线（真库）：三选一存得进、留痕叫「业务线」；乱写 / 清空拦下；同事改不了；不是企业版传了也不动；
 *     不传 = 不动；改线不重新自动分配（负责人不变）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "销售甲", email: "a@x", role: "SALES", title: "销售", avatar: null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 所在地预填, 所在地提示, 建议业务线, 业务线不认得, 业务线必填 } from "@/lib/enterprise/assign-line";
import { 新项目所在地, 详细地址上限 } from "@/lib/project/profile-rules";
import { 地址每格上限 } from "@/lib/enterprise/customer-v2";
import { 改项目 } from "@/lib/project/db";
import { 建档向导, 编辑项目, type 建档向导输入 } from "@/app/(app)/projects/actions";
import { 给客户建项目 } from "@/app/(app)/customers/[id]/project-actions";

const 空 = { addrCountry: null, addrProvince: null, addrCity: null, addrDistrict: null, location: null };

describe("所在地预填 / 所在地提示（纯函数）", () => {
  it("预填：有建议、没手动选过、和当前不一样才给", () => {
    expect(所在地预填("外贸", null, false)).toBe("外贸");
    expect(所在地预填("外贸", "内贸", false)).toBe("外贸"); // 客户默认带的线不算手动选
    expect(所在地预填("外贸", "外贸", false)).toBeNull();
    expect(所在地预填("外贸", "内贸", true)).toBeNull(); // 手动选过不覆盖
    expect(所在地预填("内贸", undefined, true)).toBeNull();
    expect(所在地预填(null, null, false)).toBeNull();
  });

  it("提示：没选 / 一样 = 请确认；不一样 = 看像 X、当前是 Y；没建议不提示", () => {
    expect(所在地提示("外贸", null)).toEqual({ 同: false, 话: "按项目所在地识别为「外贸」，请确认" });
    expect(所在地提示("外贸", "外贸")).toEqual({ 同: true, 话: "按项目所在地识别为「外贸」，请确认" });
    expect(所在地提示("外贸", "内贸")).toEqual({ 同: false, 话: "所在地看像外贸，当前选的是内贸" });
    expect(所在地提示("内贸", "暂不分配")).toEqual({ 同: false, 话: "所在地看像内贸，当前选的是暂不分配" });
    expect(所在地提示(null, "内贸")).toBeNull();
  });

  it("和 建议业务线 串起来：国外 → 外贸预填；国内 → 内贸", () => {
    expect(所在地预填(建议业务线({ addrCountry: "美国", addrCity: "Los Angeles" }), null, false)).toBe("外贸");
    expect(所在地预填(建议业务线({ addrCountry: "中国", addrProvince: "浙江省", addrCity: "杭州市" }), null, false)).toBe("内贸");
    expect(所在地预填(建议业务线({}), null, false)).toBeNull();
  });
});

describe("新项目所在地（纯函数）", () => {
  it("没传 / 全空 = 五格 null", () => {
    expect(新项目所在地(undefined)).toEqual({ ok: true, 值: 空 });
    expect(新项目所在地(null)).toEqual({ ok: true, 值: 空 });
    expect(新项目所在地({ addrCountry: "", addrCity: " ", location: "  " })).toEqual({ ok: true, 值: 空 });
  });

  it("和编辑项目同一套：国内统一存「中国」、国外清省区县、详细地址去空白", () => {
    expect(新项目所在地({ addrProvince: "广东省", addrCity: "深圳市", location: " 科技园  3 栋 " })).toEqual({
      ok: true, 值: { addrCountry: "中国", addrProvince: "广东省", addrCity: "深圳市", addrDistrict: null, location: "科技园 3 栋" },
    });
    expect(新项目所在地({ addrCountry: "美国", addrProvince: "加州", addrCity: "Los Angeles", addrDistrict: "某区" })).toEqual({
      ok: true, 值: { addrCountry: "美国", addrProvince: null, addrCity: "Los Angeles", addrDistrict: null, location: null },
    });
  });

  it("坏值报错：超长、不是对象、详细地址不是文字", () => {
    expect(新项目所在地({ addrCity: "长".repeat(地址每格上限 + 1) })).toMatchObject({ ok: false });
    expect(新项目所在地({ location: "长".repeat(详细地址上限 + 1) })).toMatchObject({ ok: false, error: expect.stringContaining("详细地址") });
    expect(新项目所在地({ location: 12 })).toMatchObject({ ok: false, error: "详细地址要写文字" });
    expect(新项目所在地("北京" as unknown as Record<string, unknown>)).toMatchObject({ ok: false, error: expect.stringContaining("项目所在地") });
  });
});

describe("新建项目带所在地（真库）", () => {
  let 甲: string;
  let 渠道: string;
  const 位置 = (id: string) => prisma.project.findUniqueOrThrow({
    where: { id }, select: { addrCountry: true, addrProvince: true, addrCity: true, addrDistrict: true, location: true, bizLine: true },
  });

  beforeEach(async () => {
    vi.stubEnv("CRM_ENTERPRISE", "1");
    await resetDb();
    invalidateSettingsCache();
    甲 = (await prisma.user.create({ data: { email: "site-jia", name: "销售甲", title: "", role: "SALES", password: "x" } })).id;
    mocks.user = { ...mocks.user, id: 甲 };
    await prisma.entMember.create({ data: { userId: 甲, bizRole: "sales" } });
    渠道 = (await prisma.channel.create({ data: { name: "渠道一", channelOwnerId: 甲 } })).id;
  });
  afterEach(() => vi.unstubAllEnvs());

  function 向导输入(所在地?: Record<string, unknown> | string): 建档向导输入 {
    return {
      客户: {
        name: "向导客户", phone: "13900001102", school: null, grade: null, major: null,
        followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: null,
        salesOwnerId: 甲, channelId: 渠道, referrerCustomerId: null,
      },
      联系人: { name: "采购联系人", position: "采购", phone: "13900001103" },
      项目: { name: "一期", amount: 0, currency: "CNY", ownerId: 甲, 业务线: "内贸", ...(所在地 !== undefined ? { 所在地 } : {}) },
      跟进: { type: "PHONE", content: "电话聊了需求", occurredAt: "2026-10-20 10:00", 节点: "潜客培育", 明确回复: false },
    } as 建档向导输入;
  }

  it("建档向导：带所在地存进项目五格；业务线照人选的存（服务端不按地址改）", async () => {
    const r = await 建档向导(向导输入({ addrCountry: "美国", addrProvince: "加州", addrCity: "Los Angeles", location: " 某街 1 号 " }));
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(await 位置(r.projectId!)).toEqual({ addrCountry: "美国", addrProvince: null, addrCity: "Los Angeles", addrDistrict: null, location: "某街 1 号", bizLine: "内贸" });
  });

  it("建档向导：不带所在地 = 和原来一样全空", async () => {
    const r = await 建档向导(向导输入());
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(await 位置(r.projectId!)).toEqual({ ...空, bizLine: "内贸" });
  });

  it("建档向导：所在地坏了拦下，客户、项目一行不写", async () => {
    expect(await 建档向导(向导输入({ addrCity: "长".repeat(地址每格上限 + 1) }))).toMatchObject({ ok: false });
    expect(await 建档向导(向导输入("北京"))).toMatchObject({ ok: false, error: expect.stringContaining("项目所在地") });
    expect(await prisma.customer.count()).toBe(0);
    expect(await prisma.project.count()).toBe(0);
  });

  describe("客户页新建项目", () => {
    let cid: string;
    beforeEach(async () => {
      cid = (await prisma.customer.create({ data: { name: "老客户", phone: "13900001104", salesOwnerId: 甲 } })).id;
    });
    const 输入 = (所在地?: Record<string, unknown>) => ({
      customerId: cid,
      项目: { name: "二期", ownerId: 甲, ...(所在地 ? { 所在地 } : {}) },
      跟进: { type: "PHONE", content: "聊了二期", occurredAt: "2026-10-28 10:00", 节点: "潜客培育", 明确回复: true },
    }) as Parameters<typeof 给客户建项目>[0];

    it("带所在地存进项目五格（不看客户地址）", async () => {
      await prisma.customer.update({ where: { id: cid }, data: { addrCountry: "中国", addrProvince: "江苏省", addrCity: "南京市" } });
      const r = await 给客户建项目(输入({ addrProvince: "广东省", addrCity: "深圳市", addrDistrict: "南山区", location: "园区 2 栋" }));
      expect(r).toMatchObject({ ok: true });
      if (!r.ok) return;
      expect(await 位置(r.projectId)).toMatchObject({ addrCountry: "中国", addrProvince: "广东省", addrCity: "深圳市", addrDistrict: "南山区", location: "园区 2 栋" });
    });

    it("不带 = 全空；坏的拦下不建", async () => {
      const r = await 给客户建项目(输入());
      expect(r).toMatchObject({ ok: true });
      if (!r.ok) return;
      expect(await 位置(r.projectId)).toMatchObject(空);
      expect(await 给客户建项目(输入({ location: "长".repeat(详细地址上限 + 1) }))).toMatchObject({ ok: false, error: expect.stringContaining("详细地址") });
      expect(await prisma.project.count()).toBe(1);
    });
  });
});

describe("改项目：业务线（真库）", () => {
  let 乙: { id: string; role: string };
  let 丙: { id: string; role: string };
  let 项目id: string;
  const 读 = () => prisma.project.findUniqueOrThrow({ where: { id: 项目id }, select: { bizLine: true, ownerId: true } });
  const 人 = async (email: string, name: string) => ({ id: (await prisma.user.create({ data: { email, name, title: "", role: "SALES", password: "x" } })).id, role: "SALES" });
  const 基 = { name: "QA-业务线项目", amount: 0 };

  beforeEach(async () => {
    vi.stubEnv("CRM_ENTERPRISE", "1");
    await resetDb();
    invalidateSettingsCache();
    乙 = await 人("line-yi", "销售乙");
    丙 = await 人("line-bing", "销售丙");
    await prisma.entMember.createMany({ data: [{ userId: 乙.id, bizRole: "sales" }, { userId: 丙.id, bizRole: "sales" }] });
    const 客户 = await prisma.customer.create({ data: { name: "QA-业务线客户", phone: "13800001102", salesOwnerId: 乙.id } });
    项目id = (await prisma.project.create({ data: { name: 基.name, customerId: 客户.id, ownerId: 乙.id, creatorId: 乙.id, bizLine: "内贸" } })).id;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("三选一存得进；再交一样的不算变；负责人不动（不重新自动分配）", async () => {
    expect(await 改项目(乙, 项目id, { ...基, 业务线: "外贸" })).toMatchObject({ ok: true, 变了: ["bizLine"] });
    expect(await 读()).toEqual({ bizLine: "外贸", ownerId: 乙.id });
    expect(await 改项目(乙, 项目id, { ...基, 业务线: "外贸" })).toEqual({ ok: true, 变了: [] });
    expect(await 改项目(乙, 项目id, { ...基, 业务线: "暂不分配" })).toMatchObject({ ok: true, 变了: ["bizLine"] });
    expect(await 读()).toEqual({ bizLine: "暂不分配", ownerId: 乙.id });
  });

  it("不传 = 不动", async () => {
    expect(await 改项目(乙, 项目id, { ...基, amount: 5 })).toMatchObject({ ok: true, 变了: ["amount"] });
    expect((await 读()).bizLine).toBe("内贸");
  });

  it("乱写、清空拦下，库里不动", async () => {
    expect(await 改项目(乙, 项目id, { ...基, 业务线: "海外" })).toEqual({ ok: false, error: 业务线不认得 });
    expect(await 改项目(乙, 项目id, { ...基, 业务线: null })).toEqual({ ok: false, error: 业务线必填 });
    expect(await 改项目(乙, 项目id, { ...基, 业务线: "  " })).toEqual({ ok: false, error: 业务线必填 });
    expect((await 读()).bizLine).toBe("内贸");
  });

  it("同事改不了", async () => {
    expect(await 改项目(丙, 项目id, { ...基, 业务线: "外贸" })).toMatchObject({ ok: false, error: expect.stringContaining("项目负责人") });
    expect((await 读()).bizLine).toBe("内贸");
  });

  it("不是企业版：传了也不动", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect(await 改项目(乙, 项目id, { ...基, 业务线: "外贸" })).toEqual({ ok: true, 变了: [] });
    expect((await 读()).bizLine).toBe("内贸");
  });

  it("编辑项目留痕叫「业务线」", async () => {
    mocks.user = { ...mocks.user, id: 乙.id, name: "销售乙" };
    expect(await 编辑项目(项目id, { ...基, 业务线: "外贸" })).toMatchObject({ ok: true });
    const 痕 = await prisma.auditLog.findFirstOrThrow({ where: { entity: "Project", entityId: 项目id, action: "update" } });
    expect(痕.summary).toContain("改了业务线");
  });
});
