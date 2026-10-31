"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Card, Checkbox, Input, InputNumber, Popconfirm, Radio, Segmented, Select, Space, Switch, Tag } from "antd";
import { 加组员角色, 改组员角色, 加项目异常类别, 改项目异常类别, 改组织规则, 预览超时回收 } from "@/app/(app)/projects/actions";
import { 上限最大, 时长最大, 默认起算日, 是不限, 到上限的人数, 推进权限们, type 推进权限, type 组织规则, type 规则改动 } from "@/lib/project/org-rules";
import BusinessDatePicker from "@/components/BusinessDatePicker";
import { dayjs } from "@/lib/utils";
// 这两张卡（超时回收、节点推进）只在企业版出现（组织规则 只有企业版才读），节点按企业版字典列
import { 企业版字典, 本套节点名, 出口叫法上限 } from "@/lib/project/stage-dict";
import { 要沟通的节点 } from "@/lib/project/stage-gates";
import { 加企业选项, 改企业选项, 存分配谁能用 } from "./ent-dict-actions";
import { 字典种类们, 字典定义, type 字典种类 } from "@/lib/enterprise/dict-kinds";
import type { 时限范围 } from "@/lib/enterprise/edit-perm-table";
import { 分配可选角色, 谁能用, type 分配谁能用配置 } from "@/lib/enterprise/assign-use";
import { 角色名 } from "@/lib/sync/dept-policy";
import { 必填项们, 必填叫法, 能配必填的节点, 建议必填 } from "@/lib/project/required";
import { 存卡点默认Action } from "@/app/(app)/projects/blocker-actions";
import { 卡点类型们, 影响等级们, 主体名上限, 主体最多, type 卡点默认 } from "@/lib/project/blocker-rules";

const 节点们 = 企业版字典.节点们;
const 默认天数 = 企业版字典.默认超时天数;
import { 改提成比例, 改按人提成比例 } from "@/app/(app)/projects/commission-actions";
import {
  三套提成比例问题, 提成范围们, 按人提成比例问题, type 三套提成比例, type 提成范围, type 按人提成比例, type 按人提成提交,
} from "@/lib/project/commission";

type 字典项 = { id: string; name: string; active: boolean; 用的人: number };
type 结果 = Promise<{ ok: boolean; error?: string }>;

export type 项目设置 = {
  角色们: 字典项[];
  /** 进异常状态时选的类别；用的人 = 现在停在这个类别上的项目数 */
  类别们: 字典项[];
  /** 企业版组织规则，每条默认关；不是企业版 = null，卡片不出（服务端读的 企业版()） */
  组织规则: 组织规则 | null;
  /** 企业版选项字典（分配方式、回收原因……），按种类分；不是企业版 = null，卡片不出 */
  企业选项: Record<string, 字典项[]> | null;
  /** 分配方式每一项谁能用（存过的；没存的项按默认）；不是企业版不给 */
  分配谁能用?: 分配谁能用配置;
  /** 每人手上线索 / 商机阶段的项目数（userId → 个数），算持有上限的口径 */
  持有: Record<string, number>;
  /**
   * 每张卡这个人能不能改：null = 能改，否则是「只有……能改」那句（服务端按「后台设置谁能改」算好，
   * 不是企业版只有老板能改；共享试用区谁都不能改）
   */
  挡: Record<"字典" | "持有上限" | "节点时限" | "必填字段" | "阶段规则", string | null>;
  /** 节点时限能改时，能改哪几个节点："全部" = 都能改、能开关；没给 = 全部（老板 / 不是企业版） */
  时限节点?: 时限范围;
  /** 企业版卡点的默认值（阻碍主体的选项、默认类型和影响）；不是企业版 = null，卡片不出 */
  卡点默认?: 卡点默认 | null;
  /** 企业版提成比例 A（底价）/ B（溢价），百分数，内贸 / 外贸 / 不限三套；不是企业版 = null，卡片不出（服务端读的 企业版()） */
  提成比例: 三套提成比例 | null;
  /** 老板、总管理员能改提成比例 */
  能改提成比例: boolean;
  /**
   * 按人单设的提成比例（10-28）：人们 = 组织里的销售管理、销售（和已经单设过的人），范围 = 他的业务线用哪一套；
   * 比例 = 已单设的（离职的不在里面）。不是企业版 = null / 没给，卡片不出
   */
  按人提成?: { 人们: { id: string; name: string; 范围: 提成范围 }[]; 比例: 按人提成比例 } | null;
};

/**
 * 设置里的「项目模式」一栏（开关开着才有）：项目组员的角色字典、异常类别字典，企业版再加组织规则；谁能改看 value.挡，别人只看。
 * 成员的上级归部门编制管，不在这里
 */
