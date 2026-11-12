"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, Dropdown } from "antd";
import { DownOutlined } from "@ant-design/icons";
import { 阶段色 } from "../../projects/[id]/ProjectStages";
import { FoldSplit, ProjectFold, 模块钮色 } from "../../projects/[id]/ProjectFold";
import ProjectDetail, { type 项目详情Props } from "../../projects/[id]/ProjectDetail";
import { 客户页项目地址 } from "@/lib/project/customer-detail-href";
import type { 项目区槽 } from "./types";
import type { 项目动作键 } from "../../projects/[id]/project-menu";

/** 项目区切换行上的一个项目：名字 + 当前节点（有结局写结局）+ 所在阶段 */
export type 项目页签 = {
  id: string; name: string; 节点: string;
  /** 三大阶段之一（线索 / 商机 / 订单）；胶囊名字后面写它（11-12 用户：「项目名后面就不要具体进程了，就跟三大阶段」） */
  阶段?: string;
  /** 有结局（异常状态、交付结清、丢单…）：胶囊后面照原页签的标法写结局（= 节点那句），不写阶段 */
  结局?: string | null;
  /** 冷项目（C11，三态开着才有）：没推进的天数，名字后一个小灰标「冷」 */
  冷天数?: number;
};

/** 客户页交给项目区的数据（page.tsx 读，project-zone.ts 读项目区） */
export type 项目区数据 = {
  customerId: string;
  /** 我能看的项目，各一个页签（最近有动静的在前） */
  页签们: 项目页签[];
  /** 看不到的同事项目个数：只显示带锁的个数，点不开（P-看-12 只给个数） */
  锁数: number;
  /** 当前页签的项目：项目详情的那一份数据；没有项目可选 = null（空状态） */
  当前: 项目详情Props | null;
};

const 锁 = (
  <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden focusable="false">
    <rect x="2.2" y="5.3" width="7.6" height="5.2" rx="1.3" />
    <path d="M4 5.3V3.8a2 2 0 0 1 4 0v1.5" />
  </svg>
);

/** 胶囊名字后面那一小格：有结局写结局（原页签同一句），没有写所在阶段 */
const 标of = (t: 项目页签) => (t.结局 ? t.节点 : t.阶段 ?? t.节点);

function 锁格({ 数 }: { 数: number }) {
  if (数 <= 0) return null;
  return (
    <span className="cd-lock" title={`还有 ${数} 个同事负责的项目，你看不到内容`} aria-label={`同事项目 ${数} 个`}>
      {锁}
      <span className="cd-lock-t">同事项目 </span>{数}
    </span>
  );
}

function 胶囊身({ t }: { t: 项目页签 }) {
  const 标 = 标of(t);
  return (
    <>
      {!t.结局 && t.阶段 && <span className="cd-pj-dot" aria-hidden style={{ background: 阶段色[t.阶段] }} />}
      <b className="cd-pj-nm">{t.name}</b>
      <em className="cd-pj-st">{标}</em>
      {t.冷天数 != null && <span className="cd-cold" title={`${t.冷天数} 天没有推进`}>冷</span>}
    </>
  );
}

/**
 * 「更多 N 个」怎么算（11-12 方案一）：一排隐藏的量尺把每颗胶囊按真实样式摆一遍（max-width 210 封顶），量出各自宽度；
 * 每颗还能缩到 胶囊最窄（名字省略号），本来就窄的不缩。可用宽 = 切换行宽 − 「项目」小字 − 锁 − 间隔。
 * 先看全部按「最窄」能不能放下；放不下就从左往右放前 k 颗 + 「更多」，k 取最大的那个；选中的那颗要是被收进去，就顶替第 k 颗的位置。
 * 至少放 1 颗（选中的）；连 1 颗 + 「更多」都按最窄放不下（窄屏、单栏）时，这一颗再往下缩到剩下的宽（最少 40）。宽度变了（ResizeObserver）、字体到了重新量；放下以后多出来的空间由 CSS 让各颗往自然宽长回去
 */
export const 胶囊最窄 = 96;
export function 算可见(宽们: number[], 可用: number, 更多宽: number, 间隔: number, 选中: number): number[] {
  const n = 宽们.length;
  const 和 = (ids: number[]) => ids.reduce((s, i) => s + 宽们[i], 0) + 间隔 * Math.max(0, ids.length - 1);
  const 全 = [...Array(n).keys()];
  if (和(全) <= 可用) return 全;
  for (let k = n - 1; k >= 1; k--) {
    let ids = 全.slice(0, k);
    if (选中 >= k) ids = [...全.slice(0, k - 1), 选中];
    if (和(ids) + 间隔 + 更多宽 <= 可用) return ids;
  }
  return [选中 >= 0 ? 选中 : 0];
}

