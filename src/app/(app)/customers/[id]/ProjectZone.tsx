"use client";

import { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Card } from "antd";
import { ProjectFold } from "../../projects/[id]/ProjectFold";
import ProjectDetail, { type 项目详情Props } from "../../projects/[id]/ProjectDetail";
import { 客户页项目地址 } from "@/lib/project/customer-detail-href";
import type { 项目区槽 } from "./types";

/** 项目区页签行上的一个项目：名字 + 当前节点（有结局写结局） */
export type 项目页签 = {
  id: string; name: string; 节点: string;
  /** 冷项目（C11，三态开着才有）：没推进的天数，页签名后一个小灰标「冷」 */
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

/**
 * 项目区第一行（定稿 UI .zh）：「项目」小标题、我能看的项目各一个页签、同事项目带锁的个数、「＋ 新建项目」；右端放当前页签这个项目的按钮。
 * 必须一行不换行：页签那段可缩、每个页签放不下省略号（悬停看全名，全站 TruncTip + title），再放不下这一段横着滚；
 * 锁、新建、右端按钮在滚动段外面、不缩，项目再多也一直看得见（审查 #1）。当前页签打开时滚到中间；Tab 键走到哪个页签就把它整个露出来——
 * 浏览器自己的「聚焦时滚进来」只管完全看不见的，露着几个像素的不滚（11-12 CI Linux 字体下第 7 个页签只露 6px），所以自己滚
 */
function 露出(框: HTMLElement, 那个: HTMLElement, 居中: boolean) {
  // 只横着挪这一段，不用 scrollIntoView（它会连整页一起竖着滚）；按矩形算，不靠 offsetParent
  const 框矩 = 框.getBoundingClientRect(), 矩 = 那个.getBoundingClientRect();
  if (矩.left >= 框矩.left - 0.5 && 矩.right <= 框矩.right + 0.5) return;
  const 左 = 矩.left - 框矩.left + 框.scrollLeft;
  框.scrollLeft = Math.max(0, 居中 ? 左 - (框.clientWidth - 矩.width) / 2 : 矩.left < 框矩.left ? 左 : 左 + 矩.width - 框.clientWidth);
}

export function ProjectTabs({ 数据, 当前id, 开建项目, 右端 }: { 数据: 项目区数据; 当前id: string | null; 开建项目: (() => void) | null; 右端: ReactNode }) {
  const 段 = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const 框 = 段.current;
    const 那个 = 框?.querySelector<HTMLElement>(".cd-tab.on");
    if (框 && 那个) 露出(框, 那个, true);
  }, [当前id]);
  return (
    <div className="cd-zh">
      <span className="cd-cap">项目</span>
      <div
        className="cd-tabs"
        role="tablist"
        aria-label="这位客户的项目"
        ref={段}
        onFocus={(e) => { const 那个 = (e.target as HTMLElement).closest<HTMLElement>(".cd-tab"); if (那个 && 段.current) 露出(段.current, 那个, false); }}
      >
        {数据.页签们.map((t) => {
          const 字 = `${t.name} · ${t.节点}`;
          const 冷 = t.冷天数 != null;
          return (
            <Link
              key={t.id}
              role="tab"
              aria-selected={t.id === 当前id}
              className={`cd-tab${t.id === 当前id ? " on" : ""}${冷 ? " cd-tab-cold" : ""}`}
              href={客户页项目地址(数据.customerId, t.id)}
              scroll={false}
              replace
              title={冷 ? `${字} · ${t.冷天数} 天没有推进` : 字}
            >
              {冷 ? (
                <>
                  <span className="cd-tab-nm">{字}</span>
                  <span className="cd-cold" title={`${t.冷天数} 天没有推进`}>冷</span>
                </>
              ) : 字}
            </Link>
          );
        })}
      </div>
      {数据.锁数 > 0 && (
        <span className="cd-lock" title={`还有 ${数据.锁数} 个同事负责的项目，你看不到内容`} aria-label={`同事项目 ${数据.锁数} 个`}>
          {锁}
          <span className="cd-lock-t">同事项目 </span>{数据.锁数}
        </span>
      )}
      {开建项目 && (
        <button type="button" className="cd-add" onClick={开建项目} aria-label="新建项目">
          ＋ 新建<span className="cd-add-t">项目</span>
        </button>
      )}
      <span className="cd-sp" />
      {右端}
    </div>
  );
}

/** 项目区：有项目画项目详情（嵌入版），没有就是空状态 + 「＋ 新建项目」 */
export default function ProjectZone({ 数据, 槽 }: { 数据: 项目区数据; 槽: 项目区槽 }) {
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
        <ProjectTabs 数据={数据} 当前id={null} 开建项目={槽.开建项目} 右端={null} />
        <div className="cd-empty" data-testid="project-zone-empty">
          <div className="cd-empty-t">{数据.锁数 > 0 ? "没有你能看的项目" : "这位客户还没有项目"}</div>
          <div className="cd-empty-d">
            {槽.开建项目 ? "阶段、沟通、待办都记在项目里。点「＋ 新建项目」给这位客户开一个。" : 槽.全只读 ? "这位客户你只能看。" : "项目由负责人新建。"}
          </div>
          {槽.开建项目 && (
            <button type="button" className="cd-add cd-add-big" onClick={槽.开建项目}>
              ＋ 新建项目
            </button>
          )}
        </div>
        {/* 没有项目也有这位客户的事：老的沟通记录（不挂项目的）、待办照样摆，只看 */}
        <div className="cd-mid cd-empty-more">
          <ProjectFold id="project-follow" 名="沟通记录">
            <Card className="cd-comm" title={`沟通记录（${槽.全部沟通数}）`}>{槽.全部沟通}</Card>
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
        页签行: (右端) => <ProjectTabs 数据={数据} 当前id={当前.p.id} 开建项目={槽.开建项目} 右端={右端} />,
        全部沟通: 槽.全部沟通,
        全部沟通数: 槽.全部沟通数,
        待办: 槽.待办,
        客户页,
        客户状态留痕: 槽.客户状态留痕,
      }}
    />
  );
}
