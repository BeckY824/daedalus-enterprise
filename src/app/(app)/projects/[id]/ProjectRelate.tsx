"use client";

/**
 * 项目页「关联客户」「关联联系人」两张卡（企业版 P17）。主客户 / 主联系人排第一、标「主」，只能勾身份 / 角色 / 立场、解除不了
 * （换主的在「编辑项目」里）；其余的能就地改、能解除。看不到的那家 / 那位只写「同事的客户 / 联系人」，不给链接。
 * 下拉选了就存（同项目画像卡）：存失败提示原因、回到存之前的样子。读写在 lib/project/relate.ts，动作在 ../relate-actions.ts
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { App, Button, Card, Select, Space, Tag } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import InlineConfirm from "@/components/InlineConfirm";
import type { 项目关联, 关联客户行, 关联联系人行 } from "@/lib/project/relate";
import { 搜客户, type 可挑客户 } from "../../customers/[id]/pick";
import {
  加关联客户Action, 改客户身份Action, 解除关联客户Action,
  加关联联系人Action, 改联系人角色立场Action, 解除关联联系人Action,
  搜项目联系人, type 可挑联系人,
} from "../relate-actions";

type 结果 = { ok: true } | { ok: false; error: string };
const 空 = <span style={{ color: "var(--text-muted)" }}>—</span>;
/** 下拉选项 = 启用着的 + 这一行已经存着、后来停用的（不然下拉里显示不出来） */
const 并上 = (启用: string[], 存着: readonly (string | null)[]) => [...启用, ...存着.filter((x): x is string => !!x && !启用.includes(x))].map((x) => ({ value: x, label: x }));

/** 跑一个动作：失败提示并回退，成了刷新 */
function useRelateRun() {
  const { message } = App.useApp();
  const router = useRouter();
  const [忙, set忙] = useState(false);
  const 跑 = async (做: () => Promise<结果>, 回退?: () => void, 成了?: string) => {
    set忙(true);
    try {
      const r = await 做();
      if (!r.ok) {
        message.error(r.error);
        回退?.();
        return false;
      }
      if (成了) message.success(成了);
      router.refresh();
      return true;
    } finally {
      set忙(false);
    }
  };
  return { 忙, 跑 };
}

/** 防抖搜：最后一次输入 250ms 后才发，旧的回来晚了不覆盖新的 */
function useRelateSearch<T>(搜: (词: string) => Promise<T[]>) {
  const [候选, set候选] = useState<T[]>([]);
  const [搜着, set搜着] = useState(false);
  const 次 = useRef(0);
  const 计时 = useRef<ReturnType<typeof setTimeout> | null>(null);
  const 现在搜 = (词: string) => {
    const n = ++次.current;
    set搜着(true);
    void 搜(词).then((rows) => { if (n === 次.current) set候选(rows); }).finally(() => { if (n === 次.current) set搜着(false); });
  };
  const 输入 = (词: string) => {
    if (计时.current) clearTimeout(计时.current);
    计时.current = setTimeout(() => 现在搜(词), 250);
  };
  return { 候选, 搜着, 现在搜, 输入 };
}

export default function ProjectRelate({ projectId, 关联, 能改 }: { projectId: string; 关联: 项目关联; 能改: boolean }) {
  return (
    <>
      <RelateCustomers projectId={projectId} 关联={关联} 能改={能改} />
      <RelateContacts projectId={projectId} 关联={关联} 能改={能改} />
    </>
  );
}

function 名字({ 名, 全称, href, 主, 主叫 }: { 名: string; 全称: string; href: string | null; 主: boolean; 主叫: string }) {
  return (
    <span className="proj-rel-name">
      <span className="proj-rel-n" title={全称 && 全称 !== 名 ? `${名}（${全称}）` : 名}>
        {href ? <Link href={href}>{名}</Link> : 名}
      </span>
      {主 && <Tag color="blue" style={{ margin: 0, borderRadius: 6, flex: "none" }}>{主叫}</Tag>}
    </span>
  );
}

