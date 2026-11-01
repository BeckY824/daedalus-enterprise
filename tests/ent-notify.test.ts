/**
 * 企业版站内通知 + 飞书推送（2026-11-01，lib/enterprise/notify.ts、feishu-push.ts、notice-actions.ts）。
 * 钉的是：notify 写库、同 key 去重、非企业版不写；飞书推送开关关着一次 fetch 都不发；
 * 开着时令牌 / 发消息的地址、头、体对；令牌缓存；飞书出错不抛、记在那一行；没绑飞书只有站内；
 * 开关只认业务角色总管理员（账号角色老板不算）；自动分配成功通知接手人、批量按人合并、手动分配也通知。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "老板", email: "a@x", role: "ADMIN", title: "", avatar: null },
  企业版: true,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/enterprise/switch", () => ({ 企业版: () => mocks.企业版 }));
vi.mock("@/lib/shared-ws/current", () => ({ 当前是共享区: async () => false }));

import { prisma } from "@/lib/prisma";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { resetDb } from "./reset";
import { notify, 等通知推完, 我的通知, 未读通知数, 标通知已读, 全部通知已读 } from "@/lib/enterprise/notify";
import { 飞书推送开关键, 清飞书推送令牌, 完整链接 } from "@/lib/enterprise/feishu-push";
import { 设飞书推送, 读飞书推送 } from "@/app/(app)/notice-actions";
import { 分配线索, 自动分配线索, 批量自动分配 } from "@/app/(app)/leads/assign-actions";
import { 自动分配不参与key } from "@/lib/enterprise/lead-assign";
import { 规则 } from "@/lib/enterprise/rules";

const 令牌地址 = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal";
const 发消息地址 = "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id";
const 回 = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let fetchMock: ReturnType<typeof vi.fn>;
const 环境 = { ...process.env };
let 甲: string, 乙: string;
const 当 = (id: string, role = "SALES", name = mocks.user.name) => { mocks.user = { ...mocks.user, id, role, name }; };
const 行 = (userId: string) => prisma.entNotice.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
/** 飞书正常：令牌 tok（2 小时），发消息 code 0 */
const 飞书正常 = () =>
  fetchMock.mockImplementation(async (url: string) =>
    url === 令牌地址 ? 回({ code: 0, tenant_access_token: "tok", expire: 7200 }) : 回({ code: 0, data: { message_id: "om_1" } }),
  );

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache(); // 上一条测试开过推送：设置缓存不随 resetDb 清
  mocks.企业版 = true;
  清飞书推送令牌();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  process.env.ENT_FEISHU_APP_ID = "cli_test";
  process.env.ENT_FEISHU_APP_SECRET = "s3cr3t";
  process.env.ENT_PUBLIC_URL = "https://crm.example.test/";
  const 人 = async (email: string, name: string, role = "SALES", feishuOpenId: string | null = null) =>
    (await prisma.user.create({ data: { email, name, title: "", role, password: "x", feishuOpenId } })).id;
  甲 = await 人("a", "甲", "SALES", "ou_jia");
  乙 = await 人("b", "乙");
});
afterEach(async () => {
  await 等通知推完();
  vi.unstubAllGlobals();
  process.env = { ...环境 };
});

