/**
 * 列表页自定义筛选（11-06）：默认筛选项不变，用户可以把收着的钉到外面、把外面的收起来，记在这台电脑上。
 * 存法和「列设置」一份（lib/list-select.ts）：显示的键 + 藏起来的默认项记成 `-键`，存完之后新加的默认项补上。
 */
import { describe, it, expect } from "vitest";
import { 拆筛选项, 切换外露, 筛选偏好键 } from "@/lib/custom-filters";

const 项 = [
  { 键: "owner", 默认外露: true, 有值: false },
  { 键: "status", 默认外露: true, 有值: true },
  { 键: "channelId", 默认外露: false, 有值: true },
  { 键: "grade", 默认外露: false, 有值: false },
];
const 键们 = (x: { 键: string }[]) => x.map((i) => i.键);

describe("拆筛选项", () => {
  it("没存过：外面就是系统默认的那几个，收着的不多不少", () => {
    const r = 拆筛选项(项, null);
    expect(键们(r.外露)).toEqual(["owner", "status"]);
    expect(键们(r.收着)).toEqual(["channelId", "grade"]);
  });

  it("按钮上的数字只数收着且有值的：外面的筛选自己看得见，不重复算", () => {
    expect(拆筛选项(项, null).筛了几个).toBe(1);
    expect(拆筛选项(项, ["owner", "status", "channelId"]).筛了几个).toBe(0);
    // 把正筛着的默认项收起来：值还在，要算进数字，不然人看不出还筛着
    expect(拆筛选项(项, ["owner", "-status"]).筛了几个).toBe(2);
  });

  it("钉出来的排在默认项后面，收起来的默认项不会被补回来", () => {
    expect(键们(拆筛选项(项, ["owner", "status", "channelId"]).外露)).toEqual(["owner", "status", "channelId"]);
    const r = 拆筛选项(项, ["owner", "-status"]);
    expect(键们(r.外露)).toEqual(["owner"]);
    expect(键们(r.收着)).toEqual(["status", "channelId", "grade"]);
  });

  it("存完之后系统新加的默认项补到外面；新加的非默认项收着", () => {
    const 新 = [...项, { 键: "新默认", 默认外露: true, 有值: false }, { 键: "新收着", 默认外露: false, 有值: false }];
    const r = 拆筛选项(新, ["owner", "-status"]);
    expect(键们(r.外露)).toEqual(["owner", "新默认"]);
    expect(键们(r.收着)).toContain("新收着");
  });

  it("存过但这个人现在没有的项（如换了权限）不出现，也不算数", () => {
    const r = 拆筛选项(项, ["owner", "status", "已经没了"]);
    expect(键们(r.外露)).toEqual(["owner", "status"]);
    expect(r.筛了几个).toBe(1);
  });
});

describe("切换外露", () => {
  it("钉上再取消：回到收着，存的那份能读回同样的结果", () => {
    const 钉 = 切换外露(["owner", "status"], null, "channelId", true);
    expect(钉).toEqual(["owner", "status", "channelId"]);
    expect(键们(拆筛选项(项, 钉).外露)).toEqual(["owner", "status", "channelId"]);
    const 取消 = 切换外露(["owner", "status", "channelId"], 钉, "channelId", false);
    expect(键们(拆筛选项(项, 取消).外露)).toEqual(["owner", "status"]);
  });

  it("收起默认项后还能再钉回来", () => {
    const 收 = 切换外露(["owner", "status"], null, "status", false);
    expect(键们(拆筛选项(项, 收).外露)).toEqual(["owner"]);
    const 回 = 切换外露(["owner"], 收, "status", true);
    expect(键们(拆筛选项(项, 回).外露)).toEqual(["owner", "status"]);
    expect(回).not.toContain("-status");
  });
});

it("每页一个偏好键，互不影响", () => {
  expect(筛选偏好键("customers")).toBe("list-filters:customers");
  expect(筛选偏好键("customers")).not.toBe(筛选偏好键("projects"));
});
