"use client";

/**
 * 疑似重复清单（12-15 第三批 C，P-合并-06）· 界面：每组一行（客户名、组里每家的编号 · 负责人 · 建档 · 项目数），按钮「合并」「不是同一个人」。
 *   - 合并：开客户详情那只合并框（MergeHost 的 MergePairDialog），两家预选好；同事负责的那家框里自动走第二批合并申请。谁能并服务端判
 *   - 不是同一个人：直接标，底部撤销条可撤；标过的不再列。另一栏「已标不是同一个人」列着能撤的
 * 公海同名（12-15 D，P-合并-07）：系统管理员多一个「公海组」页签（两家都在公海的同名组，「合并」只对管理员亮；点之前服务端再核一遍，普通角色调用被拒）；
 *   一家在公海、一家有负责人的组：行上写「公海里那家先领出来再并」，默认那一对是这种就不给「合并」，有负责人那家的负责人可点「去领取」（走公海的领取，回避、持有上限、市场不能领照旧）
 * 只读身份（只读管理员、销售教练、只看某人、切换视图在看别人）：清单照看，按钮置灰、悬停写原因。
 * 手机（≤767）：每组一张卡，按钮占满一行；一行省略、悬停看全（企业版全站规矩），390 不横滚（dupes.css）
 */
import "./dupes.css";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { App, Button, Empty, Pagination, Segmented } from "antd";
import { PageHead } from "@/components/ui";
import { LinkPending } from "@/components/NavProgress";
import { useViewAs } from "@/components/ViewAsContext";
import { showUndo } from "@/components/UndoBar";
import { 动作出错话 } from "@/lib/stale-deploy";
import { dayjs } from "@/lib/utils";
import type { 清单页, 清单组, 清单成员, 已标一对 } from "@/lib/enterprise/dupe-groups";
import { 标为不是同一个人, 撤销不是同一个人标记, 核对清单合并 } from "../dupe-actions";
import { 领取 } from "../pool-actions";
import { 看别人视角话 } from "../merge-request-words";
import { 疑似重复页 } from "../dupe-words";
import { MergePairDialog } from "../[id]/MergeHost";

const 日 = (ms: number) => (ms ? dayjs(ms).format("YYYY-MM-DD") : "");
/** 一行省略、悬停看全 */
const 一行 = (v: string, cls = "") => <span className={`dp-one ${cls}`} title={v || undefined}>{v}</span>;
/** 负责人那一格：自己的写「我」，公海的写「公海」 */
const 谁负责 = (m: 清单成员) => (m.在公海 ? "公海" : m.我的 ? "我" : m.负责人 ?? "（没有负责人）");
const 成员话 = (m: 清单成员) => [m.编号, `负责人 ${谁负责(m)}`, `建档 ${日(m.建档)}`, `${m.项目数} 个项目`].filter(Boolean).join(" · ");

