/**
 * 从通知直达放弃（豁免）（11-21，用户「通知里面直接加上这个按钮」）的纯函数部分：
 *   - 链接参数：带 / 去 / 认 ?giveup=1（别的参数、# 原样留着）
 *   - 发通知那一刻带不带：资格在且可点才带；不给、验证中、本月用过不带
 *   - 飞书消息体：带参数的多一个「放弃（豁免）」，「打开 CRM 查看」去不带参数的；不带的照旧一个链接
 *   - 项目页带参数打开做什么：弹框 / 说为什么 / 问服务器 / 不是这一条
 *   - 项目状态不给放弃的那句
 */
import { describe, expect, it } from "vitest";
import {
  有放弃参数, 带放弃参数, 去放弃参数, 通知链接带放弃, 放弃落地of, 落地对得上, 项目不给放弃, 不给放弃话, 不在手上话, 本月用过话,
  放弃链接项目, 剩多久, 放弃时限话, 放弃后要离开,
} from "@/lib/enterprise/lead-giveup-core";
import { 消息体, 放弃链接字 } from "@/lib/enterprise/feishu-push";

describe("链接参数", () => {
  it("带 / 去 / 认", () => {
    expect(带放弃参数("/projects/p1")).toBe("/projects/p1?giveup=1");
    expect(带放弃参数("/customers/c1?project=p1")).toBe("/customers/c1?project=p1&giveup=1");
    expect(带放弃参数("/projects/p1#feed")).toBe("/projects/p1?giveup=1#feed");
    expect(带放弃参数("/projects/p1?giveup=1")).toBe("/projects/p1?giveup=1");
    expect(有放弃参数("/projects/p1?giveup=1")).toBe(true);
    expect(有放弃参数("https://crm.example.com/customers/c1?project=p1&giveup=1")).toBe(true);
    expect(有放弃参数("/projects/p1?giveup=10")).toBe(false);
    expect(有放弃参数("/projects/p1#giveup=1")).toBe(false);
    expect(有放弃参数(null)).toBe(false);
    expect(去放弃参数("/projects/p1?giveup=1")).toBe("/projects/p1");
    expect(去放弃参数("/customers/c1?project=p1&giveup=1")).toBe("/customers/c1?project=p1");
    expect(去放弃参数("/customers/c1?giveup=1&project=p1#x")).toBe("/customers/c1?project=p1#x");
    expect(去放弃参数("/projects/p1")).toBe("/projects/p1");
  });

  it("发通知那一刻：资格在且可点才带；不给 / 点不了（验证中、本月用过）不带", () => {
    expect(通知链接带放弃("/projects/p1", { 可: true })).toBe("/projects/p1?giveup=1");
    expect(通知链接带放弃("/projects/p1", { 可: false })).toBe("/projects/p1");
    expect(通知链接带放弃("/projects/p1", null)).toBe("/projects/p1");
    expect(通知链接带放弃("/projects/p1", undefined)).toBe("/projects/p1");
  });
});

describe("飞书消息体", () => {
  const 段们 = (链接: string | null) => JSON.parse(消息体("ou_x", { 标题: "t", 正文: "b", 链接, uuid: "n1" }).content).zh_cn.content as { tag: string; text: string; href?: string }[][];
  it("带 ?giveup=1：同一行「打开 CRM 查看」（不带参数）+「放弃（豁免）」（带参数）", () => {
    const 段 = 段们("https://crm.example.com/projects/p1?giveup=1");
    const 链 = 段.flat().filter((x) => x.tag === "a");
    expect(链).toEqual([
      { tag: "a", text: "打开 CRM 查看", href: "https://crm.example.com/projects/p1" },
      { tag: "a", text: 放弃链接字, href: "https://crm.example.com/projects/p1?giveup=1" },
    ]);
    expect(放弃链接字).toBe("放弃（豁免）");
  });
  it("不带：照旧只有「打开 CRM 查看」；没链接只有正文", () => {
    expect(段们("https://crm.example.com/projects/p1").flat().filter((x) => x.tag === "a")).toEqual([{ tag: "a", text: "打开 CRM 查看", href: "https://crm.example.com/projects/p1" }]);
    expect(段们(null).flat().filter((x) => x.tag === "a")).toEqual([]);
  });
});

describe("项目页带参数打开做什么", () => {
  const 能 = { 可: true, 本月已用: false };
  it("没参数什么都不做；能放弃弹框；点不了说为什么；没入口问服务器；不是这一条说不在你名下", () => {
    expect(放弃落地of(false, true, 能)).toEqual({ 做: "无" });
    expect(放弃落地of(false, false, undefined)).toEqual({ 做: "无" });
    expect(放弃落地of(true, true, 能)).toEqual({ 做: "弹框" });
    expect(放弃落地of(true, true, { 可: false, 本月已用: true, 为什么: 本月用过话 })).toEqual({ 做: "说明", 话: 本月用过话 });
    expect(放弃落地of(true, true, undefined)).toEqual({ 做: "问服务器" });
    expect(放弃落地of(true, false, 能)).toEqual({ 做: "说明", 话: 不在手上话 });
  });
  it("是不是那一条：项目页看路径，客户详情看 ?project", () => {
    expect(落地对得上("p1", "/projects/p1", null)).toBe(true);
    expect(落地对得上("p 1", "/projects/p%201", null)).toBe(true);
    expect(落地对得上("p1", "/projects/p2", null)).toBe(false);
    expect(落地对得上("p1", "/customers/c1", "p1")).toBe(true);
    expect(落地对得上("p1", "/customers/c1", "p2")).toBe(false);
    expect(落地对得上("p1", "/customers/c1", null)).toBe(false);
  });
});

