"use client";

/**
 * 客户页「新增项目」（原型 cr.old，11-15）：和项目页「新增项目」、客户列表「新建」同一张新建表（projects/new/ProjectWizard.tsx 建档弹窗），
 * 客户定死是这一位、客户段收成一行，只填项目和首条沟通；项目名默认带客户简称、负责人默认客户负责人、首条沟通可选联系人。
 * 原来单独一个两步的「新增项目」框（NewProjectModal，前 3 步假完成）11-15 删了。
 * 表要的数据（成员、分配方式、渠道……）第一次打开时才取（不压客户页首屏），取过留着；取不到 / 项目模式没开：原因交给客户页就地说（onError），不弹顶部提示
 */
import { 客户显名 } from "@/lib/enterprise/customer-title";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { 取建档数据 } from "../../projects/new/wizard-actions";
import type { 建档数据 } from "../../projects/new/ProjectWizard";

const 建档弹窗 = dynamic(() => import("../../projects/new/ProjectWizard").then((m) => m.建档弹窗), { ssr: false });

export default function NewProjectEntry({
  open, onClose, onError, on取中, customer, 联系人们,
}: {
  open: boolean;
  onClose: () => void;
  /** 没打开的原因：客户页就地说一句 */
  onError: (话: string) => void;
  /** 正在取表要的数据：客户页「开项目」键转圈 */
  on取中?: (中: boolean) => void;
  customer: { id: string; name: string; shortName?: string | null; customerNo?: number | null; salesOwnerId: string | null };
  联系人们: { id: string; name: string; isPrimary: boolean }[];
}) {
  const [数据, set数据] = useState<建档数据 | null>(null);
  const 取着 = useRef(false);
  const 回调 = useRef({ onClose, onError, on取中 });
  useEffect(() => { 回调.current = { onClose, onError, on取中 }; });
  useEffect(() => {
    if (!open || 数据 || 取着.current) return;
    取着.current = true;
    回调.current.on取中?.(true);
    取建档数据()
      .then((d) => {
        if (d) return void set数据(d);
        回调.current.onError("项目模式没开，不能新增项目");
        回调.current.onClose();
      }, () => {
        回调.current.onError("没打开新增项目，请重试");
        回调.current.onClose();
      })
      .finally(() => { 取着.current = false; 回调.current.on取中?.(false); });
  }, [open, 数据]);
  if (!数据) return null;
  return (
    <建档弹窗
      open={open}
      标题="新增项目"
      数据={数据}
      onClose={onClose}
      // 全称选填（11-19）：没全称的客户叫显名（简称 → 客户编号），项目名默认同一个，不留空白
      老客户={{ id: customer.id, name: 客户显名(customer), 附注: null }}
      预选={{ 项目名: 客户显名(customer), 默认负责人: customer.salesOwnerId, 联系人们 }}
    />
  );
}
