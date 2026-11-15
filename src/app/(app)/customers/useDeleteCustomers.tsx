"use client";

import { 合计文字 } from "@/lib/currency";
import { App } from "antd";
import { useRouter } from "next/navigation";
import { useBusiness } from "@/lib/business-client";
import { 签约叫 } from "@/lib/business-config";
import { 问后果 } from "@/components/dialog-host";
import type { 后果条 } from "@/components/ConsequenceDialog";
import { deleteCustomers, 删除前清点, 客户删除预检, type 删除清点 } from "./actions";

/** 框的标题：动作 + 那几位（后果框口径，不写「确认……？」）。名字太长由框自己折行 */
export function 删除框标题(名字: string[], 人数: number, 叫法: string): string {
  const 有名 = 名字.filter(Boolean);
  if (人数 === 1 && 有名[0]) return `删除「${有名[0]}」`;
  return `删除 ${人数} 位${叫法}`;
}

/** 名单一行写不下：前三位 + 等 N 位 */
const 名单 = (名字: string[], 叫法: string) =>
  名字.length > 3 ? `${名字.slice(0, 3).join("、")} 等 ${名字.length} 位${叫法}` : 名字.join("、");

/**
 * 删客户的确认（单条、批量共用）。2026-10-02 排查 B1。
 *
 * 原来只写「其跟进记录、待办与签约记录将一并删除」——实际还删商机、计划、跟进原文，
 * 单条删除连「不可恢复」都没写，和那条「删联系人，联系人页也没了」是同一类：删完才发现。
 * 现在先数一遍，照实说会一起删掉什么、什么会留下（联系人搬进未归属）。
 * 有签约的多拦一道：签约删了，数据页的历史业绩跟着少，得勾一下才能删。
 * 11-15 前端改版（原型 cu.delete / cu.bulkdel）：换成后果框（P-界面-40「删客户」= 后果确认框，用户 11-15「删除还是要二次确认」），
 * 后果分条；删这件事在框里做，没删成原因写在框里、框不关，不再弹顶部提示。
 * 批量里有删不了的（不是自己负责的）：不再整批拦下，框里写明「跳过」谁，删其余的（跳过 = 只传给框看，不交给服务端）。
 */
export function useDeleteCustomers() {
  const { message } = App.useApp();
  const router = useRouter();
  const b = useBusiness();

  async function 问删除(rows: { id: string; name: string }[], 删完?: () => void, 跳过: { id: string; name: string }[] = []) {
    const ids = rows.map((r) => r.id);
    if (!ids.length) return;
    let 数: 删除清点;
    try {
      const preflight = await 客户删除预检(ids);
      // 预检挡住（名下有同事在推的项目、交接中……）：框还没开，原因只能放在这一句提示里
      if (!preflight.ok) return void message.error(preflight.error, 8);
      数 = await 删除前清点(ids);
    } catch {
      return void message.error("没数清楚会一起删掉什么，先别删，刷新再试");
    }

    const 题 = 删除框标题(rows.map((r) => r.name), rows.length, b.customer);
    const 跳过条: 后果条[] = 跳过.length
      ? [{ 标: "跳过", 话: `${名单(跳过.map((r) => r.name), b.customer)} · 不是你负责的，留在原处` }]
      : [];
    const 做 = async () => {
      const res = await deleteCustomers(ids);
      if (!res.ok) return res;
      删完?.();
      router.refresh();
    };

    // 企业版（P9）：删了进回收站，照实说能恢复，签约不用另勾
    if (数.进回收站) {
      const 一起进 = [
        数.联系人 && `${数.联系人} 位联系人`,
        数.项目 && `${数.项目} 个项目`,
        数.跟进 && `${数.跟进} 条沟通记录`,
      ].filter(Boolean);
      await 问后果({
        题,
        宽: 480,
        后果: [
          ...(rows.length > 1 ? [{ 标: "会删", 级: "警" as const, 话: 名单(rows.map((r) => r.name), b.customer) }] : []),
          ...(一起进.length ? [{ 标: "一起走", 级: "警" as const, 话: `${一起进.join("、")}进回收站` }] : []),
          ...跳过条,
          { 标: "能恢复", 话: "30 天内在 设置 → 回收站 恢复，过期自动清掉" },
        ],
        是: rows.length > 1 ? `删除 ${rows.length} 位` : "删除",
        做,
      });
      return;
    }

    const 一起删 = [
      数.跟进 && `${数.跟进} 条跟进记录`,
      数.计划和待办 && `${数.计划和待办} 条计划和待办`,
    ].filter(Boolean);
    const 有签约 = 数.签约 > 0;
    const 签 = 签约叫(b);
    await 问后果({
      题,
      宽: 480,
      后果: [
        ...(一起删.length ? [{ 标: "一起删", 级: "危" as const, 话: 一起删.join("、") }] : []),
        ...(有签约
          ? [{ 标: "业绩少", 级: "危" as const, 话: `${数.签约} 笔${签}（${合计文字(数.签约金额)}），数据页的业绩会跟着少${签 === "订单" ? "，订单和挂在上面的记录也一起删" : ""}` }]
          : []),
        ...(数.联系人 > 0 ? [{ 标: "留下", 话: `${数.联系人} 位联系人不删，留在联系人页，写「未归属」` }] : []),
        ...(数.线索 > 0 ? [{ 标: "退回", 话: `${数.线索} 条线索还在，退回「跟进中」，之后可以再转` }] : []),
        ...跳过条,
        { 标: "不能恢复", 级: "危", 话: "删除后不能恢复" },
      ],
      须知: 有签约 ? `我知道${签}也会删掉` : undefined,
      是: rows.length > 1 ? `删除 ${rows.length} 位` : "删除",
      做,
    });
  }

  return { 问删除 };
}
