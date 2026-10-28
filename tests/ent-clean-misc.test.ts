/**
 * 企业版去桌面端遗留（2026-10-28，A2 / B1 / B3 / B5 / B6）：
 *   - A2 记跟进：客户有在推项目时「关联项目」必选、不能清空；一个都没有时照旧能记，只提示先建项目
 *   - B1 渠道页：企业版只留渠道清单，藏掉转介绍雷达、推荐链三列、副标题「外部推荐来源与转介绍」
 *   - B3 「起草转介绍邀请」：企业版和外贸一样不摆（首页 AI 回答里的客户行、记录页 AI 面板、设置 → AI 说明）
 *   - B5 隐私页：企业版写 简报名()，不写「客户简报」
 *   - B6 客户侧栏来源：企业版只认渠道名，没有就留空，不回落成「转介绍」
 * 都挂在 企业版() 后面；开关关着时文案、行为一字不变。界面部分读源码断言。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { readFile } from "node:fs/promises";

const 读 = (p: string) => readFile(p, "utf8");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("开关本身", () => {
  it("开着：企业版() 为真，简报名() 是「智能总结」", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "1");
    const { 企业版 } = await import("@/lib/enterprise/switch");
    const { 简报名 } = await import("@/lib/ai-usage");
    expect(企业版()).toBe(true);
    expect(简报名()).toBe("智能总结");
  });

  it("关着：企业版() 为假，简报名() 是「简报」", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    const { 企业版 } = await import("@/lib/enterprise/switch");
    const { 简报名 } = await import("@/lib/ai-usage");
    expect(企业版()).toBe(false);
    expect(简报名()).toBe("简报");
  });
});

describe("A2 记跟进的关联项目", () => {
  it("有在推项目：必选、不能清空；没有：照旧能记，提示先建项目", async () => {
    const s = await 读("src/app/(app)/customers/[id]/FollowUpForm.tsx");
    expect(s).toMatch(/projects\.length > 0 \?/);
    expect(s).toContain('rules={[{ required: true, message: "请选择关联项目" }]}');
    expect(s).toContain('extra="没挂项目，建议先建项目"');
    // 关联项目那格不再能清空、不再有「不挂项目」
    expect(s).not.toContain('placeholder="不挂项目"');
    const 段 = s.slice(s.indexOf('name="projectId"'), s.indexOf('extra="没挂项目'));
    expect(段).not.toContain("allowClear");
    // 没项目时照旧存空
    expect(s).toContain("projectId: v.projectId ?? null");
  });

  it("开关关着：projects 只在企业版只用项目时才非空（记录页传 null 时不渲染这一格）", async () => {
    const s = await 读("src/app/(app)/customers/[id]/FollowUpForm.tsx");
    expect(s).toContain("{projects ? !record?.id && (");
    expect(s).toContain("projects = null,");
  });
});

describe("B1 渠道页", () => {
  it("页面：企业版不算转介绍雷达，把开关传给 ChannelsView", async () => {
    const s = await 读("src/app/(app)/channels/page.tsx");
    expect(s).toContain('import { 企业版 } from "@/lib/enterprise/switch";');
    expect(s).toMatch(/const radar = 企业 \? \{ topReferrers: \[\], inviteCandidates: \[\] \} : buildReferralRadar\(/);
    expect(s).toContain("企业版={企业}");
  });

  it("开着：藏推荐链三列、雷达、副标题，空态只讲渠道清单", async () => {
    const s = await 读("src/app/(app)/channels/ChannelsView.tsx");
    expect(s).toContain("企业版 = false,");
    expect(s).toContain("...(企业版 ? [] : 推荐链列)");
    const 推荐链 = s.slice(s.indexOf("const 推荐链列"), s.indexOf("const 列表"));
    for (const k of ['key: "directCount"', 'key: "chainCount"', 'key: "chainAmount"']) expect(推荐链).toContain(k);
    // 列表本身不再直接写这三列
    const 列表 = s.slice(s.indexOf("const 列表"));
    expect(列表).not.toContain('key: "directCount"');
    expect(s).toContain('subtitle={企业版 ? undefined : "外部推荐来源与转介绍"}');
    expect(s).toMatch(/\{!企业版 && \(radar\.topReferrers\.length > 0/);
    expect(s).toContain("在这里维护渠道清单，新建${b.customer}时从清单里选；不再用的渠道停用即可。");
  });

  it("关着：原来的副标题、空态说明、负责人提示原样还在", async () => {
    const s = await 读("src/app/(app)/channels/ChannelsView.tsx");
    expect(s).toContain('"外部推荐来源与转介绍"');
    expect(s).toContain("渠道负责人定了之后，这条线上进来的${b.customer}业绩自动归他；转介绍带来的下游也算在这条链上。");
    expect(s).toContain("之后由该渠道新增的${b.customer}及其下游转介绍归此人；已有${b.customer}的归属不变，个别要改的到其档案里单独改");
  });
});

describe("B3 起草转介绍邀请", () => {
  it("首页 AI 回答的客户行：外贸、企业版都不摆", async () => {
    const s = await 读("src/app/(app)/dashboard/TurnView.tsx");
    expect(s).toContain("{已签 && !外贸精简(b) && !企业版 && (");
    expect(s).toContain("企业版 = false,");
  });

  it("开关一路传下去：layout → AppShell → AiDock → HomeChat → TurnLog → TurnView", async () => {
    expect(await 读("src/app/(app)/layout.tsx")).toContain("企业版={企业版()}");
    expect(await 读("src/components/AppShell.tsx")).toContain("企业版={企业版}");
    expect(await 读("src/components/AiDock.tsx")).toMatch(/<HomeChat[\s\S]*?企业版=\{企业版\}/);
    expect(await 读("src/app/(app)/dashboard/HomeChat.tsx")).toMatch(/<TurnLog[\s\S]*?企业版=\{企业版\}/);
    expect(await 读("src/app/(app)/dashboard/TurnLog.tsx")).toMatch(/<TurnView[\s\S]*?企业版=\{企业版\}/);
    // 首页那条原本就传
    expect(await 读("src/app/(app)/dashboard/page.tsx")).toContain("企业版={企业版()}");
  });

  it("记录页 AI 面板：企业版菜单和结果里都没有邀请；没传开关时按「智能总结」认", async () => {
    const s = await 读("src/app/(app)/customers/[id]/AiPanel.tsx");
    expect(s).toContain('const 企业 = 企业版 ?? 简报叫 === "智能总结";');
    expect(s).toContain("const 能邀转介绍 = signed && !企业;");
    expect(s).toContain('...(能邀转介绍 ? [{ key: "invite"');
    expect(s).toMatch(/\.\.\.\(企业 \? \[\] : \[\{ kind: "invite" as const/);
    // 开关关着：记录页传的一定是默认「简报」→ 企业 为假，签约客户照旧有邀请
    expect(s).toContain('简报叫 = "简报",');
  });

  it("设置 → AI：企业版说明不列转介绍；开关关着原文一字不变", async () => {
    const s = await 读("src/app/(app)/settings/AiSettingsTab.tsx");
    expect(s).toContain('"选一家、填一个 Key 并保存，跟进速记、智能总结、问数据、盯盘话术四个功能会立刻出现。其余功能不受影响。"');
    expect(s).toContain('"选一家、填一个 Key 并保存，跟进速记、临战简报、问数据、盯盘话术、转介绍邀请五个功能会立刻出现。其余功能不受影响。"');
    expect(s).toContain('usage.filter((u) => !(企业版 && u.feature === "invite" && u.count === 0))');
  });
});

/* B5 隐私页不改：企业版 /privacy 跳登录页，且它是构建期静态页、读不到运行时开关；为一个看不到的词把 prisma 拉进静态页不值 */
describe("B5 隐私页", () => {
  it("不引 ai-usage（会连带 prisma 进静态页）", async () => {
    const s = await 读("src/app/privacy/page.tsx");
    expect(s).not.toContain("@/lib/ai-usage");
  });
});

describe("B6 客户侧栏来源", () => {
  it("企业版只认渠道名、不回落；关着照旧 渠道 > 转介绍 > 跟进方式", async () => {
    const s = await 读("src/app/(app)/@pane/panes.tsx");
    expect(s).toContain("const 企业 = 企业版();");
    expect(s).toContain(
      'source: 企业 ? c.channel?.name ?? null : c.channel?.name ?? (c.referrerCustomerId ? "转介绍" : c.followUps[0] ? (FOLLOW_TYPE_MAP[c.followUps[0].type]?.label ?? null) : null),',
    );
  });
});
