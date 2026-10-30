"use client";

import { useState } from "react";
import { Button, Input, Modal, Popconfirm, Tag, Timeline, Tooltip } from "antd";
import DatePicker from "@/components/BusinessDatePicker";
import DictSelect from "@/components/DictSelect";
import { 其他没写好 } from "@/lib/enterprise/dict-kinds";
import { dayjs, fmtDateTime } from "@/lib/utils";
import { 原因上限 } from "@/lib/project/nodes";
import { 缺有效沟通, 培育计划上限, 无效原因上限 } from "@/lib/project/stage-gates";
import type { 线索验证 } from "@/lib/project/lead-verify";
import { 线索初判Action, 市场复核Action, 销售终验Action, 总管理终判Action, 销售认领Action } from "../actions";

type 跑法 = (f: () => Promise<{ ok: boolean; error?: string; 自动推到?: string[] }>, 成了?: string) => Promise<boolean>;

const 判定色: Record<string, string> = { 有效线索: "green", 初验无效: "orange", 无效线索: "red", 暂未判定: "default" };
// 界面上不露内部岗位名（市场管理 / 总管理）：复核两步都说「管理员」，销售那几步说「负责人」（10-30 交互调整，术语表）
const 等谁: Record<string, string> = {
  市场复核: "等管理员复核",
  总管理终判: "等管理员最终确认",
  销售终验: "管理员判有效，等负责人确认",
  销售认领: "管理员判有效，等负责人认领",
};
const 步叫法: Record<string, string> = {
  销售初判: "负责人初判", 市场复核: "管理员复核", 销售终验: "负责人确认", 总管理终判: "管理员最终确认", 销售认领: "负责人认领",
};

/** 一条痕在时间线上的说法 */
function 痕说法(l: 线索验证["痕"][number]): string {
  const 头 = `${l.谁} · ${步叫法[l.step] ?? l.step} · ${l.verdict}`;
  const 尾 = [l.reason ? `无效原因：${l.reason}` : null, l.note].filter(Boolean).join("；");
  return 尾 ? `${头}（${尾}）` : 头;
}

/**
 * 企业版线索有效性验证（P12）：详情页「线索验证」节点上的判定 + 下一步按钮 + 小时间线。
 * 四步：销售初判 → 市场复核 → 销售终验 → 总管理终判（界面上说成 负责人初判 → 管理员复核 → 负责人确认 → 管理员最终确认）；谁能做哪步服务端已经算好放在 v.我能
 */
