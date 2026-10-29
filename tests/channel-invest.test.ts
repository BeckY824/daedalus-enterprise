/**
 * 企业版渠道（2026-10-29 渠道改版）的服务端：
 * - saveChannel 的企业表单：渠道属性 / 渠道名称 / 来源必填，全称一律拼成「名称|来源」（P16 不让手填），属性要在字典里；不交 attr 的老调用照旧。
 * - 渠道投入：只有老板、总管理员、市场管理能录、能删（10-29 P16 写死），渠道负责人、销售管理、销售只能看；录了投入的渠道不能删。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "老板", email: "a@x", role: "ADMIN", title: "", avatar: null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 改权限key } from "@/lib/enterprise/edit-perm";
import { saveChannel, deleteChannel, listChannelInvests, addChannelInvest, deleteChannelInvest } from "@/app/(app)/channels/actions";
import { 读渠道统计 } from "@/lib/enterprise/channel-stats-db";

let 老板: string;
let 负责人: string;
let 市场经理: string;
let 总管: string;
let 销售经理: string;
let 销售: string;
let 渠道: string;

const 当 = (id: string, role = "SALES") => { mocks.user = { ...mocks.user, id, role }; };

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  const 建人 = async (email: string, name: string, role: string, bizRole?: string) => {
    const id = (await prisma.user.create({ data: { email, name, title: "", role, password: "x" } })).id;
    if (bizRole) await prisma.entMember.create({ data: { userId: id, bizRole } });
    return id;
  };
  老板 = await 建人("boss", "老板", "ADMIN");
  负责人 = await 建人("own", "渠道运营", "SALES", "channel_ops");
  市场经理 = await 建人("mm", "市场经理", "SALES", "marketing_mgr");
  总管 = await 建人("dir", "总管", "SALES", "director");
  销售经理 = await 建人("sm", "销售经理", "SALES", "sales_mgr");
  销售 = await 建人("s1", "小王", "SALES", "sales");
  渠道 = (await prisma.channel.create({ data: { name: "抖音|官方号", attr: "公域引流", platform: "抖音", channelOwnerId: 负责人 } })).id;
  当(老板, "ADMIN");
});
afterEach(() => vi.unstubAllEnvs());

describe("saveChannel 企业表单", () => {
  const 交 = (x: Partial<Parameters<typeof saveChannel>[0]> = {}) =>
    saveChannel({ name: "", phone: null, remark: null, channelOwnerId: 负责人, attr: "公域引流", platform: "小红书", source: "店铺", ...x });

  it("全称不填拼成 名称|来源；记下创建人、属性、结束日期、状态", async () => {
    const r = await 交({ endDate: "2026-12-31", active: false });
    expect(r.ok).toBe(true);
    const c = await prisma.channel.findUniqueOrThrow({ where: { id: (r as { id: string }).id } });
    expect(c).toMatchObject({ name: "小红书|店铺", attr: "公域引流", platform: "小红书", active: false, createdById: 老板, channelOwnerId: 负责人 });
    expect(c.endDate?.getFullYear()).toBe(2026);
  });

  it("全称不让手填：交来的 name 不看，一律拼；编辑时改了来源，全称跟着换", async () => {
    const r = await 交({ name: "小红书旗舰店" });
    expect(r.ok).toBe(true);
    const id = (r as { id: string }).id;
    expect((await prisma.channel.findUniqueOrThrow({ where: { id } })).name).toBe("小红书|店铺");
    expect((await 交({ id, name: "小红书|店铺", source: "某店" })).ok).toBe(true);
    expect((await prisma.channel.findUniqueOrThrow({ where: { id } })).name).toBe("小红书|某店");
  });

  it("三样必填、属性要在字典里、全称不能重复、不能太长", async () => {
    expect(await 交({ attr: "" })).toEqual({ ok: false, error: "请选择渠道属性" });
    expect(await 交({ platform: " " })).toEqual({ ok: false, error: "请填写渠道名称" });
    expect(await 交({ source: "" })).toEqual({ ok: false, error: "请填写来源" });
    expect((await 交({ attr: "瞎写的" })).ok).toBe(false);
    expect(await 交({ platform: "抖音", source: "官方号" })).toEqual({ ok: false, error: "渠道「抖音|官方号」已存在" });
    expect(await 交({ platform: "长".repeat(40), source: "短".repeat(40) })).toEqual({ ok: false, error: "渠道名称加来源拼成的全称最多 80 个字，请缩短" });
    expect((await 交({ platform: "长".repeat(40), source: "短".repeat(39) })).ok).toBe(true);
    expect((await 交({ endDate: "不是日期" })).ok).toBe(false);
  });

  it("编辑时属性没动：这一项后来停用了也照收", async () => {
    await prisma.entDictItem.create({ data: { kind: "channelAttr", name: "公域引流", active: false, sort: 0 } });
    await prisma.entDictItem.create({ data: { kind: "channelAttr", name: "客户介绍", active: true, sort: 1 } });
    const r = await saveChannel({ id: 渠道, name: "抖音|官方号", phone: null, remark: "改个备注", channelOwnerId: 负责人, attr: "公域引流", platform: "抖音", source: "官方号" });
    expect(r.ok).toBe(true);
    // 新建选停用的那项不收
    expect((await 交({ attr: "公域引流" })).ok).toBe(false);
  });

  it("不交 attr 的老调用（客户表单里就地建渠道）照原来只要 name", async () => {
    const r = await saveChannel({ name: "林老师", phone: null, remark: null, channelOwnerId: 负责人 });
    expect(r.ok).toBe(true);
    expect(await prisma.channel.findFirst({ where: { name: "林老师" } })).toMatchObject({ attr: null, platform: null, createdById: 老板 });
  });
});

describe("渠道投入", () => {
  const 录 = (amount = 300, x: Partial<Parameters<typeof addChannelInvest>[0]> = {}) =>
    addChannelInvest({ channelId: 渠道, amount, currency: "CNY", date: "2026-10-20", remark: "十月投流", ...x });

  it("只有老板、总管理员、市场管理能录；渠道负责人、销售管理、销售不能录但能看", async () => {
    expect((await 录(100)).ok).toBe(true);
    当(总管);
    expect((await 录(200)).ok).toBe(true);
    当(市场经理);
    expect((await 录(50)).ok).toBe(true);
    for (const 谁 of [负责人, 销售经理, 销售]) {
      当(谁);
      expect(await 录(1)).toEqual({ ok: false, error: "渠道投入只有老板、总管理员、市场管理能录，别的角色只能看" });
      const 看 = await listChannelInvests(渠道);
      expect(看).toMatchObject({ ok: true, 能录: false, 不能录因: "渠道投入只有老板、总管理员、市场管理能录，别的角色只能看" });
      expect((看 as { rows: unknown[] }).rows).toHaveLength(3);
    }
    当(市场经理);
    expect(await listChannelInvests(渠道)).toMatchObject({ ok: true, 能录: true });
    expect(await listChannelInvests(渠道)).not.toHaveProperty("不能录因");
  });

  it("老配置里存过「录入渠道投入」也不管用：负责人加进去照样不能录，市场管理去掉照样能录", async () => {
    await setSetting(改权限key, { 渠道投入: ["总管理员", "销售管理"] });
    invalidateSettingsCache();
    当(市场经理);
    expect((await 录()).ok).toBe(true);
    当(销售经理);
    expect((await 录()).ok).toBe(false);
    当(负责人);
    expect((await 录()).ok).toBe(false);
  });

  it("金额、日期、币种、备注都挡；录了留记录；列表新的在前、带录入人", async () => {
    expect(await 录(0)).toEqual({ ok: false, error: "投入金额要大于 0" });
    expect(await 录(-5)).toEqual({ ok: false, error: "投入金额要大于 0" });
    expect(await 录(Number.NaN)).toEqual({ ok: false, error: "投入金额要大于 0" });
    expect(await 录(1e12)).toEqual({ ok: false, error: "投入金额太大了，检查一下位数" });
    expect(await 录(1, { date: "乱写" })).toEqual({ ok: false, error: "请选投入日期" });
    expect(await 录(1, { currency: "XXX" })).toEqual({ ok: false, error: "币种不对" });
    expect(await 录(1, { remark: "字".repeat(201) })).toEqual({ ok: false, error: "备注最多 200 个字" });
    expect(await 录(1, { channelId: "没有这个" })).toMatchObject({ ok: false, error: expect.stringMatching(/不在了/) });
    expect(await prisma.entChannelInvest.count()).toBe(0);

    await 录(100.456, { date: "2026-10-01" });
    await 录(200, { date: "2026-10-15", remark: "  " });
    const 看 = await listChannelInvests(渠道);
    if (!看.ok) throw new Error(看.error);
    expect(看.能录).toBe(true);
    expect(看.rows.map((r) => [r.amount, r.remark, r.userName])).toEqual([[200, null, "老板"], [100.46, "十月投流", "老板"]]);
    const 记 = await prisma.auditLog.findMany({ where: { entity: "Channel", entityId: 渠道 }, select: { summary: true } });
    expect(记.map((x) => x.summary)).toEqual(expect.arrayContaining(["给渠道「抖音|官方号」录入投入 CNY 200"]));
  });

  it("删投入：按同样的人挡；删了留记录", async () => {
    const id = ((await 录(100)) as { id: string }).id;
    当(销售);
    expect((await deleteChannelInvest(id)).ok).toBe(false);
    当(负责人);
    expect((await deleteChannelInvest(id)).ok).toBe(false);
    当(市场经理);
    expect(await deleteChannelInvest(id)).toEqual({ ok: true });
    expect(await deleteChannelInvest(id)).toMatchObject({ ok: false, error: expect.stringMatching(/不在了/) });
    expect(await prisma.auditLog.count({ where: { summary: { startsWith: "删除渠道「抖音|官方号」的一笔投入" } } })).toBe(1);
  });

  it("录了投入的渠道不能删；投入删光才能删", async () => {
    const id = ((await 录(100)) as { id: string }).id;
    expect(await deleteChannel(渠道)).toEqual({ ok: false, error: "该渠道已录了 1 笔投入，不能删除。如需停用请点「停用」" });
    await deleteChannelInvest(id);
    expect(await deleteChannel(渠道)).toEqual({ ok: true });
  });

  it("读渠道统计：项目按客户的渠道归，投入合计、产出比跟着算", async () => {
    await 录(400);
    const 客户 = await prisma.customer.create({ data: { name: "客户甲", phone: "13800000001", salesOwnerId: 销售, channelId: 渠道 } });
    await prisma.project.create({ data: { customerId: 客户.id, name: "单子", phase: "订单", amount: 1000, currency: "CNY", ownerId: 销售, creatorId: 销售 } });
    await prisma.project.create({ data: { customerId: 客户.id, name: "线索一", phase: "线索", ownerId: 销售, creatorId: 销售 } });
    const 统 = (await 读渠道统计([{ id: 渠道, createdAt: new Date("2026-10-01T00:00:00"), endDate: null }], new Date("2026-10-29T12:00:00")))[渠道];
    expect(统).toMatchObject({ 关联线索: 1, 关联订单: 1, 关联项目: 2, 累计成交: [{ 币种: "CNY", 合计: 1000 }], 当前投入: [{ 币种: "CNY", 合计: 400 }], 产出比: 2.5, 累计运营天数: 28 });
  });
});