function RelateCustomers({ projectId, 关联, 能改 }: { projectId: string; 关联: 项目关联; 能改: boolean }) {
  const { 忙, 跑 } = useRelateRun();
  const [加着, set加着] = useState(false);
  const [挑中, set挑中] = useState<string | undefined>();
  const [身份, set身份] = useState<string[]>([]);
  const 已有 = new Set(关联.客户们.map((x) => x.customerId));
  const 搜 = useRelateSearch<可挑客户>(async (词) => (await 搜客户(词)).filter((c) => !已有.has(c.id)));
  const 非主 = 关联.客户们.filter((x) => !x.主).length;

  const 开加 = () => {
    set加着(true);
    set挑中(undefined);
    set身份([]);
    搜.现在搜("");
  };

  return (
    <Card
      title={`关联客户（${关联.客户们.length}）`}
      extra={能改 && !加着 && 非主 < 关联.上限 ? <Button type="text" size="small" icon={<PlusOutlined />} onClick={开加} aria-label="关联一家客户">关联</Button> : null}
    >
      <div className="proj-rel">
        {关联.客户们.length === 0 && !加着 && <div className="rec-empty">还没有关联客户</div>}
        {关联.客户们.map((x) => <CustomerRow key={x.customerId} projectId={projectId} x={x} 选项={关联.选项.身份} 能改={能改} 忙={忙} 跑={跑} />)}
        {加着 && (
          <div className="proj-rel-add">
            <Select
              showSearch
              autoFocus
              placeholder="搜客户名称 / 公司 / 电话"
              value={挑中}
              onChange={set挑中}
              filterOption={false}
              loading={搜.搜着}
              notFoundContent={搜.搜着 ? "搜索中…" : "没搜到（已关联的不再列出）"}
              onSearch={搜.输入}
              options={搜.候选.map((c) => ({ value: c.id, label: c.附注 ? `${c.name}（${c.附注}）` : c.name }))}
              aria-label="挑一家要关联的客户"
              style={{ width: "100%" }}
            />
            <Select mode="multiple" allowClear placeholder="项目身份（可多选）" value={身份} onChange={set身份} options={并上(关联.选项.身份, [])} aria-label="项目身份" style={{ width: "100%" }} />
            <Space size={6}>
              <Button size="small" type="primary" disabled={!挑中} loading={忙} onClick={() => void 跑(() => 加关联客户Action(projectId, 挑中!, 身份), undefined, "关联好了").then((ok) => ok && set加着(false))}>关联</Button>
              <Button size="small" onClick={() => set加着(false)}>取消</Button>
            </Space>
          </div>
        )}
      </div>
    </Card>
  );
}

function CustomerRow({ projectId, x, 选项, 能改, 忙, 跑 }: { projectId: string; x: 关联客户行; 选项: string[]; 能改: boolean; 忙: boolean; 跑: ReturnType<typeof useRelateRun>["跑"] }) {
  const [值, set值] = useState(x.身份);
  // 服务端刷新后跟着新值走；渲染时比上一次的，不用 effect（同项目画像卡）
  const [上次, set上次] = useState(x.身份);
  if (x.身份 !== 上次) {
    set上次(x.身份);
    set值(x.身份);
  }
  return (
    <div className="proj-rel-row">
      <div className="proj-rel-head">
        <名字 名={x.名} 全称={x.全称} href={x.看得到 ? `/customers/${encodeURIComponent(x.customerId)}` : null} 主={x.主} 主叫="主客户" />
        {能改 && !x.主 && (
          <InlineConfirm 问="解除这家关联？" 是="解除" 做={async () => void (await 跑(() => 解除关联客户Action(projectId, x.customerId), undefined, "已解除"))}>
            <Button type="text" size="small" danger icon={<DeleteOutlined />} aria-label={`解除和 ${x.名} 的关联`} />
          </InlineConfirm>
        )}
      </div>
      <div className="proj-rel-field">
        <span className="proj-rel-key">身份</span>
        <div className="proj-rel-val">
          {能改 ? (
            <Select
              mode="multiple"
              size="small"
              allowClear
              placeholder="可多选"
              disabled={忙}
              value={值}
              options={并上(选项, x.身份)}
              aria-label={`${x.名} 的项目身份`}
              style={{ width: "100%" }}
              onChange={(v: string[]) => {
                const 原 = 值;
                set值(v);
                void 跑(() => 改客户身份Action(projectId, x.customerId, v), () => set值(原));
              }}
            />
          ) : 值.length ? <span className="proj-rel-text" title={值.join("、")}>{值.join("、")}</span> : 空}
        </div>
      </div>
    </div>
  );
}

