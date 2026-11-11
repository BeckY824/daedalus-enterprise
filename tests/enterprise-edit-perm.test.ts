/**
 * 企业版「后台设置谁能改」（B2 第 6 条，lib/enterprise/edit-perm*.ts）。
 * 钉的是：没存配置时按清单默认；存了按存的；老板总能改；直属 / 虚线上级只对线索配额、只对自己的下属；
 * 11-03 D3-7 ①：项目模式那几项（字典、组织规则三块、字段权限表等）只给系统管理员，存过的勾也不算；
 * 拦下一行不写；这张表本身只有老板、总管理员能存，存前规整、留记录。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "老板", email: "a@x", role: "ADMIN", title: "", avatar: null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { getSetting, setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 设字段权限, 设改权限 } from "@/app/(app)/settings/org-actions";
import { 改组织规则 } from "@/app/(app)/projects/actions";
import { 加角色, 加异常类别 } from "@/lib/project/db";
import { 读组织 } from "@/lib/enterprise/org";
import { 改权限key, 规整改权限, 能改设置, 谁能改, 谁能改的话, 设置项, 设置项们, 挡改设置 } from "@/lib/enterprise/edit-perm";

let 老板: string;
let 总管: string;
let 销售经理: string;
let 市场经理: string;
let 销售: string;
let 虚线: string;

const 当 = (id: string, role = "SALES") => { mocks.user = { ...mocks.user, id, role }; };
const 我 = () => ({ id: mocks.user.id, role: mocks.user.role });
const 记录 = () => prisma.auditLog.findMany({ orderBy: { at: "asc" }, select: { entity: true, entityId: true, summary: true } });

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  const 建人 = async (email: string, name: string, role: string, bizRole?: string) => {
    const id = (await prisma.user.create({ data: { email, name, title: "", role, password: "x" } })).id;
    if (bizRole) await prisma.entMember.create({ data: { userId: id, bizRole } });
    return id;
  };
  老板 = await 建人("boss", "老板", "ADMIN", "director");
  总管 = await 建人("dir", "总管", "SALES", "director");
  销售经理 = await 建人("sm", "销售经理", "SALES", "sales_mgr");
  市场经理 = await 建人("mm", "市场经理", "SALES", "marketing_mgr");
  虚线 = await 建人("dot", "虚线", "SALES", "sales");
  销售 = await 建人("s1", "小王", "SALES", "sales");
  await prisma.entMember.update({ where: { userId: 销售 }, data: { managerId: 销售经理, dottedManagerId: 虚线 } });
  当(老板, "ADMIN");
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("表和判断", () => {
  it("没存配置 = 清单默认；规整丢掉不认识的项和人、按可选顺序排", () => {
    expect(Object.fromEntries(设置项们.map((项) => [项, 谁能改({}, 项)]))).toEqual({
      节点时限: [],
      必填字段: [],
      线索配额: ["直属上级", "虚线上级"],
      持有上限: [],
      字典: [],
      字段权限: [],
      阶段规则: [],
    });
    // 「录入渠道投入」10-29 P16 改成写死（channel-stats 的 能录投入），老配置里存过的当不认识的项丢掉
    expect(规整改权限({ 渠道投入: ["总管理员"] })).toEqual({});
    expect(规整改权限(null)).toEqual({});
    expect(规整改权限({ 线索配额: ["总管理员", "销售管理", "老板", "直属上级"], 乱填: ["总管理员"], 字段权限: "总管理员", 字典: ["销售管理"] }))
      .toEqual({ 线索配额: ["直属上级", "销售管理", "总管理员"], 字典: [] });
    expect(谁能改的话({}, "持有上限")).toBe("只有系统管理员能改");
    // 没规整过的老配置里存着销售管理，也不认
    expect(谁能改({ 字典: ["销售管理"] }, "字典")).toEqual([]);
    expect(谁能改的话({ 字典: ["销售管理"] }, "字典")).toBe("只有系统管理员能改");
    expect(谁能改的话({}, "线索配额")).toBe("只有总管理员、直属上级、虚线上级能改");
  });

  it("老板总能改；三类按自己的类；直属 / 虚线上级只对自己的下属", async () => {
    const org = await 读组织();
    const 人 = (id: string) => ({ id, role: id === 老板 ? "ADMIN" : "SALES" });
    for (const 项 of 设置项们) expect(能改设置(org, 人(老板), 项, { [项]: [] })).toBe(true);
    expect(能改设置(org, 人(总管), "字典", {})).toBe(true);
    expect(能改设置(org, 人(销售经理), "字典", {})).toBe(false);
    expect(能改设置(org, 人(市场经理), "节点时限", {})).toBe(false);
    expect(能改设置(org, 人(市场经理), "节点时限", { 节点时限: ["市场管理"] })).toBe(false);
    expect(能改设置(org, 人(市场经理), "持有上限", {})).toBe(false);
    // 系统管理员每项都能改，表里删了也一样（11-01：权限只认业务角色，总管理不受这张表管）
    expect(能改设置(org, 人(总管), "字典", { 字典: [] })).toBe(true);
    // 线索配额：总管理照样能改（11-01 权限只认业务角色：总管理不受这张表管）；直属、虚线上级只给自己的下属设
    expect(能改设置(org, 人(总管), "线索配额", {}, 销售)).toBe(true);
    expect(能改设置(org, 人(销售经理), "线索配额", {}, 销售)).toBe(true);
    expect(能改设置(org, 人(虚线), "线索配额", {}, 销售)).toBe(true);
    expect(能改设置(org, 人(销售经理), "线索配额", {}, 虚线)).toBe(false);
    expect(能改设置(org, 人(虚线), "线索配额", { 线索配额: ["直属上级"] }, 销售)).toBe(false);
    expect(能改设置(org, 人(销售经理), "线索配额", {})).toBe(false);
  });

  it("不是企业版：不看这张表，只有老板", async () => {
    await setSetting(改权限key, { 字典: ["销售管理"] });
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect(await 挡改设置({ id: 销售经理, role: "SALES" }, "字典")).toBe("只有老板能改");
    expect(await 挡改设置({ id: 老板, role: "ADMIN" }, "字典")).toBeNull();
  });
});

describe("各处按自己那一行拦", () => {
  it("字典：只有系统管理员能加；老配置里勾过销售管理也不算", async () => {
    当(销售经理);
    expect(await 加角色(我(), "售前")).toMatchObject({ ok: false, error: "组员角色只有系统管理员能改" });
    expect(await 加异常类别(我(), "客户失联")).toMatchObject({ ok: false, error: "异常类别只有系统管理员能改" });
    expect(await prisma.projectRole.count({ where: { name: "售前" } })).toBe(0);
    当(总管);
    expect(await 加角色(我(), "售前")).toMatchObject({ ok: true });
    await setSetting(改权限key, { 字典: ["销售管理"] });
    当(销售经理);
    expect(await 加异常类别(我(), "客户失联")).toMatchObject({ ok: false, error: "异常类别只有系统管理员能改" });
    当(总管);
    expect(await 加角色(我(), "交付")).toMatchObject({ ok: true });
  });

  it("组织规则：持有上限 / 节点时限 / 必填字段只有系统管理员能改，拦下一行不写", async () => {
    当(市场经理);
    expect(await 改组织规则({ 超时回收: { 开: false } })).toMatchObject({ ok: false, error: "各进程时限只有系统管理员能改" });
    expect(await 改组织规则({ 公海: { 持有上限开: true } })).toMatchObject({ ok: false, error: "项目持有上限只有系统管理员能改" });
    当(销售经理);
    expect(await 改组织规则({ 公海: { 持有上限开: true } })).toMatchObject({ ok: false, error: "项目持有上限只有系统管理员能改" });
    expect(await 改组织规则({ 公海: { 默认上限: 5 }, 节点推进: { 开: true } })).toMatchObject({ ok: false });
    expect((await prisma.auditLog.count({ where: { summary: { contains: "默认 5 个" } } }))).toBe(0);
    当(销售);
    expect(await 改组织规则({ 超时回收: { 开: false } })).toMatchObject({ ok: false, error: "各进程时限只有系统管理员能改" });
    当(总管);
    expect(await 改组织规则({ 超时回收: { 开: false } })).toEqual({ ok: true, 收回: 0 });
    expect(await 改组织规则({ 公海: { 默认上限: 5 }, 节点推进: { 开: true } })).toEqual({ ok: true, 收回: 0 });
  });

  it("字段权限表：只有系统管理员能存，勾过销售管理也不算", async () => {
    当(销售经理);
    expect(await 设字段权限({})).toMatchObject({ ok: false, error: "字段权限表只有系统管理员能改" });
    await setSetting(改权限key, { 字段权限: ["销售管理"] });
    expect(await 设字段权限({})).toMatchObject({ ok: false, error: "字段权限表只有系统管理员能改" });
    当(总管);
    expect(await 设字段权限({})).toEqual({ ok: true });
  });
});

describe("这张表本身", () => {
  it("只有老板、总管理员能存；存前规整，留一条记录", async () => {
    for (const id of [销售经理, 市场经理, 销售]) {
      当(id);
      expect(await 设改权限({ 字典: ["销售管理"] })).toMatchObject({ ok: false });
    }
    expect(await getSetting(改权限key)).toBeFalsy();
    当(总管);
    expect(await 设改权限({ 线索配额: ["总管理员", "销售管理", "老板"], 字典: ["销售管理"], 乱填: [1] })).toEqual({ ok: true });
    expect(await getSetting(改权限key)).toEqual({ 线索配额: ["销售管理", "总管理员"], 字典: [] });
    const [r] = await 记录();
    expect(r).toMatchObject({ entity: "Setting", entityId: 改权限key });
    expect(r.summary).toContain(`${设置项.线索配额.名}：总管理员、销售管理`);
    expect(r.summary).toContain(`${设置项.字典.名}：系统管理员`);
  });

  it("不是企业版拦，一行不写", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect(await 设改权限({ 字典: [] })).toMatchObject({ ok: false });
    vi.stubEnv("CRM_ENTERPRISE", "1");
    expect(await getSetting(改权限key)).toBeFalsy();
    expect(await 记录()).toEqual([]);
  });
});
