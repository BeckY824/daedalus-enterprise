"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { LinkPending } from "@/components/NavProgress";
import { useRouter, useSearchParams } from "next/navigation";
import { useNavGo } from "@/lib/nav-pending";
import { Card, Dropdown } from "antd";
import { DownOutlined } from "@ant-design/icons";
import { FoldSplit, ProjectFold, 模块钮色 } from "../../projects/[id]/ProjectFold";
import ProjectDetail, { type 项目详情Props } from "../../projects/[id]/ProjectDetail";
import { 客户页项目地址 } from "@/lib/project/customer-detail-href";
import { 放弃参数 } from "@/lib/enterprise/lead-giveup-core";
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
  /** 当前项目顶上「已并入 → 留下的项目」那一行（第二批 2a，page.tsx 递 MergedIntoLine 进来）：递给 ProjectDetail 摆在告示格最上面 */
  已并入口?: ReactNode;
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
      {!t.结局 && t.阶段 && <span className="cd-pj-dot" aria-hidden data-stage={t.阶段} />}
      <b className="cd-pj-nm">{t.name}</b>
      <em className="cd-pj-st">{标}</em>
      {t.冷天数 != null && <span className="cd-cold" title={`${t.冷天数} 天没有推进`}>冷</span>}
    </>
  );
}

/**
 * 「更多 N 个」怎么算（11-12 方案一）：一排隐藏的量尺把每颗胶囊按真实样式摆一遍（max-width 240 封顶），量出各自宽度；
 * 每颗最窄 = 名字放得下一个完整合同号（合同号样本，11-23 用户：「XJKJ-20240716-006」这种只剩「X…」不行）的宽，本来就窄的不缩，更长的名字才省略、悬停看全。
 * 可用宽 = 切换行宽 − 「项目」小字 − 锁 − 间隔。先看全部按「最窄」能不能放下；放不下就从左往右放前 k 颗 + 「更多」，k 取最大的那个；
 * 选中的那颗要是被收进去，就顶替第 k 颗的位置。「更多 N 个」放不下时先换成短的「+N」（同一个下拉），还放不下就让卡头折成两行（项目切换占满一行，
 * 「完成节点」落下一行，同手机）；折了还放不下（极窄）这一颗再往下缩到剩下的宽（最少 40）。
 * 宽度变了（ResizeObserver）、字体到了重新量；放下以后多出来的空间由 CSS 让各颗往自然宽长回去
 */
export const 合同号样本 = "XJKJ-20240716-006";
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
 * 卡头要不要折两行：不折时（项目切换和「完成节点」同一行）切换能占的宽 不折可用，按 要宽 放得下就不折。
 * 不折可用从卡头条宽减右边按钮算，和折没折无关，折了也不会因为变宽又弹回来
 */
/** 卡头怎么摆：折 = 折两行（项目切换占满一行，「完成节点」落下一行）；藏字 = 行首「项目」小字藏起来（胶囊组自带 aria-label） */
export type 折档 = { 折: boolean; 藏字: boolean };
const 不折: 折档 = { 折: false, 藏字: false };
export const 要折 = (要宽: number, 不折可用: number | null): boolean => 不折可用 !== null && 要宽 > 不折可用;

/** 落地高亮多久（PR8：新建弹窗建好落到客户页 ?project=<新项目>，新项目卡亮 2 秒） */
export const 落地亮毫秒 = 2000;
/**
 * 打开客户页时地址带 ?project=：那个项目的卡亮 2 秒（只认进页面时那一个；页内切页签不算落地、不亮）。
 * 只动叠上去那层光圈的透明度（globals.css .cd-pj-flash），减弱动态下也只是淡入淡出
 */
