"use client";
import { dayjs } from "@/lib/utils";
import Shortcut from "./Shortcut";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Tag, Drawer } from "antd";
import { SearchOutlined, TableOutlined } from "@ant-design/icons";
import { 跟进方式名 } from "@/lib/follow-method";
import { 项目名单分组, 未填写组 } from "@/lib/roster-groups";
import { avatarColor, initial, smartTime, AVATAR_TEXT } from "@/lib/utils";
import { 开名单, 关名单, 登记换一位 } from "@/lib/roster";
import { useMiddlePane, usePaneShortcut } from "@/lib/middle-pane";
import PaneToggle from "@/components/PaneToggle";
import { useLocalPref } from "@/lib/local-pref";
import { RowLink } from "@/components/ui";
import type { 名单项目 } from "@/lib/project/list";

export type ProjectRosterData = { rows: 名单项目[]; 取到上限: boolean };

const 叫 = "项目列表";

/**
 * 企业版项目详情页的中栏名单（P11）：照客户记录页的 CustomerRoster——应用导航 | 这条名单 | 项目详情，三个竖条。
 * 只在 /projects/[id] 出现（@pane/projects/[id]），列表页 /projects 本身就是全宽的表，不挂。
 *
 * 范围和项目页一样（lib/project/list.ts 读名单项目）：业务员只看自己的 + 能看的，最多 项目上限 个。
 * 收起 / 抽屉 / ⌘\ / ⌘K 全走客户名单那套（lib/middle-pane.ts、lib/roster.ts），收起记在同一个开关上：
 * 两张详情页的中栏是同一个位置，在一边收了另一边还摊着反倒奇怪。
 *
 * 不搜时按「当前阶段」分组（线索 / 商机 / 订单，三大阶段的顺序，lib/roster-groups.ts 项目名单分组），
 * 组头写阶段名和条数，可以折叠（记在这台电脑上）；每行右边写当前进程（阶段里的节点，有结局写结局）。
 */
