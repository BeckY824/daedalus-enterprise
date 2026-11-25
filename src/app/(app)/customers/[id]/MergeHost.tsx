"use client";

/**
 * 合并客户第一批 · 界面（11-25，docs/合并客户-第一批-落地.md 第四节、第七节 7.4）。三只框都在这里，只调 merge-actions.ts：
 *   - 合并客户：搜要并进来的那家（搜合并候选）→ 并排预览（来源 / 创建人不同标红、要勾「已核对」；两家联系人配对勾「是同一个人」）
 *     → 后果框（订单阶段项目、回款几笔……）→ 合并；成了走底部撤销条，写明 30 天内可在「历史变更」里整单撤回
 *   - 联系人「和另一位合成」：同一位客户名下另挑一位、定留谁 → 合成；成了走撤销条（撤回 = 撤回合并单）
 *   - 项目「换客户」：搜目标客户 → 预览（订单阶段、回款几笔、几条沟通、几位项目联系人挂靠过去）→ 后果框 → 换；
 *     不单独撤回（总控 11-25：换错了再换回去）；换完 8 秒撤销条上的「撤销」是真的反向操作（撤销换客户：挂靠、项目关联客户的身份、序号都回原样）
 * 谁能并、能换、能合成都在服务端判，这里只摆服务端说的原因。手机（< 768）两家并排改成上下两段（merge.css）
 */
import "../merge.css";
import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Checkbox, Input, Modal, Radio, Select } from "antd";
import { useConsequence } from "@/components/ConsequenceDialog";
import { showUndo } from "@/components/UndoBar";
import { 动作出错话 } from "@/lib/stale-deploy";
import { useShellNavGo } from "@/lib/nav-pending";
import {
  搜合并候选, 预览合并, 合并客户, 撤回合并单, 合成两位联系人, 预览项目换客户, 给项目换客户, 撤销换客户, 能并同事的, type 合并候选,
} from "../merge-actions";
import { 合并桥, type 合成候选人 } from "./merge-bridge";

/** 两家来源 / 创建人不一样时要勾的那句（同 customer-merge.ts 已核对话） */
export const 已核对话 = "已核对，按留下那家的来源和创建人";
/** 撤回期限（同 customer-merge.ts 撤回期限天数 = 回收站保留天数） */
const 撤回天数 = 30;
const 撤回话 = `${撤回天数} 天内可在「历史变更」里整单撤回`;
/** 合并后果框「可撤回」那句：不是系统管理员的补上谁能撤（同服务端撤回合并：本人、且留下那家仍归本人负责） */
const 撤回谁话 = "（要你本人、且这家仍归你负责，否则找系统管理员）";
/**
 * 联系人配对下拉：选项「名字 · 职务」没有上限，手机上不能撑出屏（选项自带一行省略、悬停看全）。
 * 限了宽还要能横移：下拉左边贴着选择框，手机上选择框在右半边，默认只会左右翻、不会挪，右边照样出屏。
 * 位置同 antd 6 Select 自带的四个（mergedBuiltinPlacements），只多一个 shiftX
 */
const 配对下拉样式 = { popup: { root: { maxWidth: "min(360px, calc(100vw - 32px))" } } };
const 下拉位 = (points: [string, string], y: number) => ({ points, offset: [0, y], overflow: { adjustX: true, adjustY: true, shiftX: true, shiftY: true }, htmlRegion: "visible" as const, dynamicInset: true });
const 配对下拉位 = { bottomLeft: 下拉位(["tl", "bl"], 4), bottomRight: 下拉位(["tr", "br"], 4), topLeft: 下拉位(["bl", "tl"], -4), topRight: 下拉位(["br", "tr"], -4) };

/** 登录的人是不是系统管理员（能并 / 换到同事的客户）：只用来挑说法，谁能做服务端判；没读到按不是 */
function useMerge管(): boolean | null {
  const [管, set管] = useState<boolean | null>(null);
  useEffect(() => {
    let 还在 = true;
    能并同事的().then((v) => { if (还在) set管(v === true); }).catch(() => { if (还在) set管(false); });
    return () => { 还在 = false; };
  }, []);
  return 管;
}

type 预览 = Extract<Awaited<ReturnType<typeof 预览合并>>, { ok: true }>["预览"];
type 换预览 = Extract<Awaited<ReturnType<typeof 预览项目换客户>>, { ok: true }>["预览"];

