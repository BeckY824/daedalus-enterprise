"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { App, Card, Select } from "antd";
import AttachmentsPanel from "@/components/AttachmentsPanel";
import type { 项目画像键 } from "@/lib/enterprise/dict-kinds";
import { 改项目画像Action } from "../actions";

/** 项目画像（企业版 P11）：五项字典（所在地、级别在编辑项目框里改）。选项 = 启用着的 + 这个项目已经存着、后来停用的（不然下拉里显示不出来） */
export type 项目画像 = {
  项们: { 键: 项目画像键; 名: string; 多选: boolean; 选项: string[] }[];
  值: Partial<Record<Exclude<项目画像键, "productNeeds">, string | null>> & { productNeeds: string[] };
};

const 空 = <span style={{ color: "var(--text-muted)" }}>—</span>;

/**
 * 「项目画像」卡：能改的人改一项存一项（下拉选了就存），不能改的只看。
 * 存失败（选项刚被停用、没权限了）提示原因并回到存之前的样子
 */
export function ProjectProfileCard({ projectId, 画像, 能改 }: { projectId: string; 画像: 项目画像; 能改: boolean }) {
  const { message } = App.useApp();
  const router = useRouter();
  const [值, set值] = useState(画像.值);
  const [忙, set忙] = useState(false);
  // 服务端刷新后（别人改了、自己存完 router.refresh）跟着新值走；渲染时比上一次的，不用 effect
  const [上次, set上次] = useState(画像);
  if (画像 !== 上次) {
    set上次(画像);
    set值(画像.值);
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
