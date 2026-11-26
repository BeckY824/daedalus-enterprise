"use client";

/**
 * 合并客户第一批 · 界面（11-25，docs/合并客户-第一批-落地.md 第四节、第七节 7.4）。三只框都在这里，只调 merge-actions.ts：
 *   - 合并客户：搜要并进来的那家（搜合并候选）→ 并排预览（来源 / 创建人不同标红、要勾「已核对」；两家联系人配对勾「是同一个人」）
 *     → 后果框（订单阶段项目、回款几笔……）→ 合并；成了走底部撤销条，写明 30 天内可在「历史变更」里整单撤回
 *   - 联系人「和另一位合成」：同一位客户名下另挑一位、定留谁 → 合成；成了走撤销条（撤回 = 撤回合并单）
 *   - 项目「换客户」：搜目标客户 → 预览（订单阶段、回款几笔、几条沟通、几位项目联系人挂靠过去）→ 后果框 → 换；
 *     不单独撤回（总控 11-25：换错了再换回去）；换完 8 秒撤销条上的「撤销」是真的反向操作（撤销换客户：挂靠、项目关联客户的身份、序号都回原样）
 *   - 项目「并进另一个项目」（第二批 2a，11-26）：从被并掉的这个项目出发，选同客户、同负责人、线索阶段在推的那个（项目合并候选）→ 预览（挪哪些、组员留在原项目不并过去、
 *     这个结束为重复线索）→ 后果框 → 并过去；成了走撤销条（撤销 = 撤回项目合并单），写明 30 天内可在「历史变更」里撤回。项目详情页自己也挂一份（只用这只框）
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
  项目合并候选, 预览项目合并, 合并项目, 撤回项目合并单,
  预览合并申请, 发起客户合并申请, 撤回客户合并申请,
} from "../merge-actions";
import { 合并申请页, 凭叫法, 等待工作日 } from "../merge-request-words";
import { 合并桥, type 合成候选人 } from "./merge-bridge";

/** 两家来源 / 创建人不一样时要勾的那句（同 customer-merge.ts 已核对话） */
export const 已核对话 = "已核对，按留下那家的来源和创建人";
/** 撤回期限（同 customer-merge.ts 撤回期限天数 = 回收站保留天数） */
const 撤回天数 = 30;
const 撤回话 = `${撤回天数} 天内可在「历史变更」里整单撤回`;
/** 合并后果框「可撤回」那句：不是系统管理员的补上谁能撤（同服务端撤回合并：本人、且留下那家仍归本人负责） */
const 撤回谁话 = "（要你本人、且这家仍归你负责，否则找系统管理员）";
/** 并进另一个项目的那句（同服务端撤回项目合并：合并的人、且留下的项目仍归本人负责） */
const 并撤回谁话 = "（要你本人、且留下的项目仍归你负责，否则找系统管理员）";
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
type 申请预览 = Extract<Awaited<ReturnType<typeof 预览合并申请>>, { ok: true }>["预览"];
type 换预览 = Extract<Awaited<ReturnType<typeof 预览项目换客户>>, { ok: true }>["预览"];
type 并项目预览 = Extract<Awaited<ReturnType<typeof 预览项目合并>>, { ok: true }>["预览"];