export default function MergeHost({ customerId, 客户名 }: { customerId: string; 客户名: string }) {
  const { 请求, 收 } = useContext(合并桥);
  if (!请求) return null;
  if (请求.种 === "客户") return <MergeCustomerDialog key={请求.次} customerId={customerId} 客户名={客户名} 关={收} />;
  if (请求.种 === "联系人") return <ContactMergeDialog key={请求.次} 留={请求.留} 们={请求.们} 关={收} />;
  return <ProjectMoveDialog key={请求.次} customerId={customerId} 客户名={客户名} projectId={请求.projectId} 项目名={请求.名} 关={收} />;
}

/* ───────────────────────── 搜客户（合并、换客户共用） ───────────────────────── */

/** 空话：搜不到时那句；不是系统管理员的写明只列自己负责、不在公海的（搜合并候选 同样限着） */
function CandidateSearch({ customerId, 提示, 空话, 选 }: { customerId: string; 提示: string; 空话: string; 选: (c: 合并候选) => void }) {
  const [词, set词] = useState("");
  const [们, set们] = useState<合并候选[] | null>(null);
  const [忙, set忙] = useState(false);
  const [错, set错] = useState<string | null>(null);
  const 次 = useRef(0);
  const 计时 = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (计时.current) clearTimeout(计时.current); }, []);
  /** 打字时搜：停 250ms 再发，只认最后一次的回包；清空就收起结果 */
  function 改词(v: string) {
    set词(v);
    if (计时.current) clearTimeout(计时.current);
    const t = v.trim();
    const 这次 = ++次.current;
    if (!t) { set们(null); set忙(false); return; }
    set忙(true);
    计时.current = setTimeout(() => {
      搜合并候选(customerId, t)
        .then((r) => { if (这次 === 次.current) { set们(r); set错(null); } })
        .catch((e) => { if (这次 === 次.current) set错(动作出错话(e, "没搜成，请再试一次")); })
        .finally(() => { if (这次 === 次.current) set忙(false); });
    }, 250);
  }
  return (
    <div className="mrg-search">
      <Input.Search autoFocus allowClear value={词} onChange={(e) => 改词(e.target.value)} loading={忙} placeholder="客户名称、简称、编号或号码" aria-label="搜客户" />
      <p className="mrg-note">{提示}</p>
      {错 && <p role="alert" className="mrg-err">{错}</p>}
      {们 && !忙 && 们.length === 0 && <p className="mrg-empty" data-testid="merge-cand-empty">{空话}</p>}
      {们 && 们.length > 0 && (
        <ul className="mrg-cands" aria-label="搜到的客户">
          {们.map((c) => {
            const 副 = [c.编号, c.负责人].filter(Boolean).join(" · ");
            return (
              <li key={c.id}>
                <button type="button" className="mrg-cand" data-testid="merge-candidate" onClick={() => 选(c)} title={[c.name, 副].filter(Boolean).join(" · ")}>
                  <span className="mrg-cand-n">{c.name || "（没写名称）"}</span>
                  {副 && <span className="mrg-cand-s">{副}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** 搜不到时那句：系统管理员不限，照旧；别人（含还没读到的）写明只列你负责的、要动同事的找谁 */
const 空话of = (管: boolean | null, 找谁: string) => (管 ? "没搜到能选的客户" : `只列你负责、不在公海的客户；${找谁}`);

/** 拦下的原因（服务端给的），一条一行 */
function 原因块({ 原因 }: { 原因: string[] }) {
  return <Alert type="warning" showIcon className="mrg-why" message={原因.length > 1 ? "现在不能做：" : 原因[0]} description={原因.length > 1 ? <ul className="mrg-why-l">{原因.map((x) => <li key={x}>{x}</li>)}</ul> : undefined} />;
}

/** 一行省略、悬停看全 */
const 一行 = (v: ReactNode, 全: string, cls = "") => <span className={`mrg-one ${cls}`} title={全 || undefined}>{v}</span>;

/* ───────────────────────── 合并客户 ───────────────────────── */

function MergeCustomerDialog({ customerId, 客户名, 关 }: { customerId: string; 客户名: string; 关: () => void }) {
  const router = useRouter();
  const [问后果, 后果框] = useConsequence();
  const 管 = useMerge管();
  const [并掉, set并掉] = useState<合并候选 | null>(null);
  const [预, set预] = useState<预览 | null>(null);
  const [读错, set读错] = useState<string | null>(null);
  const [勾, set勾] = useState(false);
  /** 并掉那家的联系人 id → 配上的留下那家联系人 id */
  const [配, set配] = useState<Record<string, string | undefined>>({});
  /** 勾了「是同一个人」的（并掉那家的联系人 id） */
  const [同, set同] = useState<Set<string>>(new Set());
  const 读次 = useRef(0);

  function 挑(c: 合并候选) {
    const 这次 = ++读次.current;
    set并掉(c); set预(null); set读错(null); set勾(false); set同(new Set());
    预览合并(customerId, c.id).then((r) => {
      if (这次 !== 读次.current) return;
      if (!r.ok) { set读错(r.error); return; }
      set预(r.预览);
      // 同名的先配上（不替人勾「是同一个人」）；留下那家每位只配一次
      const 用了 = new Set<string>();
      const 初: Record<string, string | undefined> = {};
      for (const b of r.预览.联系人们.并掉) {
        const a = r.预览.联系人们.留下.find((x) => !用了.has(x.id) && x.name.trim() && x.name.trim() === b.name.trim());
        if (a) { 初[b.id] = a.id; 用了.add(a.id); }
      }
      set配(初);
    }).catch((e) => { if (这次 === 读次.current) set读错(动作出错话(e, "没读到合并预览，请再试一次")); });
  }
  const 换一家 = () => { 读次.current++; set并掉(null); set预(null); set读错(null); };

  const 对们 = 预 ? 预.联系人们.并掉.filter((b) => 同.has(b.id) && 配[b.id]).map((b) => ({ 留: 配[b.id]!, 并: b.id })) : [];
  const 能点 = !!预?.能并 && (!预.要勾选 || 勾);

  async function 合并() {
    if (!预 || !并掉 || !能点) return;
    const n = 预.条数;
    const B = 并掉.name || "并进来的客户";
    const 结: { 单号: string | null } = { 单号: null };
    const 成 = await 问后果({
      题: `把「${B}」并进「${客户名}」？`,
      宽: 480,
      危: false,
      是: "合并",
      后果: [
        ...(n ? [{
          标: "挪过来", 级: "警" as const,
          话: `${n.项目} 个项目（其中订单阶段 ${n.订单项目} 个）、回款 ${n.回款} 笔、${n.联系人} 位联系人、${n.沟通} 条沟通、${n.待办 + n.跟进计划} 条待办和跟进计划`,
        }] : []),
        ...(对们.length ? [{ 标: "合成", 话: `${对们.length} 对联系人合成一位，号码、沟通、名片收到留下那位` }] : []),
        { 标: "不变", 话: "项目负责人、组员都不变；来源和创建人按留下这家" },
        { 标: "回收站", 话: `「${B}」进回收站，原来的链接都会跳到这里` },
        { 标: "可撤回", 话: 管 ? 撤回话 : `${撤回话}${撤回谁话}` },
      ],
      做: async () => {
        const r = await 合并客户(customerId, 并掉.id, { 已核对: 预.要勾选 ? 勾 : undefined, 同一个人: 对们 });
        if (r.ok) 结.单号 = r.mergeId;
        return r;
      },
    });
    if (!成 || !结.单号) return;
    const id = 结.单号;
    关();
    router.refresh();
    showUndo({
      话: `已把「${B}」并进来，${撤回话}`,
      毫秒: 8000,
      撤销: async () => {
        const u = await 撤回合并单(id);
        router.refresh();
        return u;
      },
    });
  }

  const 题 = (
    <span className="mrg-title">
      <span className="mrg-title-t">合并客户</span>
      <span className="mrg-title-who" title={客户名}>并进「{客户名}」</span>
    </span>
  );
  return (
    <Modal
      open
      onCancel={关}
      title={题}
      width={并掉 ? 860 : 520}
      className="mrg-modal"
      destroyOnHidden
      footer={并掉 ? (
        <div className="mrg-foot">
          <Button onClick={换一家}>换一家</Button>
          <span className="mrg-foot-sp" />
          <Button onClick={关}>取消</Button>
          <Button type="primary" disabled={!能点} onClick={() => void 合并()} data-testid="merge-go">合并</Button>
        </div>
      ) : null}
    >
      {!并掉 && <CandidateSearch customerId={customerId} 提示={`选要并进这位客户的那家：它的联系人、项目、沟通都挪过来，它进回收站；${撤回话}。`} 空话={空话of(管, "要并同事的客户请找系统管理员")} 选={挑} />}
      {并掉 && !预 && !读错 && <p className="mrg-empty" aria-live="polite">正在读取…</p>}
      {并掉 && 读错 && <p role="alert" className="mrg-err">{读错}</p>}
      {并掉 && 预 && !预.能并 && <原因块 原因={预.原因} />}
      {并掉 && 预 && 预.能并 && (
        <div className="mrg-body">
          <div className="mrg-cmp" role="table" aria-label="两家对比">
            <div className="mrg-cmp-r mrg-cmp-h" role="row">
              <span role="columnheader" className="mrg-cmp-k">项</span>
              <span role="columnheader" className="mrg-cmp-a">{一行("留下（这位）", "留下（这位）")}</span>
              <span role="columnheader" className="mrg-cmp-b">{一行("并进来", "并进来")}</span>
            </div>
            {预.并排.map((r) => (
              <div key={r.格} role="row" data-testid="merge-row" className={`mrg-cmp-r${r.不同 ? " is-diff" : ""}${r.标红 ? " is-red" : ""}`}>
                <span role="rowheader" className="mrg-cmp-k">{一行(r.格, r.格)}</span>
                <span role="cell" className="mrg-cmp-a"><span className="mrg-cmp-tag" aria-hidden>留下</span>{一行(r.留下 || "—", r.留下)}</span>
                <span role="cell" className="mrg-cmp-b"><span className="mrg-cmp-tag" aria-hidden>并进来</span>{一行(r.并掉 || "—", r.并掉)}</span>
              </div>
            ))}
          </div>
          {预.补空.length > 0 && <p className="mrg-note">留下这家空着的{预.补空.join("、")}，用并进来那家的补上；其余两家不同的格都按留下这家。</p>}
          {(预.号格留下有值?.length ?? 0) > 0 && <p className="mrg-note" data-testid="merge-keep-keys">{预.号格留下有值.join("、")}两家都填了：留下这家的不动，并进来那家的随它进回收站（撤回时一起回来）。</p>}
          {预.要勾选 && (
            <div className="mrg-check" data-testid="merge-check">
              <Checkbox checked={勾} onChange={(e) => set勾(e.target.checked)}>{已核对话}</Checkbox>
              <p className="mrg-note">两家的来源或创建人不一样（标红的格）。并进来那家的创建人、来源记在合并单里可查。</p>
            </div>
          )}
          {预.联系人们.并掉.length > 0 && (
            <section className="mrg-ppl" aria-label="两家联系人">
              <p className="mrg-sec-t">联系人 <span className="mrg-sec-c">并进来那家的 {预.联系人们.并掉.length} 位都挪过来；是同一个人的勾上，合成一位</span></p>
              {预.联系人们.并掉.map((b) => {
                const 配上 = 配[b.id];
                const 别人配了 = new Set(Object.entries(配).filter(([k, v]) => k !== b.id && v).map(([, v]) => v));
                const 号 = b.号.join("、");
                return (
                  <div key={b.id} className="mrg-ppl-r" data-testid="merge-contact">
                    <span className="mrg-ppl-b">
                      {一行(<>{b.name || "—"}{b.关键 && <span className="mrg-key">关键</span>}</>, [b.name, b.position, 号].filter(Boolean).join(" · "), "mrg-ppl-n")}
                      {(b.position || 号) && 一行([b.position, 号].filter(Boolean).join(" · "), [b.position, 号].filter(Boolean).join(" · "), "mrg-ppl-s")}
                    </span>
                    <Select
                      className="mrg-ppl-sel"
                      allowClear
                      placeholder="和留下这家的…"
                      aria-label={`${b.name} 和留下这家的哪位配对`}
                      value={配上}
                      popupMatchSelectWidth={false}
                      styles={配对下拉样式}
                      builtinPlacements={配对下拉位}
                      onChange={(v?: string) => {
                        set配((m) => ({ ...m, [b.id]: v }));
                        if (!v) set同((s) => { const n = new Set(s); n.delete(b.id); return n; });
                      }}
                      options={预.联系人们.留下.map((a) => ({ value: a.id, label: [a.name || "—", a.position].filter(Boolean).join(" · "), disabled: 别人配了.has(a.id) }))}
                    />
                    <Checkbox
                      className="mrg-ppl-same"
                      disabled={!配上}
                      checked={!!配上 && 同.has(b.id)}
                      onChange={(e) => set同((s) => { const n = new Set(s); if (e.target.checked) n.add(b.id); else n.delete(b.id); return n; })}
                    >
                      是同一个人
                    </Checkbox>
                  </div>
                );
              })}
            </section>
          )}
        </div>
      )}
      {后果框}
    </Modal>
  );
}

/* ───────────────────────── 合成联系人 ───────────────────────── */

function ContactMergeDialog({ 留: 起点, 们, 关 }: { 留: 合成候选人; 们: 合成候选人[]; 关: () => void }) {
  const router = useRouter();
  const 别的 = 们.filter((c) => c.id !== 起点.id);
  const [另一位, set另一位] = useState<string | undefined>(别的.length === 1 ? 别的[0].id : undefined);
  const [留谁, set留谁] = useState(起点.id);
  const [忙, set忙] = useState(false);
  const [错, set错] = useState<string | null>(null);
  const 对方 = 别的.find((c) => c.id === 另一位);
  const 留 = 留谁 === 起点.id ? 起点 : 对方;
  const 并 = 留谁 === 起点.id ? 对方 : 起点;
  const 叫 = (c?: 合成候选人) => c?.name || "—";
  const 摘 = (c: 合成候选人) => [c.职务, c.号].filter(Boolean).join(" · ");

  async function 合成() {
    if (!留 || !并 || 忙) return;
    set忙(true); set错(null);
    try {
      const r = await 合成两位联系人(留.id, 并.id);
      if (!r.ok) { set错(r.error); return; }
      关();
      router.refresh();
      showUndo({
        话: `已把「${叫(并)}」合成进「${叫(留)}」，${撤回话}`,
        毫秒: 8000,
        撤销: async () => {
          const u = await 撤回合并单(r.mergeId);
          router.refresh();
          return u;
        },
      });
    } catch (e) {
      set错(动作出错话(e, "没合成，请再试一次"));
    } finally {
      set忙(false);
    }
  }

  return (
    <Modal
      open
      onCancel={() => !忙 && 关()}
      maskClosable={!忙}
      title={<span className="mrg-title"><span className="mrg-title-t">和另一位合成</span><span className="mrg-title-who" title={起点.name}>「{叫(起点)}」</span></span>}
      width={520}
      className="mrg-modal"
      destroyOnHidden
      footer={
        <div className="mrg-foot">
          <span className="mrg-foot-sp" />
          <Button onClick={关} disabled={忙}>取消</Button>
          <Button type="primary" loading={忙} disabled={!留 || !并} onClick={() => void 合成()} data-testid="contact-merge-go">合成</Button>
        </div>
      }
    >
      <div className="mrg-body">
        {别的.length === 0 ? (
          <p className="mrg-empty">这位客户名下没有别的联系人可以合成；挂靠过来的联系人请到他的主客户上合成。</p>
        ) : (
          <>
            <p className="mrg-sec-t">是同一个人的那位</p>
            <Radio.Group className="mrg-pick" value={另一位} onChange={(e) => set另一位(e.target.value)}>
              {别的.map((c) => (
                <Radio key={c.id} value={c.id} className="mrg-pick-r">
                  {一行(<>{叫(c)}{c.关键 && <span className="mrg-key">关键</span>}{摘(c) && <span className="mrg-ppl-s"> · {摘(c)}</span>}</>, [c.name, 摘(c)].filter(Boolean).join(" · "))}
                </Radio>
              ))}
            </Radio.Group>
            {对方 && (
              <>
                <p className="mrg-sec-t">留下哪位</p>
                <Radio.Group className="mrg-pick" value={留谁} onChange={(e) => set留谁(e.target.value)}>
                  {[起点, 对方].map((c) => <Radio key={c.id} value={c.id} className="mrg-pick-r">{一行(`留下「${叫(c)}」`, `留下「${叫(c)}」`)}</Radio>)}
                </Radio.Group>
                <ul className="mrg-out">
                  <li>号码、沟通、名片、项目联系人都收到「{叫(留)}」，号码一样的只留一行</li>
                  <li>「{叫(留)}」空着的资料用「{叫(并)}」的补上，填了的不改</li>
                  <li>「{叫(并)}」进回收站；{撤回话}</li>
                </ul>
              </>
            )}
          </>
        )}
        {错 && <p role="alert" className="mrg-err">{错}</p>}
      </div>
    </Modal>
  );
}

/* ───────────────────────── 项目换客户 ───────────────────────── */

function ProjectMoveDialog({ customerId, 客户名, projectId, 项目名, 关 }: { customerId: string; 客户名: string; projectId: string; 项目名: string; 关: () => void }) {
  const router = useRouter();
  // 撤销条上的「去看看」：框已经关了，用壳里那份跳（等待条跟到新页提交）
  const 去页 = useShellNavGo();
  const [问后果, 后果框] = useConsequence();
  const 管 = useMerge管();
  const [目标, set目标] = useState<合并候选 | null>(null);
  const [预, set预] = useState<换预览 | null>(null);
  const [读错, set读错] = useState<string | null>(null);
  const 读次 = useRef(0);

  function 挑(c: 合并候选) {
    const 这次 = ++读次.current;
    set目标(c); set预(null); set读错(null);
    预览项目换客户(projectId, c.id).then((r) => {
      if (这次 !== 读次.current) return;
      if (!r.ok) set读错(r.error);
      else set预(r.预览);
    }).catch((e) => { if (这次 === 读次.current) set读错(动作出错话(e, "没读到换客户预览，请再试一次")); });
  }
  const 换一位 = () => { 读次.current++; set目标(null); set预(null); set读错(null); };
  const 到 = 目标?.name || "目标客户";
  const 清单 = 预?.条数 ? [
    { 标: "阶段", 话: 预.条数.订单 ? "这是订单阶段的项目，阶段、节点、结局都不变" : "阶段、节点、结局都不变" },
    { 标: "回款", 话: `${预.条数.回款} 笔回款跟着项目走，金额、提成不变` },
    { 标: "沟通", 话: `${预.条数.沟通} 条沟通挪到「${到}」名下，附件跟着走` },
    { 标: "联系人", 话: `${预.条数.联系人} 位项目联系人挂靠到「${到}」，主客户还是「${客户名}」` },
    { 标: "不变", 话: "负责人、组员都不变" },
  ] : [];

  async function 换() {
    if (!目标 || !预?.能换) return;
    const 去 = 目标;
    // 换成了的那条日志：撤销条拿它调 撤销换客户（只认这一次）
    const 这次 = { logId: "" };
    const 成 = await 问后果({
      题: `把项目「${项目名}」换到「${到}」？`,
      宽: 480,
      危: false,
      是: "换客户",
      后果: [...清单.map((x) => ({ ...x, 级: x.标 === "不变" ? "常" as const : "警" as const })), { 标: "撤回", 话: "换完 8 秒内可撤销；过后不单独撤回，换错了再换回来" }],
      做: async () => {
        const r = await 给项目换客户(projectId, 去.id);
        if (r.ok) 这次.logId = r.logId;
        return r;
      },
    });
    if (!成 || !这次.logId) return;
    关();
    router.refresh();
    showUndo({
      话: `已把项目「${项目名}」换到「${到}」`,
      毫秒: 8000,
      另一个动作: { 话: "去看看", 做: () => 去页.push(`/customers/${去.id}?project=${projectId}`) },
      撤销: async () => {
        const u = await 撤销换客户(这次.logId);
        router.refresh();
        return u;
      },
    });
  }

  return (
    <Modal
      open
      onCancel={关}
      title={<span className="mrg-title"><span className="mrg-title-t">换客户</span><span className="mrg-title-who" title={项目名}>项目「{项目名}」</span></span>}
      width={560}
      className="mrg-modal"
      destroyOnHidden
      footer={目标 ? (
        <div className="mrg-foot">
          <Button onClick={换一位}>换一位</Button>
          <span className="mrg-foot-sp" />
          <Button onClick={关}>取消</Button>
          <Button type="primary" disabled={!预?.能换} onClick={() => void 换()} data-testid="move-go">换客户</Button>
        </div>
      ) : null}
    >
      {!目标 && <CandidateSearch customerId={customerId} 提示="选这个项目该挂的客户：项目连沟通、附件、项目联系人一起挪过去。" 空话={空话of(管, "要换到同事的客户请找系统管理员")} 选={挑} />}
      {目标 && !预 && !读错 && <p className="mrg-empty" aria-live="polite">正在读取…</p>}
      {目标 && 读错 && <p role="alert" className="mrg-err">{读错}</p>}
      {目标 && 预 && !预.能换 && <原因块 原因={预.原因} />}
      {目标 && 预 && 预.能换 && (
        <div className="mrg-body">
          <p className="mrg-move">{一行(<>「{客户名}」 → <b>「{到}」</b></>, `「${客户名}」 → 「${到}」`)}</p>
          <ul className="mrg-out" data-testid="move-list">
            {清单.map((x) => <li key={x.标}><span className="mrg-out-k">{x.标}</span>{x.话}</li>)}
          </ul>
        </div>
      )}
      {后果框}
    </Modal>
  );
}
