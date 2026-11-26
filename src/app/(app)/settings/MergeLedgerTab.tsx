"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, Button, Input, Table, Tag } from "antd";
import DatePicker from "@/components/BusinessDatePicker";
import type { Dayjs } from "dayjs";
import { dayjs } from "@/lib/utils";
import { businessDayjs } from "@/lib/business-clock";
import { 写xlsx } from "@/lib/xlsx-write";
import { 出错原话 } from "@/lib/stale-deploy";
import { useSettingsNote } from "./InlineNote";
import type { 台账行, 台账条件 } from "@/lib/enterprise/merge-ledger";
import type { 查合并台账, 导出合并台账Action } from "./merge-ledger-actions";

/**
 * 设置 → 合并台账（2026-12-02，客户 E-336 / E-337 / E-339）：项目合并一单一行，只读，只给系统管理员（SettingsBody 判、动作里再判）。
 * 运营对账；系统管理员每周一拿它和财务开票清单对一遍，误勾的 30 天内到被并项目详情里撤回——台账上不做撤回，项目名点过去就是详情。
 * 客户 / 项目名在新标签页打开：对账时台账的筛选留着，撤回完回来接着对；也免得设置浮层盖在详情上（@modal 软导航不收）。
 * 筛：合并时间范围 + 客户名 / 项目名；导出按同一组条件在服务端重查（导一次记导出日志），这里拼 xlsx。
 * 一行、放不下省略号，悬停看全（11-04）；列多，设置弹窗和手机上在表格框里横滚，页面不横滚（同操作日志）。
 */

type 段 = [Dayjs | null, Dayjs | null] | null;
const 时 = (v: string | null) => (v ? dayjs(v).format("YYYY-MM-DD HH:mm") : "");
/** 只传北京日期串：选择器回来的是业务钟实例（BusinessDatePicker），预设也是业务钟，直接 format；边界由服务端换成时刻 */
const 条件of = (范围: 段, 词: string): 台账条件 => ({
  起: 范围?.[0] ? 范围[0].format("YYYY-MM-DD") : null,
  止: 范围?.[1] ? 范围[1].format("YYYY-MM-DD") : null,
  词: 词.trim() || null,
});
/** 周一对账用：本周、上周都从周一算（不跟 dayjs 语言包的周起点走） */
function 周一(d: Dayjs) {
  return d.subtract((d.day() + 6) % 7, "day").startOf("day");
}
const 预设 = () => {
  const 今 = businessDayjs();
  return [
    { label: "上周", value: [周一(今).subtract(7, "day"), 周一(今).subtract(1, "day")] as [Dayjs, Dayjs] },
    { label: "本周", value: [周一(今), 今] as [Dayjs, Dayjs] },
    { label: "近 30 天", value: [今.subtract(29, "day"), 今] as [Dayjs, Dayjs] },
  ];
};

const 表头 = ["类型", "合并时间", "发起人", "客户", "留下项目", "被并项目", "留下项目负责人", "被并项目负责人", "开票自查勾选人", "开票自查时间", "状态", "撤回人", "撤回时间"] as const;
const 成格 = (r: 台账行) => [r.类型, 时(r.at), r.发起人, r.客户, r.留下项目, r.被并项目, r.留下负责人, r.被并负责人, r.自查人, 时(r.自查时间), r.状态, r.撤回人, 时(r.撤回时间)];

/** 一格：一行、放不下省略号，悬停看全文 */
const 一行 = (v: string) => <span className="ml-cell" title={v}>{v || "—"}</span>;

