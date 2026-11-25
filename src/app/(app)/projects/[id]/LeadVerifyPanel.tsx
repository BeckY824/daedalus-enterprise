"use client";

import { useState } from "react";
import { Button, Input, Modal, Popconfirm, Tag, Timeline, Tooltip } from "antd";
import DatePicker from "@/components/BusinessDatePicker";
import DictSelect from "@/components/DictSelect";
import { 其他没写好 } from "@/lib/enterprise/dict-kinds";
import { dayjs, fmtDateTime } from "@/lib/utils";
import { 原因上限 } from "@/lib/project/nodes";
import { 有效线索节点 } from "@/lib/project/stage-gates";
import type { 线索验证 } from "@/lib/project/lead-verify";
import { 线索验证依据 } from "@/lib/project/lead-verify-basis";
import type { 必填项 } from "@/lib/project/required";
import { 线索初判Action, 市场复核Action, 销售终验Action, 总管理终判Action, 销售认领Action, 撤回验证Action } from "../actions";
import { 框里原因, 跑给按钮, type 跑法 } from "./detail-note";
import { useFormDraft } from "@/components/FormDraft";
import { useConsequence } from "@/components/ConsequenceDialog";


// 11-01：显示客户定的六个叫法（v.叫法），颜色和项目卡那一行一样
const 叫法色: Record<string, string> = { 暂未验证: "default", 初验无效: "orange", 复核有效: "blue", 终验无效: "volcano", 有效线索: "green", 无效线索: "red" };
// 界面上不露内部岗位名（市场管理 / 总管理）：复核两步都说「管理员」，销售那几步说「负责人」（10-30 交互调整，术语表）
const 等谁: Record<string, string> = {
  市场复核: "等管理员复核",
  总管理终判: "等管理员最终确认",
  销售终验: "管理员判有效，等负责人确认",
  销售认领: "管理员判有效，等负责人认领",
};
const 步叫法: Record<string, string> = {
  销售初判: "负责人初判", 市场复核: "管理员复核", 销售终验: "负责人确认", 总管理终判: "管理员最终确认", 销售认领: "负责人认领", 撤回验证: "撤回验证", 进公海清验证: "进公海清掉验证",
};

/** 一条痕在时间线上的说法 */
function 痕说法(l: 线索验证["痕"][number]): string {
  const 头 = `${l.谁} · ${步叫法[l.step] ?? l.step} · ${l.verdict}`;
  const 尾 = [l.reason ? `无效原因：${l.reason}` : null, l.note].filter(Boolean).join("；");
  return 尾 ? `${头}（${尾}）` : 头;
}

/**
 * 企业版线索有效性验证（P12）：判定 + 下一步按钮 + 小时间线。11-01 起整块放在项目卡「线索验证」那一行点开的弹窗里。
 * 项目创建人是销售（v.初判即终判）：负责人判有效、判无效都是最终结果，不交复核。
 * 四步：销售初判 → 市场复核 → 销售终验 → 总管理终判（界面上说成 负责人初判 → 管理员复核 → 负责人确认 → 管理员最终确认）；谁能做哪步服务端已经算好放在 v.我能
 */
