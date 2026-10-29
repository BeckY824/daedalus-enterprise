/**
 * 回归总表「L-联动」里修了但没测试钉着的几条（2026-10-04 上线前第 2 期补测）。每条一句话说清钉的是什么：
 *   L-039 客户列表 directOf 只筛直接从这个渠道来的（渠道页的「直接推荐」列 2026-10-29 渠道改版已去掉，筛选本身还在）
 *   L-043 首页欢迎句「今天要跟 N 条」和左栏角标、Dock 同一个函数
 *   L-045 商机页汇总按全量算，不是取回来的前 300 行
 *   L-053 通用预设的来源列表是现在这一套（微信 / 小红书 / 抖音 / 视频号…）
 *   L-070 表单里不再留教培例子（王妈妈、试听）
 *   L-071 改了状态显示名后，速记解析的提示词写「显示名（值：存储值）」
 *   L-111 订单 / 供应商两页 2026-10-28 已删：AI 面板不再给那两页指路
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "我", email: "me@local", role: "ADMIN", title: "管理员", avatar: null },
  提示词: [] as string[],
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, redirect: () => { throw new Error("REDIRECT"); } }));
// 速记解析：不真调模型，只把拼好的提示词收下来看
vi.mock("@/lib/llm", async (原) => ({
  ...(await 原<typeof import("@/lib/llm")>()),
  llmEnabled: async () => false,
  chatJSON: async (prompt: string) => {
    mocks.提示词.push(prompt);
    return { followUp: { type: "PHONE", content: "聊了", status: "已完成" } };
  },
}));
for (const m of [
  "@/app/(app)/channels/ChannelsView", "@/app/(app)/customers/CustomersView",
]) vi.doMock(m, () => ({ default: () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 造本人 } from "./r2-data-helpers";
import { saveBusiness, DEFAULT_BUSINESS } from "@/lib/business";
import { invalidateSettingsCache } from "@/lib/settings";
import { parseFollowUpDraft } from "@/app/(app)/customers/[id]/ai";
import { 认页面 } from "@/lib/ai-context-page";

const ROOT = path.resolve(__dirname, "..");
let 我: string;
beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  mocks.提示词 = [];
  我 = (await 造本人()).id;
  mocks.user = { ...mocks.user, id: 我 };
});
afterAll(async () => {
  invalidateSettingsCache();
  await prisma.$disconnect();
});

const sp = (x: Record<string, string> = {}) => ({ searchParams: Promise.resolve(x) }) as never;
const 属性 = (el: unknown) => (el as { props: Record<string, unknown> }).props;

describe("L-039 客户列表 directOf = 直接从这个渠道来的那几位", () => {
  it("两位直接来的、一位转介绍来的（只算进整条链）：directOf 筛出 2 位，正是那两位", async () => {
    const ch = await prisma.channel.create({ data: { name: "林老师", channelOwnerId: 我 } });
    const 甲 = await prisma.customer.create({ data: { name: "甲", phone: "13800000001", salesOwnerId: 我, channelId: ch.id, attributionChannelId: ch.id } });
    await prisma.customer.create({ data: { name: "乙", phone: "13800000002", salesOwnerId: 我, channelId: ch.id, attributionChannelId: ch.id } });
    await prisma.customer.create({ data: { name: "甲推荐的", phone: "13800000003", salesOwnerId: 我, referrerCustomerId: 甲.id, attributionChannelId: ch.id } });
    await prisma.customer.create({ data: { name: "名字里带林老师的", phone: "13800000004", salesOwnerId: 我 } });

    const 列表 = 属性(await (await import("@/app/(app)/customers/page")).default(sp({ directOf: ch.id }))) as { total: number; rows: { name: string }[]; 直接推荐: string };
    expect(列表.total).toBe(2);
    expect(列表.rows.map((r) => r.name).sort()).toEqual(["乙", "甲"]);
    expect(列表.直接推荐).toBe("林老师");
    // 渠道页不再摆推荐链那几列，也就不再往客户列表带 directOf
    expect(readFileSync(path.join(ROOT, "src/app/(app)/channels/ChannelsView.tsx"), "utf8")).not.toMatch(/directOf/);
  });
});

describe("L-043 首页欢迎句的「今天要跟 N 条」和左栏角标、Dock 同一个函数", () => {
  it("dashboard/page.tsx 用 取提醒项 + 算提醒 数，不自己数计划", () => {
    const 首页 = readFileSync(path.join(ROOT, "src/app/(app)/dashboard/page.tsx"), "utf8");
    expect(首页).toMatch(/取提醒项\(user\.id\)/);
    expect(首页).toMatch(/算提醒\(提醒项\)/);
    expect(首页).toMatch(/今天要跟 \$\{今天要跟\} 条/);
  });
});

describe("L-053 通用预设的来源列表", () => {
  it("是现在这一套：微信、小红书、抖音、视频号都在，教培的「家长转介绍」类不在", () => {
    expect(DEFAULT_BUSINESS.sources).toEqual(expect.arrayContaining(["微信", "小红书", "抖音", "视频号"]));
    expect(DEFAULT_BUSINESS.sources.join("")).not.toMatch(/家长|试听/);
  });
});

describe("L-070 表单里不留教培例子", () => {
  it("src/app 下的 tsx 不出现「王妈妈」；placeholder 里不出现「试听」", () => {
    const 文件: string[] = [];
    const 走 = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = path.join(d, n);
        if (statSync(p).isDirectory()) 走(p);
        else if (p.endsWith(".tsx")) 文件.push(p);
      }
    };
    走(path.join(ROOT, "src/app"));
    expect(文件.length).toBeGreaterThan(30);
    const 坏 = 文件.filter((f) => {
      const s = readFileSync(f, "utf8");
      return s.includes("王妈妈") || /placeholder=["{`][^>\n]*试听/.test(s);
    });
    expect(坏.map((f) => path.relative(ROOT, f))).toEqual([]);
  });
});

describe("L-071 改了状态显示名，速记解析的提示词跟着说", () => {
  it("「已试听」改叫「已演示」：提示词里写「已演示（值：已试听）」，没改的照原样写", async () => {
    await saveBusiness({ ...DEFAULT_BUSINESS, statusLabels: { ...DEFAULT_BUSINESS.statusLabels, 已试听: "已演示", 与家人商议: "内部讨论" } });
    const c = await prisma.customer.create({ data: { name: "王总", phone: "13800000001", salesOwnerId: 我 } });
    await parseFollowUpDraft({ customerId: c.id, text: "刚和王总聊了二十分钟，下周来公司看演示" });
    expect(mocks.提示词).toHaveLength(1);
    expect(mocks.提示词[0]).toContain("已演示（值：已试听）");
    expect(mocks.提示词[0]).toContain("内部讨论（值：与家人商议）");
    expect(mocks.提示词[0]).toContain("/跟进中/");
  });
});

describe("L-111 删掉的页，AI 面板不给指路", () => {
  it("/orders、/suppliers、/opportunities（2026-10-28 已删）没有上下文说法；别的页照旧有", () => {
    expect(认页面("/orders", null)).toBeNull();
    expect(认页面("/suppliers", null)).toBeNull();
    expect(认页面("/opportunities", null)).toBeNull();
    expect(认页面("/opportunities/pipeline", null)).toBeNull();
    expect(认页面("/customers", null)?.提示).toContain("search_customers");
  });
});

/*
  L-051：在客户列表上确认 AI 建议卡「改成已签约」，背后的列表原来不刷新。真出一张卡要接上模型，默认 e2e 不调模型，
  这里用源码钉住：确认成功那一支、撤销成功之后，都 router.refresh()（真机出卡点一遍在手点单里）
*/
describe("L-051 建议卡确认 / 撤销之后刷新这一页", () => {
  it("ProposalCard：applyProposal 成功那一支和 undo 成功之后都调 router.refresh()", () => {
    const s = readFileSync(path.join(ROOT, "src/components/ProposalCard.tsx"), "utf8");
    const 确认 = s.slice(s.indexOf("const r = await applyProposal("), s.indexOf("} else {", s.indexOf("const r = await applyProposal(")));
    expect(确认).toMatch(/if \(r\.ok\)/);
    expect(确认).toMatch(/router\.refresh\(\)/);
    const 撤销 = s.slice(s.indexOf("async function undo()"), s.indexOf("if (state === \"denied\")"));
    expect(撤销).toMatch(/router\.refresh\(\)/);
  });
});

