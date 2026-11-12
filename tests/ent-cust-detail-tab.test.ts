import { describe, expect, it } from "vitest";
import { 客户页项目地址, 默认页签 } from "@/lib/project/customer-detail-href";

/* 11-12 客户详情合并第 2 批：项目的地址 = 客户详情 ?project=；没带 ?project 时默认停在哪个页签 */
describe("客户页项目地址", () => {
  it("客户详情 + ?project=，id 编码；可带落点", () => {
    expect(客户页项目地址("c1", "p1")).toBe("/customers/c1?project=p1");
    expect(客户页项目地址("c 1", "p/1", "#project-follow")).toBe("/customers/c%201?project=p%2F1#project-follow");
  });
});

describe("默认页签：我能看的、没结束的、最近有动静的（列表已按 updatedAt 倒序）", () => {
  const 项 = (id: string, result: string | null = null, pooledAt: Date | null = null) => ({ id, result, pooledAt });
  it("没结束、不在公海的第一个", () => {
    expect(默认页签([项("a", "签约"), 项("b", null, new Date()), 项("c"), 项("d")])?.id).toBe("c");
  });
  it("没结束的只剩公海里的：选它", () => {
    expect(默认页签([项("a", "丢单"), 项("b", null, new Date())])?.id).toBe("b");
  });
  it("全结束了：最近结束的那个；没有项目：null", () => {
    expect(默认页签([项("a", "丢单"), 项("b", "签约")])?.id).toBe("a");
    expect(默认页签([])).toBeNull();
  });
});