export default function ProjectSettingsTab({ value, 成员 }: { value: 项目设置; 成员: { id: string; name: string }[] }) {
  const router = useRouter();
  const { message } = App.useApp();
  const [忙, set忙] = useState(false);

  const 跑 = async (f: () => 结果, 成了?: string) => {
    set忙(true);
    try {
      const r = await f();
      if (!r.ok) message.error(r.error ?? "没改成，请稍后再试");
      else {
        if (成了) message.success(成了);
        router.refresh();
      }
      return r.ok;
    } catch {
      message.error("没改成，请稍后再试");
      return false;
    } finally {
      set忙(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <DictCard
        title="项目组员角色" 叫法="角色" 用的说法="位组员在用" 新的提示="新角色，比如：技术负责人"
        说明="拉人进项目组时给他选一个角色。停用的角色不能再选，已经用着它的组员不受影响。"
        停用说明="停用后不能再选；已经用着它的组员不变"
        项们={value.角色们} 挡={value.挡.字典} 忙={忙} 跑={跑} 加={加组员角色} 改={改组员角色}
      />
      <DictCard
        title="异常类别" 叫法="类别" 用的说法="个项目停在这个类别" 新的提示="新类别，比如：客户失联"
        说明="项目标成异常状态时选一个类别，备注可以不写。停用的类别不能再选，已经停在这个类别上的项目照样显示。"
        停用说明="停用后不能再选；已经用着它的项目不变"
        项们={value.类别们} 挡={value.挡.字典} 忙={忙} 跑={跑} 加={加项目异常类别} 改={改项目异常类别}
      />
      {value.企业选项 && <EntDictCard 各类={value.企业选项} 谁能用配置={value.分配谁能用 ?? {}} 挡={value.挡.字典} 忙={忙} 跑={跑} />}
      {value.组织规则 && <HoldCapCard 规则={value.组织规则.公海} 持有={value.持有} 成员={成员} 挡={value.挡.持有上限} 忙={忙} 跑={跑} />}
      {value.组织规则 && <PoolRouteCard />}
      {value.组织规则 && <TimeoutCard 规则={value.组织规则.超时回收} 挡={value.挡.节点时限} 范围={value.时限节点 ?? "全部"} 忙={忙} 跑={跑} />}
      {value.组织规则 && <AdvanceCard 规则={value.组织规则.节点推进} 挡={value.挡.必填字段} 忙={忙} 跑={跑} />}
      {value.组织规则 && <StageRuleCard 规则={value.组织规则.阶段} 挡={value.挡.阶段规则} 忙={忙} 跑={跑} />}
      {value.卡点默认 && <BlockerDefaultsCard 默认={value.卡点默认} 挡={value.挡.字典} 忙={忙} 跑={跑} />}
      {value.提成比例 && <RatesCard 比例={value.提成比例} 能改={value.能改提成比例} 忙={忙} 跑={跑} />}
      {value.提成比例 && value.按人提成 && <PerUserRatesCard 三套={value.提成比例} {...value.按人提成} 能改={value.能改提成比例} 忙={忙} 跑={跑} />}
    </div>
  );
}

/** 企业版选项字典：上面切换是哪一类，下面就是那一类的字典卡。只给选项，哪里都不强制必填 */
function EntDictCard({ 各类, 谁能用配置, 挡, 忙, 跑 }: {
  各类: Record<string, 字典项[]>; 谁能用配置: 分配谁能用配置; 挡: string | null; 忙: boolean;
  跑: (f: () => 结果, 成了?: string) => Promise<boolean>;
}) {
  const [种类, set种类] = useState<字典种类>(字典种类们[0]);
  const 定义 = 字典定义[种类];
  return (
    <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
      {/* 七类在 1024 宽的设置页里一排放不下，折成两行，不要左右拖（10-27）；外框的横滚只在样式没加载时兜底 */}
      <div style={{ overflowX: "auto" }}>
        <Segmented
          className="seg-wrap"
          aria-label="选项类别"
          value={种类}
          onChange={(v) => set种类(v as 字典种类)}
          options={字典种类们.map((k) => ({ value: k, label: 字典定义[k].名 }))}
        />
      </div>
      <DictCard
        key={种类}
        title={`企业选项 · ${定义.名}`} 叫法="选项" 用的说法="处在用" 新的提示={`新${定义.名}`}
        说明={`${定义.说明}只给选项，不强制填。停用的选项不能再选，已经选过的照样显示。`}
        停用说明="停用后不能再选；已经选过的照样显示"
        项们={各类[种类] ?? []} 挡={挡} 忙={忙} 跑={跑}
        加={(name) => 加企业选项(种类, name)} 改={改企业选项}
      />
      {种类 === "assign" && <AssignUseCard 项们={各类.assign ?? []} 配置={谁能用配置} 挡={挡} 忙={忙} 跑={跑} />}
    </div>
  );
}

/**
 * 分配方式谁能用（10-27）：每一项按业务角色勾，服务端（lib/enterprise/assign-use.ts）照这个拦；
 * 「谁能用」= 谁能选这种方式把线索分出去：线索页的指定分配、自动分配，加上新建线索向导里的五种都照这个拦（10-27 A7）；从公海领照旧非原负责人都能领
 */
function AssignUseCard({ 项们, 配置, 挡, 忙, 跑 }: {
  项们: 字典项[]; 配置: 分配谁能用配置; 挡: string | null; 忙: boolean;
  跑: (f: () => 结果, 成了?: string) => Promise<boolean>;
}) {
  const 起 = () => Object.fromEntries(项们.map((x) => { const v = 谁能用(x.id, 配置); return [x.id, v === "所有人" ? [...分配可选角色] : [...v]]; }));
  const [勾, set勾] = useState<Record<string, string[]>>(起);
  const 改了 = 项们.some((x) => (勾[x.id] ?? []).join() !== (起()[x.id] ?? []).join());
  return (
    <Card title="分配方式 · 谁能用" extra={挡 && <span style={{ color: "var(--text-muted)" }}>{挡}</span>}>
      <div style={{ color: "var(--text-muted)", marginBottom: 12 }}>
        按业务角色勾谁能用这种方式分线索。老板、总管理、管理员每样都能用。新建线索时只能选自己能用的方式：指定分配要选负责人，自动分配建好就分给销售，公海捞取建好放进项目公海，暂不分配、个人自持先记在自己名下。从公海领不看这里，非原负责人都能领。
      </div>
      {项们.map((x) => (
        <div key={x.id} style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap", marginBottom: 8, minWidth: 0 }}>
          <span style={{ flex: "0 0 7em", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: x.active ? undefined : "var(--text-muted)" }} title={x.name}>{x.name}</span>
          <Checkbox.Group
            aria-label={`「${x.name}」谁能用`}
            disabled={!!挡 || 忙}
            value={勾[x.id] ?? []}
            onChange={(v) => set勾({ ...勾, [x.id]: v as string[] })}
            options={分配可选角色.map((r) => ({ value: r, label: 角色名[r] }))}
          />
        </div>
      ))}
      {!挡 && (
        <Space>
          <Button type="primary" disabled={忙 || !改了} onClick={() => void 跑(() => 存分配谁能用(勾), "已保存")}>保存</Button>
          {改了 && <Button disabled={忙} onClick={() => set勾(起())}>还原</Button>}
        </Space>
      )}
    </Card>
  );
}

/** 一张字典卡：列出每一项，能改的人（看卡片右上角）改名、停用 / 启用、加新的；只停用不删，用过的照样认 */
function DictCard({
  title, 叫法, 用的说法, 新的提示, 说明, 停用说明, 项们, 挡, 忙, 跑, 加, 改,
}: {
  title: string; 叫法: string; 用的说法: string; 新的提示: string; 说明: string; 停用说明: string;
  项们: 字典项[]; 挡: string | null; 忙: boolean;
  跑: (f: () => 结果, 成了?: string) => Promise<boolean>;
  加: (name: string) => 结果;
  改: (id: string, patch: { name?: string; active?: boolean }) => 结果;
}) {
  const [新的, set新的] = useState("");
  const [改名中, set改名中] = useState<{ id: string; name: string } | null>(null);
  const 加上 = async () => 新的.trim() && (await 跑(() => 加(新的), "已加上")) && set新的("");
  const 改名 = async () => 改名中 && (await 跑(() => 改(改名中.id, { name: 改名中.name }), "已改名")) && set改名中(null);

  return (
    <Card title={title} extra={挡 && <span style={{ color: "var(--text-muted)" }}>{挡}</span>}>
      <div style={{ color: "var(--text-muted)", marginBottom: 12 }}>{说明}</div>
      {项们.length === 0 && <div style={{ color: "var(--text-muted)", marginBottom: 12 }}>还没有{叫法}</div>}
      {项们.map((r) => (
        <div key={r.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, minWidth: 0 }}>
          {改名中?.id === r.id ? (
            <Space.Compact style={{ flex: "1 1 auto", minWidth: 0 }}>
              <Input
                autoFocus
                maxLength={20}
                aria-label={`「${r.name}」的新名字`}
                value={改名中.name}
                onChange={(e) => set改名中({ id: r.id, name: e.target.value })}
                onPressEnter={() => void 改名()}
              />
              <Button type="primary" disabled={忙 || !改名中.name.trim()} onClick={() => void 改名()}>保存</Button>
              <Button onClick={() => set改名中(null)}>取消</Button>
            </Space.Compact>
          ) : (
            <>
              <span style={{ flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: r.active ? undefined : "var(--text-muted)" }} title={r.name}>{r.name}</span>
              {!r.active && <Tag>已停用</Tag>}
              {r.用的人 > 0 && <span style={{ color: "var(--text-muted)", fontSize: 12, flex: "0 0 auto" }}>{r.用的人} {用的说法}</span>}
              {!挡 && (
                <>
                  <Button size="small" type="text" disabled={忙} onClick={() => set改名中({ id: r.id, name: r.name })}>改名</Button>
                  {r.active ? (
                    <Popconfirm title={`停用「${r.name}」？`} description={停用说明} okText="停用" onConfirm={() => void 跑(() => 改(r.id, { active: false }), "已停用")}>
                      <Button size="small" type="text" disabled={忙}>停用</Button>
                    </Popconfirm>
                  ) : (
                    <Button size="small" type="text" disabled={忙} onClick={() => void 跑(() => 改(r.id, { active: true }), "已启用")}>启用</Button>
                  )}
                </>
              )}
            </>
          )}
        </div>
      ))}
      {!挡 && (
        <Space.Compact style={{ width: "100%", marginTop: 4 }}>
          <Input placeholder={新的提示} aria-label={`新${叫法}名`} maxLength={20} value={新的} onChange={(e) => set新的(e.target.value)} onPressEnter={() => void 加上()} />
          <Button disabled={忙 || !新的.trim()} onClick={() => void 加上()}>加上</Button>
        </Space.Compact>
      )}
    </Card>
  );
}

/**
 * 项目持有上限（企业版组织规则，默认关）：开了以后每人手上线索 / 商机阶段的项目到了上限，就领不了公海、也不能再被指派。
 * 自己建档、跟着客户转、离职交接不拦。每人可以单独设，空着 = 用默认；填 999 = 不限（10-26）
 */
function HoldCapCard({
  规则, 持有, 成员, 挡, 忙, 跑,
}: {
  规则: 组织规则["公海"]; 持有: Record<string, number>; 成员: { id: string; name: string }[];
  挡: string | null; 忙: boolean; 跑: (f: () => 结果, 成了?: string) => Promise<boolean>;
}) {
  const [默认, set默认] = useState<number | null>(规则.默认上限);
  const [每人, set每人] = useState<Record<string, number | null>>(规则.每人上限);
  const 改了 = 默认 !== 规则.默认上限 || 成员.some((u) => (每人[u.id] ?? null) !== (规则.每人上限[u.id] ?? null));
  const 保存 = () => 跑(() => 改组织规则({ 公海: { 默认上限: 默认 ?? undefined, 每人上限: 每人 } }), "已保存");
  const { modal } = App.useApp();
  const 拨 = (开: boolean) => 跑(() => 改组织规则({ 公海: { 持有上限开: 开 } }), 开 ? "已开持有上限" : "已关持有上限");
  // 开之前先说会挡住谁（10-30）：一开就生效，按存着的上限数一遍现在已经到了的人；关不用问
  const 开前预览 = () => {
    const n = 到上限的人数(规则, 持有, 成员.map((u) => u.id));
    const 按 = `按${是不限(规则.默认上限) ? "不限" : ` ${规则.默认上限} 个`}${Object.keys(规则.每人上限).length ? "（单独设过的按各自的）" : ""}算`;
    modal.confirm({
      title: "开持有上限？",
      content: n ? `${按}，现在有 ${n} 人已经到了上限，他们暂时领不了公海。` : `${按}，现在没有人到上限。`,
      okText: "开",
      cancelText: "取消",
      onOk: () => void 拨(true),
    });
  };

  return (
    <Card
      title="项目持有上限"
      extra={
        <Space>
          {挡 && <span style={{ color: "var(--text-muted)" }}>{挡}</span>}
          <Switch
            aria-label="项目持有上限"
            checked={规则.持有上限开}
            disabled={!!挡 || 忙}
            onChange={(开) => (开 ? 开前预览() : void 拨(false))}
          />
        </Space>
      }
    >
      <div style={{ color: "var(--text-muted)", marginBottom: 12 }}>
        开了以后，每人手上线索 / 商机阶段、还在跟的项目到了上限，就不能再从项目公海领、也不能再被指派新项目；自己建档的不拦。默认关，不限个数。填 {上限最大} = 不限。
      </div>
      {规则.持有上限开 && (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
            <span>默认每人最多</span>
            <InputNumber aria-label="默认持有上限" min={1} max={上限最大} precision={0} suffix="个" style={{ width: 120 }} disabled={!!挡} value={默认} onChange={(v) => set默认(v)} />
            {是不限(默认) && <Tag color="processing" data-testid="hold-cap-unlimited-default">不限</Tag>}
          </div>
          {成员.map((u) => (
            <div key={u.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, minWidth: 0 }}>
              <span style={{ flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={u.name}>{u.name}</span>
              <span style={{ color: "var(--text-muted)", fontSize: 12, flex: "0 0 auto" }}>手上 {持有[u.id] ?? 0} 个</span>
              <InputNumber
                aria-label={`${u.name}的持有上限`}
                min={0} max={上限最大} precision={0} suffix="个" style={{ width: 120, flex: "0 0 auto" }}
                placeholder={`默认 ${是不限(默认 ?? 规则.默认上限) ? "不限" : (默认 ?? 规则.默认上限)}`}
                disabled={!!挡}
                value={每人[u.id] ?? null}
                onChange={(v) => set每人((m) => ({ ...m, [u.id]: v }))}
              />
              {是不限(每人[u.id]) && <Tag color="processing" style={{ marginInlineEnd: 0, flex: "0 0 auto" }}>不限</Tag>}
            </div>
          ))}
          {!挡 && (
            <Button type="primary" style={{ marginTop: 4 }} disabled={忙 || !改了 || 默认 === null} onClick={() => void 保存()}>保存</Button>
          )}
        </>
      )}
    </Card>
  );
}

/**
 * 超时回收（企业版组织规则，默认关）：线索、商机阶段按节点设最长处理天数，超过还没跟进的项目自动回到项目公海、负责人收到提醒。
 * 没设天数的节点按默认天数（企业版字典，7 天）回收；订单阶段不回收。开了以后在项目上记沟通要填下一步时间。
 * 保存前先按新设置数一遍「现在会回收几个」，有的话让老板确认
 */
function TimeoutCard({
  规则, 挡, 范围, 忙, 跑,
}: {
  规则: 组织规则["超时回收"]; 挡: string | null; 范围: 时限范围; 忙: boolean;
  跑: (f: () => 结果, 成了?: string) => Promise<boolean>;
}) {
  const { message, modal } = App.useApp();
  const [天数, set天数] = useState<Record<string, number | null>>(规则.节点天数);
  const 节点 = [...节点们.线索, ...节点们.商机];
  const 全能 = 范围 === "全部";
  const 能改 = (n: string) => !挡 && (全能 || 范围.includes(n));
  const 改了 = 节点.some((n) => (天数[n] ?? null) !== (规则.节点天数[n] ?? null));

  /** 先数会回收几个，有就确认；改完提示真收了几个 */
  const 确认后存 = async (改: 规则改动, 成了: string) => {
    const 看 = await 预览超时回收(改).catch(() => null);
    if (!看) return void message.error("没改成，请稍后再试");
    if (!看.ok) return void message.error(看.error ?? "没改成，请稍后再试");
    const 存 = () => 跑(async () => {
      const r = await 改组织规则(改);
      if (r.ok) message.success(r.收回 ? `${成了}，${r.收回} 个项目回到了项目公海` : 成了);
      return r;
    });
    if (!看.个数) return void (await 存());
    modal.confirm({
      title: `按新设置，现在会有 ${看.个数} 个项目回到项目公海`,
      content: 看.团队
        ? "这些项目在进程上已经超过处理时长没跟进。确认后你名下的马上回到公海；别人名下的在他下次打开首页或项目列表时回到公海。负责人都会收到提醒。"
        : "这些项目在进程上已经超过处理时长没跟进。确认后它们马上回到公海，负责人会收到提醒。",
      okText: "确认保存",
      cancelText: "再想想",
      onOk: () => void 存(),
    });
  };

  return (
    <Card
      title="超时回收"
      extra={
        <Space>
          {挡 && <span style={{ color: "var(--text-muted)" }}>{挡}</span>}
          <Switch
            aria-label="超时回收"
            checked={规则.开}
            disabled={!!挡 || !全能 || 忙}
            onChange={(开) => void (开 ? 确认后存({ 超时回收: { 开 } }, "已开超时回收") : 跑(() => 改组织规则({ 超时回收: { 开 } }), "已关超时回收"))}
          />
        </Space>
      }
    >
      <div style={{ color: "var(--text-muted)", marginBottom: 12 }}>
        开了以后，线索、商机阶段的项目在一个进程上超过处理时长还没跟进，自动回到项目公海，负责人会收到提醒；记沟通时填了下一步时间的，过了那天还没跟进也会回收。项目上记沟通要填下一步时间。{默认天数 ? `没填天数的进程按 ${默认天数} 天算` : "没填天数的进程不回收"}，订单阶段不回收。默认关。
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <span>计时起算日</span>
        <BusinessDatePicker
          aria-label="超时计时起算日"
          format="YYYY-MM-DD"
          style={{ width: 160 }}
          placeholder="不设"
          disabled={!!挡 || !全能 || 忙}
          value={规则.起算日 ? dayjs(规则.起算日) : null}
          onChange={(d) => {
            const 起算日 = d ? d.format("YYYY-MM-DD") : null;
            if (起算日 !== 规则.起算日) void 确认后存({ 超时回收: { 起算日 } }, "已改起算日");
          }}
        />
        <span style={{ color: "var(--text-muted)" }}>所有项目从这天起才开始计超时，之前的日子不算；默认 {默认起算日}。清空 = 不设，照原来的起点算。</span>
      </div>
      {!挡 && !全能 && (
        <div style={{ color: "var(--text-muted)", marginBottom: 12 }}>
          {范围.length ? `你能改${范围.map((n) => `「${n}」`).join("")}的时限；其他进程、开关和起算日由老板、总管理员改。` : "进程时限、开关和起算日由老板、总管理员改。"}
        </div>
      )}
      {规则.开 && (
        <>
          {(["线索", "商机"] as const).map((阶段) => (
            <div key={阶段} style={{ marginBottom: 8 }}>
              <div style={{ fontWeight: 500, marginBottom: 8 }}>{阶段}阶段</div>
              {节点们[阶段].map((n) => (
                <div key={n} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, minWidth: 0 }}>
                  <span style={{ flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={n}>{n}</span>
                  <InputNumber
                    aria-label={`「${n}」的处理时长`}
                    min={1} max={时长最大} precision={0} suffix="天" style={{ width: 120, flex: "0 0 auto" }}
                    placeholder={默认天数 ? `默认 ${默认天数} 天` : "不回收"}
                    disabled={!能改(n)}
                    value={天数[n] ?? null}
                    onChange={(v) => set天数((m) => ({ ...m, [n]: v }))}
                  />
                </div>
              ))}
            </div>
          ))}
          {节点.some(能改) && (
            <Button type="primary" style={{ marginTop: 4 }} disabled={忙 || !改了} onClick={() => void 确认后存({ 超时回收: { 节点天数: 天数 } }, "已保存")}>保存</Button>
          )}
        </>
      )}
    </Card>
  );
}

const 必填选项 = 必填项们.map((x) => ({ value: x.key, label: 必填叫法(x.key), title: x.说明 }));
const 同一份 = (a: string[] = [], b: string[] = []) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * 节点推进（企业版组织规则，默认关）：老板给节点配「必填哪几样」，项目在这个节点上填齐了自动推到下一节点。
 * 配了必填的节点，手动往前推只给老板、主管；没配的节点照原来手动推。最后一个节点由人点成功交付，不能配。
 * 改了清单不当场推：项目下次保存（改项目、记沟通、改客户资料）时按新清单走
 */
function AdvanceCard({
  规则, 挡, 忙, 跑,
}: {
  规则: 组织规则["节点推进"]; 挡: string | null; 忙: boolean;
  跑: (f: () => 结果, 成了?: string) => Promise<boolean>;
}) {
  const [必填, set必填] = useState<Record<string, string[]>>(规则.必填);
  const 改了 = 能配必填的节点.some((n) => !同一份(必填[n], 规则.必填[n]));
  const 阶段们 = (["线索", "商机", "订单"] as const).map((阶段) => ({ 阶段, 节点: 节点们[阶段].filter((n) => 能配必填的节点.includes(n)) }));

  return (
    <Card
      title="进程推进"
      extra={
        <Space>
          {挡 && <span style={{ color: "var(--text-muted)" }}>{挡}</span>}
          <Switch
            aria-label="进程推进"
            checked={规则.开}
            disabled={!!挡 || 忙}
            onChange={(开) => void 跑(() => 改组织规则({ 节点推进: { 开 } }), 开 ? "已开进程推进" : "已关进程推进")}
          />
        </Space>
      }
    >
      <div style={{ color: "var(--text-muted)", marginBottom: 12 }}>
        开了以后，给进程配上必填的几样，项目在这个进程上填齐了自动推到下一个进程，进程变更里记一行「必填齐了，自动推进」。没填齐也能保存，项目页上会列出还差哪几样。配了必填的进程，手动往前推只有老板、主管能点，往后退照旧；没配的进程照原来手动推。改了清单以后，项目下次保存时按新清单走。默认关。
      </div>
      {规则.开 && (
        <>
          {阶段们.map(({ 阶段, 节点 }) => (
            <div key={阶段} style={{ marginBottom: 8 }}>
              <div style={{ fontWeight: 500, marginBottom: 8 }}>{阶段}阶段</div>
              {节点.map((n) => (
                <div key={n} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, minWidth: 0, flexWrap: "wrap" }}>
                  <span style={{ flex: "0 0 96px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={n}>{n}</span>
                  <Select
                    aria-label={`「${n}」的必填`}
                    mode="multiple"
                    allowClear
                    style={{ flex: "1 1 240px", minWidth: 0 }}
                    placeholder="不配，照原来手动推"
                    disabled={!!挡}
                    options={必填选项}
                    value={必填[n] ?? []}
                    onChange={(v: string[]) => set必填((m) => ({ ...m, [n]: v }))}
                  />
                </div>
              ))}
            </div>
          ))}
          {!挡 && (
            <Space wrap style={{ marginTop: 4 }}>
              <Button type="primary" disabled={忙 || !改了} onClick={() => void 跑(() => 改组织规则({ 节点推进: { 必填 } }), "已保存")}>保存</Button>
              <Button disabled={忙} onClick={() => set必填(Object.fromEntries(Object.entries(建议必填).map(([n, v]) => [本套节点名(n, 企业版字典), v])))}>用建议清单</Button>
            </Space>
          )}
        </>
      )}
    </Card>
  );
}

/**
 * 卡点默认值（企业版）：阻碍主体有哪些选项、发布时默认选的类型和影响。
 * 10-27 会议：卡点先不设解决时限，每类的天数不再让填（库里照旧存着，发布时仍按它写 dueAt，界面不显示）。
 * 谁能改跟字典一样
 */
function BlockerDefaultsCard({
  默认, 挡, 忙, 跑,
}: {
  默认: 卡点默认; 挡: string | null; 忙: boolean; 跑: (f: () => 结果, 成了?: string) => Promise<boolean>;
}) {
  const [主体们, set主体们] = useState<string[]>(默认.阻碍主体们);
  const [类型, set类型] = useState(默认.默认类型);
  const [影响, set影响] = useState(默认.默认影响);
  const 改了 =
    主体们.join("\n") !== 默认.阻碍主体们.join("\n") || 类型 !== 默认.默认类型 || 影响 !== 默认.默认影响;
  const 齐了 = 主体们.length > 0;
  const 保存 = () => 跑(() => 存卡点默认Action({ 阻碍主体们: 主体们, 默认类型: 类型, 默认影响: 影响 }), "已保存");
  const 行 = { display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" as const };

  return (
    <Card title="卡点默认值" extra={挡 && <span style={{ color: "var(--text-muted)" }}>{挡}</span>}>
      <div style={{ color: "var(--text-muted)", marginBottom: 12 }}>
        在项目沟通记录上发卡点时，阻碍主体从下面的选项里单选；卡点不设解决时限，只记从出现到解决用了几天。
      </div>
      <div style={行}>
        <span style={{ width: 72 }}>阻碍主体</span>
        <Select
          aria-label="阻碍主体的选项" mode="tags" style={{ flex: "1 1 240px", minWidth: 0 }} disabled={!!挡}
          value={主体们} maxCount={主体最多} placeholder="输入后回车添加"
          onChange={(v: string[]) => set主体们([...new Set(v.map((x) => x.trim()).filter((x) => x && x.length <= 主体名上限))])}
          open={false} tokenSeparators={[",", "，"]}
        />
      </div>
      <div style={行}>
        <span style={{ width: 72 }}>默认类型</span>
        <Select aria-label="默认卡点类型" style={{ width: 160 }} disabled={!!挡} value={类型} onChange={set类型} options={卡点类型们.map((t) => ({ value: t, label: t }))} />
      </div>
      <div style={行}>
        <span style={{ width: 72 }}>默认影响</span>
        <Select aria-label="默认影响" style={{ width: 160 }} disabled={!!挡} value={影响} onChange={set影响} options={影响等级们.map((t) => ({ value: t, label: t }))} />
      </div>
      {!挡 && (
        <Button type="primary" style={{ marginTop: 4 }} disabled={忙 || !改了 || !齐了} onClick={() => void 保存()}>保存</Button>
      )}
    </Card>
  );
}

/**
 * 提成比例（企业版）：底价提成 = 项目底价 × A，溢价提成 = 项目溢价 × B。内贸、外贸、不限三套，按项目负责人的业务线取（10-27 会议）。
 * 老板、总管理员能改，每次改动进操作记录。改了以后没赢单的项目预估马上按新比例算；已经赢单的实际提成不变
 */
const 范围说明: Record<提成范围, string> = {
  内贸: "负责人业务线是内贸",
  外贸: "负责人业务线是外贸",
  不限: "两边都做、没设业务线",
};
type 草稿比例 = Record<提成范围, { 底价比例: number | null; 溢价比例: number | null }>;

function RatesCard({
  比例, 能改, 忙, 跑,
}: {
  比例: 三套提成比例; 能改: boolean; 忙: boolean; 跑: (f: () => 结果, 成了?: string) => Promise<boolean>;
}) {
  const [草稿, set草稿] = useState<草稿比例>(比例);
  const 交 = Object.fromEntries(提成范围们.map((k) => [k, { 底价比例: 草稿[k].底价比例 ?? undefined, 溢价比例: 草稿[k].溢价比例 ?? undefined }]));
  const 问题 = 三套提成比例问题(交);
  const 改了 = 提成范围们.some((k) => 草稿[k].底价比例 !== 比例[k].底价比例 || 草稿[k].溢价比例 !== 比例[k].溢价比例);
  const 改 = (k: 提成范围, 哪个: "底价比例" | "溢价比例", v: number | null) => set草稿((d) => ({ ...d, [k]: { ...d[k], [哪个]: v } }));
  return (
    <Card title="提成比例" extra={!能改 && <span style={{ color: "var(--text-muted)" }}>只有老板、总管理员能改</span>}>
      <div style={{ color: "var(--text-muted)", marginBottom: 12 }}>
        底价提成 = 项目底价 × 底价比例；溢价提成 =（成交金额 − 项目底价）× 溢价比例，成交金额低于底价时溢价算 0。按项目负责人的业务线用内贸 / 外贸那一套，两边都做或没设业务线的用「不限」。改了以后，还没赢单的项目按新比例预估；已经赢单的实际提成不变。
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 12 }}>
        {提成范围们.map((k) => (
          <div key={k} style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ flex: "0 0 auto", minWidth: 40, fontWeight: 600 }} title={范围说明[k]}>{k}</span>
            <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
              底价比例
              <InputNumber<number> aria-label={`${k} 底价提成比例`} min={0} max={100} precision={2} suffix="%" style={{ width: 120 }} disabled={!能改} value={草稿[k].底价比例} onChange={(v) => 改(k, "底价比例", v)} />
            </span>
            <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
              溢价比例
              <InputNumber<number> aria-label={`${k} 溢价提成比例`} min={0} max={100} precision={2} suffix="%" style={{ width: 120 }} disabled={!能改} value={草稿[k].溢价比例} onChange={(v) => 改(k, "溢价比例", v)} />
            </span>
            <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{范围说明[k]}</span>
          </div>
        ))}
      </div>
      {能改 && 改了 && 问题 && <div style={{ color: "var(--danger-text)", marginBottom: 8 }}>{问题}</div>}
      {能改 && (
        <Button type="primary" disabled={忙 || !改了 || !!问题} onClick={() => void 跑(() => 改提成比例(草稿 as 三套提成比例), "已保存提成比例")}>保存</Button>
      )}
    </Card>
  );
}

