"use client";

/**
 * 疑似重复清单（12-15 第三批 C，P-合并-06）· 界面：每组一行（客户名、组里每家的编号 · 负责人 · 建档 · 项目数），按钮「合并」「不是同一个人」。
 *   - 合并：开客户详情那只合并框（MergeHost 的 MergePairDialog），两家预选好；同事负责的那家框里自动走第二批合并申请。谁能并服务端判
 *   - 不是同一个人：直接标，底部撤销条可撤；标过的不再列。另一栏「已标不是同一个人」列着能撤的
 * 只读身份（只读管理员、销售教练、只看某人、切换视图在看别人）：清单照看，按钮置灰、悬停写原因。
 * 手机（≤767）：每组一张卡，按钮占满一行；一行省略、悬停看全（企业版全站规矩），390 不横滚（dupes.css）
 */
import "./dupes.css";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Empty, Pagination, Segmented } from "antd";
import { PageHead } from "@/components/ui";
import { LinkPending } from "@/components/NavProgress";
import { useViewAs } from "@/components/ViewAsContext";
import { showUndo } from "@/components/UndoBar";
import { 动作出错话 } from "@/lib/stale-deploy";
import { dayjs } from "@/lib/utils";
import type { 清单页, 清单组, 清单成员, 已标一对 } from "@/lib/enterprise/dupe-groups";
import { 标为不是同一个人, 撤销不是同一个人标记 } from "../dupe-actions";
import { 看别人视角话 } from "../merge-request-words";
import { 疑似重复页 } from "../dupe-words";
import { MergePairDialog } from "../[id]/MergeHost";

const 日 = (ms: number) => (ms ? dayjs(ms).format("YYYY-MM-DD") : "");
/** 一行省略、悬停看全 */
const 一行 = (v: string, cls = "") => <span className={`dp-one ${cls}`} title={v || undefined}>{v}</span>;
/** 负责人那一格：自己的写「我」，公海的写「公海」 */
const 谁负责 = (m: 清单成员) => (m.在公海 ? "公海" : m.我的 ? "我" : m.负责人 ?? "（没有负责人）");
const 成员话 = (m: 清单成员) => [m.编号, `负责人 ${谁负责(m)}`, `建档 ${日(m.建档)}`, `${m.项目数} 个项目`].filter(Boolean).join(" · ");

export default function DupesView({ 清单, 已标, 只读原因 = null }: { 清单: 清单页; 已标: 已标一对[] | null; 只读原因?: string | null }) {
  const router = useRouter();
  const 切换视图 = useViewAs();
  const 不能写 = 只读原因 ?? (切换视图 ? 看别人视角话 : null);
  const [忙, set忙] = useState<string | null>(null);
  const [行错, set行错] = useState<{ 键: string; 话: string } | null>(null);
  const [合, set合] = useState<{ 留下: 清单成员; 并掉: 清单成员 } | null>(null);
  const 看已标 = 已标 !== null;

  const 去 = (q: Record<string, string | number | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== "" && v !== 1) u.set(k, String(v));
    const s = u.toString();
    router.push(s ? `${疑似重复页}?${s}` : 疑似重复页);
  };

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
    const 留 = g.们.find((m) => m.id === g.留下)!;
    const 并 = g.们.find((m) => m.id === g.并掉)!;
    return (
      <li key={g.键} className="dp-row" data-testid="dupe-group">
        <div className="dp-head">
          {一行(g.们[0].名, "dp-name")}
          <span className="dp-cnt">{g.们.length} 家</span>
        </div>
        <ul className="dp-mems" aria-label="同名的几家">
          {g.们.map((m) => (
            <li key={m.id} className="dp-mem" data-testid="dupe-member">
              {名格(m, 清单.管 || m.我的)}
              {一行(成员话(m), "dp-sub")}
            </li>
          ))}
        </ul>
        <div className="dp-ops">
          {钮(<Button size="small" type="primary" disabled={!!不能写 || 忙 === g.键} onClick={() => set合({ 留下: 留, 并掉: 并 })} data-testid="dupe-merge">合并</Button>)}
          {钮(<Button size="small" disabled={!!不能写} loading={忙 === g.键} onClick={() => 标(g)} data-testid="dupe-not-same">不是同一个人</Button>)}
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
            {名格(m, 清单.管)}
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
        value={看已标 ? "marked" : "todo"}
        onChange={(v) => 去({ tab: v === "marked" ? "marked" : undefined })}
        options={[{ label: `待处理 ${清单.共} 组`, value: "todo" }, { label: "已标不是同一个人", value: "marked" }]}
      />
      {!看已标 && (清单.组们.length
        ? <>
            <ul className="dp-list" data-testid="dupe-list">{清单.组们.map(组行)}</ul>
            {清单.共 > 清单.每页 && (
              <Pagination className="dp-pager" size="small" current={清单.页} pageSize={清单.每页} total={清单.共} showSizeChanger={false} onChange={(p) => 去({ page: p })} />
            )}
          </>
        : <Empty description="没有疑似重复的客户" />)}
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