function RelateContacts({ projectId, 关联, 能改 }: { projectId: string; 关联: 项目关联; 能改: boolean }) {
  const { 忙, 跑 } = useRelateRun();
  const [加着, set加着] = useState(false);
  const [挑中, set挑中] = useState<string | undefined>();
  const [角色, set角色] = useState<string[]>([]);
  const [立场, set立场] = useState<string | undefined>();
  const 搜 = useRelateSearch<可挑联系人>((词) => 搜项目联系人(projectId, 词));
  const 非主 = 关联.联系人们.filter((x) => !x.主).length;

  const 开加 = () => {
    set加着(true);
    set挑中(undefined);
    set角色([]);
    set立场(undefined);
    搜.现在搜("");
  };

  return (
    <Card
      title={`关联联系人（${关联.联系人们.length}）`}
      extra={能改 && !加着 && 非主 < 关联.上限 ? <Button type="text" size="small" icon={<PlusOutlined />} onClick={开加} aria-label="关联一位联系人">关联</Button> : null}
    >
      <div className="proj-rel">
        {关联.联系人们.length === 0 && !加着 && <div className="rec-empty">还没有关联联系人</div>}
        {关联.联系人们.map((x) => <ContactRow key={x.contactId} projectId={projectId} x={x} 选项={关联.选项} 能改={能改} 忙={忙} 跑={跑} />)}
        {加着 && (
          <div className="proj-rel-add">
            <Select
              showSearch
              autoFocus
              placeholder="搜联系人姓名 / 客户名称"
              value={挑中}
              onChange={set挑中}
              filterOption={false}
              loading={搜.搜着}
              notFoundContent={搜.搜着 ? "搜索中…" : "没搜到（已关联的不再列出）"}
              onSearch={搜.输入}
              options={搜.候选.map((c) => ({ value: c.id, label: c.附注 ? `${c.名}（${c.附注}）` : c.名 }))}
              aria-label="挑一位要关联的联系人"
              style={{ width: "100%" }}
            />
            <Select mode="multiple" allowClear placeholder="项目角色（可多选）" value={角色} onChange={set角色} options={并上(关联.选项.角色, [])} aria-label="项目角色" style={{ width: "100%" }} />
            <Select allowClear placeholder="项目立场" value={立场} onChange={set立场} options={并上(关联.选项.立场, [])} aria-label="项目立场" style={{ width: "100%" }} />
            <Space size={6}>
              <Button size="small" type="primary" disabled={!挑中} loading={忙} onClick={() => void 跑(() => 加关联联系人Action(projectId, 挑中!, { roles: 角色, stance: 立场 ?? null }), undefined, "关联好了").then((ok) => ok && set加着(false))}>关联</Button>
              <Button size="small" onClick={() => set加着(false)}>取消</Button>
            </Space>
          </div>
        )}
      </div>
    </Card>
  );
}

function ContactRow({ projectId, x, 选项, 能改, 忙, 跑 }: { projectId: string; x: 关联联系人行; 选项: 项目关联["选项"]; 能改: boolean; 忙: boolean; 跑: ReturnType<typeof useRelateRun>["跑"] }) {
  const [值, set值] = useState({ 角色: x.角色, 立场: x.立场 });
  const [上次, set上次] = useState(x);
  if (x !== 上次) {
    set上次(x);
    set值({ 角色: x.角色, 立场: x.立场 });
  }
  return (
    <div className="proj-rel-row">
      <div className="proj-rel-head">
        <名字 名={x.名} 全称={x.姓名} href={x.customerId ? `/customers/${encodeURIComponent(x.customerId)}` : null} 主={x.主} 主叫="主联系人" />
        {能改 && !x.主 && (
          <InlineConfirm 问="解除这位关联？" 是="解除" 做={async () => void (await 跑(() => 解除关联联系人Action(projectId, x.contactId), undefined, "已解除"))}>
            <Button type="text" size="small" danger icon={<DeleteOutlined />} aria-label={`解除和 ${x.名} 的关联`} />
          </InlineConfirm>
        )}
      </div>
      <div className="proj-rel-field">
        <span className="proj-rel-key">角色</span>
        <div className="proj-rel-val">
          {能改 ? (
            <Select
              mode="multiple"
              size="small"
              allowClear
              placeholder="可多选"
              disabled={忙}
              value={值.角色}
              options={并上(选项.角色, x.角色)}
              aria-label={`${x.名} 的项目角色`}
              style={{ width: "100%" }}
              onChange={(v: string[]) => {
                const 原 = 值.角色;
                set值((s) => ({ ...s, 角色: v }));
                void 跑(() => 改联系人角色立场Action(projectId, x.contactId, { roles: v }), () => set值((s) => ({ ...s, 角色: 原 })));
              }}
            />
          ) : 值.角色.length ? <span className="proj-rel-text" title={值.角色.join("、")}>{值.角色.join("、")}</span> : 空}
        </div>
      </div>
      <div className="proj-rel-field">
        <span className="proj-rel-key">立场</span>
        <div className="proj-rel-val">
          {能改 ? (
            <Select
              size="small"
              allowClear
              placeholder="选一项"
              disabled={忙}
              value={值.立场 ?? undefined}
              options={并上(选项.立场, [x.立场])}
              aria-label={`${x.名} 的项目立场`}
              style={{ width: "100%" }}
              onChange={(v?: string) => {
                const 原 = 值.立场;
                set值((s) => ({ ...s, 立场: v ?? null }));
                void 跑(() => 改联系人角色立场Action(projectId, x.contactId, { stance: v ?? null }), () => set值((s) => ({ ...s, 立场: 原 })));
              }}
            />
          ) : 值.立场 ? <span className="proj-rel-text">{值.立场}</span> : 空}
        </div>
      </div>
    </div>
  );
}
