"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, Dropdown, Empty, Tag } from "antd";
import { DownOutlined } from "@ant-design/icons";
import { fmtDate, fmtDateTime } from "@/lib/utils";
import { 跟进方式名 } from "@/lib/follow-method";
import { 客户页项目地址 } from "@/lib/project/customer-detail-href";
import { 卡内容 } from "../../projects/[id]/CustomerReadonlyCard";
import { ProjectFold } from "../../projects/[id]/ProjectFold";
import { 更多操作菜单, 项目菜单项们, type 项目动作键 } from "../../projects/[id]/project-menu";
import { 客户详情左栏 } from "../../projects/[id]/card-names";
import ProjectZone from "./ProjectZone";
import ContactForm from "./ContactForm";
import { 新增仅项目联系人Action, 改仅项目联系人Action } from "./project-only-contact-actions";
import type { 受限客户详情 } from "./restricted";
import type { ContactRow } from "./types";
import BackToList from "@/components/BackToList";

/**
 * 受限客户详情（只负责项目的人，customers/[id]/restricted.ts）：页头只有客户名 +「仅项目」；
 * 左栏是客户只读卡那一份，右边只有我自己的项目。没有星标、AI、三态条、「客户操作 ▾」、编辑客户、关联客户卡、历史负责人。
 * 页头只有「更多操作 ▾」（教练点评改版 PR1 前叫「项目操作 ▾」：当前项目的项目转让 / 退回公海 / 删除，给不给照项目权限；没有「新建项目」）；
 * 沟通卡只看本项目（无全部沟通）。版式借客户详情的类名（rec-page / rec-cd / rec-head-acts），不另加样式
 */
