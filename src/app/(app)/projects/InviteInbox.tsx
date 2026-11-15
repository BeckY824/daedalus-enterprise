"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Space, Tag } from "antd";
import { fmtDate } from "@/lib/utils";
import { 回项目邀请 } from "./actions";
import { showUndo } from "@/components/UndoBar";

export type 邀请行 = { id: string; projectId: string; 项目: string; 负责人: string; 邀请人: string; 角色: string | null; createdAt: string };

/**
 * 企业版：别人邀我进的项目组，在项目列表顶上等我点。同意前只露项目名、组长、谁邀的、角色；
 * 同意了直接打开项目；拒绝一步完成（原型 pr.invite）：这一条马上收起，6 秒内能撤销，6 秒后才真的记成没接受
 * （负责人那边显示「没接受」，不发通知）
 */
export default function InviteInbox({ 邀请们 }: { 邀请们: 邀请行[] }) {
  const router = useRouter();
  const [忙, set忙] = useState<string | null>(null);
  // 没回成的原因写在那一行下面（原型 g.notice：不弹顶部提示），再点一次时清掉
  const [错, set错] = useState<Record<string, string>>({});
  const 记错 = (id: string, 话: string | null) => set错((m) => { const n = { ...m }; if (话) n[id] = 话; else delete n[id]; return n; });
  const [收起的, set收起的] = useState<ReadonlySet<string>>(() => new Set());
  const 摆着 = 邀请们.filter((r) => !收起的.has(r.id));
  if (!摆着.length) return null;
  const 摆回 = (id: string) => set收起的((s) => { const n = new Set(s); n.delete(id); return n; });
  const 同意 = async (r: 邀请行) => {
    set忙(r.id);
    记错(r.id, null);
    try {
      const x = await 回项目邀请(r.id, true);
      // 同意了直接打开项目，项目页本身就是「已加入」的回执，不再弹顶部提示
      if (!x.ok) 记错(r.id, x.error ?? "没回成，请稍后再试");
      else router.push(`/projects/${r.projectId}`);
    } catch {
      记错(r.id, "没回成，请稍后再试");
    } finally {
      set忙(null);
    }
  };
  const 拒绝 = (r: 邀请行) => {
    set收起的((s) => new Set(s).add(r.id));
    记错(r.id, null);
    // 底部撤销条（PR5a）：到点才交；没交成撤销条上写原因，这一条摆回来
    // 只交一次：UndoBar 11-15 起已保证到点只调一次（收起动画里来新的一条、鼠标进出都不再重调），这里的 交过 只是双保险
    let 交过 = false;
    showUndo({
      话: `已拒绝「${r.项目}」`,
      毫秒: 6000,
      撤销: () => 摆回(r.id),
      到点: async () => {
        if (交过) return;
        交过 = true;
        try {
          const x = await 回项目邀请(r.id, false);
          if (x.ok) router.refresh(); else 摆回(r.id);
          return x;
        } catch (e) { 摆回(r.id); throw e; }
      },
    });
  };
  return (
    <Card title={`待我回的项目组邀请（${摆着.length}）`} size="small" style={{ marginBottom: 16 }}>
      {摆着.map((r) => (
        <div key={r.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
          <span style={{ flex: "1 1 240px", minWidth: 0 }}>
            <b>{r.项目}</b>
            <span style={{ color: "var(--text-muted)", marginLeft: 8 }}>组长 {r.负责人} · {r.邀请人} 邀请 · {fmtDate(r.createdAt)}</span>
            {r.角色 && <Tag style={{ marginLeft: 8 }}>{r.角色}</Tag>}
          </span>
          <Space>
            <Button type="primary" size="small" loading={忙 === r.id} disabled={!!忙} onClick={() => void 同意(r)}>同意</Button>
            <Button size="small" disabled={!!忙} onClick={() => 拒绝(r)}>拒绝</Button>
          </Space>
          {错[r.id] && <div role="alert" className="cd-task-err">{错[r.id]}</div>}
        </div>
      ))}
    </Card>
  );
}