/**
 * 进程卡卡头左边的项目切换（11-12 用户定「方案一：项目名放进进程卡卡头」）：行首小灰字「项目」；
 * 只有 1 个项目直接写项目名（加粗、一行省略、悬停看全）；2 个以上一排小胶囊，每颗 = 项目名 + 所在阶段（有结局写结局），选中的品牌浅底，
 * 点哪颗切哪个项目（到 ?project= 的链接，同原页签）。放不下不折行、不横滚：其余收进末尾「更多 N 个」，选中的永远看得见。
 * 同事项目照旧只给带锁的个数
 */
export function ProjectSwitch({ 数据, 当前id }: { 数据: 项目区数据; 当前id: string | null }) {
  const router = useRouter();
  const 行 = useRef<HTMLDivElement>(null);
  const 尺 = useRef<HTMLDivElement>(null);
  const 页签们 = 数据.页签们;
  const 选中 = 页签们.findIndex((t) => t.id === 当前id);
  const [可见, set可见] = useState<number[] | null>(null);
  const [最窄, set最窄] = useState<number[]>([]);
  const 量 = useCallback(() => {
    const 框 = 行.current, 量尺 = 尺.current;
    if (!框 || !量尺) return;
    const 胶囊们 = [...量尺.querySelectorAll<HTMLElement>(".cd-pj-pill:not(.cd-pj-more)")];
    const 更多 = 量尺.querySelector<HTMLElement>(".cd-pj-more");
    const 别的 = [...框.children].filter((el) => !el.classList.contains("cd-pj-pills") && !el.classList.contains("cd-pj-ruler")) as HTMLElement[];
    const 间隔 = parseFloat(getComputedStyle(框).columnGap) || 0;
    const 可用 = 框.clientWidth - 别的.reduce((s, el) => s + el.getBoundingClientRect().width + 间隔, 0);
    const 最窄们 = 胶囊们.map((el) => Math.min(Math.ceil(el.getBoundingClientRect().width), 胶囊最窄));
    const 更多宽 = 更多?.getBoundingClientRect().width ?? 0;
    const ids = 算可见(最窄们, 可用, 更多宽, 间隔, 选中);
    if (ids.length === 1 && 胶囊们.length > 1 && 最窄们[ids[0]] + 间隔 + 更多宽 > 可用) 最窄们[ids[0]] = Math.max(40, Math.floor(可用 - 间隔 - 更多宽));
    set最窄((o) => (o.length === 最窄们.length && o.every((x, i) => x === 最窄们[i]) ? o : 最窄们));
    set可见((o) => (o && o.length === ids.length && o.every((x, i) => x === ids[i]) ? o : ids));
  }, [选中]);
  useLayoutEffect(() => {
    量();
    const 框 = 行.current;
    if (!框) return;
    const 看 = new ResizeObserver(量);
    看.observe(框);
    let 还在 = true;
    document.fonts?.ready.then(() => { if (还在) 量(); });
    return () => { 还在 = false; 看.disconnect(); };
  }, [量, 页签们]);
  const 地址 = (id: string) => 客户页项目地址(数据.customerId, id);
  if (页签们.length <= 1) {
    const t = 页签们[0];
    return (
      <div className="cd-pj" ref={行}>
        <span className="cd-cap">项目</span>
        {t && (
          <span className="cd-pj-one" title={`${t.name} · ${标of(t)}`}>
            <b className="cd-pj-nm">{t.name}</b>
            <span className="cd-pj-tag">
              {!t.结局 && t.阶段 && <span className="cd-pj-dot" aria-hidden style={{ background: 阶段色[t.阶段] }} />}
              {标of(t)}
            </span>
            {t.冷天数 != null && <span className="cd-cold" title={`${t.冷天数} 天没有推进`}>冷</span>}
          </span>
        )}
        <锁格 数={数据.锁数} />
      </div>
    );
  }
  // 首帧还没量：先全摆（CSS 让它们缩、省略），量完再收；SSR 首屏也是这样，不闪成空
  const 摆 = 可见 ?? 页签们.map((_, i) => i);
  const 收 = 页签们.map((_, i) => i).filter((i) => !摆.includes(i));
  const 顺 = [...摆].sort((a, b) => a - b);
  return (
    <div className="cd-pj" ref={行}>
      <span className="cd-cap">项目</span>
      <div className="cd-pj-pills" role="tablist" aria-label="这位客户的项目">
        {顺.map((i) => {
          const t = 页签们[i];
          const on = t.id === 当前id;
          return (
            <Link
              key={t.id}
              role="tab"
              aria-selected={on}
              className={`cd-pj-pill${on ? " on" : ""}`}
              style={最窄[i] ? { minWidth: 最窄[i] } : undefined}
              href={地址(t.id)}
              scroll={false}
              replace
              title={`${t.name} · ${标of(t)}${t.冷天数 != null ? ` · ${t.冷天数} 天没有推进` : ""}`}
            >
              <胶囊身 t={t} />
            </Link>
          );
        })}
        {收.length > 0 && (
          <Dropdown
            trigger={["click"]}
            placement="bottomLeft"
            menu={{
              className: "cd-pj-menu",
              items: 收.map((i) => ({ key: 页签们[i].id, label: <span className="cd-pj-mi" title={页签们[i].name}><胶囊身 t={页签们[i]} /></span> })),
              onClick: ({ key }) => router.replace(地址(key), { scroll: false }),
            }}
          >
            <button type="button" className="cd-pj-pill cd-pj-more">更多 {收.length} 个 <DownOutlined aria-hidden /></button>
          </Dropdown>
        )}
      </div>
      <锁格 数={数据.锁数} />
      {/* 量尺：每颗胶囊按真样式量一遍宽，读屏不念、点不到 */}
      <div className="cd-pj-ruler" ref={尺} aria-hidden>
        {页签们.map((t) => <span key={t.id} className={`cd-pj-pill${t.id === 当前id ? " on" : ""}`}><胶囊身 t={t} /></span>)}
        <span className="cd-pj-pill cd-pj-more">更多 {页签们.length} 个 <DownOutlined /></span>
      </div>
    </div>
  );
}