describe("notify 写库", () => {
  it("每人一行、字段对；同 key 再来不重复；铃铛读写只动自己的", async () => {
    expect(await notify([甲, 乙, 甲, null, ""], { kind: "分配", title: "标题", body: "正文", link: "/leads", key: "k1" })).toBe(2);
    expect(await notify([甲, 乙], { kind: "分配", title: "标题", body: "正文", link: "/leads", key: "k1" })).toBe(0);
    await 等通知推完();
    const [r] = await 行(甲);
    expect(r).toMatchObject({ kind: "分配", title: "标题", body: "正文", link: "/leads", dedupeKey: "k1", readAt: null });
    expect(await prisma.entNotice.count()).toBe(2);

    // 不带 key：同一分钟同内容也只记一次
    expect(await notify([甲], { kind: "x", title: "同一句" })).toBe(1);
    expect(await notify([甲], { kind: "x", title: "同一句" })).toBe(0);
    expect(await notify([甲], { kind: "x", title: "   " })).toBe(0);

    expect(await 未读通知数(甲)).toBe(2);
    const 列 = await 我的通知(甲);
    expect(列.map((x) => x.title)).toEqual(expect.arrayContaining(["标题", "同一句"]));
    await 标通知已读(乙, 列[0].id); // 别人的标不动
    expect(await 未读通知数(甲)).toBe(2);
    await 标通知已读(甲, 列[0].id);
    expect(await 未读通知数(甲)).toBe(1);
    expect(await 全部通知已读(甲)).toBe(1);
    expect(await 未读通知数(甲)).toBe(0);
    expect(await 未读通知数(乙)).toBe(1);
  });

  it("不是企业版：一行不写", async () => {
    mocks.企业版 = false;
    expect(await notify([甲], { kind: "分配", title: "t" })).toBe(0);
    expect(await prisma.entNotice.count()).toBe(0);
  });
});

describe("飞书推送", () => {
  it("开关默认关：一次 fetch 都不发，记「没推」", async () => {
    await notify([甲], { kind: "分配", title: "t", key: "off" });
    await 等通知推完();
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await 行(甲))[0]).toMatchObject({ feishuStatus: "没推", feishuError: "飞书推送没开" });
  });

  it("开着：先拿令牌，再按 open_id 发富文本，地址、头、体都对；记「已推」", async () => {
    await setSetting(飞书推送开关键, true);
    飞书正常();
    await notify([甲], { kind: "自动分配", title: "自动分配给你一条新线索：L", body: "正文一句", link: "/leads", key: "on" });
    await 等通知推完();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [[u1, o1], [u2, o2]] = fetchMock.mock.calls as [string, RequestInit][];
    expect(u1).toBe(令牌地址);
    expect(o1.method).toBe("POST");
    expect(o1.headers).toMatchObject({ "Content-Type": "application/json; charset=utf-8" });
    expect(JSON.parse(o1.body as string)).toEqual({ app_id: "cli_test", app_secret: "s3cr3t" });
    expect(u2).toBe(发消息地址);
    expect(o2.method).toBe("POST");
    expect(o2.headers).toEqual({ "Content-Type": "application/json; charset=utf-8", Authorization: "Bearer tok" });
    const 体 = JSON.parse(o2.body as string);
    const [r] = await 行(甲);
    expect(体).toMatchObject({ receive_id: "ou_jia", msg_type: "post", uuid: r.id });
    expect(JSON.parse(体.content)).toEqual({
      zh_cn: {
        title: "自动分配给你一条新线索：L",
        content: [[{ tag: "text", text: "正文一句" }], [{ tag: "a", text: "打开 CRM 查看", href: "https://crm.example.test/leads" }]],
      },
    });
    expect(r).toMatchObject({ feishuStatus: "已推", feishuError: null });
    expect(r.feishuAt).toBeInstanceOf(Date);
  });

  it("令牌缓存：连推两条只拿一次令牌", async () => {
    await setSetting(飞书推送开关键, true);
    飞书正常();
    await notify([甲], { kind: "a", title: "一", key: "1" });
    await 等通知推完();
    await notify([甲], { kind: "a", title: "二", key: "2" });
    await 等通知推完();
    const 地址们 = fetchMock.mock.calls.map((c) => c[0]);
    expect(地址们.filter((u) => u === 令牌地址)).toHaveLength(1);
    expect(地址们.filter((u) => u === 发消息地址)).toHaveLength(2);
  });

  it("令牌失效：清掉重拿一次再发", async () => {
    await setSetting(飞书推送开关键, true);
    let 发了 = 0;
    fetchMock.mockImplementation(async (url: string) =>
      url === 令牌地址 ? 回({ code: 0, tenant_access_token: "tok", expire: 7200 }) : 发了++ === 0 ? 回({ code: 99991663, msg: "invalid token" }) : 回({ code: 0 }),
    );
    await notify([甲], { kind: "a", title: "一", key: "1" });
    await 等通知推完();
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([令牌地址, 发消息地址, 令牌地址, 发消息地址]);
    expect((await 行(甲))[0].feishuStatus).toBe("已推");
  });

  it("飞书出错（code≠0、网络断）：notify 不抛，记「失败」和原因", async () => {
    await setSetting(飞书推送开关键, true);
    fetchMock.mockImplementation(async (url: string) => (url === 令牌地址 ? 回({ code: 0, tenant_access_token: "tok", expire: 7200 }) : 回({ code: 99991672, msg: "no permission" }, 400)));
    await expect(notify([甲], { kind: "a", title: "一", key: "1" })).resolves.toBe(1);
    await 等通知推完();
    const [r] = await 行(甲);
    expect(r.feishuStatus).toBe("失败");
    expect(r.feishuError).toContain("99991672");
    expect(r.feishuError).toContain("以应用身份发消息");

    清飞书推送令牌();
    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new Error("network down"));
    await expect(notify([甲], { kind: "a", title: "二", key: "2" })).resolves.toBe(1);
    await 等通知推完();
    const 二 = (await 行(甲)).find((x) => x.title === "二")!;
    expect(二.feishuStatus).toBe("失败");
    expect(二.feishuError).toContain("network down");
  });

  it("没绑飞书：只有站内，不发消息；没配应用：一次 fetch 都不发", async () => {
    await setSetting(飞书推送开关键, true);
    飞书正常();
    await notify([乙], { kind: "a", title: "一", key: "1" });
    await 等通知推完();
    expect(fetchMock.mock.calls.map((c) => c[0])).not.toContain(发消息地址);
    expect((await 行(乙))[0]).toMatchObject({ feishuStatus: "没推", feishuError: "没绑飞书" });

    fetchMock.mockClear();
    delete process.env.ENT_FEISHU_APP_ID;
    await notify([甲], { kind: "a", title: "二", key: "2" });
    await 等通知推完();
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await 行(甲))[0]).toMatchObject({ feishuStatus: "没推", feishuError: "没配飞书应用" });
  });

  it("链接：没配 ENT_PUBLIC_URL 不带；绝对地址原样", () => {
    expect(完整链接("/projects/p1")).toBe("https://crm.example.test/projects/p1");
    expect(完整链接(null)).toBeNull();
    delete process.env.ENT_PUBLIC_URL;
    expect(完整链接("/projects/p1")).toBeNull();
  });
});

