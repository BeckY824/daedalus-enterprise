"use client";

import DatePicker from "@/components/BusinessDatePicker";
import { 短沟通话of } from "@/lib/enterprise/tri-state-quota";
import { useEffect, useRef, useState } from "react";
import { Modal, Input, Segmented, Button, Space, Typography, Select } from "antd";
import SaveButton from "@/components/SaveButton";
import { showUndo } from "@/components/UndoBar";
import type { Dayjs } from "dayjs";
import { dayjs } from "@/lib/utils";
import { 跟进类型们, FOLLOW_TYPE_MAP } from "@/lib/constants";
import FollowMethodSelect from "@/components/FollowMethodSelect";
import { 对得上的方式 } from "@/lib/follow-method";
import { useBusiness } from "@/lib/business-client";
import { 外贸精简 } from "@/lib/business-config";
import { hasVisibleText } from "@/lib/form-validation";
import { saveFollowUp, 撤销记一笔, 沟通可选项目 } from "./actions";
import { 聚焦首项 } from "@/lib/modal-focus";
import { useFormGuard } from "@/lib/form-guard";
import { 动作出错话 } from "@/lib/stale-deploy";

/**
 * 完成一条跟进计划时弹的小框（2026-10-16 外贸基础，总控：「方式 + 一句话 + 下次时间（默认 7 天后），保留『跳过，直接完成』。不做节奏标签」）。
 *
 * 外贸最常见的一串动作是「做完 → 记一下 → 排下次」。原来点完成只弹「撤销 / 排下一次」，跟进要另开表单记，
 * 多半就没记；下一次什么时候也常常没排。现在三件事一个框做完：
 *   保存并完成 = 记一条已完成的跟进 + 完成这条计划 + （选了的话）排下一次，一个事务（saveFollowUp 的「附带」）
 *   跳过，直接完成 = 交回页面，和原来一样只把计划勾掉
 * 企业版沟通必须挂项目（11-17）：客户有我能记的在推项目就照常顺带记一笔（一个自动挂、几个要选）；
 * 没有就只把计划标为完成、不另记沟通（框里写明，「完成计划」= 跳过那条路）
 */

export type 要完成的计划 = {
  id: string; subject: string; method: string; customerId: string; customerName?: string;
  /** 档案里填了 WhatsApp 号（2026-10-17 PR26 手测）：方式默认 WhatsApp，见 默认完成类型 */
  有WhatsApp?: boolean;
};

/** 计划上写的方式 → 跟进类型。对不上的：外贸当 WhatsApp，别的当电话 */
export function 方式到类型(method: string | null | undefined, 外贸: boolean): string {
  const m = String(method ?? "").trim();
  const 按名 = Object.values(FOLLOW_TYPE_MAP).find((t) => t.label === m || t.value === m.toUpperCase());
  if (按名 && 按名.value !== "TASK" && 按名.value !== "REMIND") return 按名.value;
  if (/whats\s*app/i.test(m)) return "WHATSAPP";
  if (/微信/.test(m)) return "WECHAT"; // 企业微信也算（2026-10-19 加微信沟通）
  if (/短信|消息/.test(m)) return "SMS";
  if (/邮件|mail/i.test(m)) return "EMAIL";
  if (/电话|call/i.test(m)) return "PHONE";
  if (/会议|视频|zoom|teams/i.test(m)) return "MEETING";
  if (/拜访|见面|上门/.test(m)) return "VISIT";
  return 外贸 ? "WHATSAPP" : "PHONE";
}

/**
 * 小框打开时「方式」那一格（2026-10-17 PR26 手测：电脑上有 WhatsApp 号的客户也该默认 WhatsApp，和手机上一样）。
 * 计划上的方式空着、或者是「电话沟通」——那是建计划时的老默认，多半没人挑过——而客户有 WhatsApp 号：WhatsApp。
 * 计划上明明白白写了别的（邮件、拜访……）照它的
 */
