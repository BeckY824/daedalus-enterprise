/**
 * 市场角色的项目页（11-04 V3.5.1 P-界面-05 / 08、P-看-05 / 06、P-线索-02），纯函数，规矩在 lib/enterprise/market-view.ts：
 *   - 视角：只认市场成员（含渠运）/ 市场管理；兼着总管理 / 销售 / 销管的、设了「只看某人」的不算（照旧）
 *   - 圈：市场成员 = 自己；市场管理 = 自己 + 实线下属（逐级、业务线对得上）
 *   - 项目条件：不在公海；负责的 ∪ 创建的且已分出去 ∪ 我是已加入组员；创建人筛选只认圈里的人
 *   - 只看进度：负责人不在圈里、我不是组员、不是等我拍板的市场复核
 *   - 挡详情：不是市场视角不管；进了公海的不挡（公海那条照旧）
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { 组织, 组织成员 } from "@/lib/enterprise/org-core";
import { 市场视角of, 市场圈, 市场项目条件, 只看进度, 市场挡详情 } from "@/lib/enterprise/market-view";

const 人 = (userId: string, 角色们: string[], o: Partial<组织成员> = {}): [string, 组织成员] => [
  userId,
  { userId, deptId: null, bizRole: (角色们[0] ?? null) as 组织成员["bizRole"], 角色们: 角色们 as 组织成员["角色们"], line: null, managerId: null, dottedManagerId: null, 不管设置: false, ...o },
];
// 市管 m 下面：市场成员 a（实线）→ a 下面 a2（逐级）；b 是虚线、不算；s 是销售
const org: 组织 = {
  成员: new Map([
    人("m", ["marketing_mgr"]),
    人("a", [], { managerId: "m" }),
    人("a2", [], { managerId: "a" }),
    人("b", [], { dottedManagerId: "m" }),
    人("ops", ["channel_ops"]),
    人("s", ["sales"], { managerId: "m" }),
    人("mix", ["marketing_mgr", "sales_mgr"]),
    人("d", ["director"]),
    人("w", ["marketing_mgr"]),
  ]),
  部门: new Map(),
  只看某人: new Map([["w", "a"]]),
};
const 市场成员集 = new Set(["a", "a2", "b"]);

let 原 = process.env.CRM_ENTERPRISE;
beforeAll(() => { 原 = process.env.CRM_ENTERPRISE; process.env.CRM_ENTERPRISE = "1"; });
afterAll(() => { if (原 === undefined) delete process.env.CRM_ENTERPRISE; else process.env.CRM_ENTERPRISE = 原; });

describe("市场视角", () => {
  it("市场成员（名单里的、渠运）/ 市场管理；兼销售、销管、总管理的不算；设了只看某人的不算；没 org = null", () => {
    expect(市场视角of(org, "a", 市场成员集)).toBe("市场成员");
    expect(市场视角of(org, "ops", 市场成员集)).toBe("市场成员");
    expect(市场视角of(org, "m", 市场成员集)).toBe("市场管理");
    expect(市场视角of(org, "s", 市场成员集)).toBeNull();
    expect(市场视角of(org, "mix", 市场成员集)).toBeNull();
    expect(市场视角of(org, "d", 市场成员集)).toBeNull();
    expect(市场视角of(org, "w", 市场成员集)).toBeNull();
    expect(市场视角of(null, "a", 市场成员集)).toBeNull();
    expect(市场视角of(org, "nobody", 市场成员集)).toBeNull();
  });

  it("圈：市场成员只有自己；市场管理 = 自己 + 实线下属逐级（虚线不算）", () => {
    expect(市场圈(org, "a", "市场成员")).toEqual(["a"]);
    expect(new Set(市场圈(org, "m", "市场管理"))).toEqual(new Set(["m", "a", "a2", "s"]));
  });

  it("业务线：实线下属业务线对不上的不进圈", () => {
    const 分线: 组织 = {
      成员: new Map([人("m", ["marketing_mgr"], { line: "国内" as never }), 人("x", [], { managerId: "m", line: "海外" as never }), 人("y", [], { managerId: "m" })]),
      部门: new Map(),
    };
    expect(new Set(市场圈(分线, "m", "市场管理"))).toEqual(new Set(["m", "y"]));
  });
});

describe("项目条件", () => {
  it("不在公海；负责的 ∪ 创建的且有负责人 ∪ 已加入组员", () => {
    expect(市场项目条件("a", ["a"])).toEqual({
      pooledAt: null,
      OR: [
        { ownerId: { in: ["a"] } },
        { creatorId: { in: ["a"] }, ownerId: { not: "" } },
        { members: { some: { userId: "a", inviteStatus: "JOINED" } } },
      ],
    });
  });

  it("创建人筛选只认圈里的人，圈外的当没筛", () => {
    expect(市场项目条件("m", ["m", "a"], "a")).toMatchObject({ creatorId: "a" });
    expect(市场项目条件("m", ["m", "a"], "zz")).not.toHaveProperty("creatorId");
    expect(市场项目条件("m", ["m", "a"], "")).not.toHaveProperty("creatorId");
  });
});

describe("只看进度 / 挡详情", () => {
  it("只看进度：负责人在圈里、我是组员、等我复核 → 能进；别的 → 只看进度", () => {
    expect(只看进度(["a"], "a", { ownerId: "a" })).toBe(false);
    expect(只看进度(["a"], "a", { ownerId: "s" })).toBe(true);
    expect(只看进度(["a"], "a", { ownerId: "s", 已加入: ["a"] })).toBe(false);
    expect(只看进度(["a"], "a", { ownerId: "s" }, true)).toBe(false);
  });

  it("挡详情：市场成员分出去的挡；市场管理看下属负责的不挡、圈外的挡；进了公海的不挡；不是市场视角不管", () => {
    expect(市场挡详情(org, "a", 市场成员集, { ownerId: "s", pooledAt: null })).toBe(true);
    expect(市场挡详情(org, "a", 市场成员集, { ownerId: "a", pooledAt: null })).toBe(false);
    expect(市场挡详情(org, "a", 市场成员集, { ownerId: "s", pooledAt: new Date() })).toBe(false);
    expect(市场挡详情(org, "m", 市场成员集, { ownerId: "a2", pooledAt: null })).toBe(false);
    expect(市场挡详情(org, "m", 市场成员集, { ownerId: "b", pooledAt: null })).toBe(true);
    expect(市场挡详情(org, "m", 市场成员集, { ownerId: "b", pooledAt: null }, true)).toBe(false);
    expect(市场挡详情(org, "s", 市场成员集, { ownerId: "d", pooledAt: null })).toBe(false);
    expect(市场挡详情(null, "a", 市场成员集, { ownerId: "s", pooledAt: null })).toBe(false);
  });
});