export default function LeadVerifyPanel({
  projectId,
  v,
  无效原因选项,
  字数上限,
  跑,
  忙,
  缺有效沟通话,
  不给推,
  线索验证必填 = [],
  有效还差 = [],
  沟通半句 = "",
  on去填,
  重复线索名,
  项目名,
}: {
  projectId: string;
  /** 后果框标题里写的那条线索（「把「X」退回线索公海」）；没给写「这条线索」 */
  项目名?: string;
  v: 线索验证;
  无效原因选项: string[];
  /** 培育计划、无效原因的字数上限（M-节点-03，组织规则）：null / 没给 = 不设，输入框不限字数 */
  字数上限?: { 培育计划: number | null; 无效原因: number | null };
  跑: 跑法;
  忙: boolean;
  /** 推过线索验证还差有效沟通时的话（带还差哪几项），齐了 null */
  缺有效沟通话: string | null;
  不给推: string | null;
  /** 组织规则里「线索验证」节点配的必填（顶上「判定依据」按它写，和推进时拦的是同一份）；没开节点推进 = 空 = 只看需求状态 */
  线索验证必填?: readonly 必填项[];
  /** 判「有效」还差的几项（叫法，ProjectDetail 有效沟通差）：「有效」灰着的原因写成缺项小块（设计语言 D4 · M6-a，D36），和进程卡那块同一个样子 */
  有效还差?: readonly string[];
  /** 「前两节点要沟通」开着时还要记的那条沟通（接在说明后面） */
  沟通半句?: string;
  /** 点一块：关掉这个框，去那一格填（ProjectDetail 去填） */
  on去填?: (叫: string) => void;
  /** 带「老客户重复咨询」标记的线索（重复咨询第一步 · 出口 C）才给：字典里「重复线索」现在的叫法，判无效的框里提示同一需求选它 */
  重复线索名?: string;
}) {
  const [框, set框] = useState<null | "无效" | "培育" | "异议" | "复核有效" | "复核无效">(null);
  const [无效原因, set无效原因] = useState<string | null>(null);
  const [说明, set说明] = useState("");
  const [培育日, set培育日] = useState<string | null>(null);
  const [培育计划, set培育计划] = useState("");
  /**
   * 没做成的原因（不弹顶部提示）：这一块整个在「线索验证」弹窗里，页面底部的就地小条被遮罩盖着，所以原因写在这里——
   * 判定框开着写在判定框里（框不关），没开写在按钮下面。成了验证结果、时间线自己会变，回执照常写在详情底部
   */
  const [错, set错] = useState<string | null>(null);
  const 跑这: 跑法 = (f, 成了) => 跑(f, 成了, { 报错: set错 });
  /*
    D04（设计语言 E2）：「放回公海」照 P-界面-40 走后果框（原来是 antd 气泡确认「退回线索公海？」，漏网的一处）——
    标题写「把「项目名」退回线索公海」，后果分条（只退它 / 领不回 / 记作主动退回），确认键写「退回公海」；没退成原因写在框里、框不关。
    后果照项目详情「项目退回公海」那个框的口径（原负责人领不回，公海规则 原负责人能领回 = false；项目层动作不碰客户）
  */
  const [问后果, 后果框] = useConsequence();
  const 退回问 = () => void 问后果({
    题: <>把「{项目名 || "这条线索"}」退回线索公海</>,
    后果: [
      { 标: "只退它", 话: "只退这个项目，客户和客户负责人不动" },
      { 标: "领不回", 话: "退回去以后同事都能领，你不能再领回来，也看不到这个项目了", 级: "危" },
      { 标: "待办", 话: "你在这个项目上没做完的待办会自动关闭" },
      { 标: "记作", 话: "算你主动退回（公海里按「主动退回」归类）" },
    ],
    是: "退回公海",
    做: () => 跑给按钮(跑, () => 销售认领Action(projectId, false), "已退回线索公海"),
  });
  // 判定框里打了没交的字留草稿（复盘第 1 类）：按项目 + 哪个框分；判成了、点取消就删。无效原因、日期跟着字一起带回
  const 稿 = useFormDraft({
    键: 框 ? `线索验证:${projectId}:${框}` : null,
    开: !!框,
    值: { 无效原因, 说明, 培育日, 培育计划 },
    带回: (x) => {
      if (x.无效原因 !== undefined) set无效原因(x.无效原因);
      if (x.说明 !== undefined) set说明(x.说明);
      if (x.培育日 !== undefined) set培育日(x.培育日);
      if (x.培育计划 !== undefined) set培育计划(x.培育计划);
    },
    算填过: (改过) => !!(改过.说明?.trim() || 改过.培育计划?.trim() || 改过.无效原因?.trim()),
  });

  const 开 = (k: NonNullable<typeof 框>) => {
    set无效原因(null);
    set说明("");
    set培育日(null);
    set培育计划("");
    set错(null);
    set框(k);
  };
  // 往前推（有效 / 接受复核 / 认领继续）一样要过有效沟通、直属推进这两道门
  const 推不了 = 缺有效沟通话 ?? 不给推;
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
        做: () => 跑这(() => 线索初判Action(projectId, "无效", { invalidReason: 无效原因, verifyNote: 说明 }), v.初判即终判 ? "已判无效线索" : v.无效交给 === "总管理终判" ? "已判无效，等管理员最终确认" : "已判无效，交给复核"),
        身: (
          <>
            <div style={{ marginBottom: 8, color: "var(--text-muted)" }} data-testid="lead-verify-invalid-hint">
              {v.初判即终判
                ? "这个项目是销售建的：你判无效就是最终结果，这条线索结束（记为线索流失），不再交管理员复核。"
                : v.无效交给 === "总管理终判"
                  ? "判无效直接交管理员最终确认：确认无效才算无效线索，确认有效会回到你这里继续跟。"
                  : "判无效要过复核：复核也判无效才算无效线索，复核判有效会回到你这里。"}
            </div>
            {重复线索名 && (
              <div className="lv-repeat-hint" data-testid="lead-verify-repeat-hint">
                这条是老客户重复咨询：如与这位客户原来在推的项目是同一需求，无效原因选「{重复线索名}」（不会把客户状态改成流失）。
              </div>
            )}
            {有字典 ? (
              <DictSelect style={{ width: "100%", marginBottom: 8 }} placeholder="无效原因（必选）" aria-label="无效原因" value={无效原因} onChange={set无效原因} options={无效原因选项} />
            ) : (
              <Input style={{ marginBottom: 8 }} maxLength={字数上限?.无效原因 ?? undefined} showCount={!!字数上限?.无效原因} placeholder="无效原因（必填）" aria-label="无效原因" value={无效原因 ?? ""} onChange={(e) => set无效原因(e.target.value)} />
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
        做: () => 跑这(() => 线索初判Action(projectId, "还需培育", { 下一步时间: 培育日, 计划内容: 培育计划 }), `已回到潜客培育，${培育日} 再跟进`),
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
              maxLength={字数上限?.培育计划 ?? undefined}
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
        做: () => 跑这(() => 销售终验Action(projectId, false, 说明), "已提交异议，等管理员最终确认"),
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
        做: () => 跑这(() => act(projectId, 有效, 说明), 有效 ? "已判有效，交回负责人" : "已判无效线索"),
        身: (
          <>
            <div style={{ marginBottom: 8, color: "var(--text-muted)" }}>
              {有效 ? "判有效会交回负责人继续跟。" : "判无效后这条线索结束（记为线索流失）；现负责人占过名额的（自动、指定都算，不限月；补发来的也算）记 1 个判无效待补，下一条自动分配优先补发给他；随客户分到的、转来的、没分配记录的不补。"}
            </div>
            <Input.TextArea rows={4} maxLength={原因上限} showCount value={说明} onChange={(e) => set说明(e.target.value)} placeholder="复核说明（可不写）" aria-label="复核说明" />
          </>
        ),
      };
    }
    return null;
  })();

  // 员工反馈 #7「判定依据不明确」：顶上写系统真在用的判法（lead-verify-basis.ts），不另立规矩
  const 依据 = 线索验证依据({ 线索验证必填, 初判即终判: v.初判即终判, 无效交给: v.无效交给 });

  return (
    <div data-testid="lead-verify">
      {后果框}
      <div className="lead-verify-basis" data-testid="lead-verify-basis">
        <div className="lead-verify-basis-h">判定依据</div>
        <ul>
          <li data-testid="lead-verify-basis-valid">{依据.有效}</li>
          <li data-testid="lead-verify-basis-invalid">{依据.无效}</li>
          <li>{依据.培育}</li>
          <li data-testid="lead-verify-basis-repeat">{依据.复购}</li>
        </ul>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <span style={{ color: "var(--text-muted)" }}>验证结果：</span>
        <Tag color={叫法色[v.叫法] ?? "default"} style={{ marginInlineEnd: 0 }} data-testid="lead-verify-verdict">{v.叫法}</Tag>
        {v.待 && <span style={{ color: "var(--text-muted)" }} data-testid="lead-verify-pending">{等谁[v.待]}</span>}
        {v.无效原因 && <span style={{ color: "var(--text-muted)", overflowWrap: "anywhere", minWidth: 0 }}>无效原因：{v.无效原因}</span>}
      </div>
      {v.我能 && (
        <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          {v.我能 === "初判" && (
            <>
              {推按钮("有效", () => void 跑这(() => 线索初判Action(projectId, "有效"), "判为有效线索，已推到线索推进"), "lead-verify-valid")}
              <Button size="small" danger disabled={忙} onClick={() => 开("无效")} data-testid="lead-verify-invalid">无效</Button>
              <Button size="small" disabled={忙} onClick={() => 开("培育")} data-testid="lead-verify-nurture">还需培育</Button>
            </>
          )}
          {v.我能 === "销售终验" && (
            <>
              {推按钮("接受复核", () => void 跑这(() => 销售终验Action(projectId, true), "已接受复核，推到线索推进"), "lead-verify-accept")}
              <Button size="small" disabled={忙} onClick={() => 开("异议")} data-testid="lead-verify-dispute">提交异议</Button>
            </>
          )}
          {v.我能 === "销售认领" && (
            <>
              {推按钮("认领继续", () => void 跑这(() => 销售认领Action(projectId, true), "已认领，推到线索推进"), "lead-verify-claim")}
              <Button size="small" disabled={忙} onClick={退回问} data-testid="lead-verify-return">放回公海</Button>
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
      {v.能撤回 && (
        <div style={{ marginTop: 8 }}>
          <Popconfirm
            title="撤回这次验证？"
            description="线索回到验证前（暂未验证），之后能改负责人、重新判"
            okText="撤回"
            cancelText="再想想"
            onConfirm={() => void 跑这(() => 撤回验证Action(projectId), "已撤回验证")}
          >
            <Button size="small" disabled={忙} data-testid="lead-verify-withdraw">撤回验证</Button>
          </Popconfirm>
        </div>
      )}
      {!弹框 && <框里原因 话={错} />}
      {推不了 && (v.我能 === "初判" || v.我能 === "销售终验" || v.我能 === "销售认领") && (
        // 缺项小块（D4 · M6-a）；调用方不传 有效还差 时一行灰字
        缺有效沟通话 && 有效还差.length ? (
          <div className="proj-miss" data-testid="lead-verify-miss">
            <div className="proj-miss-t">判「有效」还差 {有效还差.length} 项</div>
            <div className="proj-miss-chips">
              {有效还差.map((叫) => (on去填
                ? <button key={叫} type="button" className="proj-miss-chip" onClick={() => on去填(叫)}>{叫}</button>
                : <span key={叫} className="proj-miss-chip">{叫}</span>))}
            </div>
            <div className="proj-miss-help">{on去填 ? "点一项去填，填完回来再判；" : ""}「暂无」「-」这类占位不算填了{沟通半句}</div>
          </div>
        ) : <div style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 12 }}>{推不了}</div>
      )}
      {v.我能 === "销售终验" && 最后说明 && (
        <div style={{ marginTop: 8, color: "var(--text-muted)", overflowWrap: "anywhere" }}>复核说明：{最后说明}</div>
      )}
      {!v.我能 && !v.待 && v.痕.length === 0 && (
        <div style={{ marginTop: 8, color: "var(--text-muted)" }} data-testid="lead-verify-empty">还没验证过：项目走到「线索·{有效线索节点}」时，负责人在这里判有效、无效或还需培育。</div>
      )}
      {v.我能 === "初判" && v.初判即终判 && (
        <div style={{ marginTop: 8, color: "var(--text-muted)", fontSize: 12 }}>项目是销售建的：你的判定就是最终结果，不交管理员复核。</div>
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
        onCancel={() => { 稿.丢掉(); set框(null); set错(null); }}
        onOk={async () => {
          if (!弹框?.ok) return;
          if (await 弹框.做()) {
            稿.存好了();
            set框(null);
          }
        }}
      >
        {稿.提示}
        {弹框?.身}
        {!!弹框 && <框里原因 话={错} />}
      </Modal>
    </div>
  );
}