describe("飞书推送开关：只认业务角色总管理员", () => {
  it("老板账号没设业务角色：不能改；业务角色总管理：能改，写进设置", async () => {
    const 老板 = (await prisma.user.create({ data: { email: "boss", name: "老板", title: "", role: "ADMIN", password: "x" } })).id;
    const 总管 = (await prisma.user.create({ data: { email: "dir", name: "总管", title: "", role: "SALES", password: "x" } })).id;
    await prisma.entMember.create({ data: { userId: 总管, bizRole: "director" } });

    当(老板, "ADMIN");
    expect(await 设飞书推送(true)).toEqual({ ok: false, error: "只有总管理员能改飞书推送" });
    expect(await 读飞书推送()).toMatchObject({ 开: false, 能改: false });
    expect(await prisma.setting.findUnique({ where: { key: 飞书推送开关键 } })).toBeNull();

    当(总管);
    expect(await 设飞书推送(true)).toMatchObject({ ok: true, 概况: { 开: true, 能改: true, 配了应用: true, 配了地址: true } });
    expect(await prisma.setting.findUnique({ where: { key: 飞书推送开关键 } })).not.toBeNull();
    expect(await 设飞书推送(false)).toMatchObject({ ok: true, 概况: { 开: false } });
  });

  it("管理员只读、勾了「不管设置」的总管理：都不能改", async () => {
    const 管理员 = (await prisma.user.create({ data: { email: "adm", name: "管理员", title: "", role: "ADMIN", password: "x" } })).id;
    await prisma.entMember.create({ data: { userId: 管理员, bizRole: "admin" } });
    const 甩手总管 = (await prisma.user.create({ data: { email: "dir2", name: "总管二", title: "", role: "SALES", password: "x" } })).id;
    await prisma.entMember.create({ data: { userId: 甩手总管, bizRole: "director", noSettings: true } });

    for (const 谁 of [管理员, 甩手总管]) {
      当(谁);
      expect(await 设飞书推送(true)).toEqual({ ok: false, error: "只有总管理员能改飞书推送" });
      expect(await 读飞书推送()).toMatchObject({ 能改: false });
    }
    expect(await prisma.setting.findUnique({ where: { key: 飞书推送开关键 } })).toBeNull();
  });
});

