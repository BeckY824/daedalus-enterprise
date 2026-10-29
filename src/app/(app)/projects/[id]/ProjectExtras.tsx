"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MenuFoldOutlined, MenuUnfoldOutlined } from "@ant-design/icons";
import { App, Button, Card, Input, Select } from "antd";
import AttachmentsPanel from "@/components/AttachmentsPanel";
import { 所在地上限, 所在地提示 } from "@/lib/project/profile-rules";
import type { 项目画像键 } from "@/lib/enterprise/dict-kinds";
import type { 侧栏项目 } from "@/lib/project/list";
import { 改项目画像Action } from "../actions";

/** 项目画像（企业版 P11）：五项字典 + 所在地。选项 = 启用着的 + 这个项目已经存着、后来停用的（不然下拉里显示不出来） */
export type 项目画像 = {
  项们: { 键: 项目画像键; 名: string; 多选: boolean; 选项: string[] }[];
  值: Partial<Record<Exclude<项目画像键, "productNeeds">, string | null>> & { productNeeds: string[] };
  location: string | null;
};

const 空 = <span style={{ color: "var(--text-muted)" }}>—</span>;

/**
 * 「项目画像」卡：能改的人改一项存一项（下拉选了就存、所在地失焦 / 回车存），不能改的只看。
 * 存失败（选项刚被停用、没权限了）提示原因并回到存之前的样子
 */
