/**
 * 客户列表「客户来源」筛选的取值（F-049，11-25，lib/enterprise/customer-source-filter.ts）：
 * 「未填」= 主渠道和渠道触点都空；「触点:xx」按渠道触点；别的当渠道 id。Prisma 条件和快路径 SQL 同一口径。
 * 连库的对拍在 customer-keyword-page.test.ts
 */
import { describe, expect, it } from "vitest";
import { 认来源筛选, 来源筛选条件, 来源筛选SQL, 客户来源筛选项, 来源未填, 触点前缀, 切我分出去的去掉, 触点显示名 } from "@/lib/enterprise/customer-source-filter";
import { 拆导出渠道 } from "@/app/(app)/customers/export-table";
import { 渠道触点们 } from "@/lib/enterprise/touchpoint";

describe("客户来源筛选取值", () => {
  it("认三种值；空的、只写了前缀的当没筛", () => {
    expect(认来源筛选("未填")).toEqual({ 类: "未填" });
    expect(认来源筛选(" 触点:公司资源 ")).toEqual({ 类: "触点", 触点: "公司资源" });
    expect(认来源筛选("ch_abc")).toEqual({ 类: "渠道", id: "ch_abc" });
    for (const v of ["", "  ", null, undefined, "触点:", "触点: "]) expect(认来源筛选(v)).toBeNull();
  });

  it("Prisma 条件：未填 = 两格都空（触点空串也算空）；触点、渠道各比一格", () => {
    expect(来源筛选条件(来源未填)).toEqual({ AND: [{ channelId: null }, { OR: [{ touchpoint: null }, { touchpoint: "" }] }] });
    expect(来源筛选条件(`${触点前缀}客户介绍`)).toEqual({ touchpoint: "客户介绍" });
    expect(来源筛选条件("ch1")).toEqual({ channelId: "ch1" });
    expect(来源筛选条件("")).toBeNull();
  });

  it("快路径 SQL：值都走参数绑定，未填不带参数", () => {
    expect(来源筛选SQL(来源未填)).toEqual({ sql: `c."channelId" IS NULL AND (c."touchpoint" IS NULL OR c."touchpoint" = '')`, values: [] });
    expect(来源筛选SQL(`${触点前缀}公司资源`)).toEqual({ sql: 'c."touchpoint" = ?', values: ["公司资源"] });
    expect(来源筛选SQL("x' OR 1=1 --")).toEqual({ sql: 'c."channelId" = ?', values: ["x' OR 1=1 --"] });
    expect(来源筛选SQL(undefined)).toBeNull();
  });

  it("下拉：未填最前，触点一组（每个触点都在、带「（触点）」），渠道一组原样；没有渠道时不出空组", () => {
    const 渠道 = [{ value: "ch1", label: "展会" }];
    const 组 = 客户来源筛选项(渠道);
    expect(组[0]).toMatchObject({ value: 来源未填, label: "未填" });
    expect(组[1]).toEqual({ label: "渠道触点", options: 渠道触点们.map((t) => ({ value: `${触点前缀}${t}`, label: `${t}（触点）` })) });
    expect(组[2]).toEqual({ label: "渠道", options: 渠道 });
    expect(客户来源筛选项([])).toHaveLength(2);
    // 每个值都认得回来
    for (const g of 组) for (const o of "options" in g ? g.options : [g]) expect(认来源筛选(o.value)).not.toBeNull();
  });

  it("市场角色切「我分出去的」：筛的是未填 / 触点时 channelId 一并去掉（项目不带触点），渠道 id 留着", () => {
    expect(切我分出去的去掉(来源未填)).toEqual(["scope", "channelId"]);
    expect(切我分出去的去掉(`${触点前缀}公司资源`)).toEqual(["scope", "channelId"]);
    expect(切我分出去的去掉("ch1")).toEqual(["scope"]);
    expect(切我分出去的去掉("")).toEqual(["scope"]);
    expect(切我分出去的去掉(undefined)).toEqual(["scope"]);
  });

  it("「客户来源」显示：没主渠道、有触点写「公司资源（触点）」，导出主渠道那格同一写法；有渠道照旧拆主子", () => {
    expect(触点显示名("公司资源")).toBe("公司资源（触点）");
    expect(拆导出渠道(null, "客户介绍")).toEqual(["客户介绍（触点）", ""]);
    expect(拆导出渠道("", "公司资源")).toEqual(["公司资源（触点）", ""]);
    expect(拆导出渠道("展会|华东", "公司资源")).toEqual(["展会", "华东"]);
    expect(拆导出渠道(null, null)).toEqual(["", ""]);
    expect(拆导出渠道(null)).toEqual(["", ""]);
  });
});
