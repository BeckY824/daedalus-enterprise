"use client";
/**
 * 「从回收站捞回」键（客户 11-05：「可以捞回且只有查重触发时可以捞回」）：查重说「回收站里有」时摆在提示里。
 * 建档向导、首页查重框共用；AI 建档卡片同一个服务端动作（customers/number-actions.ts 从回收站捞回）。
 * 捞回后客户回到原负责人名下（或原来的公海），把服务端重查的结论交给外面，外面照新结论摆
 * 结果就地写在键后面一行（原型 g.save / g.notice：不弹顶部提示）：捞回了灰字 status；已不在（没捞成）橙字 status；出错红字 alert
 */
import { useState } from "react";
import { Button, Popconfirm } from "antd";
import { 从回收站捞回, type 查号码结果 } from "./number-actions";
import { 动作出错话 } from "@/lib/stale-deploy";

export default function RescueKey({ 类型, 值, 捞回了 }: { 类型: string; 值: string; 捞回了: (查: 查号码结果) => void }) {
  const [忙, set忙] = useState(false);
  const [话, set话] = useState<{ 话: string; 级: "常" | "警" | "错" } | null>(null);
  async function 捞() {
    set忙(true);
    set话(null);
    try {
      const r = await 从回收站捞回(类型, 值);
      if (!r.ok) { set话({ 话: r.error, 级: "错" }); return; }
      set话({ 话: r.提示, 级: r.已不在 ? "警" : "常" }); // 没捞成，不用成功样式
      捞回了(r.查);
    } catch (出错) {
      set话({ 话: 动作出错话(出错, "没捞成，请稍后再试"), 级: "错" });
    } finally {
      set忙(false);
    }
  }
  return (
    <>
    <Popconfirm
      title="从回收站捞回"
      description="带这个号码的客户（连同联系人、项目、跟进）回到删除前的负责人名下或公海"
      okText="捞回"
      cancelText="再想想"
      onConfirm={() => void 捞()}
    >
      <Button size="small" loading={忙} data-testid="rescue-from-trash">从回收站捞回</Button>
    </Popconfirm>
    {话 && (
      <span role={话.级 === "错" ? "alert" : "status"} className={话.级 === "错" ? "cu-said cu-said-err" : 话.级 === "警" ? "cu-said cu-said-warn" : "cu-said"}>
        {话.话}
      </span>
    )}
    </>
  );
}
