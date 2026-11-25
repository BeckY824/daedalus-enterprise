"use client";

import DatePicker from "@/components/BusinessDatePicker";

import { useContext, useEffect, useRef, useState } from "react";
import { 只读上下文, 只能看的格上下文, 资料改挡上下文 } from "./read-only";
import { 是空值, 有值, 空值符 } from "@/lib/empty-value";
import { useRouter } from "next/navigation";
import { AutoComplete, Input, Select } from "antd";
import { EditOutlined } from "@ant-design/icons";
import { dayjs } from "@/lib/utils";
import { patchCustomer, type PatchableKey } from "../actions";
import { 带走说法 } from "@/lib/carry-over";
import { useTransferConfirm } from "../useTransferConfirm";
import Shortcut from "@/components/Shortcut";
import { 释义下拉 } from "@/components/DictNote";
import { 不填项, 去不填 } from "@/lib/enterprise/dict-kinds";
import { useFormDraft } from "@/components/FormDraft";
import { 动作出错话 } from "@/lib/stale-deploy";

type Option = { value: string; label: string };

/**
 * 记录页左栏的"点一下就能改"字段。
 * 平时是一行文字；点击变成输入框，失焦或回车即存，Esc 放弃。
 * 不弹窗、不用"保存"按钮——改一个字段本来就该是一个动作。
 *
 * Esc 一律**还原并收起**（审查 D4）：原来「能选也能填」那一类按 Esc 不还原草稿，
 * 下次点开看到的是上次没存的字；而且输入框一收起，浏览器补发的那次失焦会拿着旧草稿去存——
 * 所以放弃用一个 ref 记着，commit 看见它就什么都不做。每次点开也从当前值起步。
 * 多行的「备注」回车是换行，⌘↵ 才存（框下面有一行淡字说）。
 */