export default function ProjectRoster({ data }: { data: ProjectRosterData }) {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState("");
  const 中栏 = useMiddlePane("roster");
  const 抽屉里 = !中栏.露着;
  const 抽屉开着 = 中栏.抽屉开着;
  usePaneShortcut(中栏.切换);
  const 搜索框 = useRef<HTMLInputElement>(null);
  const activeId = pathname.startsWith("/projects/") ? pathname.split("/")[2] : "";

  const rows = useMemo(() => {
    const k = q.trim().toLowerCase();
    // 客户名只在露客户时给了（不露时是 null），所以按客户名搜不出公海里同事客户的项目——和项目页的搜索一个口径
    return data.rows.filter((r) => !k || [r.name, r.customerName, r.lastNote].some((s) => (s ?? "").toLowerCase().includes(k)));
  }, [data.rows, q]);

  const [收起的, set收起的] = useLocalPref<string[]>("projRoster.collapsed", []);
  /* 「本周要跟」= 项目的下一步日期排在七天之内的，过期没做的也算（照客户名单那条；计划挂在客户上，按项目只有下一步日期这一格） */
  const [页签, set页签] = useState<"全部" | "本周">("全部");
  const 七天后 = dayjs().add(7, "day").endOf("day");
  const 页签里 = useMemo(
    () => rows.filter((r) => (页签 === "本周" ? Boolean(r.nextAt && dayjs(r.nextAt).isBefore(七天后)) : true)),
    // 七天后 每次渲染都新算，按天变就够了，不进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, 页签],
  );
  const 分组 = !q.trim();
  const 组们 = useMemo(() => 项目名单分组(页签里), [页签里]);
  const 切组 = (s: string) => set收起的(收起的.includes(s) ? 收起的.filter((x) => x !== s) : [...收起的, s]);

  // ⌘K：光标进搜索框（窄屏时先把抽屉打开），键由 CommandBar 听，这里只登记（lib/roster.ts 登记换一位）
  useEffect(
    () =>
      登记换一位(() => {
        if (抽屉里) return 开名单();
        搜索框.current?.focus();
        搜索框.current?.select();
      }),
    [抽屉里],
  );
  useEffect(() => {
    if (抽屉开着) setTimeout(() => 搜索框.current?.focus(), 80);
  }, [抽屉开着]);

  // 圆点和客户名单同一套：橙 = 下一步到期了（今天或更早），灰 = 一个月没沟通，绿 = 正常
  const 今天末 = dayjs().endOf("day");
  const 点 = (r: 名单项目) =>
    r.nextAt && dayjs(r.nextAt).isBefore(今天末)
      ? { cls: "due", 说: r.nextText ? `下一步到期了：${r.nextText}` : "下一步到期了" }
      : !r.lastAt || dayjs().diff(dayjs(r.lastAt), "day") >= 30
        ? { cls: "cold", 说: "一个月没沟通了" }
        : { cls: "ok", 说: "最近沟通过" };
  const 一行 = (r: 名单项目, 带阶段: boolean) => {
    const d = 点(r);
    const 方式 = r.lastType ? 跟进方式名({ type: r.lastType, method: r.lastMethod }) : null;
    const 进程 = r.结局 ?? r.进程;
    return (
      <RowLink key={r.id} href={`/projects/${r.id}`} className={`roster-row${activeId === r.id ? " on" : ""}`} onClick={() => 抽屉开着 && 关名单()}>
        <span className="roster-av" style={{ background: avatarColor(r.name), color: AVATAR_TEXT }}>
          {initial(r.name)}
        </span>
        <span className="roster-m">
          <span className="roster-l0">
            <span className="roster-src" title={[r.阶段?.trim(), r.pooled ? "公海" : null, 方式].filter(Boolean).join(" · ") || undefined}>
              {带阶段 && (
                <Tag style={{ margin: "0 6px 0 0", borderRadius: 5, fontSize: 12, lineHeight: "18px", padding: "0 5px" }}>{r.阶段?.trim() || 未填写组}</Tag>
              )}
              {[r.pooled ? "公海" : null, 方式].filter(Boolean).join(" · ")}
            </span>
            <span className="roster-t">{r.lastAt ? smartTime(r.lastAt) : ""}</span>
          </span>
          <span className="roster-n">{r.name}</span>
          <span className="roster-l2">
            {/* 名字整段显示（.roster-n 不截）；最近一句是辅助，最多两行，悬停看全 */}
            <span className="roster-note" title={r.lastNote ?? undefined}>{r.lastNote ?? `还没沟通${r.customerName ? ` · ${r.customerName}` : ""}`}</span>
            {进程 && (
              <span className="roster-stage" title={`当前进程：${进程}`}>
                {进程}
              </span>
            )}
            <span className={`roster-dot ${d.cls}`} title={d.说} aria-label={d.说} />
          </span>
        </span>
      </RowLink>
    );
  };

  const 内容 = (
    <>
      <div className="pane-h">
        <span className="pane-t">
          项目
          <span className="pane-n">{data.rows.length}</span>
        </span>
        <Link href="/projects" className="pane-ib" aria-label="项目表格" title="表格视图">
          <TableOutlined />
        </Link>
        <PaneToggle 栏="roster" 位置="中栏" 名={叫} />
      </div>
      <div className="roster-tabs" role="tablist" aria-label={叫}>
        {(["全部", "本周"] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={页签 === t} className={`roster-tab${页签 === t ? " on" : ""}`} onClick={() => set页签(t)}>
            {t === "本周" ? "本周要跟" : t}
          </button>
        ))}
      </div>
      <div className="pane-search">
        <SearchOutlined style={{ color: "var(--text-muted)" }} />
        <input
          ref={搜索框}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜项目名、客户、最近一句"
          aria-label="搜索项目"
          onKeyDown={(e) => {
            // 名单里没有的，回车去项目页全量里搜
            if (e.key === "Enter" && q.trim() && rows.length === 0) router.push(`/projects?keyword=${encodeURIComponent(q.trim())}`);
          }}
        />
        <kbd className="pane-kbd">
          <Shortcut>⌘K</Shortcut>
        </kbd>
      </div>
      <div className="pane-rows">
        {页签里.length === 0 && (
          <div className="pane-empty">{q ? "名单里没有，回车去项目页里搜" : 页签 === "本周" ? "这一周没有到期的下一步" : "还没有项目"}</div>
        )}
        {分组
          ? 组们.map((g) => {
              const 开 = !收起的.includes(g.s);
              return (
                <div key={g.s} className="roster-group">
                  <button type="button" className="roster-sec" aria-expanded={开} onClick={() => 切组(g.s)}>
                    <span className="roster-car" aria-hidden="true">▾</span>
                    {g.s}
                    <span className="roster-cnt">{g.rows.length}</span>
                  </button>
                  {开 && g.rows.map((r) => 一行(r, false))}
                </div>
              );
            })
          : 页签里.map((r) => 一行(r, true))}
        {data.取到上限 && (
          <Link href="/projects" className="pane-more">
            这里只有最近改过的 {data.rows.length} 个，更早的在项目页里搜 ›
          </Link>
        )}
      </div>
    </>
  );

  if (抽屉里) {
    return (
      <Drawer
        placement="left"
        open={抽屉开着}
        onClose={关名单}
        closable={false}
        styles={{ wrapper: { width: 300 }, body: { padding: 0, display: "flex", flexDirection: "column" } }}
        rootClassName="pane-drawer"
      >
        {内容}
      </Drawer>
    );
  }

  return <aside className="pane pane-roster">{内容}</aside>;
}