function useLandingFlash(): string | null {
  const 参数 = useSearchParams();
  const [亮, set亮] = useState<string | null>(() => 参数.get("project"));
  // 页内落地（客户页「新增项目」建好后换到 ?project=<新项目>&landed=1，原型 cr.submit「新项目卡亮 2 秒」）：
  // 组件不重挂，按 landed 那一下再亮一次；切页签的链接不带 landed，不亮
  const 新落 = 参数.get("landed") === "1" ? 参数.get("project") : null;
  const [上次落, set上次落] = useState(新落);
  if (新落 !== 上次落) {
    set上次落(新落);
    if (新落) set亮(新落);
  }
  useEffect(() => {
    if (!亮) return;
    const t = window.setTimeout(() => set亮(null), 落地亮毫秒);
    return () => window.clearTimeout(t);
  }, [亮]);
  return 亮;
}

/**
 * 进程卡卡头左边的项目切换（11-12 用户定「方案一：项目名放进进程卡卡头」）：行首小灰字「项目」；
 * 只有 1 个项目直接写项目名（加粗、一行省略、悬停看全）；2 个以上一排小胶囊，每颗 = 项目名 + 所在阶段（有结局写结局），选中的品牌浅底，
 * 点哪颗切哪个项目（到 ?project= 的链接，同原页签）。放不下不折行、不横滚：其余收进末尾「更多 N 个」，选中的永远看得见。
 * 同事项目照旧只给带锁的个数
 */