export default function InlineField({
  customerId,
  field,
  label,
  value,
  kind = "text",
  options,
  placeholder = "点击填写",
  可清空 = false,
  释义,
  空时横线 = false,
  显示,
}: {
  customerId: string;
  field: PatchableKey;
  label: string;
  value: string | null;
  /** combo = 能选也能填的下拉。给职位 / 年级那种「库里是自由文本、下拉只是建议」的字段 */
  kind?: "text" | "textarea" | "select" | "combo" | "date";
  options?: Option[];
  placeholder?: string;
  /**
   * 下拉能清空（排查 D8）。渠道负责人那一格说明里写着「清空即恢复按推荐链」，原来下拉却没有清空的叉，
   * 一旦手工指定过就回不去了
   */
  可清空?: boolean;
  /** 下拉每项下面一行灰字（企业版客户类型，10-30）：名字 → 释义；框里选中后还是只显示名字 */
  释义?: Record<string, string>;
  /**
   * 没填时也写「—」（11-01 会议：企业版客户详情页未填字段一律用 — 代替）。
   * 「点击填写」那句挪到悬停提示里，点「—」照旧进编辑
   */
  空时横线?: boolean;
  /**
   * 有值时换个样子显示（11-09：企业版电话、邮箱是文字 + 复制键）。
   * 复制键点了只复制、不进编辑（CopyValue 自己拦）；点这一行别处才进编辑
   */
  显示?: (v: string) => React.ReactNode;
}) {
  const router = useRouter();
  const { 先问转走的项目 } = useTransferConfirm();
  /**
   * dt.field：存的时候先摆新值（待显），刷新回来的 value 换上之前不闪回旧值；没存上就退回旧值、原因写在格子下面。
   * 负责人那格例外：交接中的负责人还没换，不先摆
   */
  /** 基准 = 先摆时服务端给的值；刷新回来 value 变了就不再先摆（渲染时比，不放 effect） */
  const [待显, set待显] = useState<{ 值: string | null; 基准: string | null } | null>(null);
  const [话, set话] = useState<{ 话: string; 错?: boolean } | null>(null);
  const 话计时 = useRef<ReturnType<typeof setTimeout> | null>(null);
  const 说 = (x: { 话: string; 错?: boolean }) => {
    if (话计时.current) clearTimeout(话计时.current);
    set话(x);
    话计时.current = setTimeout(() => set话(null), 6000);
  };
  // 企业版字段权限「只能看」的格（11-03 D5-1）：和整页只读一样只显示、不给点，悬停说为什么
  const 权限挡 = useContext(只能看的格上下文).includes(field);
  const 改挡 = useContext(资料改挡上下文);
  const 归属挡 = 改挡 && (field !== "salesOwnerId" || 改挡.公海) ? 改挡.话 : null;
  const 只读 = useContext(只读上下文) || 权限挡 || !!归属挡;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string | null>(value);
  const [saving, setSaving] = useState(false);
  /** 这一次编辑是不是按 Esc 放弃了。放弃之后的失焦不许存 */
  const 放弃了 = useRef(false);
  /** combo 那一格眼下的值。回车 / 失焦晚一拍提交时读它，不读闭包里那个旧的 draft */
  const 最新 = useRef<string>(value ?? "");
  /*
    打字的两种格（text / textarea）留草稿（11-17，components/FormDraft.tsx）：没存上（发版后老页面、没权限……）、刷新了，
    再点开这一格带回打过的字。存上了 / Esc 放弃就删
  */
  const 打字格 = kind === "text" || kind === "textarea";
  const 稿 = useFormDraft({
    键: 打字格 ? `客户:${customerId}:就地:${field}` : null,
    开: editing,
    值: { v: draft },
    带回: (x) => {
      if (typeof x.v === "string") setDraft(x.v);
    },
    紧凑: true,
  });

  function 开始() {
    放弃了.current = false;
    交过了.current = false;
    最新.current = value ?? "";
    setDraft(value);
    setEditing(true);
  }
  function 放弃() {
    放弃了.current = true;
    稿.丢掉();
    setDraft(value);
    setEditing(false);
  }

  /** 这一次编辑交过了没有：combo 的选中 / 回车 / 失焦可能接连到，只交一次 */
  const 交过了 = useRef(false);
  async function commit(next: string | null) {
    if (放弃了.current || 交过了.current) return;
    交过了.current = true;
    setEditing(false);
    const normalized = next?.trim() ? next.trim() : null;
    if ((normalized ?? null) === (value ?? null)) return void 稿.丢掉();
    // 换销售负责人：客户名下的项目跟着走（企业版同事负责的留下，P-转-07），先列出来问一句（D-36）；取消 = 不改
    if (field === "salesOwnerId" && normalized && !(await 先问转走的项目([customerId], normalized))) {
      setDraft(value);
      return;
    }
    if (field !== "salesOwnerId") set待显({ 值: normalized, 基准: value });
    setSaving(true);
    const res = await patchCustomer(customerId, field, normalized).catch((e) => ({ ok: false as const, error: 动作出错话(e, "没存上，请稍后再试") }));
    setSaving(false);
    if (!res.ok) {
      // 打的字还在草稿里：再点开这一格会带回来
      if (打字格 && 有值(next)) 说({ 话: `${res.error}（打的字还留着，再点开这一格接着改）`, 错: true });
      else 说({ 话: res.error, 错: true });
      set待显(null);
      setDraft(value);
      return;
    }
    稿.存好了();
    /*
      服务端回了最后存下的样子（规整过的、或没动的库里现值）：按它摆，不按人敲的那串（11-17 员工反馈：电话格敲了带字母的串，
      服务端没写，格子却一直摆着那串，刷新才变回去）。和原来一样的就不再先摆
    */
    if ("值" in res && res.值 !== undefined && field !== "salesOwnerId") {
      const 终 = typeof res.值 === "string" && res.值.trim() ? res.值 : null;
      set待显(终 === (value ?? null) ? null : { 值: 终, 基准: value });
      setDraft(终);
    }
    // 换了销售负责人，原负责人没做完的活一起转过去了：说一声，不然人不知道计划和待办换了主（排查 B3）
    const 带走 = 带走说法(res.带走);
    // 企业版「交接中」（11-09）：同转让，负责人还没换，等接手人确认
    // 这几句写在负责人那格下面（不弹顶部提示）
    if (res.交接中) 说({ 话: res.申请移交 ? "已发起客户转让，等接手人确认后生效，确认前仍在你名下" : "已发起交接：等接手人确认，确认前仍在原负责人名下" });
    else if (res.交接已在路上) 说({ 话: "这位已在另一笔交接里，没再发起" });
    else if (res.带走?.没转成) 说({ 话: "负责人刚被别人改了，这次没转", 错: true });
    else if (带走) 说({ 话: `已转给新负责人${带走}` });
    /*
      已 revalidatePath 的保存不再 router.refresh（跳转优化 PR-B 11-25）：动作里 revalidatePath 了，Next 在同一个回包里就把这页重新渲染好带回来；再 refresh 是让服务器把整页再算一遍，还会把预取缓存再清一次（patchCustomer 存成了都 revalidatePath 这位客户）。
      换负责人照旧 refresh：走交接那一支（发起转让交接）回来的不一定 revalidate 过，权限、只读也跟着变
    */
    if (field === "salesOwnerId") router.refresh();
  }

  const 显值 = 待显 && 待显.基准 === value ? 待显.值 : value;
  const 原显 =
    (kind === "select" || kind === "combo") && options
      ? (options.find((o) => o.value === 显值)?.label ?? 显值)
      : kind === "date" && 有值(显值)
        ? dayjs(显值).format("YYYY-MM-DD")
        : 显值;
  const 话行 = 话 && <div role={话.错 ? "alert" : "status"} className={话.错 ? "cd-task-err rec-field-said" : "rec-field-said"}>{话.话}</div>;
  // 导入时拿 "-" 占位的也算没填（11-01）：只读显示「—」，能编辑的照常给填写提示
  const display = typeof 原显 === "string" && 是空值(原显) ? null : 原显;

  if (!editing) {
    return (
      <div className={`rec-field${kind === "textarea" ? " is-multi" : ""}`} data-field={field} {...(只读 ? { style: { cursor: "default" }, ...(权限挡 ? { title: `你的角色只能看「${label}」，改不了（设置 → 组织架构 → 字段权限）` } : 归属挡 ? { title: 归属挡 } : {}) } : { onClick: 开始, role: "button", tabIndex: 0, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter") 开始(); else if (e.key === " " && e.target === e.currentTarget) { e.preventDefault(); 开始(); } }, "aria-label": `编辑${label}` })}>
        <div className="rec-field-k">{label}</div>
        {/* 一行、放不下打省略号、悬停看全文（11-04 用户：「尽量所有信息都在一行显示完整。除了备注」）；
            悬停浮层是全站的 TruncTip，量到真截了才出。多行的备注照旧换行。
            换样子显示的（电话、邮箱）省略号打在文字自己身上，复制键不被挤出去（.copy-val） */}
        <div
          className={`rec-field-v${display ? "" : " rec-field-empty"}${saving ? " rec-field-saving" : ""}${kind === "textarea" ? "" : " is-line"}`}
          title={!display && 空时横线 && !只读 ? placeholder : undefined}
        >
          {显示 && typeof display === "string" && display ? (
            <span className="rec-field-link">{显示(display)}</span>
          ) : kind === "textarea" && typeof display === "string" && display ? (
            <LongText text={display} />
          ) : (
            display || (只读 || 空时横线 ? 空值符 : placeholder)
          )}
        </div>
        {/* 能改的格行尾一支笔（规范 M3-b）：悬停才出、触屏常显 */}
        {!只读 && <EditOutlined className="rec-field-pen" aria-hidden />}
        {话行}
      </div>
    );
  }

  const common = { autoFocus: true, size: "middle" as const, style: { width: "100%" } };
  return (
    <div className={`rec-field rec-field-editing${kind === "textarea" ? " is-multi" : ""}`} data-field={field}>
      <div className="rec-field-k">{label}</div>
      {kind === "select" && (
        <Select
          {...common}
          defaultOpen
          value={draft ?? undefined}
          // 能清空的下拉第一项是「—」（11-04 用户）：误点了选一个值，能选回没填，不用找那个悬停才出的叉
          options={可清空 && options ? [不填项, ...options] : options}
          {...释义下拉(释义)}
          allowClear={可清空}
          onChange={(v?: string) => {
            const 值 = 去不填(v);
            setDraft(值);
            void commit(值);
          }}
          onBlur={() => setEditing(false)}
        />
      )}
      {kind === "combo" && (
        /*
          能选也能填。和上面那个 select 的区别只有一条：不在选项里的值也收。
          所以不能用 onChange 提交（打字的每一下都会触发），改成失焦 / 回车提交，
          和 text 那一支一个节奏。
        */
        <AutoComplete
          {...common}
          defaultOpen
          allowClear
          value={draft ?? undefined}
          options={options?.map((o) => ({ value: o.value }))}
          filterOption={(输入, o) => String(o?.value ?? "").toLowerCase().includes(输入.toLowerCase())}
          /*
            用键盘 ↓ 选候选项再回车：keydown 比 onSelect 先到，原来回车时提交的是打了一半的字（「大」而不是「大三」）；
            点选时 blur 又可能抢在 onChange 前面，什么都没存（2026-10-02 排查 1-5）。
            现在选中就直接提交选中的那个；回车等一拍再交——有候选项被选中的话 onSelect 已经先交了，这次就是同值跳过
          */
          onChange={(v) => {
            最新.current = v ?? "";
            setDraft(v ?? "");
          }}
          onSelect={(v: string) => {
            最新.current = v;
            setDraft(v);
            void commit(v);
          }}
          onBlur={() => setTimeout(() => void commit(最新.current), 0)}
          onKeyDown={(e) => {
            if (e.key === "Enter") setTimeout(() => void commit(最新.current), 0);
            if (e.key === "Escape") 放弃();
          }}
        />
      )}
      {kind === "date" && (
        <DatePicker
          {...common}
          open
          value={draft ? dayjs(draft) : null}
          onChange={(d) => {
            const v = d ? d.format("YYYY-MM-DD") : null;
            setDraft(v);
            void commit(v);
          }}
          onOpenChange={(o) => !o && setEditing(false)}
        />
      )}
      {kind === "textarea" && (
        <div>
          <Input.TextArea
            {...common}
            autoSize={{ minRows: 2, maxRows: 8 }}
            value={draft ?? ""}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void commit(draft)}
            onKeyDown={(e) => {
              if (e.key === "Escape") 放弃();
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void commit(draft);
              }
            }}
          />
          <div className="rec-field-hint"><Shortcut>⌘↵</Shortcut> 保存 · Esc 放弃</div>
        </div>
      )}
      {kind === "text" && (
        <Input
          {...common}
          value={draft ?? ""}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commit(draft)}
          onPressEnter={() => void commit(draft)}
          onKeyDown={(e) => {
            if (e.key === "Escape") 放弃();
          }}
        />
      )}
      {稿.提示}
    </div>
  );
}

/**
 * 多行字段（备注）的显示（16a 界面样板）：.ui-v2 下超过 4 行收起，右下一颗「展开 / 收起」。
 * 收不收只看真截没截（scrollHeight 比可见高度高）：样板之外没有 4 行的限制，量出来不截，按钮也不出。
 * 按钮只管展开，不进编辑（拦住冒泡，和电话旁的复制键一样）；点文字别处照旧进编辑
 */
function LongText({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [开, set开] = useState(false);
  const [截了, set截了] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || 开) return;
    const 量 = () => set截了(el.scrollHeight > el.clientHeight + 1);
    量();
    const ro = new ResizeObserver(量);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, 开]);
  return (
    <>
      <span ref={ref} className={`rec-field-clamp${开 ? " is-open" : ""}`}>{text}</span>
      {(截了 || 开) && (
        <button
          type="button"
          className="rec-field-more"
          aria-expanded={开}
          onClick={(e) => { e.stopPropagation(); set开(!开); }}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {开 ? "收起" : "展开"}
        </button>
      )}
    </>
  );
}
