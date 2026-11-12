"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, Empty, Tag } from "antd";
import { fmtDate, fmtDateTime } from "@/lib/utils";
import { FOLLOW_TYPE_MAP } from "@/lib/constants";
import { 客户页项目地址 } from "@/lib/project/customer-detail-href";
import { 卡内容 } from "../../projects/[id]/CustomerReadonlyCard";
import { ProjectFold } from "../../projects/[id]/ProjectFold";
import ProjectZone from "./ProjectZone";
import ContactForm from "./ContactForm";
import { 新增仅项目联系人Action, 改仅项目联系人Action } from "./project-only-contact-actions";
import type { 受限客户详情 } from "./restricted";
import type { ContactRow } from "./types";

const 灰字 = { color: "var(--text-muted)" } as const;

/**
 * 受限客户详情（只负责项目的人，customers/[id]/restricted.ts）：页头只有客户名 +「仅项目」；
 * 左栏是客户只读卡那一份，右边只有我自己的项目。没有星标、AI、三态条、转让 / 放公海 / 删除 / 编辑客户、关联客户卡、历史负责人。
 * 版式借客户详情的类名（rec-page / rec-cd），不另加样式
 */
export default function RestrictedCustomerDetail({ 数据 }: { 数据: 受限客户详情 }) {
  const { 客户, 卡, 项目区, 沟通, 待办, 可改联系人 } = 数据;
  const router = useRouter();
  // 联系人编辑框：null = 关着；"新" = 新增（挂到当前页签的项目上）；一行 = 改自己新增的那位
  const [框, set框] = useState<"新" | ContactRow | null>(null);
  const 当前项目 = 项目区.当前?.p.id ?? null;
  const 可改 = new Map(可改联系人.map((c) => [c.id, c]));
  const 全部沟通 = (
    <div className="proj-mod-body" data-testid="restricted-follow-all">
      {!沟通.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="你的项目上还没有沟通记录" />}
      {沟通.map((f) => (
        <div key={f.id} style={{ padding: "8px 0", borderTop: "1px solid var(--line)", minWidth: 0 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0 8px", fontSize: "var(--fs-note)", ...灰字 }}>
            <span>{fmtDateTime(f.occurredAt)}</span>
            <span>{f.method || FOLLOW_TYPE_MAP[f.type]?.label || f.type}</span>
            <span>{f.who}</span>
            <Link href={客户页项目地址(客户.id, f.项目.id, "#project-follow")} scroll={false} title={f.项目.名} style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
              {f.项目.名}
            </Link>
          </div>
          <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{f.content}</div>
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
      <div className="rec-head">
        <div className="rec-head-id">
          <div className="rec-head-line">
            <h1 className="rec-head-name" style={{ margin: 0, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={客户.name}>{客户.name}</h1>
            <Tag style={{ marginInlineStart: 8 }} title="这位客户不归你，你只负责下面的项目：客户资料只能看，项目照常推进">仅项目</Tag>
          </div>
        </div>
      </div>
      <div className="rec rec-cd">
        <aside className="rec-rail rec-card" aria-label="客户资料（只读）">
          <div className="rec-sec">
            <div className="rec-sec-t">
              <span>客户资料（只读）</span>
              {/* 新增的联系人挂到当前页签的项目上；没有能打开的项目就不给 */}
              {当前项目 && (
                <Button type="link" size="small" style={{ padding: 0, height: "auto" }} title="新增的联系人挂到当前这个项目上" onClick={() => set框("新")}>
                  新增联系人
                </Button>
              )}
            </div>
            <卡内容
              卡={卡}
              没给的说法="不在你的项目上，联系方式不显示"
              操作={(x) => {
                const 行 = x.id ? 可改.get(x.id) : undefined;
                return 行 ? <Button type="link" size="small" style={{ padding: 0, height: "auto", flex: "none" }} aria-label={`改联系人 ${x.name}`} onClick={() => set框(行)}>改</Button> : null;
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
          }}
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