describe("L-045 首页「正在被遗忘」先只数我的、再排前几位", () => {
  it("同事名下 10 位分更高的被遗忘客户、我名下 1 位：我的那位在，同事的一位都不混进来", async () => {
    const { loadWatchlistPage } = await import("@/lib/sentinel-data");
    const { dayjs } = await import("@/lib/utils");
    const 同事 = await prisma.user.create({ data: { email: "co@x", name: "同事", title: "销售", role: "SALES", password: "x" } });
    const 早 = (天: number) => new Date(Date.now() - 天 * 86400000);
    for (let i = 0; i < 10; i++) {
      await prisma.customer.create({ data: { name: `同事的${i}`, phone: `1370000${String(i).padStart(4, "0")}`, salesOwnerId: 同事.id, followStatus: "意向较高", createdAt: 早(60) } });
    }
    await prisma.customer.create({ data: { name: "我的那位", phone: "13800000001", salesOwnerId: 我, followStatus: "跟进中", createdAt: 早(30) } });
    const 我的 = (await loadWatchlistPage(dayjs(), { ownerId: 我 })).items;
    expect(我的.map((w) => w.customerName)).toEqual(["我的那位"]);
    // 不限人时同事的那十位排在前面——先取前 8 再按人筛的老写法，「我的那位」就被挤掉了
    const 全部 = (await loadWatchlistPage(dayjs())).items;
    expect(全部.slice(0, 8).some((w) => w.customerName === "我的那位")).toBe(false);
  });
});
