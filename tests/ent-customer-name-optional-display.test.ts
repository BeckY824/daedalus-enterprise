/**
 * 企业版客户名称选填（11-19）独立审查补的几处「没名客户显示空白 / 「」」——纯函数和组件静态渲染这一半
 * （库里的那一半在 ent-customer-name-optional.test.ts）：
 *   仅项目块链接、客户看板卡片标题 / aria-label、通知里的客户名、市场指定方向的报错、按名找客户的条件、全称灰字一行省略
 *
 * 不引 jsdom：renderToStaticMarkup + createElement（同 ai-meter-bar.test.ts）。
 */
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }), usePathname: () => "/customers" }));

import ProjectOnlyBlock from "@/app/(app)/customers/ProjectOnlyBlock";
import CustomerBoard from "@/app/(app)/customers/CustomerBoard";
import { 通知里的客户名 } from "@/lib/enterprise/notice-mask";
import { 客户按名条件, 客户引, 全称或显名, 客户显名 } from "@/lib/enterprise/customer-title";
import { 没填全称提示, 像人名提示 } from "@/lib/enterprise/fullname-hint";

const 没名 = { id: "c-no-name-0001", name: "", shortName: null, customerNo: 12 };

describe("仅项目块：没全称的客户链接文字不空（和客户表格第一列同一个抬头算法）", () => {
  const 行 = (补: Record<string, unknown>) => ({ ...没名, school: null, customerType: null, customerAttr: null, 地区: "", 当前节点: null, 当前阶段: null, 项目数: 1, 仅项目: true, ...补 });
  it("全空兜客户编号；有当前节点接在编号后面；有简称叫简称", () => {
    const html = renderToStaticMarkup(createElement(ProjectOnlyBlock, { 行们: [行({}), 行({ id: "c-no-name-0002", customerNo: 13, 当前节点: "报价" }), 行({ id: "c-no-name-0003", customerNo: 14, shortName: "编的简称" })] as never }));
    expect(html).toContain(">NO.00012</a>");
    expect(html).toContain('title="NO.00012"');
    expect(html).toContain(">NO.00013|报价</a>");
    expect(html).toContain(">编的简称</a>");
    expect(html).not.toContain("></a>");
  });
});

describe("客户看板：卡片标题、aria-label 不空", () => {
  it("没全称的叫客户编号；有简称的叫简称", () => {
    const html = renderToStaticMarkup(createElement(CustomerBoard, {
      行们: [{ ...没名, customerAttr: null, salesOwnerName: "销售甲", custStatus: null, extra: null, pool: null }, { id: "c2", name: "", shortName: "编的简称", customerNo: 13, customerAttr: null, salesOwnerName: "销售甲", custStatus: null, extra: null, pool: null }] as never,
      字典: [], 加载中: false, 页: 1, 每页: 20, 总数: 2, 翻页: () => {}, 去: () => {},
    }));
    expect(html).toContain('aria-label="NO.00012，销售甲"');
    expect(html).toContain(">NO.00012</div>");
    expect(html).toContain('aria-label="编的简称，销售甲"');
    expect(html).not.toContain('aria-label="，');
  });
  it("抬头节点和列表第一列一样接在编号后面", () => {
    const html = renderToStaticMarkup(createElement(CustomerBoard, {
      行们: [{ ...没名, customerAttr: null, salesOwnerName: "销售甲", custStatus: null, extra: null, pool: null }] as never,
      字典: [], 加载中: false, 页: 1, 每页: 20, 总数: 1, 翻页: () => {}, 去: () => {}, 抬头节点: { [没名.id]: "报价" },
    }));
    expect(html).toContain(">NO.00012|报价</div>");
  });
});

describe("通知里的客户名：全称空着兜简称 → 客户编号", () => {
  it("空全称 + 简称 → 简称；都空 → 客户 编号；没编号没 id → 一位客户；有全称照旧", () => {
    expect(通知里的客户名({ ...没名, shortName: "编的简称" })).toBe("编的简称");
    expect(通知里的客户名(没名)).toBe("客户 NO.00012");
    expect(通知里的客户名({ name: "" })).toBe("一位客户");
    expect(通知里的客户名({ name: "编的单位", shortName: "编的简称" })).toBe("编的单位");
  });
});

describe("日志 / 查重提示口径：全称或显名；界面：客户显名", () => {
  it("有全称的老客户日志照旧写全称（哪怕有简称），没全称兜简称 → 编号，不出「」", () => {
    const 老 = { id: "c3", name: "编的单位全称", shortName: "编的简称", customerNo: 3 };
    expect(客户引(老)).toBe("「编的单位全称」");
    expect(客户显名(老)).toBe("编的简称");
    expect(客户引(没名)).toBe("「NO.00012」");
    expect(全称或显名(没名)).toBe("NO.00012");
  });
});

describe("按名找客户：全称、简称都比，像编号的按客户编号", () => {
  it("普通词比全称、简称；NO.00012 / 12 再加编号", () => {
    expect(客户按名条件("编的").OR).toEqual([{ name: { contains: "编的" } }, { shortName: { contains: "编的" } }]);
    expect(客户按名条件("NO.00012").OR).toContainEqual({ customerNo: 12 });
    expect(客户按名条件(" 12 ").OR).toContainEqual({ customerNo: 12 });
  });
});

describe("全称灰字：一行放得下的短句", () => {
  it("两句都不超过 24 个字（AI 卡、新建弹窗一行；放不下 CSS 省略 + title）", () => {
    expect([...没填全称提示].length).toBeLessThanOrEqual(24);
    expect([...像人名提示].length).toBeLessThanOrEqual(24);
  });
});