export function ProjectSwitch({ 数据, 当前id }: { 数据: 项目区数据; 当前id: string | null }) {
  /** 「更多」里挑一个项目：同一页换 ?project=，慢了顶上的条照样亮（lib/nav-pending.ts，跳转优化 PR-A 审查补） */
  const 去页 = useNavGo();
  const 亮id = useLandingFlash();
  const 亮 = (id: string | undefined) => (!!id && id === 亮id ? " cd-pj-flash" : "");
  const 行 = useRef<HTMLDivElement>(null);
  const 尺 = useRef<HTMLDivElement>(null);
  const 页签们 = 数据.页签们;
  const 选中 = 页签们.findIndex((t) => t.id === 当前id);
  const [可见, set可见] = useState<number[] | null>(null);
  const [最窄, set最窄] = useState<number[]>([]);
  // 「更多 N 个」放不下时换短的「+N」；还放不下卡头折两行（见 算可见 上面那段）
  const [短更多, set短更多] = useState(false);
  const [档, set档原] = useState<折档>(不折);
  const set档 = useCallback((x: 折档) => set档原((o) => (o.折 === x.折 && o.藏字 === x.藏字 ? o : x)), []);
  // 行首「项目」小字的宽：看得见时量一次记住（紧的时候它藏起来量成 0，判断就会来回翻）
  const 字宽记 = useRef(0);
  const 量 = useCallback(() => {
    const 框 = 行.current, 量尺 = 尺.current;
    if (!框 || !量尺) return;
    const 宽 = (el: Element | null | undefined) => (el ? el.getBoundingClientRect().width : 0);
    const 间隔 = parseFloat(getComputedStyle(框).columnGap) || 0;
    const 字 = 框.querySelector(":scope > .cd-cap");
    if (宽(字) > 0) 字宽记.current = 宽(字) + 间隔;
    const 字宽 = 字宽记.current;
    const 锁宽 = [...框.children].filter((el) => el.classList.contains("cd-lock")).reduce((s, el) => s + 宽(el) + 间隔, 0);
    // 不折时能占的宽：卡头条（进程卡卡头）内容宽 − 右边按钮 − 条里的间隔；不在卡头条里（空状态那一行）= null，不折不藏。
    // 可用宽都从卡头条量，和现在折没折、藏没藏小字无关
    const 条 = 框.closest<HTMLElement>(".proj-stage-bar.has-head");
    const 条样 = 条 ? getComputedStyle(条) : null;
    const 钮 = 条 ? [...条.children].find((el) => el.classList.contains("proj-stage-acts")) : null;
    const 条内宽 = 条 && 条样 ? 条.clientWidth - (parseFloat(条样.paddingLeft) || 0) - (parseFloat(条样.paddingRight) || 0) : 框.clientWidth;
    const 平宽 = 条 && 条样 ? 条内宽 - (钮 ? 宽(钮) + (parseFloat(条样.columnGap) || 0) : 0) - 锁宽 : null;
    const 折宽 = 条内宽 - 锁宽;
    // 样本用 scrollWidth：量尺 0 宽
    const 样本宽 = (sel: string) => 量尺.querySelector<HTMLElement>(sel)?.scrollWidth ?? 0;
    if (页签们.length <= 1) {
      // 一个项目：名字（放得下合同号的那截）+ 阶段小标 放不下就折；折了还长的照旧一行省略
      const 一 = 框.querySelector<HTMLElement>(":scope > .cd-pj-one"), 名 = 一?.querySelector<HTMLElement>(".cd-pj-nm");
      const 要宽 = 一 && 名 ? 宽(一) - 名.clientWidth + Math.min(名.scrollWidth, 样本宽(".cd-pj-sample.is-one")) + 字宽 : 0;
      set档(要折(要宽, 平宽) ? { 折: true, 藏字: false } : 不折);
      return;
    }
    const 胶囊组 = 框.querySelector<HTMLElement>(":scope > .cd-pj-pills");
    const 胶囊间隔 = 胶囊组 ? parseFloat(getComputedStyle(胶囊组).columnGap) || 0 : 间隔;
    const 胶囊们 = [...量尺.querySelectorAll<HTMLElement>(".cd-pj-pill:not(.cd-pj-more):not(.is-sample)")];
    const 更多宽 = 宽(量尺.querySelector(".cd-pj-more:not(.is-short)"));
    const 短宽 = 宽(量尺.querySelector(".cd-pj-more.is-short"));
    const 名样本 = 样本宽(".cd-pj-sample:not(.is-one)");
    // 每颗最窄：名字缩到放得下合同号样本为止（本来就短的不缩）
    const 最窄们 = 胶囊们.map((el) => {
      const 自然 = Math.ceil(宽(el)), 名 = el.querySelector<HTMLElement>(".cd-pj-nm");
      return 名 ? Math.min(自然, Math.ceil(自然 - 名.clientWidth + 名样本)) : 自然;
    });
    const 放得下 = (ids: number[], 多: number, 可用: number) => ids.length === 胶囊们.length || ids.reduce((s, i) => s + 最窄们[i] + 胶囊间隔, 0) + 多 <= 可用;
    const 试 = (可用: number) => {
      const 长 = 算可见(最窄们, 可用, 更多宽, 胶囊间隔, 选中);
      if (放得下(长, 更多宽, 可用)) return { ids: 长, 短: false, 中: true, 可用 };
      const 短 = 算可见(最窄们, 可用, 短宽, 胶囊间隔, 选中);
      return { ids: 短, 短: true, 中: 放得下(短, 短宽, 可用), 可用 };
    };
    // 依次试：一行 → 一行藏「项目」小字（1024 三栏）→ 折两行 → 折两行藏小字（912 三栏）；每档里先「更多 N 个」再「+N」。
    // 都不行（极窄）用最后一档，这一颗往下缩
    const 档们: 折档[] = 条 === null ? [不折] : [不折, { 折: false, 藏字: true }, { 折: true, 藏字: false }, { 折: true, 藏字: true }];
    let 用 = 试(0), 定 = 档们[档们.length - 1];
    for (const 档 of 档们) {
      const 底 = 档.折 ? 折宽 : 平宽 ?? 折宽;
      const 这 = 试(底 - (档.藏字 ? 0 : 字宽));
      用 = 这; 定 = 档;
      if (这.中) break;
    }
    const ids = 用.ids;
    const 多宽 = 用.短 ? 短宽 : 更多宽;
    if (ids.length === 1 && 胶囊们.length > 1 && 最窄们[ids[0]] + 胶囊间隔 + 多宽 > 用.可用) 最窄们[ids[0]] = Math.max(40, Math.floor(用.可用 - 胶囊间隔 - 多宽));
    set最窄((o) => (o.length === 最窄们.length && o.every((x, i) => x === 最窄们[i]) ? o : 最窄们));
    set可见((o) => (o && o.length === ids.length && o.every((x, i) => x === ids[i]) ? o : ids));
    set短更多(用.短 && ids.length < 胶囊们.length);
    set档(定);
  }, [选中, 页签们.length, set档]);
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
  // 卡头折两行：data-wrap 挂在自己身上，进程卡卡头条按 :has 折（globals.css）
  const 折标 = 档.折 ? "" : undefined;
  const 藏字标 = 档.藏字 ? "" : undefined;
  if (页签们.length <= 1) {
    const t = 页签们[0];
    return (
      <div className="cd-pj" ref={行} data-wrap={折标} data-nocap={藏字标}>
        <span className="cd-cap">项目</span>
        {t && (
          <span className={`cd-pj-one${亮(t.id)}`} data-flash={亮(t.id) ? "" : undefined} title={`${t.name} · ${标of(t)}`}>
            <b className="cd-pj-nm">{t.name}</b>
            <span className="cd-pj-tag">
              {!t.结局 && t.阶段 && <span className="cd-pj-dot" aria-hidden data-stage={t.阶段} />}
              {标of(t)}
            </span>
            {t.冷天数 != null && <span className="cd-cold" title={`${t.冷天数} 天没有推进`}>冷</span>}
          </span>
        )}
        <锁格 数={数据.锁数} />
        <div className="cd-pj-ruler" ref={尺} aria-hidden>
          <b className="cd-pj-sample is-one">{合同号样本}</b>
        </div>
      </div>
    );
  }
  // 首帧还没量：先全摆（CSS 让它们缩、省略），量完再收；SSR 首屏也是这样，不闪成空
  // 可见存的是下标：router.refresh 后页签变少（项目删了、转走了），量完之前那一帧旧下标可能越界——先滤掉，滤空了就全摆，等布局量完再收
  const 量过 = 可见?.filter((i) => i < 页签们.length);
  const 摆 = 量过 && 量过.length ? 量过 : 页签们.map((_, i) => i);
  const 收 = 页签们.map((_, i) => i).filter((i) => !摆.includes(i));
  const 顺 = [...摆].sort((a, b) => a - b);
  return (
    <div className="cd-pj" ref={行} data-wrap={折标} data-nocap={藏字标}>
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
              className={`cd-pj-pill${on ? " on" : ""}${亮(t.id)}`}
              data-flash={亮(t.id) ? "" : undefined}
              style={最窄[i] ? { minWidth: 最窄[i] } : undefined}
              href={地址(t.id)}
              scroll={false}
              replace
              title={`${t.name} · ${标of(t)}${t.冷天数 != null ? ` · ${t.冷天数} 天没有推进` : ""}`}
            >
              <胶囊身 t={t} />
              <LinkPending />
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
              onClick: ({ key }) => 去页.replace(地址(key), { scroll: false }),
            }}
          >
            {短更多
              ? <button type="button" className="cd-pj-pill cd-pj-more is-short" aria-label={`+${收.length}，更多 ${收.length} 个项目`} title={`更多 ${收.length} 个项目`}>+{收.length} <DownOutlined aria-hidden /></button>
              : <button type="button" className="cd-pj-pill cd-pj-more">更多 {收.length} 个 <DownOutlined aria-hidden /></button>}
          </Dropdown>
        )}
      </div>
      <锁格 数={数据.锁数} />
      {/* 量尺：每颗胶囊按真样式量一遍宽，读屏不念、点不到 */}
      <div className="cd-pj-ruler" ref={尺} aria-hidden>
        {页签们.map((t) => <span key={t.id} className={`cd-pj-pill${t.id === 当前id ? " on" : ""}`}><胶囊身 t={t} /></span>)}
        <span className="cd-pj-pill cd-pj-more">更多 {页签们.length} 个 <DownOutlined /></span>
        <span className="cd-pj-pill cd-pj-more is-short">+{页签们.length} <DownOutlined /></span>
        {/* 合同号样本：选中那颗的字（加粗，最宽的那种）量一个完整合同号多宽，每颗最窄就到这 */}
        <span className="cd-pj-pill on is-sample"><b className="cd-pj-sample">{合同号样本}</b></span>
      </div>
    </div>
  );
}