export default function RestrictedCustomerDetail({ 数据 }: { 数据: 受限客户详情 }) {
  const { 客户, 卡, 项目区, 沟通, 待办, 可改联系人 } = 数据;
  const router = useRouter();
  // 联系人编辑框：null = 关着；"新" = 新增（挂到当前页签的项目上）；一行 = 改自己新增的那位
  const [框, set框] = useState<"新" | ContactRow | null>(null);
  const 当前项目 = 项目区.当前?.p.id ?? null;
  const 可改 = new Map(可改联系人.map((c) => [c.id, c]));
  // 「更多操作 ▾」同客户详情（CustomerDetail / RecordView）：点了经 动作口 交给嵌入版 ProjectDetail 开框
  const 动作口 = useRef<((key: 项目动作键) => void) | null>(null);
  const 挂动作 = useCallback((做: ((key: 项目动作键) => void) | null) => { 动作口.current = 做; }, []);
  const [项目忙, set项目忙] = useState(false);
  // 「更多操作 ▾」（教练点评改版 PR1，原「项目操作 ▾」）：和客户页同名同位置，只有项目那一组（没有新建项目、没有客户组）。
  // 不摆「发起点评」：这页只列我负责的项目（restricted.ts），负责人本人不能发点评（lib/enterprise/coach-topic.ts）
  // 点了哪项在 Dropdown 的 menu.onClick 里按 key 交给 动作口（这一页菜单里只有项目那几项；灰着的项 antd 不触发 onClick）
  const 更多操作项 = 项目区.当前
    ? 更多操作菜单({ 项目: { 当前名: 项目区.当前.p.name, 当前节点: 项目区.页签们.find((t) => t.id === 项目区.当前?.p.id)?.节点, 能建: false, 项们: 项目菜单项们(项目区.当前), 忙: 项目忙 }, 客户: [] })
    : [];
  const 全部沟通 = (
    <div className="proj-mod-body" data-testid="restricted-follow-all">
      {!沟通.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="你的项目上还没有沟通记录" />}
      {沟通.map((f) => (
        <div key={f.id} className="rcd-follow">
          <div className="rcd-follow-meta">
            <span>{fmtDateTime(f.occurredAt)}</span>
            <span>{跟进方式名(f)}</span>
            <span>{f.who}</span>
            <Link href={客户页项目地址(客户.id, f.项目.id, "#project-follow")} scroll={false} title={f.项目.名} className="rcd-follow-proj">
              {f.项目.名}
            </Link>
          </div>
          <div className="rcd-follow-body">{f.content}</div>
        </div>
      ))}
    </div>
  );
  const 待办数 = 待办.任务.length + 待办.计划.length;
  const 待办卡 = 待办数 ? (
    <ProjectFold id="project-todo" 名="待办">
      <Card className="rec-mod" title={`待办（${待办数}）`}>
        <div className="proj-mod-body" aria-label="待办">
          {待办.计划.map((p) => (
            <div key={`plan-${p.id}`} className="rec-task">
              <span className="rec-task-k">计划</span>
              <Link className="rec-task-t" href="/follow-ups/plans" title="到「跟进计划」里办">{p.subject}</Link>
              <span className="rec-task-due">{p.plannedAt ? (p.plannedHasTime ? fmtDateTime(p.plannedAt) : fmtDate(p.plannedAt)) : null}</span>
            </div>
          ))}
          {待办.任务.map((t) => (
            <div key={`task-${t.id}`} className="rec-task">
              <span className="rec-task-k">任务</span>
              <span className="rec-task-t">{t.title}</span>
              <span className="rec-task-due">{t.dueAt ? (t.dueHasTime ? fmtDateTime(t.dueAt) : fmtDate(t.dueAt)) : null}</span>
            </div>
          ))}
        </div>
      </Card>
    </ProjectFold>
  ) : null;

  return (
    <div className="rec-page ui-v2" data-testid="restricted-customer-detail">
      {/* 回到进来前那张列表（员工反馈 1A，components/BackToList.tsx） */}
      <div className="back-to-list-row"><BackToList /></div>
      <div className="rec-head">
        <div className="rec-head-id">
          <div className="rec-head-line">
            <h1 className="rec-head-name rcd-name" title={客户.name}>{客户.name}</h1>
            <Tag className="rcd-tag" title="这位客户不归你，你只负责下面的项目：客户资料只能看，项目照常推进">仅项目</Tag>
          </div>
        </div>
        <span className="rcd-grow" />
        {更多操作项.length > 0 && (
          <span className="rec-head-acts">
            <Dropdown trigger={["click"]} placement="bottomRight" menu={{ items: 更多操作项, className: "rec-head-menu", onClick: ({ key }) => 动作口.current?.(key as 项目动作键) }}>
              <Button data-testid="rec-more-ops">更多操作 <DownOutlined /></Button>
            </Dropdown>
          </span>
        )}
      </div>
      <div className="rec rec-cd">
        <aside className="rec-rail rec-card" aria-label={`${客户详情左栏.资料}（只读）`}>
          <div className="rec-sec">
            <div className="rec-sec-t">
              <span>{客户详情左栏.资料}（只读）</span>
              {/* 新增的联系人挂到当前页签的项目上；没有能打开的项目就不给 */}
              {当前项目 && (
                <Button type="link" size="small" className="rcd-link-btn" title="新增的联系人挂到当前这个项目上" onClick={() => set框("新")}>
                  新增联系人
                </Button>
              )}
            </div>
            <卡内容
              卡={卡}
              没给的说法="不在你的项目上，联系方式不显示"
              操作={(x) => {
                const 行 = x.id ? 可改.get(x.id) : undefined;
                return 行 ? <Button type="link" size="small" className="rcd-link-btn" aria-label={`改联系人 ${x.name || "—"}`} onClick={() => set框(行)}>改</Button> : null;
              }}
            />
          </div>
        </aside>
        <ProjectZone
          数据={项目区}
          槽={{
            全部沟通,
            全部沟通数: `${沟通.length}`,
            待办: 待办卡,
            开建项目: null,
            全只读: false,
            客户状态留痕: null,
            提醒: null,
            无全部沟通: true,
            // 这是他在这位客户下最后一个项目：转走 / 退回公海 / 删了以后客户页就 404 了，回客户列表
            走后去: 项目区.页签们.length <= 1 ? { 到: "/customers", 说法: "这位客户下已经没有你负责的项目了，已回到客户列表" } : null,
          }}
          挂动作={挂动作}
          报忙={set项目忙}
        />
      </div>
      <ContactForm
        open={框 !== null}
        onClose={() => set框(null)}
        onSaved={() => { set框(null); router.refresh(); }}
        customerId={客户.id}
        record={框 === "新" ? null : 框}
        号码种类={数据.号码种类}
        职务选项={数据.职务选项}
        存法={(x) => (框 && 框 !== "新" ? 改仅项目联系人Action(框.id, x) : 新增仅项目联系人Action(客户.id, 当前项目, x))}
      />
    </div>
  );
}
