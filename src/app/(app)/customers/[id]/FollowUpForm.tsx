"use client";

import DatePicker from "@/components/BusinessDatePicker";

import { isCalendarDate } from "@/lib/schedule-date";
import { 是逾期 } from "@/lib/overdue";
import { requiredText } from "@/lib/form-validation";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal, Form, Input, Select, InputNumber, Row, Col, App, Button, Checkbox, Space, Typography, Radio } from "antd";
import { DownOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { FOLLOW_TYPES, FOLLOW_RECORD_STATUSES, 跟进类型们 } from "@/lib/constants";
import { dayjs, fmtDateTime } from "@/lib/utils";
import { saveFollowUp, completePlan, saveTask, savePlan } from "./actions";
import { 项目沟通须知, 记项目沟通Action, type 项目沟通须知结果 } from "../../projects/actions";
import { 回公海文案, 回公海颜色, 预演回收日 } from "@/lib/enterprise/recycle-text";
import { 下一步文字上限 } from "@/lib/project/project-fields";
import { parseFollowUpDraft } from "./ai";
import { useBusiness } from "@/lib/business-client";
import { 外贸精简 } from "@/lib/business-config";
import AiWait from "@/components/AiWait";
import AiCost, { AiRemaining, useAiOutOfCredits } from "@/components/AiCost";
import { clearJob, runJob } from "@/lib/ai-jobs";
import { statusLabel } from "@/lib/business-config";
import { 只填没动过的, 跳过说明 } from "@/lib/fill-untouched";
import CustomerPick, { type 客户近况 } from "./CustomerPick";
import FollowMethodSelect from "@/components/FollowMethodSelect";
import { 对得上的方式 } from "@/lib/follow-method";
import { useFormGuard } from "@/lib/form-guard";
import { 卡点类型们, 影响等级们, 描述上限, type 卡点默认 } from "@/lib/project/blocker-rules";
import { 选沟通附件, 传沟通附件 } from "@/components/FollowAttachments";

/** 记沟通时顺手标的卡点（F-跟进-08）：类型「暂无卡点」且描述空 = 不生成（服务端 沟通卡点 同一条规则） */
type 卡点值 = { type: string; impact: string | null; description: string };
const 空卡点: 卡点值 = { type: "暂无卡点", impact: null, description: "" };

/** 卡点那一块：摆在沟通内容和下一步之间，和项目详情「记一条沟通」一个样子（同一套 CSS） */
function 卡点格({ 默认, 值, on改 }: { 默认: 卡点默认; 值: 卡点值; on改: (x: 卡点值) => void }) {
  return (
    <div className="follow-blocker" style={{ marginBottom: 16 }}>
      <div style={{ marginBottom: 4 }}>卡点<span style={{ color: "var(--text-muted)" }}>（可不填；选了卡点或写了描述，记下时生成一个卡点）</span></div>
      <div className="follow-blocker-row">
        <Select aria-label="卡点类型" value={值.type} onChange={(v) => on改({ ...值, type: v })} options={卡点类型们.map((v) => ({ value: v, label: v }))} />
        <Select aria-label="卡点影响" allowClear value={值.impact} onChange={(v) => on改({ ...值, impact: v ?? null })} placeholder={`卡点影响（默认${默认.默认影响}）`} options={影响等级们.map((v) => ({ value: v, label: v }))} />
      </div>
      <Input.TextArea aria-label="卡点描述" style={{ marginTop: 8 }} autoSize={{ minRows: 1, maxRows: 4 }} maxLength={描述上限} value={值.description} onChange={(e) => on改({ ...值, description: e.target.value })} placeholder="卡在哪儿（可不填）" />
    </div>
  );
}

/** 「标题你改过，没动」里说的名字：和表单上的标签对得上，说短一点 */
const 字段名: Record<string, string> = {
  type: "类型",
  status: "状态",
  title: "标题",
  content: "内容",
  durationMinutes: "时长",
  occurredAt: "时间",
  contactId: "联系人",
  opportunityId: "商机",
};

/** 项目模式主区上的格子：校验没过的不在这里头，才去展开「更多」 */
const 主区格 = new Set(["customerId", "projectId", "content", "下一步", "下一步时间"]);

type Rec = {
  id?: string;
  type?: string;
  /** 企业版沟通方式（10-31）：编辑时带上，下拉摆它 */
  method?: string | null;
  title?: string;
  content?: string;
  status?: string;
  duration?: number | null;
  occurredAt?: string;
  dueAt?: string | null;
  dueHasTime?: boolean | null;
  contactId?: string | null;
  opportunityId?: string | null;
  participants?: string | null;
  /** 编辑时的版本号（J-105）：保存时交回去当闸门 */
  updatedAt?: string;
};

/** AI 速记解析出的"顺带创建"项，勾选后随跟进一起保存 */
type Extras = {
  tasks: { title: string; dueAt: string | null; checked: boolean }[];
  plan: { subject: string; plannedAt: string; method: string; checked: boolean } | null;
  followStatusSuggestion: string | null;
  decisionStatusSuggestion: string | null;
};

/**
 * 跟进表单。两处用：记录页（给了 customerId 和他的联系人、商机）和跟进页页头的「记录跟进」
 * （都不给，第一格挑人，挑中后联系人、商机、到期计划从 CustomerPick 取回来）。只有一份。
 */
export default function FollowUpForm({
  open,
  onClose,
  onSaved,
  customerId: 给定客户,
  预选客户,
  record,
  contacts: 给定联系人,
  opportunities: 给定商机,
  projects = null,
  aiEnabled,
  initialAiText,
  待收口计划 = null,
  完成了计划,
  有WhatsApp = false,
  只读 = false,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** 记录页上给定；跟进页上不给，改由表单第一格挑 */
  customerId?: string;
  /** 不给 customerId 时预填的那一位（从某位客户带过来的） */
  预选客户?: { id: string; name: string } | null;
  record: Rec | null;
  /** 记录页上给；挑人时用挑中那位的 */
  contacts?: { id: string; name: string; position: string | null }[];
  opportunities?: { id: string; name: string }[];
  /**
   * 企业版只用项目时这位客户在推的项目（没结束、不在公海，最近动过的在前）。给了就把「关联商机」换成「关联项目」，
   * 新建默认选第一个（10-27 会议：「默认自动关联当前项目」）；编辑不改挂哪个项目，这一格不摆
   */
  projects?: { id: string; name: string }[] | null;
  aiEnabled: boolean;
  /** 记录页顶部的速记框直接带过来的原文：打开即解析，少点一次 */
  initialAiText?: string;
  /**
   * 这位客户已经到期（今天或更早）的那条跟进计划（审查 M9）。
   * 记的这一笔多半就是在做那件事，所以新建时默认勾上「同时完成」——原来记完了，
   * 首页照样催「发二版阶梯报价已逾期 4 天」
   */
  待收口计划?: { id: string; subject: string; plannedAt: string; method: string } | null;
  /**
   * 勾着「同时完成」保存之后，服务端已一并完成，由记录页显示提示（带撤销和排下一次）。
   * 不给（跟进页上挑人时）就由这张表单自己完成，提示条里带撤销和去他记录页的路
   */
  完成了计划?: (p: { id: string; subject: string; plannedAt: string; method: string }, 已完成?: boolean) => void;
  /**
   * 给定的这位档案里填了 WhatsApp 号：新建时类型默认 WhatsApp（2026-10-17 PR26 手测，和手机上一样）。
   * 挑人时看挑中那位的（近况.有WhatsApp）
   */
  有WhatsApp?: boolean;
  /**
   * 同事的客户（团队开了互看，2026-10-20）：只能记一条跟进。不给选提醒 / 任务、不带 AI 拆出来的待办和计划、不完成别人的计划
   * （服务端 saveFollowUp 同样拦）
   */
  只读?: boolean;
}) {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const AI已用完 = useAiOutOfCredits();
  const router = useRouter();
  const b = useBusiness();
  const type = Form.useWatch("type", form);
  const method = Form.useWatch("method", form) as string | null | undefined;
  const dueAt = Form.useWatch("dueAt", form);
  const dueHasTime = Form.useWatch("dueHasTime", form) ?? true;
  const status = Form.useWatch("status", form);
  const 创建过期待办 = !record?.id && (type === "TASK" || type === "REMIND") && status !== "已完成" && dueAt && (dueHasTime ? dueAt.valueOf() < Date.now() - 60_000 : 是逾期(dueAt.format("YYYY-MM-DD")));

  const projectId = Form.useWatch("projectId", form) as string | undefined;
  const 沟通时刻 = Form.useWatch("occurredAt", form) as ReturnType<typeof dayjs> | undefined;
  const 下一步时刻 = Form.useWatch("下一步时间", form) as ReturnType<typeof dayjs> | null | undefined;
  /*
    选了关联项目（10-30 P0-3）：和项目详情「记一条沟通」走同一条路（记项目沟通Action）——
    要选「客户明确回复了吗」、写下一步，阶段记在项目现在的阶段上。能不能走这条路问服务端（项目沟通须知，只读）：
    不是组员、项目在公海、类型是待办 / 提醒，都照旧走 saveFollowUp
  */
  const 要须知 = open && !!projects && !record?.id;
  const [须知存, set须知存] = useState<{ id: string; r: 项目沟通须知结果 } | null>(null);
  useEffect(() => {
    if (!要须知 || !projectId) return;
    let 作废 = false;
    项目沟通须知(projectId).then(
      (r) => { if (!作废) set须知存({ id: projectId, r }); },
      () => { if (!作废) set须知存({ id: projectId, r: { ok: false, error: "" } }); },
    );
    return () => { 作废 = true; };
  }, [要须知, projectId]);
  const 须知r = 须知存 && 须知存.id === projectId ? 须知存.r : null;
  const 须知 = 要须知 && 须知r && 须知r.ok && 须知r.能记 ? 须知r : null;
  /** 还在问：先别让保存，免得走错路 */
  const 须知问着 = 要须知 && !!projectId && !须知r;
  const 项目模式 = !!须知 && type !== "TASK" && type !== "REMIND";
  /*
    F-跟进-06：项目模式下主区只留沟通内容、卡点、下一步、下一步时间、截图录音，别的收进默认折叠的「更多」。
    AI 速记框里有字（带原文打开、或已解析过）就展开着，不然人看不到 AI 在干什么
  */
  const 收起 = 项目模式 && !!须知;
  const [更多开, set更多开] = useState(false);
  const [卡点, set卡点] = useState<卡点值>(空卡点);
  const [附件们, set附件们] = useState<File[]>([]);
  const 明确回复 = Form.useWatch("明确回复", form) as boolean | undefined;
  // 选了下一步时间就预演回收日：和项目详情同一个算法，算不准（没底子）就不写
  const 预演 = 项目模式 && 须知 ? 预演回收日(须知.回收预演, 沟通时刻?.format("YYYY-MM-DD"), 下一步时刻 ? 下一步时刻.format("YYYY-MM-DD") : null) : null;

  const 挑人 = !给定客户;
  /** 挑中那位的近况：联系人、商机、到期计划都从这儿来。关框、保存时清掉 */
  const [近况, set近况] = useState<客户近况 | null>(null);
  /** 人亲手改过「跟进类型」没有：换人时没改过才跟着新那位有没有 WhatsApp 号走（2026-10-17 复测，同 PlanForm 人改过方式） */
  const 人改过类型 = useRef(false);
  const customerId = 给定客户 ?? 近况?.id;
  const contacts = 给定联系人 ?? 近况?.contacts ?? [];
  const opportunities = 给定商机 ?? 近况?.opportunities ?? [];
  // 外贸「关联商机 / 订单」里订单那一组（跟进挂订单）2026-10-29 随订单表一起删了，只挂商机
  /** 新建默认挂的项目：页面按最近动过排，第一个就是当前在推的 */
  const 默认项目 = projects?.[0]?.id;
  /** 挑人时的「到期计划」和记录页同一个口径：最早那条没做完的，今天或更早到期 */
  const 收口计划 = 挑人
    ? 近况?.未完成计划 && !dayjs(近况.未完成计划.plannedAt).isAfter(dayjs().endOf("day")) ? 近况.未完成计划 : null
    : 待收口计划;

  function 换人(v: 客户近况 | null) {
    set近况(v);
    // 联系人、商机是上一位的，换了人就不作数了（AI 解析填进去的也一样）
    form.setFieldsValue({ contactId: undefined, opportunityId: undefined });
    // 类型人没碰过：跟着这一位有没有 WhatsApp 号走
    if (!record?.id && !record?.type && !人改过类型.current) form.setFieldsValue({ type: v?.有WhatsApp ? "WHATSAPP" : "PHONE" });
  }

  const [aiText, setAiText] = useState("");
  /** 这一次解析走到哪儿了：null = 没解析过；有「起」没结果 = 跑着 */
  const [解析, set解析] = useState<{ 起: number; 结果?: string; 出错?: string } | null>(null);
  const aiLoading = Boolean(解析 && !解析.结果 && !解析.出错);
  const [extras, setExtras] = useState<Extras | null>(null);
  /** 「同时完成那条到期计划」勾没勾。每次打开都重新默认勾上 */
  const [收口, set收口] = useState(true);
  /*
    解析也登记进任务表（lib/ai-jobs）：要十来秒，人会切去别的应用，
    答完了侧栏那条和系统通知会叫他回来。弹窗关了 = 不要了，任务一起清掉——
    清掉之后模型那边回来的结果不会再写回去，也就不会冒出一条「答完了」。
  */
  const 任务键 = `followup-parse:${customerId}`;
  /** 弹窗在解析途中被关掉：回来的结果没人接，不许再往一个已经关掉的表单里填 */
  const 这一次 = useRef(0);

  // AI 面板的状态在关闭/保存的事件处理里重置（见 resetAi），
  // 不放进 effect——react-hooks/set-state-in-effect 禁止，且事件里重置语义更准
  function resetAi() {
    这一次.current++;
    clearJob(任务键);
    setAiText("");
    setExtras(null);
    set解析(null);
    // 下次打开「同时完成计划」重新默认勾上。在关闭的事件里复位，不放 effect（同上）
    set收口(true);
    set近况(null);
    set更多开(false);
    set卡点(空卡点);
    set附件们([]);
  }
  /*
    点外面不关、关前问一句、新建的草稿留在本机（2026-10-19 客户反馈，lib/form-guard.tsx）。
    同一位客户的「新建跟进」是同一个弹窗；跟进页上挑人的，客户、联系人、商机不进草稿（下次重新挑）。
    速记框带原文打开的不存：那是 AI 马上要填的
  */
  const 守 = useFormGuard({
    open,
    form,
    草稿键: record?.id || initialAiText ? null : `新建跟进:${给定客户 ?? "挑人"}:${record?.type ?? ""}`,
    关: () => {
      resetAi();
      onClose();
    },
    填过: () => aiText.trim() !== "" || 卡点.description.trim() !== "" || 附件们.length > 0,
    不存: 给定客户 ? ["projectId"] : ["customerId", "contactId", "opportunityId", "projectId"],
  });

  async function onAiParse() {
    return runParse(aiText);
  }

  async function runParse(text: string) {
    if (AI已用完) return;
    if (!customerId) {
      message.warning(`先挑一位${b.customer}`);
      return;
    }
    if (text.trim().length < 5) {
      message.warning("先把沟通过程随手写几句");
      return;
    }
    const 轮 = ++这一次.current;
    const 起 = Date.now();
    set解析({ 起 });
    const 请求 = parseFollowUpDraft({ customerId, text });
    // 任务表只记「跑着 / 好了 / 出错」给侧栏和系统通知用；草稿本身由下面这条 await 接
    runJob<null>(
      任务键,
      () => 请求.then((r) => (r.ok ? { ok: true as const, value: null } : { ok: false as const, error: r.error })),
      undefined,
      { 名: "解析跟进速记", 去: `/customers/${customerId}` },
    );
    let res: Awaited<typeof 请求>;
    try {
      res = await 请求;
    } catch (e) {
      res = { ok: false, error: e instanceof Error ? e.message : "解析失败，请重试" };
    }
    if (轮 !== 这一次.current) return;
    if (!res.ok) {
      set解析({ 起, 出错: res.error });
      return;
    }
    const d = res.draft;
    /*
      只填人没动过的格子（lib/fill-untouched.ts）。解析要十来秒，这期间人可能已经补了标题、改了类型——
      结果回来整个盖掉，他刚写的就没了。「重新解析」同理：上一轮 AI 填的没人碰过，照换；人改过的留着。
    */
    const { 填, 跳过 } = 只填没动过的(
      {
        type: d.followUp.type,
        status: d.followUp.status,
        title: d.followUp.title || undefined,
        content: d.followUp.content,
        durationMinutes: d.followUp.durationMinutes,
        occurredAt: d.followUp.occurredAt ? dayjs(d.followUp.occurredAt) : dayjs(),
        contactId: d.followUp.contactId ?? undefined,
        opportunityId: d.followUp.opportunityId ?? undefined,
      },
      (name) => form.isFieldTouched(name),
    );
    form.setFieldsValue(填);
    setExtras({
      tasks: d.tasks.map((t) => ({ ...t, checked: true })),
      plan: d.plan ? { ...d.plan, checked: true } : null,
      followStatusSuggestion: d.followStatusSuggestion,
      decisionStatusSuggestion: d.decisionStatusSuggestion,
    });
    // 做完留一行摘要在原地，替掉原来那条一闪就走的提示：人一眼看到 AI 认出了什么，再去核对下面的表
    const 摘要 = [
      FOLLOW_TYPES.find((t) => t.value === d.followUp.type)?.label,
      d.followUp.status,
      d.plan?.plannedAt ? `下次 ${dayjs(d.plan.plannedAt).format("M 月 D 日")}` : null,
      d.tasks.length ? `${d.tasks.length} 条待办` : null,
      跳过说明(跳过, 字段名),
      `${((Date.now() - 起) / 1000).toFixed(1)}s`,
    ].filter(Boolean);
    set解析({ 起, 结果: `已预填：${摘要.join(" · ")}` });
  }

  const autoParsed = useRef<string | null>(null);
  /**
   * 这一回打开是按哪条 record 初始化的；undefined = 关着、还没初始化。
   * 默认项目、有WhatsApp 晚到或后变时 effect 会再跑：原来整张表 resetFields，人选的类型、写的内容全没了（2026-10-28）。
   * 现在只在打开那一刻（关→开、换了一条 record）清表重填，之后只补空
   */
  const 初始化过 = useRef<Rec | null | undefined>(undefined);
  useEffect(() => {
    if (!open) {
      autoParsed.current = null;
      人改过类型.current = false;
      初始化过.current = undefined;
      return;
    }
    if (初始化过.current === record) {
      if (record?.id) return;
      // 项目还空着、人也没碰过才挂默认项目；类型人没改过才跟着有没有 WhatsApp 号走（同换人）
      if (默认项目 && form.getFieldValue("projectId") == null && !form.isFieldTouched("projectId")) form.setFieldsValue({ projectId: 默认项目 });
      if (!record?.type && !人改过类型.current) form.setFieldsValue({ type: 有WhatsApp ? "WHATSAPP" : "PHONE" });
      return;
    }
    初始化过.current = record;
    if (initialAiText && aiEnabled && !record?.id && autoParsed.current !== initialAiText) {
      autoParsed.current = initialAiText;
      setAiText(initialAiText);
      // 解析是异步网络调用，放到下一拍触发，不在 effect 里同步 setState
      const t = setTimeout(() => void runParse(initialAiText), 0);
      return () => clearTimeout(t);
    }
    if (record?.id) {
      form.setFieldsValue({
        ...record,
        occurredAt: dayjs(record.occurredAt),
        dueAt: record.dueAt ? dayjs(record.dueAt) : null,
        dueHasTime: !record.dueAt || !isCalendarDate(record.dueAt),
        durationMinutes: record.duration ? Math.round(record.duration / 60) : null,
      });
      form.setFields([{ name: "dueHasTime", touched: false }, { name: "dueAt", touched: false }]);
    } else {
      form.resetFields();
      form.setFieldsValue({
        type: record?.type ?? (有WhatsApp ? "WHATSAPP" : "PHONE"),
        status: "已完成", dueHasTime: true,
        occurredAt: dayjs(),
        projectId: 默认项目,
      });
    }
  }, [open, record, form, 有WhatsApp, 默认项目]);

  /*
    保存中：网慢时连点两下会建出两条一样的记录（跟进带的 AI 待办和计划也各建两份，2026-10-02 排查）。
    校验没过（validateFields 抛出）也会走 finally 放开
  */
  const [存着, set存着] = useState(false);
  async function 保存() {
    if (存着) return;
    set存着(true);
    try {
      await onOk();
    } catch (error) {
      if (!error || typeof error !== "object" || !("errorFields" in error)) message.error("保存失败，请刷新确认结果后重试");
      // 收起来的「更多」里有格子没过（比如客户明确回复没选）：展开让人看到
      else if (收起 && (error as { errorFields: { name: (string | number)[] }[] }).errorFields.some((e) => !主区格.has(String(e.name[0])))) set更多开(true);
    } finally {
      set存着(false);
    }
  }

  async function onOk() {
    const v = await form.validateFields();
    const 谁 = 给定客户 ?? (v.customerId as string);
    const 名 = 近况?.name;
    const 要收口 = !record?.id && 收口计划 && 收口 ? 收口计划 : null;
    if (项目模式 && 须知 && v.projectId) return 记到项目(v, 谁, 要收口);
    const res = await saveFollowUp({
      id: record?.id,
      版本: record?.id ? record.updatedAt : null,
      customerId: 谁,
      type: v.type,
      method: 对得上的方式(v.type, v.method),
      title: v.title,
      content: v.content,
      status: v.status,
      durationMinutes: v.durationMinutes ?? null,
      occurredAt: v.occurredAt.toISOString(),
      dueAt: v.dueAt ? v.dueHasTime ? v.dueAt.toISOString() : v.dueAt.format("YYYY-MM-DD") : null,
      dueHasTime: !record?.id || record.dueHasTime != null || form.isFieldTouched("dueHasTime") || form.isFieldTouched("dueAt") ? Boolean(v.dueHasTime) : undefined,
      确认过期待办: 创建过期待办 && v.确认过期待办 === true,
      contactId: v.contactId ?? null,
      ...(projects ? (!record?.id ? { projectId: v.projectId ?? null } : {}) : { opportunityId: v.opportunityId ?? null }),
      participants: v.participants ?? null,
      // 经 AI 解析过才带原文：手工写的跟进没有"原文"这个概念
      sourceText: !record?.id && extras ? aiText : null,
      ...(!record?.id ? { 附带: {
        tasks: 只读 ? [] : extras?.tasks.filter((t) => t.checked).map(({ title, dueAt }) => ({ title, dueAt })) ?? [],
        plan: !只读 && extras?.plan?.checked ? { subject: extras.plan.subject, plannedAt: extras.plan.plannedAt, method: extras.plan.method } : null,
        完成计划: 只读 ? undefined : 要收口?.id,
      } } : {}),
    });
    // 校验不通过时必须如实报错，否则界面照样提示成功、人以为已经存下了
    if (!res.ok) {
      message.error(res.error);
      // 撞了版本（J-105）：页面上的数据先刷成最新的，人关框重开就是新的那一版，不然拿着旧版本再存还是被拦
      if (record?.id) router.refresh();
      return;
    }

    resetAi();
    守.存好了();
    onSaved();
    // 顺手完成那条到期计划：记录页上提示由它出（带撤销、排下一次），这里就不再单说一句「沟通已记下」
    if (要收口 && 完成了计划) return void 完成了计划(要收口, true);
    if (!挑人 || !名) {
      if (要收口) void window.desktopReminders?.刷新();
      if ("待办id" in res && res.待办id) {
        // 顺带建了待办：Dock 数和到点提醒要马上跟上
        void window.desktopReminders?.刷新();
        return void message.success("沟通已记下，也加进了待办——到点会提醒你");
      }
      return void message.success(record?.id ? "已保存" : "领取了" in res && res.领取了 ? "已领取并记下这条沟通，这位现在归你了" : "沟通已记下");
    }

    // 跟进页上挑人记的：人留在原地（新的那行会亮一下），提示里给撤销和去他记录页的路
    if (要收口) {
      void window.desktopReminders?.刷新();
    }
    const key = `followup-new-${res.id}`;
    message.success({
      key,
      duration: 6,
      content: (
        <span>
          {要收口 ? `沟通已记下，计划「${要收口.subject}」一并完成` : `已记下和${名}的这次沟通`}
          {要收口 && (
            <Button
              type="link"
              size="small"
              onClick={async () => {
                message.destroy(key);
                await completePlan(要收口.id, false);
                void window.desktopReminders?.刷新();
                message.success(`「${要收口.subject}」已改回未完成`);
                router.refresh();
              }}
            >
              撤销
            </Button>
          )}
          <Button type="link" size="small" onClick={() => { message.destroy(key); router.push(`/customers/${谁}`); }}>
            去{名}的记录页
          </Button>
        </span>
      ),
    });
  }

  /**
   * 项目模式保存：先走项目那条（记项目沟通Action，和项目详情一样建这条沟通、记阶段标记、可能自动推进、按需生成卡点；
   * 标题、另选的联系人、状态、时长、参与人一起交），再传截图录音，最后做顺带的（完成到期计划、AI 拆出的待办和计划）。
   * 后两步各自是一次请求，不和第一步同一个事务：第一步成了就算记下了，后面哪步没成单独说
   */
  async function 记到项目(v: Awaited<ReturnType<typeof form.validateFields>>, 谁: string, 要收口: typeof 收口计划) {
    if (!须知) return;
    // 标题、另选的联系人、状态、时长、参与人随这一次一起交（服务端 认沟通额外），不再事后拿 saveFollowUp 补——普通成员不能改沟通了（M-权限-09）
    const r = await 记项目沟通Action(v.projectId, {
      type: v.type, method: 对得上的方式(v.type, v.method), content: v.content, occurredAt: v.occurredAt.toISOString(),
      阶段: 须知.phase, 明确回复: v.明确回复 === true,
      下一步: v.下一步, 下一步时间: v.下一步时间 ? v.下一步时间.format("YYYY-MM-DD") : null,
      额外: {
        title: v.title ?? null, contactId: v.contactId ?? null, status: v.status ?? "已完成",
        durationMinutes: v.durationMinutes ?? null, participants: v.participants ?? null,
      },
    }, 须知.卡点默认 ? 卡点 : undefined);
    if (!r.ok) return void message.error("error" in r ? r.error : "没记上，请刷新后重试");
    const 没存上: string[] = [];
    if (附件们.length && r.followUpId) {
      const 错 = await 传沟通附件(r.followUpId, 附件们);
      if (错.length) 没存上.push(`${错.length} 个截图 / 录音（${错[0]}）`);
    }
    if (!只读) {
      for (const t of extras?.tasks.filter((x) => x.checked) ?? []) {
        const x = await saveTask({ customerId: 谁, title: t.title, dueAt: t.dueAt });
        if (!x.ok) 没存上.push(`待办「${t.title}」`);
      }
      if (extras?.plan?.checked) {
        const x = await savePlan({ customerId: 谁, subject: extras.plan.subject, plannedAt: extras.plan.plannedAt, method: extras.plan.method });
        if (!x.ok) 没存上.push("下次跟进计划");
      }
      if (要收口) await completePlan(要收口.id);
      if (要收口 || extras?.tasks.some((x) => x.checked)) void window.desktopReminders?.刷新();
    }
    resetAi();
    守.存好了();
    onSaved();
    if (没存上.length) message.warning(`沟通已记下，${没存上.join("、")}没存上，请到记录页补一下`);
    if ("卡点" in r && r.卡点) message.success(`已生成卡点 ${r.卡点}`);
    if ("卡点没发" in r && r.卡点没发) message.warning(`沟通记下了，卡点没生成：${r.卡点没发}`);
    if (r.自动推到?.length) message.success(`必填齐了，自动推进到 ${r.自动推到.join(" → ")}`);
    if (要收口 && !只读 && 完成了计划) return void 完成了计划(要收口, true);
    message.success(要收口 && !只读 ? `沟通已记下，计划「${要收口.subject}」一并完成` : "沟通已记下");
  }

  const showDuration = type === "PHONE" || type === "MEETING";
  const showDue = type === "TASK" || type === "REMIND";
  const showAi = aiEnabled && !record?.id;
  /** 「更多」显不显示：人点开了，或 AI 速记框里有字 / 解析过 */
  const 更多显示 = 更多开 || !!aiText.trim() || !!解析;
  /** 挑人模式下还没挑：AI 解析要知道是谁（认联系人、商机），先不让点 */
  const 还没挑 = !customerId;
  const suggestions = [
    extras?.followStatusSuggestion ? `跟进状态 → ${statusLabel(b, extras.followStatusSuggestion)}` : null,
    extras?.decisionStatusSuggestion ? `决策状态 → ${statusLabel(b, extras.decisionStatusSuggestion)}` : null,
  ].filter(Boolean);

  /** AI 速记那一块：项目模式收进「更多」，别的时候照旧在最上面 */
  const AI块 = showAi && (
  <div
    style={{
      background: "var(--brand-bg)",
      border: "1px solid var(--brand-line)",
      borderRadius: 8,
      padding: "12px 14px",
      marginBottom: 8,
    }}
  >
    <Input.TextArea
      value={aiText}
      onChange={(e) => setAiText(e.target.value)}
      autoSize={{ minRows: 2, maxRows: 6 }}
      maxLength={5000}
      placeholder={'跟进速记：把沟通过程随手倒出来，或直接粘贴微信聊天记录，AI 帮你填表。\n如："刚和周总通了 20 分钟电话，他担心交期，想先小批量试一单，下周三再约他聊报价"'}
    />
    <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      {解析 ? (
        <div style={{ flex: 1, minWidth: 0, marginRight: 12 }}>
          <AiWait 在做="从这段话里认出沟通方式、结果和下次时间" 起={解析.起} 结果={解析.结果} 出错={解析.出错} />
        </div>
      ) : (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {还没挑 ? `先挑一位${b.customer}，AI 才认得出他的联系人和商机` : "解析结果只是预填，核对无误再保存"}
        </Typography.Text>
      )}
      {/* 跑着时不转圈：在做什么、过了几秒，左边那一行已经说了。按钮只负责「现在不能再点」 */}
      <Button size="small" type="primary" ghost icon={<ThunderboltOutlined />} disabled={aiLoading || 还没挑 || AI已用完} onClick={onAiParse}>
        {解析?.结果 ? "重新解析" : "AI 解析填表"}
        <AiCost />
      </Button>
    </div>
    {AI已用完 && <AiRemaining />}
  </div>
  );

  return (
    <Modal
      {...守.弹窗}
      open={open}
      title={record?.id ? "编辑沟通记录" : "记一条沟通"}
      onOk={保存}
      confirmLoading={存着 || 须知问着}
      okText="保存"
      cancelText="取消"
      width={640}
      destroyOnHidden
    >
      {/* AI 速记块放在 Form 里面（它不是字段）：挑人那一格是 Form.Item，得在它上面、仍是第一格 */}
      <Form form={form} layout="vertical" style={{ marginTop: 8 }} onValuesChange={(changed) => { if ("type" in changed) 人改过类型.current = true; 守.改了(); }}>
        {挑人 && <CustomerPick 预选={预选客户} 近况={近况} on近况={换人} 不提计划={Boolean(收口计划)} />}
        {!收起 && AI块}
        {收起 ? (
          /*
            F-跟进-06（项目模式）：主区只摆关联项目、沟通内容、卡点、下一步、下一步时间、截图录音；
            沟通方式、状态、发生时间、标题、联系人、时长、参与人、客户明确回复、AI 收进默认折叠的「更多」。
            折起来只是不显示（Form.Item 照样挂着），校验一个不少；没过的格子在「更多」里就自动展开
          */
          <Row gutter={16}>
            {projects ? !record?.id && (
              <Col span={24}>
                {/*
                  10-26 白板：「沟通跟进记录必须选项目当前阶段」。有在推项目就必选、不能清空；
                  一个在推项目都没有时先照旧能记（projectId 存空），只提示去建项目
                */}
                {projects.length > 0 ? (
                  <Form.Item name="projectId" label="关联项目" rules={[{ required: true, message: "请选择关联项目" }]}>
                    <Select placeholder="选择项目" options={projects.map((p) => ({ value: p.id, label: p.name }))} />
                  </Form.Item>
                ) : (
                  <Form.Item name="projectId" label="关联项目" extra="没挂项目，建议先建项目">
                    <Select disabled placeholder="没有在推的项目" options={[]} />
                  </Form.Item>
                )}
              </Col>
            ) : <Col span={24}>
              <Form.Item name="opportunityId" label="关联商机">
                <Select
                  allowClear
                  placeholder="选择商机"
                  options={opportunities.map((o) => ({ value: o.id, label: o.name }))}
                />
              </Form.Item>
            </Col>}
            <Col span={24}>
              <Form.Item name="content" label="沟通内容" rules={[requiredText("请填写沟通内容")]}>
                <Input.TextArea rows={4} placeholder="记录沟通要点、客户反馈、下一步动作…" />
              </Form.Item>
            </Col>
            {须知?.卡点默认 && (
              <Col span={24}>
                <卡点格 默认={须知.卡点默认} 值={卡点} on改={(x) => { set卡点(x); 守.改了(); }} />
              </Col>
            )}
            <Col span={24}>
              <Form.Item name="下一步" preserve={false} label="下一步做什么" rules={[requiredText("请写下一步做什么")]}>
                <Input maxLength={下一步文字上限} showCount placeholder="比如：周五前发报价单给对方采购" />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item
                label="下一步时间"
                required={须知.要下一步}
                extra={预演 ? (
                  <span style={{ color: 回公海颜色[回公海文案(预演).级别] }}>选这天 → 回收日变为 {dayjs(预演).format("MM-DD")}</span>
                ) : 须知.要下一步 ? "那天过完还没有新的沟通，项目会回公海" : "可不填"}
              >
                <Form.Item name="下一步时间" preserve={false} noStyle rules={须知.要下一步 ? [{ required: true, message: "请填下一步时间" }] : []}>
                  <DatePicker aria-label="下一步时间" style={{ width: 200 }} disabledDate={(x) => x.isBefore(dayjs(), "day")} />
                </Form.Item>
                <Space size={4} wrap style={{ marginLeft: 8 }}>
                  {([["明天", 1], ["3 天后", 3], ["1 周后", 7]] as const).map(([名, 天]) => {
                    const 日 = dayjs().add(天, "day");
                    const 选着 = 下一步时刻?.isSame(日, "day") ?? false;
                    return (
                      <Button
                        key={名}
                        size="small"
                        type={选着 ? "primary" : "default"}
                        ghost={选着}
                        onClick={() => {
                          form.setFieldsValue({ 下一步时间: 日 });
                          void form.validateFields(["下一步时间"]).catch(() => {});
                          守.改了();
                        }}
                      >
                        {名}
                      </Button>
                    );
                  })}
                </Space>
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item label="截图 / 录音" extra="可不传，保存后挂在这条沟通上">
                <选沟通附件 文件们={附件们} on改={(x) => { set附件们(x); 守.改了(); }} />
              </Form.Item>
            </Col>
            <Col span={24} style={{ marginBottom: 12 }}>
              <Button type="link" size="small" style={{ paddingInline: 0 }} icon={<DownOutlined rotate={更多显示 ? 180 : 0} />} aria-expanded={更多显示} onClick={() => set更多开(!更多显示)}>
                更多：沟通方式、发生时间、状态、标题、联系人、客户明确回复{showAi ? "、AI 速记" : ""}
              </Button>
              {!更多显示 && 明确回复 == null && <span style={{ color: "var(--danger-text)", fontSize: "var(--dt-aux, 12px)" }}> 客户明确回复还没选</span>}
            </Col>
            <Col span={24} style={更多显示 ? undefined : { display: "none" }}>
              <div className="follow-more" style={{ marginBottom: 12 }}>
                {AI块}
                <Row gutter={16}>
                  <Col span={8}>
                    <Form.Item name="type" hidden rules={[{ required: true }]}><Input /></Form.Item>
                    <Form.Item name="method" hidden><Input /></Form.Item>
                    {/* 企业版列字典里的沟通方式，类型跟着推（FollowMethodSelect）；别的版本就是类型下拉 */}
                    <Form.Item label="沟通方式" required>
                      <FollowMethodSelect
                        aria-label="沟通方式"
                        type={type ?? "PHONE"}
                        method={method}
                        类型们={跟进类型们(外贸精简(b)).filter((t) => !只读 || (t.value !== "TASK" && t.value !== "REMIND"))}
                        onChange={(v) => { form.setFieldsValue(v); 人改过类型.current = true; 守.改了(); }}
                      />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item name="status" label="状态">
                      <Select options={FOLLOW_RECORD_STATUSES.map((s) => ({ value: s, label: s }))} />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item name="occurredAt" label="发生时间" rules={[{ required: true }]}>
                      <DatePicker showTime maxDate={dayjs().endOf("day")} format="YYYY-MM-DD HH:mm" style={{ width: "100%" }} />
                    </Form.Item>
                  </Col>

                  <Col span={24}>
                    {/* 选填：时间线上已有跟进类型，标题只在需要一句话概括时才有意义 */}
                    <Form.Item name="title" label="标题" extra="选填，填了会显示在沟通记录上">
                      <Input placeholder="如：与周总沟通试单与报价" />
                    </Form.Item>
                  </Col>

                  <Col span={12}>
                    <Form.Item name="contactId" label="对接联系人">
                      <Select
                        allowClear
                        placeholder="选择联系人"
                        options={contacts.map((c) => ({
                          value: c.id,
                          label: c.position ? `${c.name}（${c.position}）` : c.name,
                        }))}
                      />
                    </Form.Item>
                  </Col>

                  {showDuration && (
                    <Col span={12}>
                      <Form.Item name="durationMinutes" label="时长（分钟）">
                        <InputNumber min={0} max={600} style={{ width: "100%" }} placeholder="如 18" />
                      </Form.Item>
                    </Col>
                  )}
                  {showDue && (
                    <Col span={12}>
                      <Form.Item
                        name="dueAt"
                        label={type === "TASK" ? "截止时间" : "提醒时间"}
                        extra={record?.id ? undefined : 创建过期待办 ? "这个时间已过期，创建的待办会立即进入到期清单" : dueHasTime ? "填了会同时加进待办，到点提醒" : "仅日期会进入当天待办，不弹定时提醒"}
                      >
                        <DatePicker showTime={dueHasTime} format={dueHasTime ? "YYYY-MM-DD HH:mm" : "YYYY-MM-DD"} style={{ width: "100%" }} />
                      </Form.Item>
                    </Col>
                  )}
                  {showDue && <Col span={24}><Form.Item name="dueHasTime" valuePropName="checked"><Checkbox>指定钟点并到点提醒</Checkbox></Form.Item>{record?.dueAt && record.dueHasTime == null && !isCalendarDate(record.dueAt) && <Typography.Paragraph type="secondary">旧记录未保存是否选了钟点；只改其他内容会保留原提醒方式，请核对后重新选择日期或钟点。</Typography.Paragraph>}</Col>}
                  {创建过期待办 && <Col span={24}><Form.Item name="确认过期待办" preserve={false} valuePropName="checked" rules={[{ validator: (_, v) => v === true ? Promise.resolve() : Promise.reject(new Error("请确认创建过期待办，或修改提醒时间/状态")) }]}><Checkbox>我确认仍要创建过期待办</Checkbox></Form.Item></Col>}
                  {type === "MEETING" && (
                    <Col span={12}>
                      <Form.Item name="participants" label="参与人" tooltip="多人用逗号分隔">
                        <Input placeholder="周总, 小李" />
                      </Form.Item>
                    </Col>
                  )}
                  <Col span={24}>
                    <Form.Item name="明确回复" preserve={false} label="客户明确回复了吗" extra={`记在项目现在的阶段（${须知.phase}）上`} rules={[{ required: true, message: "请选客户明确回复了吗" }]}>
                      <Radio.Group options={[{ value: true, label: "客户明确回复了" }, { value: false, label: "没有明确回复" }]} />
                    </Form.Item>
                  </Col>
                </Row>
              </div>
            </Col>
          </Row>
        ) : (
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="type" hidden rules={[{ required: true }]}><Input /></Form.Item>
              <Form.Item name="method" hidden><Input /></Form.Item>
              {/* 企业版列字典里的沟通方式，类型跟着推（FollowMethodSelect）；别的版本就是类型下拉 */}
              <Form.Item label="沟通方式" required>
                <FollowMethodSelect
                  aria-label="沟通方式"
                  type={type ?? "PHONE"}
                  method={method}
                  类型们={跟进类型们(外贸精简(b)).filter((t) => !只读 || (t.value !== "TASK" && t.value !== "REMIND"))}
                  onChange={(v) => { form.setFieldsValue(v); 人改过类型.current = true; 守.改了(); }}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="status" label="状态">
                <Select options={FOLLOW_RECORD_STATUSES.map((s) => ({ value: s, label: s }))} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="occurredAt" label="发生时间" rules={[{ required: true }]}>
                <DatePicker showTime maxDate={dayjs().endOf("day")} format="YYYY-MM-DD HH:mm" style={{ width: "100%" }} />
              </Form.Item>
            </Col>

            <Col span={24}>
              {/* 选填：时间线上已有跟进类型，标题只在需要一句话概括时才有意义 */}
              <Form.Item name="title" label="标题" extra="选填，填了会显示在沟通记录上">
                <Input placeholder="如：与周总沟通试单与报价" />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="content" label="沟通内容" rules={[requiredText("请填写沟通内容")]}>
                <Input.TextArea rows={4} placeholder="记录沟通要点、客户反馈、下一步动作…" />
              </Form.Item>
            </Col>

            <Col span={12}>
              <Form.Item name="contactId" label="对接联系人">
                <Select
                  allowClear
                  placeholder="选择联系人"
                  options={contacts.map((c) => ({
                    value: c.id,
                    label: c.position ? `${c.name}（${c.position}）` : c.name,
                  }))}
                />
              </Form.Item>
            </Col>
            {projects ? !record?.id && (
              <Col span={12}>
                {/*
                  10-26 白板：「沟通跟进记录必须选项目当前阶段」。有在推项目就必选、不能清空；
                  一个在推项目都没有时先照旧能记（projectId 存空），只提示去建项目
                */}
                {projects.length > 0 ? (
                  <Form.Item name="projectId" label="关联项目" rules={[{ required: true, message: "请选择关联项目" }]}>
                    <Select placeholder="选择项目" options={projects.map((p) => ({ value: p.id, label: p.name }))} />
                  </Form.Item>
                ) : (
                  <Form.Item name="projectId" label="关联项目" extra="没挂项目，建议先建项目">
                    <Select disabled placeholder="没有在推的项目" options={[]} />
                  </Form.Item>
                )}
              </Col>
            ) : <Col span={12}>
              <Form.Item name="opportunityId" label="关联商机">
                <Select
                  allowClear
                  placeholder="选择商机"
                  options={opportunities.map((o) => ({ value: o.id, label: o.name }))}
                />
              </Form.Item>
            </Col>}

            {showDuration && (
              <Col span={12}>
                <Form.Item name="durationMinutes" label="时长（分钟）">
                  <InputNumber min={0} max={600} style={{ width: "100%" }} placeholder="如 18" />
                </Form.Item>
              </Col>
            )}
            {showDue && (
              <Col span={12}>
                <Form.Item
                  name="dueAt"
                  label={type === "TASK" ? "截止时间" : "提醒时间"}
                  extra={record?.id ? undefined : 创建过期待办 ? "这个时间已过期，创建的待办会立即进入到期清单" : dueHasTime ? "填了会同时加进待办，到点提醒" : "仅日期会进入当天待办，不弹定时提醒"}
                >
                  <DatePicker showTime={dueHasTime} format={dueHasTime ? "YYYY-MM-DD HH:mm" : "YYYY-MM-DD"} style={{ width: "100%" }} />
                </Form.Item>
              </Col>
            )}
            {showDue && <Col span={24}><Form.Item name="dueHasTime" valuePropName="checked"><Checkbox>指定钟点并到点提醒</Checkbox></Form.Item>{record?.dueAt && record.dueHasTime == null && !isCalendarDate(record.dueAt) && <Typography.Paragraph type="secondary">旧记录未保存是否选了钟点；只改其他内容会保留原提醒方式，请核对后重新选择日期或钟点。</Typography.Paragraph>}</Col>}
            {创建过期待办 && <Col span={24}><Form.Item name="确认过期待办" preserve={false} valuePropName="checked" rules={[{ validator: (_, v) => v === true ? Promise.resolve() : Promise.reject(new Error("请确认创建过期待办，或修改提醒时间/状态")) }]}><Checkbox>我确认仍要创建过期待办</Checkbox></Form.Item></Col>}
            {type === "MEETING" && (
              <Col span={12}>
                <Form.Item name="participants" label="参与人" tooltip="多人用逗号分隔">
                  <Input placeholder="周总, 小李" />
                </Form.Item>
              </Col>
            )}
          </Row>
        )}
      </Form>

      {!record?.id && !只读 && 收口计划 && (
        <div style={{ borderTop: "1px dashed var(--line-soft)", paddingTop: 12, marginTop: 4 }}>
          <Checkbox checked={收口} onChange={(e) => set收口(e.target.checked)}>
            同时完成计划「{收口计划.subject}」
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>（原定 {fmtDateTime(收口计划.plannedAt)}）</Typography.Text>
          </Checkbox>
        </div>
      )}

      {extras && !record?.id && !只读 && (extras.tasks.length > 0 || extras.plan || suggestions.length > 0) && (
        <div style={{ borderTop: "1px dashed var(--line-soft)", paddingTop: 12, marginTop: 4 }}>
          <Space orientation="vertical" size={6} style={{ width: "100%" }}>
            {extras.tasks.map((t, i) => (
              <Checkbox
                key={i}
                checked={t.checked}
                onChange={(e) =>
                  setExtras({
                    ...extras,
                    tasks: extras.tasks.map((x, j) => (j === i ? { ...x, checked: e.target.checked } : x)),
                  })
                }
              >
                同时创建待办：{t.title}
                {t.dueAt ? `（截止 ${fmtDateTime(t.dueAt)}）` : ""}
              </Checkbox>
            ))}
            {extras.plan && (
              <Checkbox
                checked={extras.plan.checked}
                onChange={(e) => setExtras({ ...extras, plan: { ...extras.plan!, checked: e.target.checked } })}
              >
                同时创建下次跟进计划：{extras.plan.subject} · {fmtDateTime(extras.plan.plannedAt)} · {extras.plan.method}
              </Checkbox>
            )}
            {suggestions.length > 0 && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                AI 建议：{suggestions.join("；")}（如认可，保存后可点{b.customer}档案页顶部的对应状态标签修改）
              </Typography.Text>
            )}
          </Space>
        </div>
      )}
    </Modal>
  );
}