export function 默认完成类型(method: string | null | undefined, 外贸: boolean, 有WhatsApp = false): string {
  const m = String(method ?? "").trim();
  if (有WhatsApp && (!m || m === "电话沟通")) return "WHATSAPP";
  return 方式到类型(m, 外贸);
}

/** 下次那条计划的主题：和手机上一样，取这次那句话的第一句 */
export function 下次主题(内容: string): string {
  const 首句 = 内容.trim().split(/[，。！？,.!?\n]/)[0].slice(0, 20);
  return 首句 ? `接着跟进：${首句}` : "接着跟进";
}

type 下次 = "none" | "3" | "7" | "pick";

/** 提示：这笔不算有效沟通之类的轻提示（C12），框里已就地说过一遍；页面想留着说就接它 */
export type 记完了 = { kind: "saved"; next: string | null; 跟进id: string; 下次计划id: string | null; 提示?: string };

/**
 * 「保存并完成」之后的提示，带「撤销」（2026-10-17 PR26 手测：「跳过，直接完成」有撤销，这边没有，
 * 点错了只能去时间线删跟进、计划页删计划）。撤销 = 删掉刚记的那笔和刚排的下一条、计划回到待办（撤销记一笔）。
 * 记录页和计划页共用；撤销成了由页面自己刷新
 */
export function 提示记完了(
  plan: Pick<要完成的计划, "id" | "subject" | "customerId">,
  r: 记完了,
  撤销完了: () => void,
) {
  // 底部撤销条（原型 g.undo），不弹顶部提示；撤销没成由撤销条自己写「撤销不了：原因」
  showUndo({
    话: r.next ? `已记一笔，「${plan.subject}」完成；下次 ${dayjs(r.next).format("M 月 D 日")}` : `已记一笔，「${plan.subject}」完成`,
    毫秒: 6000,
    撤销: async () => {
      const u = await 撤销记一笔({ customerId: plan.customerId, 跟进id: r.跟进id, 计划id: plan.id, 下次计划id: r.下次计划id })
        .catch((出错) => ({ ok: false as const, error: 动作出错话(出错, "没撤销成，请稍后重试") }));
      if (u.ok) 撤销完了();
      return u;
    },
  });
}

type 框参数 = {
  /** 有值就开着 */
  plan: 要完成的计划 | null;
  onClose: () => void;
  /**
   * saved = 记了一笔、计划已在服务端一起完成（next 是排的下一次，YYYY-MM-DD，没排为 null；
   *   跟进id / 下次计划id 给提示条上的「撤销」用，见 提示记完了）；
   * skip = 人点了「跳过，直接完成」，由页面走原来那一下完成（计划页先原地打勾再存，留位不变）
   */
  onDone: (r: 记完了 | { kind: "skip" }) => void;
};

/** 每换一条计划整个框重新挂一次（key = 计划 id），框里的格子从这条计划的方式起头，不带上一条的残留 */
export default function CompletePlanModal(p: 框参数) {
  return p.plan ? <CompletePlanDialog key={p.plan.id} {...p} plan={p.plan} /> : null;
}

