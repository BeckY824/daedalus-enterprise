"use client";

import { Modal, Select } from "antd";
import type { 演示组 } from "@/lib/enterprise/demo-switch";

/**
 * 「以某人的视角查看」挑人（切换视图，lib/enterprise/view-as.ts）：按业务角色分组、能搜名字和部门。
 * 名单服务端给（view-as-menu.ts 读视图名单：在职、不含自己和系统管理员），这里只管挑
 */
export default function ViewAsPicker({ open, 名单, 关, 选 }: { open: boolean; 名单: 演示组[]; 关: () => void; 选: (id: string) => void }) {
  return (
    <Modal open={open} title="以某人的视角查看（只读）" onCancel={关} footer={null} destroyOnHidden>
      <Select
        aria-label="选一位成员"
        placeholder="搜名字或部门"
        showSearch={{ optionFilterProp: "label" }}
        autoFocus
        className="view-as-pick"
        options={名单.map((g) => ({ label: g.名, title: g.名, options: g.人.map((p) => ({ value: p.id, label: p.说明 ? `${p.name} · ${p.说明}` : p.name })) }))}
        onChange={(v: string) => 选(v)}
      />
    </Modal>
  );
}