describe("项目状态不给放弃的那句", () => {
  const 基 = { ownerId: "a", phase: "线索", result: null, pooledAt: null, awaitAssignAt: null, deletedAt: null, 客户在公海: false };
  it("够 = null；不在手上 / 不在线索 / 公海 / 待分配各一句", () => {
    expect(项目不给放弃("a", 基)).toBeNull();
    expect(项目不给放弃("a", null)).toBe(不给放弃话.不在手上);
    expect(项目不给放弃("b", 基)).toBe(不给放弃话.不在手上);
    expect(项目不给放弃("a", { ...基, deletedAt: new Date() })).toBe(不给放弃话.不在手上);
    expect(项目不给放弃("a", { ...基, phase: "商机" })).toBe(不给放弃话.不在线索);
    expect(项目不给放弃("a", { ...基, result: "lost" })).toBe(不给放弃话.不在线索);
    expect(项目不给放弃("a", { ...基, pooledAt: new Date() })).toBe(不给放弃话.在公海);
    expect(项目不给放弃("a", { ...基, 客户在公海: true })).toBe(不给放弃话.在公海);
    expect(项目不给放弃("a", { ...基, awaitAssignAt: new Date() })).toBe(不给放弃话.待分配);
  });
});

describe("铃铛按项目对能不能放弃、首页时限那句", () => {
  it("放弃链接项目：带 ?giveup=1 的项目页链接回项目 id；不带的、不是项目页的回 null", () => {
    expect(放弃链接项目("/projects/p1?giveup=1")).toBe("p1");
    expect(放弃链接项目("/projects/p%201?giveup=1")).toBe("p 1");
    expect(放弃链接项目("/projects/p1")).toBeNull();
    expect(放弃链接项目("/leads?giveup=1")).toBeNull();
    expect(放弃链接项目("/projects/%E0%A4%A?giveup=1")).toBeNull();
    expect(放弃链接项目(null)).toBeNull();
  });
  it("剩多久：向上取整到分钟", () => {
    expect(剩多久(0)).toBe("不到 1 分钟");
    expect(剩多久(30_000)).toBe("不到 1 分钟");
    expect(剩多久(61_000)).toBe("2 分钟");
    expect(剩多久(50 * 60_000)).toBe("50 分钟");
    expect(剩多久(60 * 60_000)).toBe("1 小时");
    expect(剩多久(90 * 60_000)).toBe("1 小时 30 分钟");
    expect(剩多久(24 * 3_600_000)).toBe("1 天");
    expect(剩多久((6 * 24 + 23) * 3_600_000 + 50 * 60_000)).toBe("6 天 23 小时");
  });
  it("放弃时限话：超时 / 转走 / 窗口；过了点各一句", () => {
    const 现在 = new Date("2026-11-20T07:10:00Z");
    const 后 = (分: number) => new Date(现在.getTime() + 分 * 60_000);
    expect(放弃时限话("超时", 后(50), 现在)).toBe("还剩 50 分钟 超时");
    expect(放弃时限话("超时", 后(-1), 现在)).toBe("已到超时时间");
    expect(放弃时限话("转走", 后(25), 现在)).toBe("已超时，还剩 25 分钟 自动转走");
    expect(放弃时限话("转走", 后(0), 现在)).toBe("已超时，马上自动转走");
    expect(放弃时限话("窗口", 后(3 * 24 * 60), 现在)).toBe("还剩 3 天 可放弃");
  });
});

describe("铃铛放弃成了以后当前页要不要离开（审查：刷新会 404）", () => {
  it("项目页这条、客户详情 ?project=这条、跟着转走的这位客户 = 离开；别的 = 刷新", () => {
    expect(放弃后要离开("/projects/p1", "", "p1")).toBe(true);
    expect(放弃后要离开("/projects/p1/", "?giveup=1", "p1")).toBe(true);
    expect(放弃后要离开("/customers/c1", "?project=p1", "p1")).toBe(true);
    expect(放弃后要离开("/customers/c1", "", "p1", { customerId: "c1", 客户跟走: true })).toBe(true);
    expect(放弃后要离开("/customers/c1", "", "p1", { customerId: "c1", 客户跟走: false })).toBe(false);
    expect(放弃后要离开("/customers/c2", "", "p1", { customerId: "c1", 客户跟走: true })).toBe(false);
    expect(放弃后要离开("/customers/c1", "?project=p2", "p1")).toBe(false);
    expect(放弃后要离开("/projects/p2", "", "p1")).toBe(false);
    expect(放弃后要离开("/dashboard", "", "p1", { customerId: "c1", 客户跟走: true })).toBe(false);
    expect(放弃后要离开("/customers/%E0%A4%A", "", "p1", { customerId: "c1", 客户跟走: true })).toBe(false);
  });
});