export default function MergeHost({ customerId, 客户名 }: { customerId: string; 客户名: string }) {
  const { 请求, 收 } = useContext(合并桥);
  if (!请求) return null;
  if (请求.种 === "客户") return <MergeCustomerDialog key={请求.次} customerId={customerId} 客户名={客户名} 关={收} />;
  if (请求.种 === "联系人") return <ContactMergeDialog key={请求.次} 留={请求.留} 们={请求.们} 关={收} />;
  if (请求.种 === "并项目") return <ProjectMergeDialog key={请求.次} projectId={请求.projectId} 项目名={请求.名} 关={收} />;
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
            const 名 = c.按号 ? 按号名 : c.name || "（没写名称）";
            return (
              <li key={c.id}>
                <button type="button" className="mrg-cand" data-testid="merge-candidate" onClick={() => 选(c)} title={[名, 副, c.要申请 ? 要申请标 : ""].filter(Boolean).join(" · ")}>
                  <span className="mrg-cand-n">{名}</span>
                  {副 && <span className="mrg-cand-s">{副}</span>}
                  {c.要申请 && <span className="mrg-cand-ask" data-testid="merge-cand-ask">{要申请标}</span>}
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
/** 合并客户框搜不到时那句（第二批 2b-3）：看得到的都列，看不到的同事客户要输完整号码 */
const 合并空话of = (管: boolean | null) => (管 ? "没搜到能选的客户" : "没搜到：只列你看得到、不在公海的客户；看不到的同事客户，请输入完整的手机号或邮箱");
/** 同事负责的候选后面那个标（方案第二批第 9 节「合并客户框」） */
const 要申请标 = "同事负责 · 要申请";
/** 按完整号码搜到、看不到的同事客户：不给名称 */
const 按号名 = "同事负责的客户（号码撞上）";

/** 拦下的原因（服务端给的），一条一行 */
function 原因块({ 原因 }: { 原因: string[] }) {
  return <Alert type="warning" showIcon className="mrg-why" message={原因.length > 1 ? "现在不能做：" : 原因[0]} description={原因.length > 1 ? <ul className="mrg-why-l">{原因.map((x) => <li key={x}>{x}</li>)}</ul> : undefined} />;
}

/** 一行省略、悬停看全 */
const 一行 = (v: ReactNode, 全: string, cls = "") => <span className={`mrg-one ${cls}`} title={全 || undefined}>{v}</span>;

/* ───────────────────────── 合并客户 ───────────────────────── */

function MergeCustomerDialog({ customerId, 客户名, 关 }: { customerId: string; 客户名: string; 关: () => void }) {
  const router = useRouter();
  // 撤销条上的「看进度」：框已经关了，用壳里那份跳（同项目换客户）
  const 去 = useShellNavGo();
  const [问后果, 后果框] = useConsequence();
  const 管 = useMerge管();
  const [并掉, set并掉] = useState<合并候选 | null>(null);
  const [预, set预] = useState<预览 | null>(null);
  /** 发合并申请的预览（第二批 2b-3）：同事负责、或名下有同事在推的项目，直接并拦下时改走申请 */
  const [申, set申] = useState<申请预览 | null>(null);
  const [读错, set读错] = useState<string | null>(null);
  const [勾, set勾] = useState(false);
  /** 并掉那家的联系人 id → 配上的留下那家联系人 id */
  const [配, set配] = useState<Record<string, string | undefined>>({});
  /** 勾了「是同一个人」的（并掉那家的联系人 id） */
  const [同, set同] = useState<Set<string>>(new Set());
  const 读次 = useRef(0);

  /** 同名的先配上（不替人勾「是同一个人」）；留下那家每位只配一次 */
  function 先配(p: 预览) {
    const 用了 = new Set<string>();
    const 初: Record<string, string | undefined> = {};
    for (const b of p.联系人们.并掉) {
      const a = p.联系人们.留下.find((x) => !用了.has(x.id) && x.name.trim() && x.name.trim() === b.name.trim());
      if (a) { 初[b.id] = a.id; 用了.add(a.id); }
    }
    set配(初);
  }
  /**
   * 选了一家：系统管理员照第一批直接并。别人：标了要申请的（同事负责）直接读申请预览；
   * 自己负责的先读直接合并预览，拦下了再读申请预览（名下有同事在推的项目也要申请）——申请也发不了就摆申请那边的原因
   */
  function 挑(c: 合并候选) {
    const 这次 = ++读次.current;
    set并掉(c); set预(null); set申(null); set读错(null); set勾(false); set同(new Set());
    const 读申请 = async (直接拦?: 预览) => {
      const r = await 预览合并申请(customerId, c.id, c.按号);
      if (这次 !== 读次.current) return;
      if (!r.ok) { set读错(r.error); return; }
      if (!r.预览.能发 && 直接拦) {
        // 申请那边的原因全都是直接合并那边也有的（数据拦法，两边一样）才摆直接合并的；否则摆申请自己的原因（已挂着一张、5 张上限等）
        const 同 = r.预览.原因.length > 0 && r.预览.原因.every((x) => 直接拦.原因.includes(x));
        if (同) {
          // 直接合并那组里「可以发合并申请」的句子会把人引去发一个发不了的申请：去掉再摆（去空了就摆申请这边的原因）
          const 去后 = 直接拦.原因.filter((x) => !x.includes("可以发合并申请"));
          set预({ ...直接拦, 原因: 去后.length ? 去后 : r.预览.原因 });
        } else set申(r.预览);
        return;
      }
      set申(r.预览);
      if (r.预览.预览) { set预(r.预览.预览); 先配(r.预览.预览); }
    };
    const 读 = c.要申请 && 管 !== true
      ? 读申请()
      : 预览合并(customerId, c.id).then(async (r) => {
          if (这次 !== 读次.current) return;
          if (!r.ok) { set读错(r.error); return; }
          if (!r.预览.能并 && 管 !== true) return 读申请(r.预览);
          set预(r.预览);
          先配(r.预览);
        });
    读.catch((e) => { if (这次 === 读次.current) set读错(动作出错话(e, "没读到合并预览，请再试一次")); });
  }
  const 换一家 = () => { 读次.current++; set并掉(null); set预(null); set申(null); set读错(null); };

  const 对们 = 预 ? 预.联系人们.并掉.filter((b) => 同.has(b.id) && 配[b.id]).map((b) => ({ 留: 配[b.id]!, 并: b.id })) : [];
  /** 走申请：申请预览说能发、拿到了并排 */
  const 走申请 = !!申?.能发 && !!预;
  const 能点 = (走申请 || !!预?.能并) && (!预?.要勾选 || 勾);
  const B名 = 并掉 ? (并掉.按号 ? 按号名 : 并掉.name || "并进来的客户") : "";

  async function 发申请() {
    if (!申 || !预 || !并掉 || !能点) return;
    const 们 = 申.同意人;
    const 结: { 单号: string | null; 人数: number } = { 单号: null, 人数: 们.length };
    const n = 预.条数;
    const 成 = await 问后果({
      题: `发合并申请：把「${B名}」并进「${客户名}」？`,
      宽: 520,
      危: false,
      是: "发申请",
      后果: [
        { 标: "要同意", 级: "警" as const, 话: `${们.map((x) => x.名).join("、")}（共 ${们.length} 位）都同意了才合并；一位拒绝，申请就结束` },
        { 标: "等多久", 话: `${等待工作日} 个工作日内没有全部同意，申请失效，要重新发起` },
        { 标: "等的时候", 话: "两家照常能用；两家的负责人、阶段、回款或提成、被判无效有变，申请失效" },
        ...(n ? [{ 标: "合并后", 话: `挪过来 ${n.项目} 个项目、${n.联系人} 位联系人、${n.沟通} 条沟通；项目负责人、组员都不变，${撤回天数} 天内你可整单撤回` }] : []),
        { 标: "可撤回申请", 话: `都同意之前，你可以在「合并申请」页撤回` },
      ],
      做: async () => {
        const r = await 发起客户合并申请(customerId, 并掉.id, { 已核对: 预.要勾选 ? 勾 : undefined, 同一个人: 对们, 按号: 并掉.按号 });
        if (r.ok) { 结.单号 = r.requestId; 结.人数 = r.同意人.length; }
        return r;
      },
    });
    if (!成 || !结.单号) return;
    const id = 结.单号;
    关();
    router.refresh();
    showUndo({
      话: `合并申请已发出，等 ${结.人数} 位同意`,
      毫秒: 8000,
      撤销: async () => {
        const u = await 撤回客户合并申请(id);
        router.refresh();
        return u;
      },
      另一个动作: { 话: "看进度", 做: () => 去.push(合并申请页) },
    });
  }

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
          {走申请
            ? <Button type="primary" disabled={!能点} onClick={() => void 发申请()} data-testid="merge-request-go">发合并申请（要 {申!.同意人.length} 位同意）</Button>
            : <Button type="primary" disabled={!能点} onClick={() => void 合并()} data-testid="merge-go">合并</Button>}
        </div>
      ) : null}
    >
      {!并掉 && <CandidateSearch customerId={customerId} 提示={`选要并进这位客户的那家：它的联系人、项目、沟通都挪过来，它进回收站；${撤回话}。`} 空话={合并空话of(管)} 选={挑} />}
      {并掉 && !预 && !申 && !读错 && <p className="mrg-empty" aria-live="polite">正在读取…</p>}
      {并掉 && 读错 && <p role="alert" className="mrg-err">{读错}</p>}
      {并掉 && !走申请 && 申 && !申.能发 && <原因块 原因={申.原因} />}
      {并掉 && 预 && !预.能并 && !走申请 && <原因块 原因={预.原因} />}
      {并掉 && 预 && (预.能并 || 走申请) && (
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
          {走申请 && (
            <section className="mrg-ask" aria-label="要同意的人" data-testid="merge-approvers">
              <p className="mrg-sec-t">要同意的人 <span className="mrg-sec-c">他们都同意了才合并；{等待工作日} 个工作日内没全部同意，申请失效</span></p>
              <ul className="mrg-ask-l">
                {申!.同意人.map((x) => {
                  const 身份 = [...x.凭.map((v) => 凭叫法[v]), ...(x.项目.length ? [`${x.项目.length} 个项目：${x.项目.map((p) => p.name).join("、")}`] : ((x as { 项目数?: number }).项目数 ?? 0) > 0 ? [`${(x as { 项目数?: number }).项目数} 个项目`] : [])].join("；");
                  return (
                    <li key={x.userId} className="mrg-ask-r" data-testid="merge-approver">
                      {一行(x.名, x.名, "mrg-ask-n")}
                      {一行(身份, 身份, "mrg-ask-s")}
                    </li>
                  );
                })}
              </ul>
              <p className="mrg-note" data-testid="merge-ask-note">{并掉?.要申请 ? "并进来那家是同事的：联系人只显示姓名、职务，号码不显示。" : "走申请时两家联系人都只显示姓名、职务，号码不显示。"}</p>
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

/* ───────────────────────── 并进另一个项目（第二批 2a） ───────────────────────── */

/** 项目合并预览的条数 → 「挪过去」那一句；0 条的不写，都没有写「没有要挪的沟通、附件」 */
function 挪话(n: NonNullable<并项目预览["条数"]>): string {
  const 段 = [[n.沟通, "条沟通"], [n.附件, "个附件"], [n.录音, "段录音"], [n.点评, "条点评"], [n.卡点, "个没解决的卡点"]] as const;
  const 有 = 段.filter(([k]) => k > 0).map(([k, 字]) => `${k} ${字}`);
  return 有.length ? 有.join("、") : "没有要挪的沟通、附件";
}

/**
 * 两边各有项目联系人（不是同一位）时的核实话（E-331「合并时要核实」）：号码同不同都提示，合并不按号码去重、不自动合成；
 * 合成的入口在客户详情（联系人合并），这里只提示、不做按钮。每边最多列 3 位
 */
function 核实话(人: NonNullable<并项目预览["联系人"]>): string | null {
  if (!人.留下.length || !人.并掉.length) return null;
  const 列 = (xs: typeof 人.留下) => xs.slice(0, 3).map((x) => `${x.name || "（没写名字）"}（${x.尾号 ? `尾号 ${x.尾号}` : x.号藏 ? "号码看不到" : "没留号码"}）`).join("、") + (xs.length > 3 ? ` 等 ${xs.length} 位` : "");
  const 两位 = 人.留下.length === 1 && 人.并掉.length === 1;
  return `留下的项目有 ${列(人.留下)}，这个项目有 ${列(人.并掉)}：${两位 ? "这两位可能是同一个人" : "这几位里可能有同一个人"}，确认后可在客户详情里合成`;
}

function ProjectMergeDialog({ projectId, 项目名, 关 }: { projectId: string; 项目名: string; 关: () => void }) {
  const router = useRouter();
  const 去页 = useShellNavGo();
  const [问后果, 后果框] = useConsequence();
  const 管 = useMerge管();
  const [候选, set候选] = useState<Awaited<ReturnType<typeof 项目合并候选>> | null>(null);
  const [候选错, set候选错] = useState<string | null>(null);
  const [留下, set留下] = useState<string | null>(null);
  const [预, set预] = useState<并项目预览 | null>(null);
  const [读错, set读错] = useState<string | null>(null);
  const 读次 = useRef(0);
  // E-335 一.4：两个项目都还没开票的自查，不勾不能并；换了留下的项目要重新核对
  const [没开票, set没开票] = useState(false);

  useEffect(() => {
    let 还在 = true;
    项目合并候选(projectId).then((r) => { if (还在) set候选(r); })
      .catch((e) => { if (还在) set候选错(动作出错话(e, "没读到能并进的项目，请再试一次")); });
    return () => { 还在 = false; };
  }, [projectId]);

  function 挑(id: string) {
    const 这次 = ++读次.current;
    set留下(id); set预(null); set读错(null); set没开票(false);
    预览项目合并(id, projectId).then((r) => {
      if (这次 !== 读次.current) return;
      if (!r.ok) { set读错(r.error); return; }
      set预(r.预览);
    }).catch((e) => { if (这次 === 读次.current) set读错(动作出错话(e, "没读到合并预览，请再试一次")); });
  }

  const A = 预?.留下?.name || 候选?.find((c) => c.id === 留下)?.name || "留下的项目";
  const B = 预?.并掉?.name || 项目名 || "这个项目";
  const 撤回句 = `${撤回天数} 天内可在「历史变更」里撤回`;
  const 没开票话 = "我已核对：这两个项目都还没开票";
  const 清单 = 预?.能并 && 预.条数 ? [
    { 标: "挪过去", 话: 挪话(预.条数), 级: "警" as const },
    { 标: "联系人", 话: `${预.条数.联系人} 位项目联系人、${预.条数.关联客户} 位关联客户一起过去，同一位联系人只留一份`, 级: "常" as const },
    ...(预.联系人 && 核实话(预.联系人) ? [{ 标: "核实", 话: 核实话(预.联系人)!, 级: "警" as const }] : []),
    // 组员不并进留下的项目（E-331「随项目结束、留痕」）：只提示，不能勾；名单记在合并单和操作日志里
    ...(预.组员.length ? [{ 标: "组员", 话: `${预.组员.length} 位组员留在这个项目里，随项目结束、留痕，不并进留下的项目；不在那边项目组的看不到挪过去的沟通`, 级: "常" as const }] : []),
    { 标: "结束", 话: "这个项目将结束为重复线索，不退还已占线索名额", 级: "警" as const },
    { 标: "统计", 话: "记成重复线索（无效），渠道线索数照记，有效率会略降", 级: "常" as const },
    { 标: "不变", 话: "留下那个项目的负责人、阶段、节点都不变", 级: "常" as const },
  ] : [];

  async function 并() {
    if (!留下 || !预?.能并 || !没开票) return;
    const 留 = 留下;
    const 结: { 单号: string | null } = { 单号: null };
    const 成 = await 问后果({
      题: `把「${B}」并进「${A}」？`,
      宽: 480,
      危: false,
      是: "并过去",
      后果: [
        ...清单.filter((x) => x.标 !== "结束" && x.标 !== "不变"),
        { 标: "自查", 话: 没开票话, 级: "常" as const },
        { 标: "结束", 话: `这个项目将结束为重复线索，不退还已占线索名额，${撤回天数} 天内可撤回${管 ? "" : 并撤回谁话}`, 级: "警" as const },
      ],
      做: async () => {
        const r = await 合并项目(留, projectId, true);
        if (r.ok) 结.单号 = r.mergeId;
        return r;
      },
    });
    if (!成 || !结.单号) return;
    const id = 结.单号;
    关();
    router.refresh();
    showUndo({
      话: `已把「${B}」并进「${A}」，${撤回句}`,
      毫秒: 8000,
      另一个动作: { 话: "去看看", 做: () => 去页.push(`/projects/${留}`) },
      撤销: async () => {
        const u = await 撤回项目合并单(id);
        router.refresh();
        return u;
      },
    });
  }

  // 已签合同、到商机 / 订单的也列，灰着不能选、旁边写原因（E-331 必改 5，别像功能坏了）；服务端照样拦
  const 选项 = (候选 ?? []).map((c) => ({ value: c.id, label: c.name || "（没写名称）", node: c.node, 不能: c.不能 ?? "", disabled: !!c.不能 }));
  const 都灰 = 选项.length > 0 && 选项.every((o) => o.disabled);
  return (
    <Modal
      open
      onCancel={关}
      title={<span className="mrg-title"><span className="mrg-title-t">并进另一个项目</span><span className="mrg-title-who" title={项目名}>项目「{项目名}」</span></span>}
      width={560}
      className="mrg-modal"
      destroyOnHidden
      footer={
        <div className="mrg-foot">
          <span className="mrg-foot-sp" />
          <Button onClick={关}>取消</Button>
          <Button type="primary" disabled={!预?.能并 || !没开票} title={预?.能并 && !没开票 ? "请先勾选「我已核对：这两个项目都还没开票」" : undefined} onClick={() => void 并()} data-testid="pmerge-go">并过去</Button>
        </div>
      }
    >
      <div className="mrg-body">
        <p className="mrg-note">选留下的项目（同一位客户、同一位负责人、线索阶段在推的）：这个项目的沟通、附件、联系人都挪过去，它结束为重复线索；{撤回句}。</p>
        {!候选 && !候选错 && <p className="mrg-empty" aria-live="polite">正在读取…</p>}
        {候选错 && <p role="alert" className="mrg-err">{候选错}</p>}
        {候选 && 候选.length === 0 && <p className="mrg-empty" data-testid="pmerge-empty">这位客户名下没有同一位负责人在推的别的项目，没有能并进的。</p>}
        {都灰 && <p className="mrg-empty" data-testid="pmerge-allgrey">没有能选的项目，点开看各自为什么不能并。</p>}
        {候选 && 候选.length > 0 && (
          <Select
            className="mrg-psel"
            aria-label="留下的项目"
            placeholder="选留下的项目，可输入名称搜"
            showSearch={{ optionFilterProp: "label" }}
            value={留下 ?? undefined}
            onChange={挑}
            options={选项}
            optionRender={(o) => (
              <span className="mrg-popt">
                {一行(<>{o.label}{o.data.node && <span className="mrg-ppl-s"> · {o.data.node}</span>}</>, [o.data.label, o.data.node, o.data.不能].filter(Boolean).join(" · "))}
                {o.data.不能 && <span className="mrg-popt-no">{o.data.不能}</span>}
              </span>
            )}
            notFoundContent="没有名称对得上的项目"
            data-testid="pmerge-pick"
          />
        )}
        {留下 && !预 && !读错 && <p className="mrg-empty" aria-live="polite">正在读取…</p>}
        {留下 && 读错 && <p role="alert" className="mrg-err">{读错}</p>}
        {留下 && 预 && !预.能并 && <原因块 原因={预.原因} />}
        {留下 && 预 && 预.能并 && (
          <>
            <p className="mrg-move" data-testid="pmerge-move">{一行(<>「{B}」 → <b>「{A}」</b></>, `「${B}」 → 「${A}」`)}</p>
            <ul className="mrg-out" data-testid="pmerge-list">
              {清单.map((x) => <li key={x.标} data-testid={`pmerge-${x.标}`} className={x.标 === "核实" ? "mrg-out-chk" : undefined}><span className="mrg-out-k">{x.标}</span>{x.话}</li>)}
            </ul>
            <Checkbox className="mrg-nobill" checked={没开票} onChange={(e) => set没开票(e.target.checked)} data-testid="pmerge-nobill">{没开票话}</Checkbox>
          </>
        )}
      </div>
      {后果框}
    </Modal>
  );
}