export function ProjectProfileCard({ projectId, 画像, 能改 }: { projectId: string; 画像: 项目画像; 能改: boolean }) {
  const { message } = App.useApp();
  const router = useRouter();
  const [值, set值] = useState(画像.值);
  const [地, set地] = useState(画像.location ?? "");
  const [忙, set忙] = useState(false);
  // 服务端刷新后（别人改了、自己存完 router.refresh）跟着新值走；渲染时比上一次的，不用 effect
  const [上次, set上次] = useState(画像);
  if (画像 !== 上次) {
    set上次(画像);
    set值(画像.值);
    set地(画像.location ?? "");
  }

  const 存 = async (patch: Parameters<typeof 改项目画像Action>[1], 回退: () => void) => {
    set忙(true);
    try {
      const r = await 改项目画像Action(projectId, patch);
      if (!r.ok) {
        message.error(r.error);
        回退();
      } else router.refresh();
    } finally {
      set忙(false);
    }
  };
  const 存地 = () => {
    const 新 = 地.trim();
    if (新 === (画像.location ?? "")) return;
    void 存({ location: 新 || null }, () => set地(画像.location ?? ""));
  };

  return (
    <Card title="项目画像">
      <div className="proj-profile">
        {画像.项们.map((项) => (
          <div key={项.键} className="proj-profile-row">
            <span className="proj-profile-key">{项.名}</span>
            <div className="proj-profile-val">
              {!能改 ? (
                项.多选 ? (值.productNeeds.length ? 值.productNeeds.join("、") : 空) : (值[项.键 as Exclude<项目画像键, "productNeeds">] ?? 空)
              ) : 项.多选 ? (
                <Select
                  mode="multiple"
                  aria-label={项.名}
                  style={{ width: "100%" }}
                  placeholder="可多选"
                  allowClear
                  disabled={忙}
                  value={值.productNeeds}
                  options={项.选项.map((x) => ({ value: x, label: x }))}
                  onChange={(v: string[]) => {
                    const 原 = 值.productNeeds;
                    set值({ ...值, productNeeds: v });
                    void 存({ productNeeds: v }, () => set值((s) => ({ ...s, productNeeds: 原 })));
                  }}
                />
              ) : (
                <Select
                  aria-label={项.名}
                  style={{ width: "100%" }}
                  placeholder="选一项"
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  disabled={忙}
                  value={值[项.键 as Exclude<项目画像键, "productNeeds">] ?? undefined}
                  options={项.选项.map((x) => ({ value: x, label: x }))}
                  onChange={(v?: string) => {
                    const k = 项.键 as Exclude<项目画像键, "productNeeds">;
                    const 原 = 值[k] ?? null;
                    set值({ ...值, [k]: v ?? null });
                    void 存({ [k]: v ?? null }, () => set值((s) => ({ ...s, [k]: 原 })));
                  }}
                />
              )}
            </div>
          </div>
        ))}
        <div className="proj-profile-row">
          <span className="proj-profile-key">所在地</span>
          <div className="proj-profile-val">
            {能改 ? (
              <Input
                aria-label="所在地"
                placeholder={所在地提示}
                maxLength={所在地上限}
                disabled={忙}
                value={地}
                onChange={(e) => set地(e.target.value)}
                onBlur={存地}
                onPressEnter={(e) => (e.target as HTMLInputElement).blur()}
              />
            ) : (
              <span className="proj-profile-text" title={画像.location ?? undefined}>{画像.location || 空}</span>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

/** 「附件」卡（企业版 P11）：合同、方案、表格、图片都行，不分类；看得到项目就能看、能改项目才能传和删（接口 api/attachments/access.ts 认项目） */
export function ProjectAttachmentsCard({ projectId, 起始个数, 只读 }: { projectId: string; 起始个数: number; 只读: boolean }) {
  const [个数, set个数] = useState(起始个数);
  return (
    <Card title={`附件（${个数}）`}>
      <AttachmentsPanel 归属={{ projectId }} 只读={只读} on个数={set个数} />
    </Card>
  );
}

/**
 * 详情页左边的项目列表（企业版 P11）：范围和项目页一样（lib/project/list.ts 读侧栏项目），点一个换一个，当前那个高亮。
 * 宽度 ≥1280 默认摆开、窄了默认收起（globals.css .proj-shell）；点了按钮就按点的来。
 * 收起 / 摆开记在 开 里：null = 跟宽度走；窄屏摆开时浮在内容上面，点了某个项目就收回去
 */
export function useProjectNav() {
  const [开, set开] = useState<boolean | null>(null);
  const 窄 = () => typeof window !== "undefined" && window.matchMedia("(max-width: 1279px)").matches;
  const 现在开着 = () => 开 ?? !窄();
  return {
    data: 开 === null ? undefined : 开 ? "open" : "closed",
    切: () => set开(!现在开着()),
    点了: () => { if (窄()) set开(null); },
  };
}

export function ProjectSideNav({ 们, 当前, 收起, 点了 }: { 们: 侧栏项目[]; 当前: string; 收起: () => void; 点了: () => void }) {
  const [词, set词] = useState("");
  const 表 = useRef<HTMLUListElement>(null);
  // 打开时把当前那个滚进来（列表最多 500 个，当前的可能在很下面）
  useEffect(() => {
    表.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest" });
  }, [当前]);
  const t = 词.trim().toLowerCase();
  const 列 = t ? 们.filter((x) => x.name.toLowerCase().includes(t)) : 们;
  return (
    // 窄屏浮着的时候按 Esc 收回去（焦点在列表里、搜索框里都算）
    <nav className="proj-nav" aria-label="项目列表" onKeyDown={(e) => { if (e.key === "Escape") 收起(); }}>
      <div className="proj-nav-head">
        <span>项目（{们.length}）</span>
        <Button type="text" size="small" icon={<MenuFoldOutlined />} aria-label="收起项目列表" title="收起" onClick={收起} />
      </div>
      {们.length > 8 && <Input size="small" allowClear placeholder="找项目" value={词} onChange={(e) => set词(e.target.value)} style={{ margin: "0 8px 8px", width: "calc(100% - 16px)" }} />}
      <ul ref={表} className="proj-nav-list">
        {列.map((x) => (
          <li key={x.id}>
            <Link href={`/projects/${x.id}`} aria-current={x.id === 当前 ? "page" : undefined} className={x.id === 当前 ? "proj-nav-item on" : "proj-nav-item"} onClick={点了}>
              <span className="proj-nav-name" title={x.name}>{x.name}</span>
              <span className="proj-nav-meta">
                <span className="proj-nav-phase">{x.阶段}</span>
                <span className="proj-nav-node" title={x.结局 ?? x.进程}>{x.结局 ?? x.进程}</span>
                {x.pooled && <span className="proj-nav-pool">公海</span>}
              </span>
            </Link>
          </li>
        ))}
        {!列.length && <li className="proj-nav-empty">{t ? "没有对得上的项目" : "还没有项目"}</li>}
      </ul>
    </nav>
  );
}

export function ProjectNavOpenButton({ onClick }: { onClick: () => void }) {
  return (
    <Button className="proj-nav-open" size="small" icon={<MenuUnfoldOutlined />} onClick={onClick}>项目列表</Button>
  );
}