/**
 * 提成比例 · 按人设置（10-28 用户「以销售个人为单位」）：给某个销售单独定底价、溢价比例，比业务线那一套优先；
 * 留空的那项跟他业务线的那一套。只交改了的人（别人同时在改别的人不会被冲掉）；每改一个人进操作记录。
 * 人多了有个按名字找的框；名字太长省略、悬停看全
 */
type 草稿单设 = Record<string, { 底价比例: number | null; 溢价比例: number | null }>;
const 搜索门槛 = 8;

function PerUserRatesCard({
  三套, 人们, 比例, 能改, 忙, 跑,
}: {
  三套: 三套提成比例; 人们: { id: string; name: string; 范围: 提成范围 }[]; 比例: 按人提成比例;
  能改: boolean; 忙: boolean; 跑: (f: () => 结果, 成了?: string) => Promise<boolean>;
}) {
  const 原 = (id: string) => ({ 底价比例: 比例[id]?.底价比例 ?? null, 溢价比例: 比例[id]?.溢价比例 ?? null });
  const [草稿, set草稿] = useState<草稿单设>(() => Object.fromEntries(人们.map((u) => [u.id, 原(u.id)])));
  const [找, set找] = useState("");
  const 值 = (id: string) => 草稿[id] ?? 原(id);
  const 改了的: 按人提成提交 = Object.fromEntries(
    人们.filter((u) => 值(u.id).底价比例 !== 原(u.id).底价比例 || 值(u.id).溢价比例 !== 原(u.id).溢价比例).map((u) => [u.id, 值(u.id)]),
  );
  const 名 = new Map(人们.map((u) => [u.id, u.name]));
  const 问题 = 按人提成比例问题(改了的, (id) => 名.get(id) ?? "有一个人");
  const 有改动 = Object.keys(改了的).length > 0;
  const 改 = (id: string, 哪个: "底价比例" | "溢价比例", v: number | null) => set草稿((d) => ({ ...d, [id]: { ...值(id), [哪个]: v } }));
  const 词 = 找.trim().toLowerCase();
  const 显示 = 词 ? 人们.filter((u) => u.name.toLowerCase().includes(词)) : 人们;
  const 单设数 = 人们.filter((u) => 比例[u.id]).length;
  return (
    <Card
      title="提成比例 · 按人设置"
      extra={!能改 ? <span style={{ color: "var(--text-muted)" }}>只有老板、总管理员能改</span> : 单设数 > 0 && <span style={{ color: "var(--text-muted)" }}>已单设 {单设数} 人</span>}
    >
      <div style={{ color: "var(--text-muted)", marginBottom: 12 }}>
        给某个销售单独定比例，比上面按业务线的那一套优先；留空的那项跟他业务线的比例走（框里灰字就是现在用的）。离职的人自动不算。改了以后，他还没赢单的项目按新比例预估；已经赢单的实际提成不变。
      </div>
      {人们.length > 搜索门槛 && (
        <Input allowClear placeholder="按名字找" aria-label="按名字找销售" style={{ maxWidth: 240, marginBottom: 12 }} value={找} onChange={(e) => set找(e.target.value)} />
      )}
      {人们.length === 0 ? (
        <div style={{ color: "var(--text-muted)" }}>组织里还没有销售。先在「组织架构」里把人设成销售或销售管理</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 12 }}>
          {显示.length === 0 && <div style={{ color: "var(--text-muted)" }}>没找到叫「{找.trim()}」的人</div>}
          {显示.map((u) => {
            const 线 = 三套[u.范围];
            const v = 值(u.id);
            return (
              <div key={u.id} style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", minWidth: 0 }}>
                <span
                  title={u.name}
                  style={{ flex: "0 1 160px", minWidth: 0, maxWidth: 160, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {u.name}
                </span>
                <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                  底价比例
                  <InputNumber<number>
                    aria-label={`${u.name} 底价提成比例`} min={0} max={100} precision={2} suffix="%" style={{ width: 120 }} disabled={!能改}
                    placeholder={String(线.底价比例)} value={v.底价比例} onChange={(x) => 改(u.id, "底价比例", x ?? null)}
                  />
                </span>
                <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                  溢价比例
                  <InputNumber<number>
                    aria-label={`${u.name} 溢价提成比例`} min={0} max={100} precision={2} suffix="%" style={{ width: 120 }} disabled={!能改}
                    placeholder={String(线.溢价比例)} value={v.溢价比例} onChange={(x) => 改(u.id, "溢价比例", x ?? null)}
                  />
                </span>
                <span style={{ color: "var(--text-muted)", fontSize: 12 }}>留空跟{u.范围}</span>
              </div>
            );
          })}
        </div>
      )}
      {能改 && 有改动 && 问题 && <div style={{ color: "var(--danger-text)", marginBottom: 8 }}>{问题}</div>}
      {能改 && 人们.length > 0 && (
        <Space wrap>
          <Button type="primary" disabled={忙 || !有改动 || !!问题} onClick={() => void 跑(() => 改按人提成比例(改了的), "已保存按人提成比例")}>保存</Button>
          {有改动 && <Button disabled={忙} onClick={() => set草稿(Object.fromEntries(人们.map((u) => [u.id, 原(u.id)])))}>撤销改动</Button>}
        </Space>
      )}
    </Card>
  );
}