/** 项目区：有项目画项目详情（嵌入版），没有就是空状态 + 「＋ 新建项目」 */
export default function ProjectZone({ 数据, 槽, 挂动作, 报忙 }: { 数据: 项目区数据; 槽: 项目区槽; 挂动作?: (做: ((key: 项目动作键) => void) | null) => void; 报忙?: (忙: boolean) => void }) {
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
    // 放弃参数只给打开那一下用（GiveUpBanner 落地时已读、已从地址去掉）；这里拿的是旧参数串，不去掉会写回地址栏
    现在.delete(放弃参数);
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
          {/* 名下有我能记售后回访的交付结清项目（我看不到它，所以没有页签）：不说「还没有项目」，指到下面的「记售后回访」（3703 实操 r84）；
              同事还有锁着的项目时不说「没有在推的项目」（同事可能正在推），说我这边看不到 */}
          <div className="cd-empty-t">{槽.记售后回访 ? (数据.锁数 > 0 ? "没有你能看的在推项目" : "没有在推的项目") : 数据.锁数 > 0 ? "没有你能看的项目" : "这位客户还没有项目"}</div>
          <div className="cd-empty-d">
            {槽.记售后回访 ? `有交付结清的项目，可以在下面「沟通记录」点「记售后回访」。${槽.开建项目 ? "有新需求点「＋ 新建项目」。" : ""}`
              : 槽.开建项目 ? "阶段、沟通、待办都记在项目里。点「＋ 新建项目」或右上角「更多操作」给这位客户开一个。" : 槽.全只读 ? "这位客户你只能看。" : "项目由负责人新建。"}
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
            <Card className="cd-comm" title={`沟通记录（${槽.全部沟通数}）`} extra={<FoldSplit 色={模块钮色.沟通} 主={槽.记售后回访 ? { 字: "记售后回访", onClick: 槽.记售后回访, testid: "cust-after-sale-visit" } : null} />}>{槽.全部沟通}</Card>
          </ProjectFold>
          {槽.待办}
        </div>
      </section>
    );
  }
  const 当前 = 数据.当前;
  // 我能记售后回访、却没有页签的交付结清项目（看不到它，只是客户负责人）：页签上自带「记售后回访」时另给一颗只记它们的（E-283 审查）
  const 页签外售后 = (槽.售后项目ids ?? []).filter((id) => !数据.页签们.some((t) => t.id === id));
  return (
    <ProjectDetail
      key={当前.p.id}
      {...当前}
      已并入口={数据.已并入口}
      嵌入={{
        页签行: <ProjectSwitch 数据={数据} 当前id={当前.p.id} />,
        提醒: 槽.提醒,
        挂动作,
        报忙,
        全部沟通: 槽.全部沟通,
        全部沟通数: 槽.全部沟通数,
        待办: 槽.待办,
        客户页,
        进程变更卡: 槽.进程变更卡,
        无全部沟通: 槽.无全部沟通,
        走后去: 槽.走后去,
        记售后回访: 槽.记售后回访,
        页签外售后回访: 槽.记这几个售后回访 && 页签外售后.length ? () => 槽.记这几个售后回访!(页签外售后) : null,
      }}
    />
  );
}
