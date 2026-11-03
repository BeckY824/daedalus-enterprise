/**
 * 项目详情顶上的醒目提醒：同号再次录入（lib/enterprise/same-number-collab.ts）。
 * 沟通列表按接手前等规矩会收起组员写的记录，这条独立摆，负责人一进来就看得见谁、何时、什么来源；来源不同的标重点。
 */
import { 同号提醒们 } from "@/lib/enterprise/same-number-collab";
import { fmtDateTime } from "@/lib/utils";

export default async function SameNumberBanner({ projectId }: { projectId: string }) {
  const 们 = await 同号提醒们(projectId);
  if (!们.length) return null;
  const 有重点 = 们.some((x) => x.重点);
  const 色 = 有重点 ? "var(--color-danger, #cf1322)" : "var(--color-warning, #d48806)";
  return (
    <div role="status" aria-label="同号再次录入提醒" style={{ margin: "0 0 12px", padding: "10px 14px", borderRadius: 8, border: `1px solid ${色}`, background: "var(--bg-elevated, transparent)" }}>
      <div style={{ fontWeight: 600, color: 色 }}>{有重点 ? "同号再次录入 · 来源不同，重点关注" : "同号再次录入"}</div>
      {们.map((x) => (
        <div key={x.id} style={{ marginTop: 4, fontSize: 13, overflowWrap: "anywhere" }}>
          <span style={{ color: "var(--text-muted)" }}>{fmtDateTime(x.何时)}</span> {x.摘要.replace(/^同号再次录入：/, "")}
        </div>
      ))}
    </div>
  );
}