const 推进权限说明: Record<推进权限, string> = {
  负责人可推: "负责人自己、直属上级、老板、总管理员都能往前推",
  仅上级推: "负责人有直属上级时，只有直属上级、老板、总管理员能往前推",
};

/**
 * 阶段规则（企业版，10-26 会定）：往前推节点谁能推（默认负责人可推），线索、商机两个阶段出口的叫法。
 * 改叫法只换说法：存的结局、节点、跨阶段单向的规矩都不变。往后退、点结局不归推进权限管。每次推进都记在节点变更里
 */
/** 客户名下有多个项目时两级公海怎么走：10-27 会议定项目随客户整体转让，不再二选一，这里只说明（规矩在 lib/enterprise/pool-link.ts） */
function PoolRouteCard() {
  return (
    <Card title="多项目客户的公海走法">
      <div style={{ color: "var(--text-muted)", lineHeight: 1.7 }}>
        项目随客户整体转让，不单独转让某一个项目：项目进了项目公海，客户连同名下别的项目一起进客户公海；谁领这个项目，客户和别的项目一起归他。
        客户名下有没结束的订单阶段项目时，客户不跟着进。
      </div>
    </Card>
  );
}

function StageRuleCard({
  规则, 挡, 忙, 跑,
}: {
  规则: 组织规则["阶段"]; 挡: string | null; 忙: boolean;
  跑: (f: () => 结果, 成了?: string) => Promise<boolean>;
}) {
  const 阶段们 = ["线索", "商机"] as const;
  const 原来 = (s: (typeof 阶段们)[number]): [string, string] => [规则.出口叫法[s]?.[0] ?? "", 规则.出口叫法[s]?.[1] ?? ""];
  const [叫法, set叫法] = useState<Record<string, [string, string]>>(() => Object.fromEntries(阶段们.map((s) => [s, 原来(s)])));
  const 改了 = 阶段们.some((s) => 叫法[s][0] !== 原来(s)[0] || 叫法[s][1] !== 原来(s)[1]);
  const 存 = () => 跑(() => 改组织规则({
    阶段: { 出口叫法: Object.fromEntries(阶段们.map((s) => [s, [叫法[s][0].trim() || null, 叫法[s][1].trim() || null] as const])) },
  }), "已保存");

  return (
    <Card title="阶段规则" extra={挡 && <span style={{ color: "var(--text-muted)" }}>{挡}</span>}>
      <div style={{ color: "var(--text-muted)", marginBottom: 12 }}>
        线索阶段只能走到「转商机」或「流失」，商机阶段只能「赢单」或「丢单」，订单只能从商机进；进了下一个阶段就退不回上一个，阶段里面往后退随便退。每次推进都记在进程变更里。
      </div>
      <div style={{ fontWeight: 500, marginBottom: 8 }}>谁能往前推进程</div>
      <Radio.Group
        aria-label="往前推权限"
        disabled={!!挡 || 忙}
        value={规则.推进权限}
        onChange={(e) => void 跑(() => 改组织规则({ 阶段: { 推进权限: e.target.value as 推进权限 } }), "已保存")}
        style={{ display: "grid", gap: 4, marginBottom: 16 }}
        options={推进权限们.map((v) => ({ value: v, label: <span>{v}<span style={{ color: "var(--text-muted)" }}>：{推进权限说明[v]}</span></span> }))}
      />
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 16, minWidth: 0 }}>
        <Switch
          aria-label="前两个进程要沟通"
          size="small"
          style={{ flex: "none", marginTop: 3 }}
          disabled={!!挡 || 忙}
          checked={规则.前两节点要沟通}
          onChange={(v) => void 跑(() => 改组织规则({ 阶段: { 前两节点要沟通: v } }), "已保存")}
        />
        <div style={{ minWidth: 0 }}>
          <div>线索、商机前两个进程各要一条沟通才能往后推</div>
          <div style={{ color: "var(--text-muted)" }}>开了：{要沟通的节点().join("、")} 这几个进程上，各记过至少一条沟通才能推到下一个进程（必填齐了的自动推进也一样）。默认关</div>
        </div>
      </div>
      <div style={{ fontWeight: 500, marginBottom: 8 }}>结束状态叫法<span style={{ color: "var(--text-muted)", fontWeight: 400 }}>（空着 = 用默认；只换说法，已经定了结果的项目不变）</span></div>
      {阶段们.map((s) => {
        const [成, 没成] = 企业版字典.出口们[s];
        return (
          <div key={s} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, minWidth: 0, flexWrap: "wrap" }}>
            <span style={{ flex: "0 0 64px" }}>{s}阶段</span>
            {([0, 1] as const).map((i) => (
              <Input
                key={i}
                aria-label={`${s}阶段${i === 0 ? "走成" : "没走成"}的叫法`}
                style={{ flex: "1 1 140px", minWidth: 0 }}
                maxLength={出口叫法上限}
                placeholder={(i === 0 ? 成 : 没成).叫法}
                disabled={!!挡}
                value={叫法[s][i]}
                onChange={(e) => set叫法((m) => {
                  const v: [string, string] = [...m[s]];
                  v[i] = e.target.value;
                  return { ...m, [s]: v };
                })}
              />
            ))}
          </div>
        );
      })}
      {!挡 && <Button type="primary" style={{ marginTop: 4 }} disabled={忙 || !改了} onClick={() => void 存()}>保存叫法</Button>}
    </Card>
  );
}
