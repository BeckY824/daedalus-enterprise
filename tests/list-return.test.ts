/**
 * 列表记住位置 + 「回到列表」（员工反馈 1A，lib/list-return.ts）：纯函数和读写。
 * 真浏览器里回来后筛选、页码、滚动还在，见 e2e-ent/list-return.spec.ts。
 * 这里没有 window：读写走模块里的内存兜底（和存储被禁时同一条路）。
 */
import { describe, it, expect } from "vitest";
import { 列表种of, 是详情页, 页码of, 回列表文字, 记地址, 地址快照, 解析地址们, 订阅地址, 读滚动, 记滚动, 读勾选, 记勾选, 记横滚, 当前列表地址 } from "@/lib/list-return";

describe("认路径", () => {
  it("三张列表：客户 / 公海 / 项目；子路径、别的页都不算", () => {
    expect(列表种of("/customers")).toBe("客户");
    expect(列表种of("/pool")).toBe("公海");
    expect(列表种of("/projects")).toBe("项目");
    for (const p of ["/customers/abc", "/projects/new", "/pool/x", "/dashboard", "/leads", "/customersX", ""]) expect(列表种of(p)).toBeNull();
  });

  it("详情页：客户详情、项目详情；项目的新建 / 交接 / 挂靠不算", () => {
    expect(是详情页("/customers/c1")).toBe(true);
    expect(是详情页("/projects/p1")).toBe(true);
    for (const p of ["/projects/new", "/projects/handover", "/projects/attach", "/customers", "/customers/c1/x", "/pool", null, undefined]) expect(是详情页(p)).toBe(false);
  });
});

describe("页码和文字", () => {
  it("页码：没写、乱写、第 1 页都是 1", () => {
    expect(页码of("/customers")).toBe(1);
    expect(页码of("/customers?page=7&keyword=a")).toBe(7);
    expect(页码of("/customers?page=abc")).toBe(1);
    expect(页码of("/customers?page=-3")).toBe(1);
    expect(页码of("/customers?page=2.5")).toBe(1);
  });

  it("「回到客户列表（第 7 页）」；第 1 页不写页码；客户跟着业务叫法；公海、项目", () => {
    expect(回列表文字("客户", "/customers?page=7")).toBe("回到客户列表（第 7 页）");
    expect(回列表文字("客户", "/customers?keyword=a")).toBe("回到客户列表");
    expect(回列表文字("客户", "/customers", "学员")).toBe("回到学员列表");
    expect(回列表文字("公海", "/pool?page=3")).toBe("回到公海（第 3 页）");
    expect(回列表文字("项目", "/projects")).toBe("回到项目列表");
  });
});

describe("记地址", () => {
  it("每种记最近一次的完整地址（筛选、排序、页码、页签原样），最近看的那种记成「最近」；变了才通知", () => {
    let 次 = 0;
    const 退 = 订阅地址(() => 次++);
    记地址("客户", "/customers?keyword=%E5%BC%A0&sort=level-desc&page=3&pageSize=20");
    记地址("公海", "/pool?tab=project&page=2");
    expect(次).toBe(2);
    记地址("公海", "/pool?tab=project&page=2");
    expect(次).toBe(2);
    const 表 = 解析地址们(地址快照());
    expect(表.客户).toBe("/customers?keyword=%E5%BC%A0&sort=level-desc&page=3&pageSize=20");
    expect(表.公海).toBe("/pool?tab=project&page=2");
    expect(表.最近).toBe("公海");
    记地址("客户", "/customers?page=4");
    expect(解析地址们(地址快照())).toMatchObject({ 客户: "/customers?page=4", 公海: "/pool?tab=project&page=2", 最近: "客户" });
    退();
  });

  it("不是这种列表的地址不记（防把人带去别处）；坏数据当没记", () => {
    记地址("客户", "https://evil.example/customers");
    记地址("客户", "/pool?page=9");
    记地址("公海", "/customers/abc");
    expect(解析地址们(地址快照()).客户).toBe("/customers?page=4");
    expect(解析地址们("not json")).toEqual({});
    expect(解析地址们("[1,2]")).toEqual({});
    expect(解析地址们(JSON.stringify({ 客户: "//evil.example", 公海: 3, 最近: "项目" }))).toEqual({});
  });
});

describe("记滚动", () => {
  it("按种记位置和当时的地址；取整、负数当 0；没记过 = null", () => {
    expect(读滚动("项目")).toBeNull();
    记滚动("客户", "/customers?page=4", 1234.6);
    expect(读滚动("客户")).toEqual({ href: "/customers?page=4", y: 1235 });
    记滚动("公海", "/pool", -5);
    expect(读滚动("公海")).toEqual({ href: "/pool", y: 0 });
    expect(读滚动("客户")).toEqual({ href: "/customers?page=4", y: 1235 });
  });
});

describe("勾选和横滚（29R：进详情再回来、刷新后还原）", () => {
  it("同一张表、同一个地址读回勾选；地址不一样不还原；别的表互不影响", () => {
    记勾选("customers", "/customers?page=2", ["c1", "c2"]);
    expect(读勾选("customers", "/customers?page=2")).toEqual({ href: "/customers?page=2", ids: ["c1", "c2"], x: 0 });
    expect(读勾选("customers", "/customers?page=3")).toBeNull();
    expect(读勾选("pool", "/customers?page=2")).toBeNull();
    记勾选("pool", "/pool", ["p1"]);
    expect(读勾选("customers", "/customers?page=2")?.ids).toEqual(["c1", "c2"]);
    expect(读勾选("pool", "/pool")?.ids).toEqual(["p1"]);
  });

  it("横滚位置：同一个地址上和勾选互相留着；换了地址另起一份（勾选清空）", () => {
    记勾选("ent-projects", "/projects?keyword=a", ["x1"]);
    记横滚("ent-projects", "/projects?keyword=a", 312.6);
    expect(读勾选("ent-projects", "/projects?keyword=a")).toEqual({ href: "/projects?keyword=a", ids: ["x1"], x: 313 });
    记勾选("ent-projects", "/projects?keyword=a", ["x1", "x2"]);
    expect(读勾选("ent-projects", "/projects?keyword=a")?.x).toBe(313);
    记横滚("ent-projects", "/projects?keyword=b", 80);
    expect(读勾选("ent-projects", "/projects?keyword=b")).toEqual({ href: "/projects?keyword=b", ids: [], x: 80 });
    expect(读勾选("ent-projects", "/projects?keyword=a")).toBeNull();
    // 负数、NaN 当 0；取消全部勾选也记下（回来不再冒出旧勾选）
    记横滚("ent-projects", "/projects?keyword=b", Number.NaN);
    expect(读勾选("ent-projects", "/projects?keyword=b")?.x).toBe(0);
    记勾选("ent-projects", "/projects?keyword=b", []);
    expect(读勾选("ent-projects", "/projects?keyword=b")?.ids).toEqual([]);
  });

  it("没有 window（服务端）：当前地址是空串，不抛", () => {
    expect(当前列表地址()).toBe("");
  });
});