export default function LeadVerifyPanel({
  projectId,
  v,
  无效原因选项,
  跑,
  忙,
  没有效沟通,
  不给推,
}: {
  projectId: string;
  v: 线索验证;
  无效原因选项: string[];
  跑: 跑法;
  忙: boolean;
  没有效沟通: boolean;
  不给推: string | null;
}) {
  const [框, set框] = useState<null | "无效" | "培育" | "异议" | "复核有效" | "复核无效">(null);
  const [无效原因, set无效原因] = useState<string | null>(null);
  const [说明, set说明] = useState("");
  const [培育日, set培育日] = useState<string | null>(null);
  const [培育计划, set培育计划] = useState("");

  const 开 = (k: NonNullable<typeof 框>) => {
    set无效原因(null);
    set说明("");
    set培育日(null);
    set培育计划("");
    set框(k);
  };
  // 往前推（有效 / 接受复核 / 认领继续）一样要过有效沟通、直属推进这两道门
  const 推不了 = 没有效沟通 ? 缺有效沟通 : 不给推;
  const 推按钮 = (文字: string, 做: () => void, testid: string) => (
    <Tooltip title={推不了 ?? undefined}>
      <span>
        <Button size="small" type="primary" disabled={忙 || !!推不了} onClick={做} data-testid={testid}>{文字}</Button>
      </span>
    </Tooltip>
  );
  const 有字典 = 无效原因选项.length > 0;
  const 原因好了 = 有字典 ? !!无效原因 && !其他没写好(无效原因) : !!无效原因?.trim();
  const 复核步 = v.我能 === "市场复核" || v.我能 === "总管理终判" ? v.我能 : null;
  const 最后说明 = [...v.痕].reverse().find((l) => l.step !== "销售初判" && l.note)?.note;

  const 弹框 = (() => {
    if (框 === "无效") {
      return {
        title: "判为无效线索",
        ok: 原因好了,
        做: () => 跑(() => 线索初判Action(projectId, "无效", { invalidReason: 无效原因, verifyNote: 说明 }), "已判无效，交给复核"),
        身: (
          <>
            <div style={{ marginBottom: 8, color: "var(--text-muted)" }}>判无效要过复核：复核也判无效才算无效线索，复核判有效会回到你这里。</div>
            {有字典 ? (
              <DictSelect style={{ width: "100%", marginBottom: 8 }} placeholder="无效原因（必选）" aria-label="无效原因" value={无效原因} onChange={set无效原因} options={无效原因选项} />
            ) : (
              <Input style={{ marginBottom: 8 }} maxLength={无效原因上限} placeholder="无效原因（必填）" aria-label="无效原因" value={无效原因 ?? ""} onChange={(e) => set无效原因(e.target.value)} />
            )}
            <Input.TextArea rows={3} maxLength={原因上限} showCount value={说明} onChange={(e) => set说明(e.target.value)} placeholder="说明（可不写）" aria-label="初判说明" />
          </>
        ),
      };
    }
    if (框 === "培育") {
      return {
        title: "还需培育：回潜客培育",
        ok: !!培育日 && !!培育计划.trim(),
        做: () => 跑(() => 线索初判Action(projectId, "还需培育", { 下一步时间: 培育日, 计划内容: 培育计划 }), `已回到潜客培育，${培育日} 再跟进`),
        身: (
          <>
            <div style={{ marginBottom: 8, color: "var(--text-muted)" }}>项目回到「线索·潜客培育」，按你选的日子排一条跟进计划，到时候提醒负责人再聊。</div>
            <DatePicker
              aria-label="下次跟进日期"
              style={{ width: "100%" }}
              value={培育日 ? dayjs(培育日) : null}
              disabledDate={(x) => x.isBefore(dayjs(), "day")}
              onChange={(d) => set培育日(d ? d.format("YYYY-MM-DD") : null)}
            />
            <Input.TextArea
              rows={3}
              maxLength={培育计划上限}
              showCount
              style={{ marginTop: 8 }}
              value={培育计划}
              onChange={(e) => set培育计划(e.target.value)}
              placeholder="下一步计划内容（必填），比如：下月再问一次预算"
              aria-label="下一步计划内容"
            />
          </>
        ),
      };
    }
    if (框 === "异议") {
      return {
        title: "提交异议",
        ok: !!说明.trim(),
        做: () => 跑(() => 销售终验Action(projectId, false, 说明), "已提交异议，等管理员最终确认"),
        身: (
          <>
            <div style={{ marginBottom: 8, color: "var(--text-muted)" }}>你仍认为这条线索无效：写清理由，交给管理员最终确认。</div>
            <Input.TextArea rows={4} maxLength={原因上限} showCount value={说明} onChange={(e) => set说明(e.target.value)} placeholder="异议说明（必填）" aria-label="异议说明" />
          </>
        ),
      };
    }
    if (框 === "复核有效" || 框 === "复核无效") {
      const 有效 = 框 === "复核有效";
      const act = 复核步 === "总管理终判" ? 总管理终判Action : 市场复核Action;
      return {
        title: `${复核步 ? 步叫法[复核步] : "复核"}：判${有效 ? "有效" : "无效"}`,
        ok: true,
        danger: !有效,
        做: () => 跑(() => act(projectId, 有效, 说明), 有效 ? "已判有效，交回负责人" : "已判无效线索"),
        身: (
          <>
            <div style={{ marginBottom: 8, color: "var(--text-muted)" }}>
              {有效 ? "判有效会交回负责人继续跟。" : "判无效后这条线索结束（记为线索流失），负责人本月自动分配名额 +1。"}
            </div>
            <Input.TextArea rows={4} maxLength={原因上限} showCount value={说明} onChange={(e) => set说明(e.target.value)} placeholder="复核说明（可不写）" aria-label="复核说明" />
          </>
        ),
      };
    }
    return null;
  })();

  // 线索阶段别的节点、还没判过：不占地方
  if (!v.我能 && !v.待 && v.痕.length === 0) return null;
  return (
    <div style={{ marginTop: 12 }} data-testid="lead-verify">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <span style={{ color: "var(--text-muted)" }}>线索判定：</span>
        <Tag color={判定色[v.判定] ?? "default"} style={{ marginInlineEnd: 0 }} data-testid="lead-verify-verdict">{v.判定}</Tag>
        {v.待 && <span style={{ color: "var(--text-muted)" }} data-testid="lead-verify-pending">{等谁[v.待]}</span>}
        {v.无效原因 && <span style={{ color: "var(--text-muted)", overflowWrap: "anywhere", minWidth: 0 }}>无效原因：{v.无效原因}</span>}
      </div>
      {v.我能 && (
        <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          {v.我能 === "初判" && (
            <>
              {推按钮("有效", () => void 跑(() => 线索初判Action(projectId, "有效"), "判为有效线索，已推到线索推进"), "lead-verify-valid")}
              <Button size="small" danger disabled={忙} onClick={() => 开("无效")} data-testid="lead-verify-invalid">无效</Button>
              <Button size="small" disabled={忙} onClick={() => 开("培育")} data-testid="lead-verify-nurture">还需培育</Button>
            </>
          )}
          {v.我能 === "销售终验" && (
            <>
              {推按钮("接受复核", () => void 跑(() => 销售终验Action(projectId, true), "已接受复核，推到线索推进"), "lead-verify-accept")}
              <Button size="small" disabled={忙} onClick={() => 开("异议")} data-testid="lead-verify-dispute">提交异议</Button>
            </>
          )}
          {v.我能 === "销售认领" && (
            <>
              {推按钮("认领继续", () => void 跑(() => 销售认领Action(projectId, true), "已认领，推到线索推进"), "lead-verify-claim")}
              <Popconfirm title="退回项目公海？" description="算你主动退回，别人可以领走" okText="退回" cancelText="再想想" onConfirm={() => void 跑(() => 销售认领Action(projectId, false), "已退回项目公海")}>
                <Button size="small" disabled={忙} data-testid="lead-verify-return">退回公海</Button>
              </Popconfirm>
            </>
          )}
          {复核步 && (
            <>
              <Button size="small" type="primary" disabled={忙} onClick={() => 开("复核有效")} data-testid="lead-verify-review-valid">判有效</Button>
              <Button size="small" danger disabled={忙} onClick={() => 开("复核无效")} data-testid="lead-verify-review-invalid">判无效</Button>
            </>
          )}
        </div>
      )}
      {推不了 && (v.我能 === "初判" || v.我能 === "销售终验" || v.我能 === "销售认领") && (
        <div style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 12 }}>{推不了}</div>
      )}
      {v.我能 === "销售终验" && 最后说明 && (
        <div style={{ marginTop: 8, color: "var(--text-muted)", overflowWrap: "anywhere" }}>复核说明：{最后说明}</div>
      )}
      {v.痕.length > 0 && (
        <Timeline
          style={{ marginTop: 12, marginBottom: -16 }}
          items={v.痕.map((l) => ({
            key: l.id,
            color: l.verdict === "无效" ? "red" : l.verdict === "有效" || l.verdict === "接受复核" || l.verdict === "认领继续" ? "green" : "gray",
            children: (
              <div style={{ overflowWrap: "anywhere", minWidth: 0 }}>
                <div>{痕说法(l)}</div>
                <div style={{ color: "var(--text-muted)", fontSize: 12 }}>{fmtDateTime(l.at)}</div>
              </div>
            ),
          }))}
          data-testid="lead-verify-trail"
        />
      )}
      <Modal
        open={!!弹框}
        title={弹框?.title}
        okText="确定"
        okButtonProps={{ disabled: !弹框?.ok, loading: 忙, danger: !!弹框?.danger || 框 === "无效" }}
        onCancel={() => set框(null)}
        onOk={async () => {
          if (!弹框?.ok) return;
          if (await 弹框.做()) set框(null);
        }}
      >
        {弹框?.身}
      </Modal>
    </div>
  );
}
