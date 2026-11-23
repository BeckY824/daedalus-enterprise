"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, Input, Modal, Space, Tag } from "antd";
import { fmtDate, smartTime } from "@/lib/utils";
import { 原因上限 } from "@/lib/project/nodes";
import { 市场复核Action, 总管理终判Action } from "./actions";
import { showUndo } from "@/components/UndoBar";
import { 动作出错话 } from "@/lib/stale-deploy";
import { useFormDraft } from "@/components/FormDraft";

export type 待复核行 = {
  projectId: string; 项目: string; 负责人: string; 步: "市场复核" | "销售终验" | "总管理终判" | "销售认领";
  无效原因: string | null; 初判说明: string | null; 复核说明: string | null; 异议说明: string | null; 更新于: string;
};

// 只写这一步要你做什么，不露内部步骤名（终验、终判这类，规则 F）
const 步叫法: Record<待复核行["步"], string> = { 市场复核: "等你复核", 总管理终判: "有异议，等你判定", 销售终验: "复核判有效，等你确认", 销售认领: "已判有效，等你认领" };

/**
 * 企业版线索验证（P12）：项目列表 / 新线索页顶上「待复核的线索」，和项目组邀请放一块。
 * 复核两步（市场管理、总管理）在这里直接判；销售终验、认领要看详情，给链接。
 * 判有效一步完成（原型 pr.verify，P-界面-40）：这一条马上收起，底部撤销条（全站同一条，g.undo）6 秒内能撤销、
 * 也能「补一句」复核说明，6 秒后才交给服务端（到点才做：撤销 = 不交）；判无效照旧先弹框确认（会记线索流失、补额度）
 */