describe("分配成功提醒", () => {
  let 市场: string, 经理: string, 销售一: string, 销售二: string;
  beforeEach(async () => {
    const 人 = async (email: string, name: string) => (await prisma.user.create({ data: { email, name, title: "", role: "SALES", password: "x" } })).id;
    市场 = await 人("mkt", "市场小李");
    经理 = await 人("smgr", "销售经理");
    销售一 = await 人("s1", "销售一");
    销售二 = await 人("s2", "销售二");
    await prisma.entMember.createMany({
      data: [
        { userId: 市场, bizRole: "marketing_mgr" },
        { userId: 经理, bizRole: "sales_mgr" },
        { userId: 销售一, bizRole: "sales", managerId: 经理 },
        { userId: 销售二, bizRole: "sales", managerId: 经理 },
      ],
    });
    await setSetting(规则.线索分配.key, true);
    await setSetting(自动分配不参与key, [经理]);
    for (const [i, id] of [经理, 销售一, 销售二].entries()) await prisma.user.update({ where: { id }, data: { createdAt: new Date(2026, 0, i + 1) } });
    for (const id of [经理, 销售一, 销售二]) await prisma.entLeadQuota.upsert({ where: { userId: id }, create: { userId: id, quota: 10, setById: 市场 }, update: { quota: 10 } });
    当(市场, "SALES", "市场小李");
  });
  const 建线索 = async (name: string) => (await prisma.lead.create({ data: { name, ownerId: 市场 } })).id;

  it("自动分配一条：通知接手人（带线索名、链到线索页），点的人不收", async () => {
    const r = await 自动分配线索(await 建线索("华东一号线索"));
    expect(r).toMatchObject({ ok: true });
    const to = r.ok ? r.toUserId : "";
    await 等通知推完();
    const [n] = await 行(to);
    expect(n).toMatchObject({ kind: "自动分配", link: "/leads" });
    expect(n.title).toBe("自动分配给你一条新线索：华东一号线索");
    expect(n.body).toContain("市场小李");
    expect(await prisma.entNotice.count({ where: { userId: 市场 } })).toBe(0);
    expect(await prisma.entNotice.count()).toBe(1);
  });

  it("批量自动分配：按接手人合并成一条「自动分配给你 N 条新线索」", async () => {
    const ids = await Promise.all(["A", "B", "C", "D"].map(建线索));
    const r = await 批量自动分配(ids);
    expect(r.ok).toBe(true);
    await 等通知推完();
    const 一 = await 行(销售一), 二 = await 行(销售二);
    expect(一).toHaveLength(1);
    expect(二).toHaveLength(1);
    expect(一[0].title).toBe("自动分配给你 2 条新线索");
    expect(二[0].title).toBe("自动分配给你 2 条新线索");
    expect(await prisma.entNotice.count({ where: { userId: 市场 } })).toBe(0);
  });

  it("手动分配：也通知接手人（kind 分配）；分给自己不通知", async () => {
    expect(await 分配线索({ leadId: await 建线索("手动一条"), toUserId: 销售一 })).toEqual({ ok: true });
    await 等通知推完();
    expect((await 行(销售一))[0]).toMatchObject({ kind: "分配", title: "市场小李 分给你一条新线索：手动一条" });
  });

  it("不是企业版：分配照常、不写通知", async () => {
    mocks.企业版 = false;
    await 自动分配线索(await 建线索("X"));
    expect(await prisma.entNotice.count()).toBe(0);
  });
});
