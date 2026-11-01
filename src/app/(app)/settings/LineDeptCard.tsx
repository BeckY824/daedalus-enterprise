"use client";

/**
 * 「各条线参与自动分配的部门」（2026-11-01 清单 A4 / A5）：内贸、外贸各勾一组部门（连下级部门）。
 * 勾了的线：部门在里面、有销售业务角色、个人参与状态是允许的在职成员才进自动分配；
 * 一个都没勾的线：退回按成员的内贸 / 外贸标记分，这里提示「还没勾部门」。部门名不写死，全在后台勾。
 * 只有总管理员能改（服务端 设线部门 按业务角色挡）；打开时自己取一遍设置，组织架构页不用多传
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { App, Alert, Button, Card, Select, Space } from "antd";
import { 拆角色 } from "@/lib/enterprise/org-core";
import { 两条线, 线部门们, type 线部门 } from "@/lib/enterprise/assign-line";
import type { 组织部门 } from "@/lib/enterprise/org-tree";
import { 读线部门设置, 设线部门, type 线部门设置 } from "../leads/assign-actions";

const 销售 = (bizRole: string) => 拆角色(bizRole).some((r) => r === "sales" || r === "sales_mgr");

export default function LineDeptCard({
  部门,
  部门选项,
  成员,
}: {
  部门: 组织部门[];
  部门选项: { value: string; label: string }[];
  成员: { id: string; name: string; deptId: string | null; bizRole: string }[];
}) {
  const router = useRouter();
  const { message } = App.useApp();
  const [设置, set设置] = useState<线部门设置 | null | undefined>(undefined);
  const [草稿, set草稿] = useState<线部门 | null>(null);
  const [忙, set忙] = useState(false);

  useEffect(() => {
    let 还在 = true;
    void 读线部门设置().then((x) => 还在 && set设置(x), () => 还在 && set设置(null));
    return () => {
      还在 = false;
    };
  }, []);

  if (设置 === undefined || 设置 === null) return null;
  const 选 = 草稿 ?? 设置.设的;
  const 改了 = 草稿 != null && 两条线.some((l) => [...草稿[l]].sort().join() !== [...设置.设的[l]].sort().join());
  const 部门表 = new Map(部门.map((d) => [d.id, d]));
  // 按存着的算（不按草稿）：保存后才算数
  const 现在的人 = (l: (typeof 两条线)[number]) => {
    const 里 = 线部门们(部门表, 设置.设的[l]);
    return 成员.filter((m) => m.deptId && 里.has(m.deptId) && 销售(m.bizRole)).map((m) => m.name);
  };

  async function 存(v: 线部门) {
    if (忙) return;
    set忙(true);
    try {
      const r = await 设线部门(v);
      if (!r.ok) {
        message.error(r.error);
        return;
      }
      message.success("各条线参与自动分配的部门已保存");
      set设置({ ...设置!, 设的: v, 还没勾: 两条线.filter((l) => !v[l].some((id) => 部门表.has(id))) });
      set草稿(null);
      router.refresh();
    } finally {
      set忙(false);
    }
  }

  return (
    <Card
      title="各条线参与自动分配的部门"
      data-testid="org-line-depts"
      extra={!设置.能改 && <span style={{ color: "var(--text-muted)" }}>只有总管理员能改</span>}
    >
      <p className="muted">
        新线索自动分配按项目上选的「业务线」分线（内贸 / 外贸）；选「暂不分配」的不自动分，留在新线索等人手动指派；老项目没选业务线的按负责人的线，负责人也没设按内贸。
        每条线勾几个部门（连下级部门），只有这些部门里有销售业务角色、参与状态是「允许」的人参与那条线的自动分配。
      </p>
      {设置.还没勾.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          data-testid="org-line-depts-unset"
          message={`${设置.还没勾.join("、")}还没勾部门：先按成员的内贸 / 外贸标记分`}
        />
      )}
      <div style={{ display: "grid", gap: 12 }}>
        {两条线.map((l) => {
          const 人 = 现在的人(l);
          return (
            <div key={l}>
              <b>{l}</b>
              <Select
                mode="multiple"
                allowClear
                style={{ width: "100%", maxWidth: 480, display: "block", marginTop: 4 }}
                aria-label={`${l}参与自动分配的部门`}
                data-testid={`org-line-depts-${l}`}
                disabled={!设置.能改 || 忙}
                placeholder="没勾：按成员的内贸 / 外贸标记"
                optionFilterProp="label"
                value={选[l]}
                onChange={(v: string[]) => set草稿({ ...选, [l]: v })}
                options={部门选项}
              />
              {设置.设的[l].length > 0 && (
                <p className="muted" style={{ margin: "4px 0 0", overflowWrap: "anywhere" }}>
                  现在参与的销售：{人.length ? 人.join("、") : "没有（勾的部门里没有销售）"}（参与状态暂停 / 禁止的不分）
                </p>
              )}
            </div>
          );
        })}
      </div>
      {设置.能改 && (
        <Space wrap style={{ marginTop: 12 }}>
          <Button type="primary" disabled={!改了 || 忙} data-testid="org-line-depts-save" onClick={() => void 存(选)}>保存</Button>
          <Button disabled={!改了 || 忙} onClick={() => set草稿(null)}>放弃修改</Button>
        </Space>
      )}
    </Card>
  );
}
