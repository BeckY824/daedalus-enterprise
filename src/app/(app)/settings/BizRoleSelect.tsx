"use client";

import { Select, type SelectProps } from "antd";
import { 角色名, 业务角色, 角色组合问题 } from "@/lib/sync/dept-policy";

/**
 * 业务角色多选框（企业版）：组织架构每人一行、团队成员「新增成员」两处共用一份，选项、灰掉的规则、每项下面那行说明都在这里，
 * 免得一处加了角色另一处漏掉（11-19：新增成员时没有「销售教练」可选）。
 * 灰掉的规则只认 dept-policy.ts 的 角色组合问题（服务端 设成员、saveUser 同一份）：销售教练不兼销售类角色、只读管理员不兼别的（教练除外）
 */

/** 只有系统管理员能给、能改的角色：总管理、管理员、销售教练（看全部的那几个） */
export const 总管级 = (r: string) => r === "director" || r === "admin" || r === "coach";

/**
 * 角色下拉每项下面那行「能做什么」（10-30）：只写代码里按角色写死的那几样——总管理员看全部（lib/enterprise/visibility.ts）、
 * 改组织架构（org-actions）、分配线索 / 录渠道投入 / 改销售的参与状态（只有总管理员）（lead-assign、channel-stats）、复核和终判无效线索（lead-verify）。
 * 字段权限、分配方式谁能用那两张表按角色配，不写在这里
 */
export const 角色能做: Record<业务角色, string> = {
  director: "看全部客户；改组织架构；分配线索、改销售的参与状态、录渠道投入；终判无效线索",
  admin: "只能看、不能改。没设业务线看全部；设了只看这条线的数据、下属和公海",
  coach: "只能看、不能改，电话和提成看不到。看全部（设了业务线也看全部）。不能兼销售类角色",
  sales_mgr: "能分到线索；手动指派线索",
  sales: "能分到线索",
  marketing_mgr: "分配线索、录渠道投入；复核被判无效的线索",
  channel_ops: "没有额外的管理权限",
  project_ops: "没有额外的管理权限",
};

/** 下拉选项：能给总管级 = false 时总管级只留他已经有的；和已选的撞了（角色组合问题）的灰掉，说明那行换成为什么不能选 */
export function 业务角色选项(已选: readonly string[], 能给总管级: boolean) {
  return 业务角色.filter((r) => 能给总管级 || !总管级(r) || 已选.includes(r)).map((r) => {
    const 问题 = 已选.includes(r) ? null : 角色组合问题([...已选, r]);
    return { value: r, label: 角色名[r], disabled: !!问题, 说明: 问题 ?? 角色能做[r] };
  });
}

type Props = Omit<SelectProps<string[]>, "mode" | "options" | "optionRender"> & {
  /** 能给总管理 / 管理员 / 销售教练：只有系统管理员（设置页能改的人）；默认能 */
  能给总管级?: boolean;
};

export default function BizRoleSelect({ value, 能给总管级 = true, ...rest }: Props) {
  return (
    <Select<string[]>
      mode="multiple"
      popupMatchSelectWidth={280}
      // 只有 8 项、每项两行高：不用虚拟列表，最后一项（销售教练）也在 DOM 里，滚到哪都是全的
      virtual={false}
      {...rest}
      value={value}
      options={业务角色选项(value ?? [], 能给总管级)}
      optionRender={(o) => (
        <div>
          <div>{o.label}</div>
          <div className="biz-role-opt-desc">{(o.data as { 说明?: string }).说明}</div>
        </div>
      )}
    />
  );
}
