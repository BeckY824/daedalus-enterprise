"use client";

import { useState } from "react";
import { Button } from "antd";
import { DeleteOutlined } from "@ant-design/icons";
import { useRouter } from "next/navigation";
import InlineConfirm from "@/components/InlineConfirm";
import { showUndo } from "@/components/UndoBar";
import { useBusiness } from "@/lib/business-client";
import { deleteContact, deleteUnassignedContact, detachContact, restoreContact, undoDetachContact } from "./actions";
import { 动作出错话 } from "@/lib/stale-deploy";

/**
 * 拿掉一位联系人的两条路，客户详情和联系人页共用（2026-10-01 用户反馈）。
 *
 *   只移出   —— 客户详情上不再有他，联系人页里还在、写「未归属」，以后能挂到别的客户下面
 *   彻底删除 —— 联系人页里也没了（原来点删除就是这一条，用户删完才发现）
 *
 * 两条都给一次「撤销」（底部撤销条，原型 g.undo）：移出撤回去关键联系人原样回来；删除撤回去原来那几条跟进也接回来。
 * 没成：回 { ok:false, error }，调用方就地写原因（不弹顶部提示，原型 g.notice）。
 */
export function useContactRemoval() {
  const router = useRouter();

  async function 移出(c: { id: string; name: string }) {
    const r = await detachContact(c.id);
    if (!r.ok) return r;
    router.refresh();
    showUndo({
      话: `「${c.name}」已移出，联系人页里还留着`,
      毫秒: 6000,
      撤销: async () => {
        const u = await undoDetachContact(c.id, r.原来是关键);
        router.refresh();
        return u;
      },
    });
    return { ok: true };
  }

  /** `未归属` = 联系人页上那种从客户上移出过的人，删的是另一张表 */
  async function 彻底删(c: { id: string; name: string; 未归属?: boolean }) {
    const r = c.未归属 ? await deleteUnassignedContact(c.id) : await deleteContact(c.id);
    router.refresh();
    if (!r.ok) return r;
    showUndo({
      话: `「${c.name}」已删除`,
      毫秒: 6000,
      撤销: async () => {
        const u = await restoreContact(r.快照);
        router.refresh();
        return u;
      },
    });
    return { ok: true };
  }

  return { 移出, 彻底删 };
}

/**
 * 客户详情上联系人那颗「删除」：原地确认（P-界面-40「移出或彻底删联系人」归原地确认），不弹框。
 * 两颗键各自就地问一句：「移出」更不伤数据（中性色），「删除」连联系人页一起删（红）。
 * 没成：原因写在这两颗键后面一行（role=alert），几秒后收。
 */
/** 只删：公海里（移出走 客户事项挡 会被拒）只给「删除」一颗，删除挡放行的人（系统管理员）照常能删（#403 审查） */
export function ContactRemoveInline({ c, 文字 = false, 只删 = false }: { c: { id: string; name: string }; 文字?: boolean; 只删?: boolean }) {
  const { 移出, 彻底删 } = useContactRemoval();
  const b = useBusiness();
  const [错, set错] = useState<string | null>(null);
  const 跑 = async (f: () => Promise<{ ok: boolean; error?: string | null }>) => {
    set错(null);
    const r = await f().catch((出错) => ({ ok: false, error: 动作出错话(出错, "没做成，请刷新后重试") }));
    if (!r.ok) {
      const 话 = r.error || "没做成，请刷新后重试";
      set错(话);
      setTimeout(() => set错(null), 6000);
    }
    return r;
  };
  return (
    <>
      {!只删 && (
        <InlineConfirm 问={`联系人页里还留着，以后能挂到别的${b.customer}`} 是="只移出" 中性 做={() => 跑(() => 移出(c))}>
          <Button type="text" size="small" aria-label={`移出联系人 ${c.name}`}>移出</Button>
        </InlineConfirm>
      )}
      <InlineConfirm 问="联系人页里也一起删掉，沟通记录不删" 是="彻底删除" 做={() => 跑(() => 彻底删(c))}>
        {文字
          ? <Button size="small" type="text" danger aria-label={`删除联系人 ${c.name}`}>删除</Button>
          : <Button type="text" size="small" danger icon={<DeleteOutlined />} aria-label={`删除联系人 ${c.name}`} />}
      </InlineConfirm>
      {错 && <span role="alert" className="cd-task-err">{错}</span>}
    </>
  );
}
