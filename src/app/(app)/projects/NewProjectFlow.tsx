"use client";

import { useState, type ReactNode } from "react";
import { App, Modal } from "antd";
import { RightOutlined } from "@ant-design/icons";
import dynamic from "next/dynamic";
import { useBusiness } from "@/lib/business-client";
import { useMe, 默认负责人 as 我当负责人 } from "@/lib/me-client";
import type { 可选成员 } from "@/lib/utils";
import CustomerSearchSelect from "@/components/CustomerSearchSelect";
import NewProjectModal from "../customers/[id]/NewProjectModal";
import { 取客户近况 } from "../customers/[id]/pick";
import { 取建档数据 } from "./new/wizard-actions";
import type { 建档数据 } from "./new/ProjectWizard";

/** 「新增项目」→「新客户」的建档向导框：点了才加载，不压首屏 JS（同客户页「新增客户」） */
const 建档弹窗 = dynamic(() => import("./new/ProjectWizard").then((m) => m.建档弹窗), { ssr: false });

type 选项 = {
  users: 可选成员[];
  /** 「给老客户开项目」新建框里线索阶段的节点（字典里的） */
  节点们: readonly string[];
  /** 企业版开了超时回收：首条沟通要填下一步时间 */
  要下一步: boolean;
  /** 服务端已经给了向导要的数据（客户页）：「新客户」不再取一次；不给 = 点了再取（项目页） */
  建档?: 建档数据 | null;
  /** 一挂上就把「新增项目」选新老客户那个框打开（客户页「新建 ▾ → 新建项目」点了才挂这一块） */
  起手开着?: boolean;
};

/**
 * 企业版「新增项目」整条路（11-01 用户：「也是弹窗进行……打开新增的时候给一个选项新客户还是老客户」）：
 * 先问新客户还是老客户，新客户走建档向导（先查重），老客户挑一位再接客户页同一个新建项目框。
 * 项目页 / 市场角色「我分出去的」（ProjectsView）和客户页页头「新建 ▾」（CustomersView）共用这一份。
 * 开建档("新增客户")：市场角色「我分出去的」页头的「新建客户」，和客户页「新建客户」同一个向导框
 */
export function useNewProjectFlow({ users, 节点们, 要下一步, 建档: 给的 = null, 起手开着 = false }: 选项): { 开选客户: () => void; 开建档: (标题: "新增项目" | "新增客户") => Promise<void>; 弹框: ReactNode } {
  const { message } = App.useApp();
  const b = useBusiness();
  const [选客户, set选客户] = useState(起手开着);
  const [挑老客户, set挑老客户] = useState(false);
  const [建档, set建档] = useState<建档数据 | null>(给的);
  const [建档开着, set建档开着] = useState(false);
  const [标题, set标题] = useState<"新增项目" | "新增客户">("新增项目");
  const [取档中, set取档中] = useState(false);
  const 开建档 = async (t: "新增项目" | "新增客户") => {
    set取档中(true);
    try {
      const d = 建档 ?? 给的 ?? (await 取建档数据());
      if (!d) return void message.error("项目模式没开，不能新增项目");
      set建档(d);
      set选客户(false);
      set标题(t);
      set建档开着(true);
    } catch {
      message.error("没打开，请重试");
    } finally {
      set取档中(false);
    }
  };
  const 弹框 = (
    <>
      <Modal open={选客户} title="新增项目" footer={null} width={420} onCancel={() => set选客户(false)} destroyOnHidden>
        <div className="new-proj-pick">
          <button type="button" className="new-proj-opt" disabled={取档中} onClick={() => void 开建档("新增项目")}>
            <两行 名={`新${b.customer}`} 说={`一起建好${b.customer}、联系人和首条沟通，号码先查重`} />
            <RightOutlined aria-hidden />
          </button>
          <button type="button" className="new-proj-opt" disabled={取档中} onClick={() => { set选客户(false); set挑老客户(true); }}>
            <两行 名={`老${b.customer}`} 说={`选一位已有的${b.customer}，接着填项目和首条沟通`} />
            <RightOutlined aria-hidden />
          </button>
        </div>
      </Modal>
      {建档 && <建档弹窗 open={建档开着} 标题={标题} 数据={建档} onClose={() => set建档开着(false)} />}
      <OldCustomerProject 开={挑老客户} 关={() => set挑老客户(false)} users={users} 节点们={节点们} 要下一步={要下一步} />
    </>
  );
  return { 开选客户: () => set选客户(true), 开建档, 弹框 };
}

/** 客户页按需挂的那一份（next/dynamic 懒加载）：挂上就打开选新老客户的框；再点一次由外面换 key 重挂 */
export default function NewProjectFlow(p: Omit<选项, "起手开着">) {
  return useNewProjectFlow({ ...p, 起手开着: true }).弹框;
}

/** 「新增项目」选项里的一项：名字 + 一行小字说明 */
function 两行({ 名, 说 }: { 名: string; 说: string }) {
  return (
    <div className="new-proj-opt-t">
      <div>{名}</div>
      <div className="new-proj-opt-s">{说}</div>
    </div>
  );
}

/**
 * 「给老客户开项目」：先挑一位已有的客户，再接客户页同一个新建项目框（customers/[id]/NewProjectModal.tsx）。
 * 能挑到谁走 搜客户 的可见范围，建项目的权限以服务端 给客户建项目 为准
 */
function OldCustomerProject({ 开, 关, users, 节点们, 要下一步 }: { 开: boolean; 关: () => void; users: 可选成员[]; 节点们: readonly string[]; 要下一步: boolean }) {
  const { message } = App.useApp();
  const b = useBusiness();
  const me = useMe();
  const [选, set选] = useState<string | undefined>();
  const [取中, set取中] = useState(false);
  const [客户, set客户] = useState<{ id: string; name: string; 联系人们: { id: string; name: string; isPrimary: boolean }[] } | null>(null);

  async function 下一步() {
    if (!选) return;
    set取中(true);
    try {
      const c = await 取客户近况(选);
      if (!c) {
        message.error(`没找到这位${b.customer}，或你看不到`);
        return;
      }
      // 近况里不带谁是主要联系人，新建框默认选第一个
      set客户({ id: c.id, name: c.name, 联系人们: c.contacts.map((x) => ({ id: x.id, name: x.name, isPrimary: false })) });
      set选(undefined);
      关();
    } catch {
      message.error(`${b.customer}没取到，请重试`);
    } finally {
      set取中(false);
    }
  }

  return (
    <>
      <Modal
        open={开}
        title="给老客户开项目"
        okText="下一步"
        okButtonProps={{ disabled: !选, loading: 取中 }}
        onOk={() => void 下一步()}
        onCancel={() => {
          set选(undefined);
          关();
        }}
        destroyOnHidden
      >
        <CustomerSearchSelect value={选} onChange={set选} placeholder="搜名称 / 公司 / 电话" className="old-cust-pick" />
        <div className="old-cust-pick-note">
          选一位已有的{b.customer}，接着填项目和首条沟通。新{b.customer}请回「新增项目」选「新{b.customer}」，要先查重。
        </div>
      </Modal>
      {客户 && (
        <NewProjectModal
          open
          onClose={() => set客户(null)}
          customerId={客户.id}
          customerName={客户.name}
          默认负责人={我当负责人(me, users) ?? null}
          users={users}
          联系人们={客户.联系人们}
          节点们={节点们}
          要下一步={要下一步}
        />
      )}
    </>
  );
}