export default function MergeLedgerTab({ 查, 导出 }: { 查: typeof 查合并台账; 导出: typeof 导出合并台账Action }) {
  const [就地, 提示条] = useSettingsNote();
  const [范围, set范围] = useState<段>(null);
  const [词, set词] = useState("");
  const [行, set行] = useState<台账行[] | null>(null);
  const [截断, set截断] = useState(false);
  const [读不到, set读不到] = useState<string | null>(null);
  const [导着, set导着] = useState(false);
  // 列表上次真正查过的条件（拉 成功后写入）：导出用它，不用输入框里还没搜的词
  const [已查, set已查] = useState<台账条件>({ 起: null, 止: null, 词: null });

  // 初次进来 行 本来就是 null（转圈）；用户改条件时先清成 null 再查，见 重拉
  // 请求号：只认最后一次发出的结果，早发的后回来直接丢（读写 ref 都放在 then 回调里）
  const 请求号 = useRef(0);
  const 末发 = useRef(JSON.stringify(条件of(null, "")));
  const 拉 = (范: 段, w: string) => {
    const 条件 = 条件of(范, w);
    const 号 = (请求号.current += 1);
    return 查(条件)
      .catch((e: unknown) => ({ ok: false as const, error: 出错原话(e, "合并台账没读出来") }))
      .then((r) => {
        if (号 !== 请求号.current) return;
        if (!r.ok) {
          set读不到(r.error);
          set行([]);
          return;
        }
        set读不到(null);
        set已查(条件);
        set截断(r.截断);
        set行(r.行们);
      });
  };
  useEffect(() => {
    void 拉(null, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在进来时拉一次，之后由 重拉 按用户改的条件查
  }, []);
  const 重拉 = (范: 段, w: string) => {
    末发.current = JSON.stringify(条件of(范, w));
    set行(null);
    void 拉(范, w);
  };
  // 日期范围：rc-picker 改了结束日期后焦点会跳回开始框、弹层不收，onChange 要等弹层关了才来，
  // 所以范围凑齐（或清空）就由 onCalendarChange 立刻发；onChange 再来一次同条件的不重发
  const 改范围 = (v: 段) => {
    const 新 = v ?? null;
    if (新 && (!新[0] || !新[1])) return;
    set范围(新);
    if (JSON.stringify(条件of(新, 词)) !== 末发.current) 重拉(新, 词);
  };

  async function 导() {
    set导着(true);
    try {
      const r = await 导出(已查).catch((e: unknown) => ({ ok: false as const, error: 出错原话(e, "导出没能完成，请重试") }));
      if (!r.ok) return void 就地.error(r.error);
      const bytes = 写xlsx([{ 名: "合并台账", 表头, 行: r.行们.map(成格), 列宽: [12, 17, 10, 24, 24, 24, 12, 12, 12, 17, 8, 10, 17] }]);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `合并台账-${dayjs().format("YYYYMMDD")}.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      就地.success(`已导出 ${r.行们.length} 单${r.截断 ? "（超上限，只导了最新的）" : ""}`);
    } finally {
      set导着(false);
    }
  }

  const 项目格 = (id: string, 名: string) => (
    <a href={`/projects/${id}`} target="_blank" rel="noopener" className="ml-cell" title={名}>{名}</a>
  );

  return (
    <div data-testid="合并台账">
      <Alert
        type="info"
        showIcon
        className="ml-tip"
        title="项目合并、公海客户合并一单一行，只读"
        description="每周一拿它和财务开票清单对一遍：开票自查勾错的，30 天内到被并项目详情里撤回（点项目名在新标签页打开）。只有系统管理员看得到。"
      />
      <div className="ml-bar">
        <DatePicker.RangePicker
          aria-label="合并时间范围"
          className="ml-range"
          classNames={{ popup: { root: "ml-range-pop" } }}
          value={范围}
          presets={预设()}
          allowClear
          onChange={(v) => 改范围(v as 段)}
          onCalendarChange={(v) => 改范围(v as 段)}
        />
        <Input.Search
          aria-label="按客户名或项目名搜"
          className="ml-search"
          placeholder="客户名 / 项目名"
          allowClear
          value={词}
          onChange={(e) => {
            set词(e.target.value);
            // 点了清空：立刻回到不带词的列表
            if (!e.target.value) 重拉(范围, "");
          }}
          onSearch={(v) => 重拉(范围, v)}
        />
        <Button onClick={() => void 导()} loading={导着} disabled={!行?.length}>导出</Button>
        {行 && !读不到 && (
          <span className="ml-count" role="status">
            共 {行.length} 单{截断 ? "（超上限，只列了最新的，缩小时间范围再看）" : ""}
          </span>
        )}
      </div>
      {提示条}
      <Table<台账行>
        rowKey="id"
        size="middle"
        loading={行 === null}
        dataSource={行 ?? []}
        tableLayout="fixed"
        scroll={{ x: 1436 }}
        pagination={{ pageSize: 20, showSizeChanger: false, hideOnSinglePage: true }}
        locale={{
          emptyText: 读不到 ? (
            <span>
              {读不到}
              <Button type="link" size="small" onClick={() => 重拉(范围, 词)}>重试</Button>
            </span>
          ) : 范围 || 词 ? "这个范围里没有合并单" : "还没有项目合并或公海客户合并",
        }}
        columns={[
          { title: "类型", dataIndex: "类型", width: 96, ellipsis: true, render: 一行 },
          { title: "合并时间", dataIndex: "at", width: 140, ellipsis: true, render: (v: string) => 一行(时(v)) },
          { title: "发起人", dataIndex: "发起人", width: 96, ellipsis: true, render: 一行 },
          {
            title: "客户", dataIndex: "客户", width: 150, ellipsis: true,
            render: (v: string, r) => (r.客户id && r.客户状态 !== "已删" ? <a href={`/customers/${r.客户id}`} target="_blank" rel="noopener" className="ml-cell" title={v}>{v}</a> : 一行(v)),
          },
          { title: "留下项目", dataIndex: "留下项目", width: 150, ellipsis: true, render: (v: string, r) => (r.类型 === "项目合并" ? 项目格(r.留下id, v) : 一行("")) },
          { title: "被并项目", dataIndex: "被并项目", width: 150, ellipsis: true, render: (v: string, r) => (r.类型 === "项目合并" ? 项目格(r.被并id, v) : 一行("")) },
          { title: "留下项目负责人", dataIndex: "留下负责人", width: 110, ellipsis: true, render: 一行 },
          { title: "被并项目负责人", dataIndex: "被并负责人", width: 110, ellipsis: true, render: 一行 },
          {
            title: "开票自查", key: "自查", width: 180, ellipsis: true,
            render: (_: unknown, r) => 一行([r.自查人, 时(r.自查时间)].filter(Boolean).join(" · ")),
          },
          {
            title: "状态", dataIndex: "状态", width: 84,
            render: (v: string) => <Tag color={v === "已撤回" ? "default" : "geekblue"} className="ml-tag">{v}</Tag>,
          },
          {
            title: "撤回", key: "撤回", width: 170, ellipsis: true,
            render: (_: unknown, r) => 一行([r.撤回人, 时(r.撤回时间)].filter(Boolean).join(" · ")),
          },
        ]}
      />
    </div>
  );
}