export default function DupesView({ 清单, 已标, 只读原因 = null, 栏 = "普通" }: { 清单: 清单页; 已标: 已标一对[] | null; 只读原因?: string | null; 栏?: "普通" | "公海" }) {
  const router = useRouter();
  const { modal } = App.useApp();
  const 切换视图 = useViewAs();
  const 不能写 = 只读原因 ?? (切换视图 ? 看别人视角话 : null);
  const [忙, set忙] = useState<string | null>(null);
  const [行错, set行错] = useState<{ 键: string; 话: string } | null>(null);
  const [合, set合] = useState<{ 留下: 清单成员; 并掉: 清单成员 } | null>(null);
  const 看已标 = 已标 !== null;
  const 页签值 = 看已标 ? "marked" : 栏 === "公海" ? "pool" : "todo";

  const 去 = (q: Record<string, string | number | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== "" && v !== 1) u.set(k, String(v));
    const s = u.toString();
    router.push(s ? `${疑似重复页}?${s}` : 疑似重复页);
  };

  /** 三家及以上先确认：一次标掉的是两两所有对，其中有同一位的要先合并（12-15 C 审查建议 5） */
  function 点不是同一个人(g: 清单组) {
    if (g.们.length < 3) { void 标(g); return; }
    const 全对 = g.们.length * (g.们.length - 1) / 2;
    modal.confirm({
      title: "确认都不是同一个人？",
      content: g.对们.length === 全对
        ? `这 ${g.们.length} 家两两都不是同一位；其中有同一位的请先合并`
        : `这 ${g.们.length} 家里会标 ${g.对们.length} 对互不是同一位；其中有同一位的请先合并`,
      okText: "都不是同一位，标上",
      cancelText: "取消",
      onOk: () => 标(g),
    });
  }

  async function 标(g: 清单组) {
    set忙(g.键); set行错(null);
    const r = await 标为不是同一个人(g.们.map((m) => m.id)).catch((e) => ({ ok: false as const, error: 动作出错话(e, "没标上，请再试一次") }));
    set忙(null);
    if (!r.ok) { set行错({ 键: g.键, 话: r.error }); return; }
    router.refresh();
    const 对们 = r.对们;
    showUndo({
      话: `已标「${g.们[0].名}」这 ${g.们.length} 家不是同一个人，不再列出`,
      毫秒: 6000,
      撤销: async () => {
        const u = await 撤销不是同一个人标记(对们);
        router.refresh();
        return u;
      },
    });
  }

  /** 点「合并」：先让服务端核一遍（公海对只有系统管理员能并、一家公海一家有主回先领出来再并），过了才开合并框 */
  async function 点合并(g: 清单组, 留: 清单成员, 并: 清单成员) {
    set忙(g.键); set行错(null);
    const r = await 核对清单合并(留.id, 并.id).catch((e) => ({ ok: false as const, error: 动作出错话(e, "没打开，请再试一次") }));
    set忙(null);
    if (!r.ok) { set行错({ 键: g.键, 话: r.error }); return; }
    set合({ 留下: 留, 并掉: 并 });
  }

  /** 「去领取」：把公海那家领成自己的，领完刷新（回避、持有上限、市场不能领由领取那边判，原话回给这一行） */
  async function 去领取(g: 清单组, id: string) {
    set忙(`${g.键}:${id}`); set行错(null);
    const r = await 领取([id]).catch((e) => ({ ok: false as const, error: 动作出错话(e, "没领取成功，请再试一次") }));
    set忙(null);
    if (!r.ok) { set行错({ 键: g.键, 话: r.error }); return; }
    if (!r.updated) { set行错({ 键: g.键, 话: "这家已经不在公海了，刷新再看" }); router.refresh(); return; }
    router.refresh();
  }

  async function 撤(p: 已标一对) {
    set忙(p.id); set行错(null);
    const r = await 撤销不是同一个人标记([p.id]).catch((e) => ({ ok: false as const, error: 动作出错话(e, "没撤成，请再试一次") }));
    set忙(null);
    if (!r.ok) { set行错({ 键: p.id, 话: r.error }); return; }
    router.refresh();
  }

  const 钮 = (b: ReactNode) => (不能写 ? <span className="dp-ro" title={不能写}>{b}</span> : b);
  const 名格 = (m: { id: string; 名: string }, 能点: boolean) =>
    能点 ? <Link href={`/customers/${m.id}`} className="dp-one dp-link" title={m.名}>{m.名}<LinkPending /></Link> : 一行(m.名);

  const 组行 = (g: 清单组) => {
    if (g.太多) {
      // 超一组上限：不列成员、不给一键标（也省掉两两成对的开销），逐家去客户详情处理
      return (
        <li key={g.键} className="dp-row" data-testid="dupe-group-toomany">
          <div className="dp-head">
            {一行(g.组名, "dp-name")}
            <span className="dp-cnt">同名 {g.家数} 家，太多请逐家处理</span>
            <Link href={`/customers?keyword=${encodeURIComponent(g.组名)}`} className="dp-cnt dp-link" data-testid="dupe-toomany-link">去客户列表按名字找 ›<LinkPending /></Link>
          </div>
        </li>
      );
    }
    const 留 = g.们.find((m) => m.id === g.留下)!;
    const 并 = g.们.find((m) => m.id === g.并掉)!;
    const 能领 = g.们.some((m) => m.我的);
    return (
      <li key={g.键} className="dp-row" data-testid="dupe-group">
        <div className="dp-head">
          {一行(g.们[0].名, "dp-name")}
          <span className="dp-cnt">{g.们.length} 家</span>
          {g.公海组 && <span className="dp-cnt" data-testid="dupe-pool-tag">都在公海</span>}
        </div>
        <ul className="dp-mems" aria-label="同名的几家">
          {g.们.map((m) => (
            <li key={m.id} className="dp-mem" data-testid="dupe-member">
              {名格(m, 清单.管 || m.我的)}
              {一行(成员话(m), "dp-sub")}
            </li>
          ))}
        </ul>
        {g.先领.length > 0 && (
          <div className="dp-hint" data-testid="dupe-claim-first">
            {一行("公海里那家先领出来再并", "dp-note")}
            {能领 && g.先领.map((id) => 钮(
              <Button key={id} size="small" disabled={!!不能写} loading={忙 === `${g.键}:${id}`} onClick={() => 去领取(g, id)} data-testid="dupe-claim" title={`领取「${g.们.find((m) => m.id === id)?.编号 ?? ""}」`}>去领取</Button>,
            ))}
          </div>
        )}
        <div className="dp-ops">
          {g.能并 && 钮(<Button size="small" type="primary" disabled={!!不能写 || 忙 === g.键} onClick={() => 点合并(g, 留, 并)} data-testid="dupe-merge">合并</Button>)}
          {钮(<Button size="small" disabled={!!不能写} loading={忙 === g.键} onClick={() => 点不是同一个人(g)} data-testid="dupe-not-same">不是同一个人</Button>)}
        </div>
        {行错?.键 === g.键 && <div className="dp-err" role="alert" title={行错.话}>{行错.话}</div>}
      </li>
    );
  };

  const 已标行 = (p: 已标一对) => (
    <li key={p.id} className="dp-row" data-testid="dupe-marked">
      <ul className="dp-mems" aria-label="标了不是同一个人的两家">
        {p.两家.map((m) => (
          <li key={m.id} className="dp-mem">
            {名格(m, 清单.管 || m.我的)}
            {一行(`负责人 ${m.负责人 ?? "公海"}`, "dp-sub")}
          </li>
        ))}
      </ul>
      {一行([p.谁标 ? `${p.谁标}标的` : "", 日(p.标于)].filter(Boolean).join(" · "), "dp-by")}
      <div className="dp-ops">
        {钮(<Button size="small" disabled={!!不能写} loading={忙 === p.id} onClick={() => 撤(p)} data-testid="dupe-undo-mark">撤销标记</Button>)}
      </div>
      {行错?.键 === p.id && <div className="dp-err" role="alert" title={行错.话}>{行错.话}</div>}
    </li>
  );

  return (
    <div className="dp-page">
      <PageHead
        title="疑似重复"
        subtitle={清单.管 ? "名字相同的客户，逐组看是不是同一位：是就合并，不是就标一下，标过的不再列" : "你负责的客户里，和别的客户名字相同的，逐组看是不是同一位：是就合并，不是就标一下，标过的不再列"}
        extra={<Link href="/customers">回到客户列表</Link>}
      />
      <Segmented
        className="dp-tabs"
        value={页签值}
        onChange={(v) => 去({ tab: v === "marked" ? "marked" : v === "pool" ? "pool" : undefined })}
        options={[
          { label: 页签值 === "todo" ? `待处理 ${清单.共} 组` : "待处理", value: "todo" },
          // 公海组只有系统管理员有（服务端不给别的角色，这里也不摆）
          ...(清单.管 ? [{ label: 页签值 === "pool" ? `公海组 ${清单.共} 组` : 清单.公海共 ? `公海组 ${清单.公海共} 组` : "公海组", value: "pool" }] : []),
          { label: "已标不是同一个人", value: "marked" },
        ]}
      />
      {!看已标 && (清单.组们.length
        ? <>
            <ul className="dp-list" data-testid="dupe-list">{清单.组们.map(组行)}</ul>
            {清单.共 > 清单.每页 && (
              <Pagination className="dp-pager" size="small" current={清单.页} pageSize={清单.每页} total={清单.共} showSizeChanger={false} onChange={(p) => 去({ page: p })} />
            )}
          </>
        : <Empty description={栏 === "公海" ? "公海里没有同名的客户" : "没有疑似重复的客户"} />)}
      {看已标 && (已标!.length
        ? <ul className="dp-list" data-testid="dupe-marked-list">{已标!.map(已标行)}</ul>
        : <Empty description="还没有标过「不是同一个人」的" />)}
      {合 && (
        <MergePairDialog
          留下={{ id: 合.留下.id, name: 合.留下.名 }}
          并掉={{ id: 合.并掉.id, name: 合.并掉.名, 编号: 合.并掉.编号, 负责人: 合.并掉.负责人, ...(合.并掉.要申请 ? { 要申请: true } : {}) }}
          关={() => set合(null)}
        />
      )}
    </div>
  );
}
