/**
 * 企业版项目模式的左栏（lib/enterprise/nav.ts，10-29 客户定稿）：
 * 六个根目录、这个顺序；不在左栏的新线索、跟进、联系人亮到入口那一项上；公海是 /pool，客户页带 pool=1 的老链接也亮公海。
 */
import { describe, it, expect } from "vitest";
import { 企业版根目录, 企业版亮项, 企业版页名, 公海入口 } from "@/lib/enterprise/nav";

describe("企业版根目录", () => {
  it("六项：首页 / 复盘 / 渠道 / 公海 / 客户 / 项目，客户跟着业务叫法", () => {
    const r = 企业版根目录("学员");
    expect(r.map((x) => x.label)).toEqual(["首页", "复盘", "渠道", "公海", "学员", "项目"]);
    expect(r.map((x) => x.key)).toEqual(["/dashboard", "/overview", "/channels", 公海入口, "/customers", "/projects"]);
  });

  it("没有新线索、跟进、联系人；键不重复；要跟的红数只挂在项目上", () => {
    const r = 企业版根目录("客户");
    for (const k of ["/leads", "/follow-ups", "/contacts"]) expect(r.map((x) => x.key)).not.toContain(k);
    expect(new Set(r.map((x) => x.key)).size).toBe(r.length);
    expect(r.filter((x) => x.挂要跟).map((x) => x.key)).toEqual(["/projects"]);
  });

  it("公海指统一公海 /pool（P7）", () => {
    expect(公海入口).toBe("/pool");
  });
});

describe("企业版亮项", () => {
  it("/pool 亮公海；客户页带 pool=1 的老链接也亮公海；客户档案页亮客户", () => {
    expect(企业版亮项("/pool", null)).toBe("/pool");
    expect(企业版亮项("/poolX", null)).toBeNull();
    expect(企业版亮项("/customers", "1")).toBe(公海入口);
    expect(企业版亮项("/customers", null)).toBe("/customers");
    expect(企业版亮项("/customers", "")).toBe("/customers");
    expect(企业版亮项("/customers/abc", "1")).toBe("/customers");
  });

  it("不在左栏的页挂到入口那一项：新线索、跟进 → 项目，联系人 → 客户", () => {
    expect(企业版亮项("/leads", null)).toBe("/projects");
    expect(企业版亮项("/follow-ups", null)).toBe("/projects");
    expect(企业版亮项("/follow-ups/plans", null)).toBe("/projects");
    expect(企业版亮项("/projects/p1", null)).toBe("/projects");
    expect(企业版亮项("/contacts", null)).toBe("/customers");
    expect(企业版亮项("/contacts/c1", null)).toBe("/customers");
  });

  it("根目录各自亮；前缀相同的别的路径不误亮；认不出的交回去", () => {
    expect(企业版亮项("/dashboard", null)).toBe("/dashboard");
    expect(企业版亮项("/overview", null)).toBe("/overview");
    expect(企业版亮项("/channels/x", null)).toBe("/channels");
    expect(企业版亮项("/customersX", null)).toBeNull();
    expect(企业版亮项("/settings", null)).toBeNull();
    expect(企业版亮项("/admin", null)).toBeNull();
  });
});

describe("企业版页名", () => {
  it("标签页标题：不在左栏的页写自己的名字，不跟着亮项叫「项目」", () => {
    expect(企业版页名("/customers", "1", "客户")).toBe("公海");
    expect(企业版页名("/pool", null, "客户")).toBe("公海");
    expect(企业版页名("/customers", null, "学员")).toBe("学员");
    expect(企业版页名("/leads", null, "客户")).toBe("新线索");
    expect(企业版页名("/follow-ups/plans", null, "客户")).toBe("跟进");
    expect(企业版页名("/contacts", null, "客户")).toBe("联系人");
    expect(企业版页名("/overview", null, "客户")).toBe("复盘");
    expect(企业版页名("/settings", null, "客户")).toBe("设置");
    expect(企业版页名("/admin", null, "客户")).toBe("");
  });
});
