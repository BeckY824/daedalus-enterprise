/**
 * 订单节点超期提醒（2026-10-03 外贸第 3b 块）——纯函数这一层。
 *   - 算提醒：订单节点单独数（超期 = 截止日在今天之前或卡住；今天 = 今天到期），点名最久的那一单那一步
 *   - 盯盘：订单超期一类，排在逾期计划前面，点理由直达那张订单那一步
 * 订单节点开关 2026-10-28 删了：库里不再取订单提醒项（/api/desktop/reminders 回包里订单恒为 0、盯盘不取订单），
 * 「从库里取」那一段跟着删；纯函数照旧认这个形状，这里继续钉着（壳那一半在桌面端仓库里钉）
 */
import { describe, it, expect } from "vitest";
import { 算提醒, type 订单提醒项 } from "@/lib/reminders";
import { buildWatchlist } from "@/lib/sentinel";

const 现在 = new Date(2026, 9, 10, 9, 30);
const 日 = (d: number, h = 23) => new Date(2026, 9, 10 + d, h, 59);
const 节 = (p: Partial<订单提醒项>): 订单提醒项 => ({ orderId: "o", no: "A-1", 节点: "订舱", 时间: null, 卡住: false, ...p });

describe("算提醒：订单节点", () => {
  it("超期 = 截止日在今天之前或卡住；今天 = 今天到期；明天的不算；点名最久的", () => {
    const r = 算提醒([], 现在, [
      节({ 时间: 日(-1), 节点: "收定金", no: "A-1" }),
      节({ 时间: 日(-4), 节点: "订舱", no: "B-2" }),
      节({ 卡住: true }),
      节({ 时间: 日(0) }),
      节({ 时间: 日(1) }),
    ]);
    expect(r.订单).toEqual({ 超期: 3, 今天: 1, 最久: { no: "B-2", 节点: "订舱", 天: 4 } });
    // 跟进那两个数不受影响
    expect([r.逾期, r.今天]).toEqual([0, 0]);
  });

  it("没有订单：全是 0", () => {
    expect(算提醒([], 现在).订单).toEqual({ 超期: 0, 今天: 0, 最久: null });
  });
});

describe("盯盘：订单超期", () => {
  const 空 = { overduePlans: [], customers: [], opportunities: [] };
  it("超期的节点进来、排在逾期计划前面；卡住的不论截止日；今天到期的不算超期", () => {
    const items = buildWatchlist(
      {
        ...空,
        overduePlans: [{ customerId: "c2", customerName: "Bolt", ownerName: "我", subject: "回电", plannedAt: 日(-5, 10) }],
        lateOrderNodes: [
          { orderId: "o1", orderNo: "A-1", idx: 9, nodeName: "订舱", dueAt: 日(-2), 卡住: false, customerId: "c1", customerName: "Acme", ownerName: "我" },
          { orderId: "o3", orderNo: "C-1", idx: 7, nodeName: "生产跟进", dueAt: null, 卡住: true, customerId: "c3", customerName: "Cato", ownerName: "我" },
          { orderId: "o4", orderNo: "D-1", idx: 5, nodeName: "收定金", dueAt: 日(0), 卡住: false, customerId: "c4", customerName: "Dune", ownerName: "我" },
        ],
      },
      现在,
    );
    expect(items.map((x) => [x.kind, x.customerName])).toEqual([
      ["order_late", "Acme"],
      ["order_late", "Cato"],
      ["overdue_plan", "Bolt"],
    ]);
    expect(items[0]).toMatchObject({ reason: "订单 A-1 第 9 步「订舱」已超期 2 天", href: "/orders/o1?node=9" });
    expect(items[1].reason).toBe("订单 C-1 卡在第 7 步「生产跟进」");
  });
});
