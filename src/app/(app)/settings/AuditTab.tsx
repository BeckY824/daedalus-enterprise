"use client";

import { Table, Tag, Alert } from "antd";
import { UserCell } from "@/components/ui";
import { dayjs } from "@/lib/utils";
import { useBusiness } from "@/lib/business-client";

/** 设置 · 操作日志：每一次改动的记录，只增不改不删。最近 200 条由 SettingsBody 取好传进来 */

export type AuditRow = {
  id: string;
  at: string;
  userName: string;
  action: string;
  entity: string;
  summary: string;
  detail: string | null;
};

/** 动作与对象的中文叫法，日志里直接显示英文没人看得懂 */
const ACTION_LABEL: Record<string, string> = {
  create: "新建", update: "修改", delete: "删除", assign: "转派",
  convert: "转化", deactivate: "停用", reactivate: "恢复", password: "改密码", device_revoke: "退出机器", ai_use: "AI", ai_apply: "确认 AI 建议", ai_undo: "撤销 AI 建议",
  pool: "放回公海", claim: "领取", import: "导入", merge: "合并重复",
  restore: "从回收站恢复", purge: "彻底删除", sync: "同步", export: "导出", handover: "离职交接",
};
const ENTITY_LABEL: Record<string, string> = {
  Customer: "学员", Contract: "签约", Lead: "线索", User: "成员", Channel: "渠道", Setting: "系统设置", Ai: "AI 功能", Device: "机器",
  Opportunity: "商机", Contact: "联系人", FollowUp: "沟通记录", Task: "待办", FollowPlan: "跟进计划",
  // 订单 / 供应商表 2026-10-29 删了，老日志里还有这两类对象，叫法留着
  TradeOrder: "订单", Supplier: "供应商",
  // 企业版（2026-10-26 验收 #17：对象一栏露出英文 Project）
  Project: "项目", ProjectMember: "项目组成员", ProjectRole: "项目角色", ProjectExceptionCategory: "异常分类", Attachment: "附件", followup: "沟通记录",
  EntImportBatch: "企业版导入", EntDept: "部门", EntSnapshot: "数据快照", EntMember: "成员", EntLeadQuota: "分配上限", EntLeadAssign: "线索分配", EntBlocker: "卡点",
  EntCommission: "提成", EntLeadVerify: "线索验证",
  // 2026-11-03 D6-2：这几类原来直接露英文表名；新加 recordAudit 记得补（tests/audit-labels 守着）
  EntBlockerReason: "阻碍原因", EntProjectPayment: "回款", EntDictItem: "字典", EntOrgSync: "通讯录同步", EntConn: "连接设置",
  EntChannelMain: "主渠道", EntDupeHit: "挂靠申请",
};
/** 明细是入库时序列化的 JSON，格式化给人看；万一存了非法内容也不能让页面崩 */
function safeJson(raw: string | null): string {
  if (!raw) return "";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

const ACTION_COLOR: Record<string, string> = {
  create: "success", update: "processing", delete: "error",
  assign: "cyan", convert: "gold", deactivate: "warning", reactivate: "default", password: "default", ai_use: "purple", ai_apply: "green", ai_undo: "default",
  pool: "default", claim: "cyan", merge: "geekblue", restore: "green", purge: "error", export: "magenta",
};

/** 导出 = 设置 →「导出记录」：同一张表只放导出那几条，抬头换成导出的说法（11-03） */
export default function AuditTab({ logs, 导出 = false }: { logs: AuditRow[]; 导出?: boolean }) {
  const b = useBusiness();
  return (
    <>
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 14 }}
                title={导出 ? "谁、什么时候导出了哪张表、多少行" : `${b.customer}等业务数据的修改会记录在这里`}
                description={导出 ? "每导出一次记一条，展开看当时的筛选条件。只有系统管理员看得到，此处显示最近 200 条。" : "记录只增不改不删，成员被停用或删除后其历史操作仍然保留。此处显示最近 200 条。"}
              />
              <Table<AuditRow>
                rowKey="id"
                size="middle"
                dataSource={logs}
                // 留个底：手机上内容那列至少还有 160 宽，放不下就在框里横滚；1024 的设置页约 494，不滚
                scroll={{ x: 480 }}
                pagination={{ pageSize: 20, showSizeChanger: false }}
                locale={{ emptyText: 导出 ? "还没有人导出过" : "还没有任何操作记录" }}
                expandable={{
                  // 明细是 JSON，平时折起来，要追细节时再展开
                  rowExpandable: (r) => !!r.detail,
                  expandedRowRender: (r) => (
                    <pre
                      style={{
                        margin: 0,
                        fontSize: 12,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-all",
                        color: "var(--ink-soft)",
                      }}
                    >
                      {safeJson(r.detail)}
                    </pre>
                  ),
                }}
                // 时间两行、动作和对象并一格（10-27）：设置弹窗里不用左右拖，内容那列多留宽度
                columns={[
                  {
                    title: "时间",
                    dataIndex: "at",
                    width: 100,
                    render: (v: string) => (
                      <span className="audit-at">
                        {dayjs(v).format("YYYY-MM-DD")}
                        <span className="muted">{dayjs(v).format("HH:mm:ss")}</span>
                      </span>
                    ),
                  },
                  {
                    title: "操作人",
                    dataIndex: "userName",
                    width: 120,
                    render: (v: string) => <UserCell name={v} size={26} />,
                  },
                  {
                    title: "动作",
                    dataIndex: "action",
                    width: 96,
                    render: (v: string, r: AuditRow) => (
                      <span className="audit-act">
                        <Tag color={ACTION_COLOR[v] ?? "default"} style={{ margin: 0 }}>
                          {ACTION_LABEL[v] ?? v}
                        </Tag>
                        <span className="muted">{r.entity === "Customer" ? b.customer : ENTITY_LABEL[r.entity] ?? r.entity}</span>
                      </span>
                    ),
                  },
                  // 一行、放不下省略号，悬停看全（11-04 用户：「一行显示不下的用... 但是悬浮要做好」）
                  { title: "内容", dataIndex: "summary", ellipsis: true, render: (v: string) => <span title={v}>{v}</span> },
                ]}
              />
    </>
  );
}
