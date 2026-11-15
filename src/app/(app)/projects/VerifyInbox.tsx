"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, Input, Modal, Space, Tag } from "antd";
import { fmtDate } from "@/lib/utils";
import { 原因上限 } from "@/lib/project/nodes";
import { 市场复核Action, 总管理终判Action } from "./actions";
import { useUndoLater } from "./useUndoLater";

export type 待复核行 = {
  projectId: string; 项目: string; 负责人: string; 步: "市场复核" | "销售终验" | "总管理终判" | "销售认领";
  无效原因: string | null; 初判说明: string | null; 复核说明: string | null; 异议说明: string | null; 更新于: string;
};

// 只写这一步要你做什么，不露内部步骤名（终验、终判这类，规则 F）
const 步叫法: Record<待复核行["步"], string> = { 市场复核: "等你复核", 总管理终判: "有异议，等你判定", 销售终验: "复核判有效，等你确认", 销售认领: "已判有效，等你认领" };

/**
 * 企业版线索验证（P12）：项目列表 / 新线索页顶上「待复核的线索」，和项目组邀请放一块。
 * 复核两步（市场管理、总管理）在这里直接判；销售终验、认领要看详情，给链接。
 * 判有效一步完成（原型 pr.verify，P-界面-40）：这一条马上收起，6 秒内能撤销、也能「补一句」复核说明，6 秒后才交给服务端；
 * 判无效照旧先弹框确认（会记线索流失、补额度）
 */
export default function VerifyInbox({ 们 }: { 们: 待复核行[] }) {
  const router = useRouter();
  const [忙, set忙] = useState(false);
  // 没判成的原因：一行一行写在那一行下面；说明框里的写在框里（原型 g.notice：不弹顶部提示）
  const [错, set错] = useState<Record<string, string>>({});
  const [框错, set框错] = useState("");
  const 记错 = (id: string, 话: string | null) => set错((m) => { const n = { ...m }; if (话) n[id] = 话; else delete n[id]; return n; });
  const [框, set框] = useState<{ r: 待复核行; 有效: boolean } | null>(null);
  const [说明, set说明] = useState("");
  const [收起的, set收起的] = useState<ReadonlySet<string>>(() => new Set());
  const 稍后交 = useUndoLater();
  const 摆着 = 们.filter((r) => !收起的.has(r.projectId));
  if (!摆着.length && !框) return null;
  const 摆回 = (id: string) => set收起的((s) => { const n = new Set(s); n.delete(id); return n; });
  const 动作of = (r: 待复核行) => (r.步 === "总管理终判" ? 总管理终判Action : 市场复核Action);
  const 判有效 = (r: 待复核行) => {
    记错(r.projectId, null);
    set收起的((s) => new Set(s).add(r.projectId));
    稍后交(`verify-${r.projectId}`, {
      文字: "已判有效，交回负责人",
      撤: () => 摆回(r.projectId),
      // 补一句：不再等计时，开原来那个说明框（判有效），写完点确定才交
      另一钮: { 字: "补一句", 点: () => { 摆回(r.projectId); set说明(""); set框错(""); set框({ r, 有效: true }); } },
      交: () => {
        void 动作of(r)(r.projectId, true, "").then(
          (x) => {
            if (x.ok) return router.refresh();
            摆回(r.projectId);
            记错(r.projectId, x.error ?? "没判成，请稍后再试");
          },
          () => { 摆回(r.projectId); 记错(r.projectId, "没判成，请稍后再试"); },
        );
      },
    });
  };
  const 判 = async () => {
    if (!框) return;
    set忙(true);
    set框错("");
    try {
      const act = 动作of(框.r);
      const x = await act(框.r.projectId, 框.有效, 说明);
      if (!x.ok) set框错(x.error ?? "没判成，请稍后再试");
      else {
        // 成了：框关、这一行收起，就是回执（不弹顶部提示）
        const id = 框.r.projectId;
        set收起的((s) => new Set(s).add(id));
        set框(null);
        router.refresh();
      }
    } catch {
      set框错("没判成，请稍后再试");
    } finally {
      set忙(false);
    }
  };
  return (
    <Card title={`待复核的线索（${摆着.length}）`} size="small" style={{ marginBottom: 16 }} data-testid="verify-inbox">
      {摆着.map((r) => {
        const 复核 = r.步 === "市场复核" || r.步 === "总管理终判";
        const 附 = [r.无效原因 ? `无效原因：${r.无效原因}` : null, r.初判说明, r.步 === "总管理终判" && r.异议说明 ? `异议：${r.异议说明}` : null, r.步 === "销售终验" && r.复核说明 ? `复核说明：${r.复核说明}` : null].filter(Boolean).join(" · ");
        return (
          <div key={r.projectId} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }} data-testid={`verify-row-${r.projectId}`}>
            <span style={{ flex: "1 1 240px", minWidth: 0, overflowWrap: "anywhere" }}>
              <Link href={`/projects/${r.projectId}`}><b>{r.项目}</b></Link>
              <Tag style={{ marginLeft: 8 }} color={复核 ? "orange" : "blue"}>{步叫法[r.步]}</Tag>
              <span style={{ color: "var(--text-muted)" }}>负责人 {r.负责人 || "已不在的成员"} · {fmtDate(r.更新于)}</span>
              {附 && <div style={{ color: "var(--text-muted)", fontSize: 12 }}>{附}</div>}
            </span>
            {复核 ? (
              <Space>
                <Button type="primary" size="small" disabled={忙} onClick={() => 判有效(r)}>判有效</Button>
                <Button danger size="small" disabled={忙} onClick={() => { 记错(r.projectId, null); set说明(""); set框错(""); set框({ r, 有效: false }); }}>判无效</Button>
              </Space>
            ) : (
              <Link href={`/projects/${r.projectId}`}><Button size="small">去处理</Button></Link>
            )}
            {错[r.projectId] && <div role="alert" className="cd-task-err">{错[r.projectId]}</div>}
          </div>
        );
      })}
      <Modal
        open={!!框}
        title={框 ? `判${框.有效 ? "有效" : "无效"}` : ""}
        okText="确定"
        okButtonProps={{ loading: 忙, danger: !!框 && !框.有效 }}
        onCancel={() => set框(null)}
        onOk={() => void 判()}
      >
        <div style={{ marginBottom: 8, color: "var(--text-muted)", overflowWrap: "anywhere" }}>
          「{框?.r.项目}」{框?.有效 ? "判有效会交回负责人继续推进。" : "判无效后这条线索结束（记为线索流失）；现负责人的分配占过额度的（自动、指定都算，不限哪个月），给他本月补回 1 个；随客户分到的、转来的、没分配记录的、没设配额的不补。"}
        </div>
        <Input.TextArea rows={4} maxLength={原因上限} showCount value={说明} onChange={(e) => set说明(e.target.value)} placeholder="复核说明（可不写）" aria-label="复核说明" />
        {框错 && <div role="alert" className="csq-err">{框错}</div>}
      </Modal>
    </Card>
  );
}