export default function VerifyInbox({ 们, 首页 = false }: {
  们: 待复核行[];
  /**
   * 摆在首页顶部待办里（dashboard/page.tsx）。设计语言 H-A（11-21，H-新7 / 新12）：首页不再是带表头的卡，
   * 每条一行，和「待回复客户」「待分配新线索」同一种行（home-cth-todo）：标签 + 项目名｜负责人 · smartTime · 附言｜判有效 / 判无效；
   * 时间不掉行、不截（窄屏整句折行）。新线索页、项目页顶上照旧是卡
   */
  首页?: boolean;
}) {
  const router = useRouter();
  const [忙, set忙] = useState(false);
  // 没判成的原因：一行一行写在那一行下面；说明框里的写在框里（原型 g.notice：不弹顶部提示）
  const [错, set错] = useState<Record<string, string>>({});
  const [框错, set框错] = useState("");
  const 记错 = (id: string, 话: string | null) => set错((m) => { const n = { ...m }; if (话) n[id] = 话; else delete n[id]; return n; });
  const [框, set框] = useState<{ r: 待复核行; 有效: boolean } | null>(null);
  const [说明, set说明] = useState("");
  const [收起的, set收起的] = useState<ReadonlySet<string>>(() => new Set());
  /**
   * 点了「补一句」的那几条：撤销条的「另一个动作」点下去会先按到点收条（UndoBar：先调 到点、紧接着同步调 另一个动作），
   * 所以 到点 把真交推到下一个微任务、交之前看一眼这里——补一句的这一次不交，等说明框点确定带着说明交
   */
  const 补一句的 = useRef(new Set<string>());
  // 复核说明打了没交的字留草稿（复盘第 1 类）：按项目 + 判有效 / 无效分；判成了、点取消就删
  const 稿 = useFormDraft({ 键: 框 ? `复核说明:${框.r.projectId}:${框.有效 ? "有效" : "无效"}` : null, 开: !!框, 值: { 说明 }, 带回: (v) => { if (v.说明 !== undefined) set说明(v.说明); } });
  const 摆着 = 们.filter((r) => !收起的.has(r.projectId));
  if (!摆着.length && !框) return null;
  const 摆回 = (id: string) => set收起的((s) => { const n = new Set(s); n.delete(id); return n; });
  const 动作of = (r: 待复核行) => (r.步 === "总管理终判" ? 总管理终判Action : 市场复核Action);
  const 判有效 = (r: 待复核行) => {
    const id = r.projectId;
    记错(id, null);
    补一句的.current.delete(id);
    set收起的((s) => new Set(s).add(id));
    // 只交一次：UndoBar 11-15 起已保证到点只调一次（收起动画里来新的一条、鼠标进出都不再重调），这里的 交过 只是双保险
    let 交过 = false;
    showUndo({
      话: `「${r.项目}」已判有效，交回负责人`,
      毫秒: 6000,
      // 到点才交：撤销 = 不交，这一条摆回来
      撤销: () => { 摆回(id); },
      到点: () => Promise.resolve().then(async () => {
        if (交过) return;
        交过 = true;
        if (补一句的.current.delete(id)) return;
        try {
          const x = await 动作of(r)(id, true, "");
          if (x.ok) return void router.refresh();
          // 没判成：这一条摆回来、原因写在行下面；撤销条上也写「没做成：原因」（换了页也看得见）
          摆回(id);
          记错(id, x.error ?? "没判成，请稍后再试");
          return x;
        } catch (出错) {
          摆回(id);
          记错(id, 动作出错话(出错, "没判成，请稍后再试"));
          return { ok: false, error: 动作出错话(出错, "没判成，请稍后再试") };
        }
      }),
      // 补一句：这一次不交，开原来那个说明框（判有效），写完点确定才带着说明交
      另一个动作: { 话: "补一句", 做: () => { 补一句的.current.add(id); 摆回(id); set说明(""); set框错(""); set框({ r, 有效: true }); } },
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
        稿.存好了();
        set收起的((s) => new Set(s).add(id));
        set框(null);
        router.refresh();
      }
    } catch (出错) {
      set框错(动作出错话(出错, "没判成，请稍后再试"));
    } finally {
      set忙(false);
    }
  };
  const 附言of = (r: 待复核行) => [r.无效原因 ? `无效原因：${r.无效原因}` : null, r.初判说明, r.步 === "总管理终判" && r.异议说明 ? `异议：${r.异议说明}` : null, r.步 === "销售终验" && r.复核说明 ? `复核说明：${r.复核说明}` : null].filter(Boolean).join(" · ");
  const 判框 = (
    <Modal
      open={!!框}
      title={框 ? `判${框.有效 ? "有效" : "无效"}` : ""}
      okText="确定"
      okButtonProps={{ loading: 忙, danger: !!框 && !框.有效 }}
      onCancel={() => { 稿.丢掉(); set框(null); }}
      onOk={() => void 判()}
    >
      {稿.提示}
      <div style={{ marginBottom: 8, color: "var(--text-muted)", overflowWrap: "anywhere" }}>
        「{框?.r.项目}」{框?.有效 ? "判有效会交回负责人继续推进。" : "判无效后这条线索结束（记为线索流失）；现负责人占过名额的（自动、指定都算，不限月；补发来的也算）记 1 个判无效待补，下一条自动分配优先补发给他；随客户分到的、转来的、没分配记录的不补。"}
      </div>
      <Input.TextArea rows={4} maxLength={原因上限} showCount value={说明} onChange={(e) => set说明(e.target.value)} placeholder="复核说明（可不写）" aria-label="复核说明" />
      {框错 && <div role="alert" className="csq-err">{框错}</div>}
    </Modal>
  );
  if (首页)
    return (
      <div className="home-verify" role="group" aria-label={`待复核的线索（${摆着.length}）`} data-testid="verify-inbox">
        {摆着.map((r) => {
          const 复核 = r.步 === "市场复核" || r.步 === "总管理终判";
          const 附 = 附言of(r);
          return (
            <div key={r.projectId} className="home-cth-todo home-verify-row" data-testid={`verify-row-${r.projectId}`}>
              <span className="home-cth-todo-t home-verify-t">
                <Tag color={复核 ? "orange" : "blue"}>{步叫法[r.步]}</Tag>
                <Link href={`/projects/${r.projectId}`} className="home-verify-name">{r.项目}</Link>
              </span>
              <span className="home-cth-todo-s home-verify-s">
                负责人 {r.负责人 || "已不在的成员"} · <span className="home-cth-todo-time">{smartTime(r.更新于)}</span>
                {附 ? ` · ${附}` : ""}
              </span>
              <span className="home-cth-todo-a home-verify-a">
                {复核 ? (
                  <>
                    <Button type="link" size="small" disabled={忙} onClick={() => 判有效(r)}>判有效</Button>
                    <Button type="link" danger size="small" disabled={忙} onClick={() => { 记错(r.projectId, null); set说明(""); set框错(""); set框({ r, 有效: false }); }}>判无效</Button>
                  </>
                ) : (
                  <Link className="link-strong" href={`/projects/${r.projectId}`}>去处理 ›</Link>
                )}
              </span>
              {错[r.projectId] && <div role="alert" className="cd-task-err home-verify-err">{错[r.projectId]}</div>}
            </div>
          );
        })}
        {判框}
      </div>
    );
  return (
    <Card title={`待复核的线索（${摆着.length}）`} size="small" style={{ marginBottom: 16 }} data-testid="verify-inbox">
      {摆着.map((r) => {
        const 复核 = r.步 === "市场复核" || r.步 === "总管理终判";
        const 附 = 附言of(r);
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
      {判框}
    </Card>
  );
}