/** 项目区：有项目画项目详情（嵌入版），没有就是空状态 + 「＋ 新建项目」 */
export default function ProjectZone({ 数据, 槽, 挂动作 }: { 数据: 项目区数据; 槽: 项目区槽; 挂动作?: (做: ((key: 项目动作键) => void) | null) => void }) {
  const 客户页 = `/customers/${encodeURIComponent(数据.customerId)}`;
  const router = useRouter();
  const 参数 = useSearchParams();
  const 参数字 = 参数.toString();
  const 显示的 = 数据.当前?.p.id ?? null;
  // 地址上带的项目读不出来（看不了、不是这位客户的、删了）时服务端换成了默认那个：把地址改成实际显示的，
  // 不留「地址写 A、页签和内容是 B」（审查 #5）。只改 project 这一项，别的查询参数（?focus= 等）和锚点照留
  useEffect(() => {
    const 现在 = new URLSearchParams(参数字);
    const 要 = 现在.get("project");
    if (!要 || 要 === 显示的) return;
    if (显示的) 现在.set("project", 显示的);
    else 现在.delete("project");
    const 查 = 现在.toString();
    router.replace(`${客户页}${查 ? `?${查}` : ""}${window.location.hash}`, { scroll: false });
  }, [参数字, 显示的, 客户页, router]);
  if (!数据.当前) {
    return (
      <section className="rec-zone" aria-label="项目">
        {/* 没有项目也有提醒：仍在项目区（中栏）顶上 */}
        {槽.提醒 && <div className="cd-alert">{槽.提醒}</div>}
        <div className="cd-zh"><ProjectSwitch 数据={数据} 当前id={null} /></div>
        <div className="cd-empty" data-testid="project-zone-empty">
          <div className="cd-empty-t">{数据.锁数 > 0 ? "没有你能看的项目" : "这位客户还没有项目"}</div>
          <div className="cd-empty-d">
            {槽.开建项目 ? "阶段、沟通、待办都记在项目里。点「＋ 新建项目」或右上角「项目操作」给这位客户开一个。" : 槽.全只读 ? "这位客户你只能看。" : "项目由负责人新建。"}
          </div>
          {槽.开建项目 && (
            <button type="button" className="cd-add cd-add-big" onClick={槽.开建项目}>
              ＋ 新建项目
            </button>
          )}
        </div>
        {/* 没有项目也有这位客户的事：老的沟通记录（不挂项目的）、待办照样摆，只看 */}
        <div className="cd-mid cd-empty-more">
          <ProjectFold id="project-follow" 名="沟通记录" 连体>
            <Card className="cd-comm" title={`沟通记录（${槽.全部沟通数}）`} extra={<FoldSplit 色={模块钮色.沟通} />}>{槽.全部沟通}</Card>
          </ProjectFold>
          {槽.待办}
        </div>
      </section>
    );
  }
  const 当前 = 数据.当前;
  return (
    <ProjectDetail
      key={当前.p.id}
      {...当前}
      嵌入={{
        页签行: <ProjectSwitch 数据={数据} 当前id={当前.p.id} />,
        多项目: 数据.页签们.length >= 2,
        提醒: 槽.提醒,
        挂动作,
        全部沟通: 槽.全部沟通,
        全部沟通数: 槽.全部沟通数,
        待办: 槽.待办,
        客户页,
        客户状态留痕: 槽.客户状态留痕,
      }}
    />
  );
}