function CompletePlanDialog({ plan, onClose, onDone }: 框参数 & { plan: 要完成的计划 }) {
  const b = useBusiness();
  const 外贸 = 外贸精简(b);
  const [类型, set类型] = useState(() => 默认完成类型(plan.method, 外贸, plan.有WhatsApp));
  // 企业版沟通方式（10-31）：计划上写的正好是字典里的一种、又对得上类型就先选它
  const [方式, set方式] = useState<string | null>(() => 对得上的方式(类型, plan.method) ?? null);
  const [字, set字] = useState("");
  const [下次, set下次] = useState<下次>("7");
  const [日子, set日子] = useState<Dayjs | null>(() => dayjs().add(7, "day"));
  const [忙, set忙] = useState(false);
  // 点外面不关；写了那一句再按 Esc / X 先问一句（2026-10-19 客户反馈，lib/form-guard.tsx）。挂着一条计划，不算新建弹窗，不存草稿
  const 守 = useFormGuard({ open: true, 关: onClose, 填过: () => hasVisibleText(字), 忙, afterOpenChange: 聚焦首项 });

  /** 企业版这位客户我能挂沟通的在推项目：undefined = 还在问；null = 不是企业版（照旧不挂） */
  const [项目们, set项目们] = useState<{ id: string; name: string }[] | null | undefined>(undefined);
  const [项目, set项目] = useState<string | null>(null);
  useEffect(() => {
    let 作废 = false;
    沟通可选项目(plan.customerId).then(
      (r) => { if (!作废) set项目们(r.ok ? r.项目们 : null); },
      () => { if (!作废) set项目们(null); },
    );
    return () => { 作废 = true; };
  }, [plan.customerId]);
  /** 没有能挂的在推项目：只标完成，不另记沟通 */
  const 只完成 = Array.isArray(项目们) && 项目们.length === 0;
  const 挂的项目 = 项目们 && 项目们.length === 1 ? 项目们[0].id : 项目;
  const 要选项目 = !!项目们 && 项目们.length > 1;

  const 下次日 = 下次 === "none" ? null : 下次 === "pick" ? 日子?.format("YYYY-MM-DD") ?? null : dayjs().add(Number(下次), "day").format("YYYY-MM-DD");
  const 可存 = 只完成 || (项目们 !== undefined && hasVisibleText(字) && (下次 !== "pick" || !!日子) && (!要选项目 || !!项目));

  /** 这笔不算有效沟通（C12）：框里就地说一句（role=status），对勾放完再关框 */
  const [短话, set短话] = useState<string | null>(null);
  /** 存好了、等对勾放完再交给页面的那一下 */
  const 存好后 = useRef<(() => void) | null>(null);
  const 保存键 = useRef<HTMLSpanElement>(null);
  function 交出去() {
    const f = 存好后.current;
    存好后.current = null;
    f?.();
  }
  /** 已经存上了、在等对勾放完：「跳过」不能再点（不然又完成一次） */
  const [已存, set已存] = useState(false);

  /**
   * 保存并完成（原型 g.save）：转圈 → 对勾都在键里；没成原因浮在键上方，框留着可以再点。不弹顶部提示
   */
  async function 保存(): Promise<{ ok: boolean; error?: string }> {
    if (忙) return { ok: false, error: "正在保存，请稍等" };
    if (只完成) {
      // 没有能挂的项目：不记沟通，走「跳过，直接完成」那条路（页面只把计划勾掉）
      存好后.current = () => onDone({ kind: "skip" });
      set已存(true);
      return { ok: true };
    }
    if (要选项目 && !项目) return { ok: false, error: "请选一个关联项目" };
    if (!可存) return { ok: false, error: "先写一句这次聊了什么" };
    set忙(true);
    try {
      const 内容 = 字.trim();
      const r = await saveFollowUp({
        customerId: plan.customerId,
        type: 类型,
        method: 对得上的方式(类型, 方式),
        title: "",
        content: 内容,
        status: "已完成",
        occurredAt: new Date().toISOString(),
        ...(挂的项目 ? { projectId: 挂的项目 } : {}),
        附带: {
          tasks: [],
          ...(下次日 ? { plan: { subject: 下次主题(内容), plannedAt: 下次日, method: 对得上的方式(类型, 方式) ?? FOLLOW_TYPE_MAP[类型]?.label ?? "电话沟通" } } : {}),
          完成计划: plan.id,
        },
      }).catch((出错) => ({ ok: false as const, error: 动作出错话(出错, "没保存上，请稍后重试") }));
      if (!r.ok) return { ok: false, error: "error" in r && r.error ? r.error : "没保存上，请稍后重试" };
      // 客户三态（C12）：这条不算有效沟通时给一句轻提示（照常保存，不拦）
      const 短 = 短沟通话of(r) ?? undefined;
      if (短) set短话(短);
      set已存(true);
      存好后.current = () => onDone({ kind: "saved", next: 下次日, 跟进id: r.id, 下次计划id: r.下次计划id ?? null, ...(短 ? { 提示: 短 } : {}) });
      return { ok: true };
    } finally {
      set忙(false);
    }
  }

  function 跳过() {
    if (忙 || 已存) return;
    onDone({ kind: "skip" });
  }

  return (
    <Modal
      open
      title="完成这条计划"
      {...守.弹窗}
      // 存上了、对勾还在放：Esc / X 当「存好了」，照样交给页面（撤销条、刷新）
      onCancel={() => (存好后.current ? 交出去() : 守.要关())}
      destroyOnHidden
      width={480}
      footer={
        <Space>
          {!只完成 && (
            <Button onClick={跳过} disabled={忙 || 已存}>
              跳过，直接完成
            </Button>
          )}
          <span ref={保存键}>
            <SaveButton 做={保存} disabled={!可存} 已保存="已完成" 成了={交出去}>
              {只完成 ? "完成计划" : "保存并完成"}
            </SaveButton>
          </span>
        </Space>
      }
    >
      {(
        <div className="done-plan" data-testid="complete-plan-modal">
          <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
            {plan.customerName ? `${plan.customerName} · ` : ""}「{plan.subject}」做完了，{只完成 ? "标为完成。" : "顺手记一笔。"}
          </Typography.Paragraph>
          {只完成 ? (
            <div role="note" className="done-plan-note">这位客户还没有在推的项目：只把计划标为完成，不另记沟通</div>
          ) : <>
          {项目们 && 项目们.length > 0 && (
            <div className="done-plan-row">
              <span className="done-plan-k">项目</span>
              {要选项目 ? (
                <Select aria-label="关联项目" className="done-plan-pick" placeholder="选择关联项目" value={项目 ?? undefined} onChange={(v: string) => set项目(v)} options={项目们.map((x) => ({ value: x.id, label: x.name }))} />
              ) : (
                <span className="done-plan-proj">{项目们[0].name}</span>
              )}
            </div>
          )}
          <div className="done-plan-row">
            <span className="done-plan-k">方式</span>
            <FollowMethodSelect
              aria-label="跟进方式"
              style={{ width: 180 }}
              type={类型}
              method={方式}
              类型们={跟进类型们(外贸).filter((t) => t.value !== "TASK" && t.value !== "REMIND")}
              onChange={(v) => { set类型(v.type); set方式(v.method); }}
            />
          </div>
          <div className="done-plan-row">
            <span className="done-plan-k">一句话</span>
            <Input.TextArea
              aria-label="这次聊了什么"
              autoSize={{ minRows: 2, maxRows: 5 }}
              maxLength={2000}
              value={字}
              onChange={(e) => set字(e.target.value)}
              onPressEnter={(e) => { if (e.metaKey || e.ctrlKey) 保存键.current?.querySelector("button")?.click(); }}
              placeholder="聊了什么、结果怎样，比如：客户要了新报价，下周回"
            />
          </div>
          <div className="done-plan-row">
            <span className="done-plan-k">下次</span>
            <Space wrap size={8}>
              <Segmented<下次>
                aria-label="下次跟进"
                value={下次}
                onChange={set下次}
                options={[{ value: "none", label: "不排" }, { value: "3", label: "3 天后" }, { value: "7", label: "7 天后" }, { value: "pick", label: "选日子" }]}
              />
              {下次 === "pick" && (
                <DatePicker
                  aria-label="下次跟进日期"
                  value={日子}
                  onChange={(d) => set日子(d)}
                  disabledDate={(d) => d.isBefore(dayjs().startOf("day"))}
                  allowClear={false}
                />
              )}
            </Space>
          </div>
          {短话 && <div role="status" className="rec-plan-said">{短话}</div>}
          {下次日 && <div className="done-plan-tip">{`会排一条 ${dayjs(下次日).format("M 月 D 日")}的计划：${下次主题(字)}`}</div>}
          </>}
        </div>
      )}
    </Modal>
  );
}
