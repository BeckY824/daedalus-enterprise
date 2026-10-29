"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { App, Button, Card, Input, Modal, Space, Tag } from "antd";
import { fmtDate } from "@/lib/utils";
import { 原因上限 } from "@/lib/project/nodes";
import { 市场复核Action, 总管理终判Action } from "./actions";

export type 待复核行 = {
  projectId: string; 项目: string; 负责人: string; 步: "市场复核" | "销售终验" | "总管理终判" | "销售认领";
  无效原因: string | null; 初判说明: string | null; 复核说明: string | null; 异议说明: string | null; 更新于: string;
};

const 步叫法: Record<待复核行["步"], string> = { 市场复核: "市场复核", 总管理终判: "总管理终判", 销售终验: "复核判有效，等你终验", 销售认领: "总管理判有效，等你认领" };

/**
 * 企业版线索验证（P12）：项目列表 / 新线索页顶上「待复核的线索」，和项目组邀请放一块。
 * 复核两步（市场管理、总管理）在这里直接判；销售终验、认领要看详情，给链接
 */
export default function VerifyInbox({ 们 }: { 们: 待复核行[] }) {
  const router = useRouter();
  const { message } = App.useApp();
  const [忙, set忙] = useState(false);
  const [框, set框] = useState<{ r: 待复核行; 有效: boolean } | null>(null);
  const [说明, set说明] = useState("");
  if (!们.length) return null;
  const 判 = async () => {
    if (!框) return;
    set忙(true);
    try {
      const act = 框.r.步 === "总管理终判" ? 总管理终判Action : 市场复核Action;
      const x = await act(框.r.projectId, 框.有效, 说明);
      if (!x.ok) message.error(x.error ?? "没判成，请稍后再试");
      else {
        message.success(框.有效 ? "已判有效，交回负责人" : "已判无效线索");
        set框(null);
        router.refresh();
      }
    } catch {
      message.error("没判成，请稍后再试");
    } finally {
      set忙(false);
    }
  };
  return (
    <Card title={`待复核的线索（${们.length}）`} size="small" style={{ marginBottom: 16 }} data-testid="verify-inbox">
      {们.map((r) => {
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
                <Button type="primary" size="small" disabled={忙} onClick={() => { set说明(""); set框({ r, 有效: true }); }}>判有效</Button>
                <Button danger size="small" disabled={忙} onClick={() => { set说明(""); set框({ r, 有效: false }); }}>判无效</Button>
              </Space>
            ) : (
              <Link href={`/projects/${r.projectId}`}><Button size="small">去处理</Button></Link>
            )}
          </div>
        );
      })}
      <Modal
        open={!!框}
        title={框 ? `${框.r.步}：判${框.有效 ? "有效" : "无效"}` : ""}
        okText="确定"
        okButtonProps={{ loading: 忙, danger: !!框 && !框.有效 }}
        onCancel={() => set框(null)}
        onOk={() => void 判()}
      >
        <div style={{ marginBottom: 8, color: "var(--text-muted)", overflowWrap: "anywhere" }}>
          「{框?.r.项目}」{框?.有效 ? "判有效会交回负责人继续跟。" : "判无效后这条线索结束（记为线索流失），负责人本月自动分配名额 +1。"}
        </div>
        <Input.TextArea rows={4} maxLength={原因上限} showCount value={说明} onChange={(e) => set说明(e.target.value)} placeholder="复核说明（可不写）" aria-label="复核说明" />
      </Modal>
    </Card>
  );
}
