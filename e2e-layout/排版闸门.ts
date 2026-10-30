/**
 * 发版前必过的排版闸门（2026-10-19 团队版主动排查）。
 *
 * 10-19 客户连报的几个显示 bug（Windows 上客户详情左栏商机小行溢出卡片、时间线跟进头一行被长商机名挤到 AI 栏底下点不动、
 * 跟进记录页右上按钮被切一半、毛玻璃中栏白线）全是客户先发现的。这一份让同一类问题在 CI 里先红：
 *
 *   - 数据：e2e-layout/企业版.ts 起服务前建库灌数据，名字、长句取自 e2e-layout/种子.ts，照真客户的样子（一整句英文项目名、英国公司全大写长名、
 *     整段询盘、长网址、长中文、中英混排、一个长英文名同事挂大额项目），业务配置写长来源 / 职级 / 行业选项 + 长字段名（10-22 排版普查）
 *   - 窗口：Windows 常见的 1024 / 1280 / 1366 宽（高 680：任务栏 + 标题栏之后剩的），每个宽度三种摆法：默认、右边 AI 栏常驻、左栏拖到最宽
 *   - 页面：首页、客户列表、客户记录页（名单 + 详情）、商机列表 / 看板、订单列表 / 详情、跟进记录、计划、待跟名单、供应商、设置各页、团队页
 *     10-28 起本仓库只出企业版：闸门改到企业版服务上（e2e-layout/企业版.ts 建库灌数据，playwright.layout.config.ts 的「企业版」项目），
 *     页面按企业版左栏换成首页、客户列表、客户记录页、项目看板 / 列表 / 公海 / 详情、跟进记录 / 计划 / 待跟名单、数据、新线索、联系人、渠道、设置各页；
 *     商机、订单、供应商、桌面端 / 团队设置企业版用户进不去，不再量
 *   - 每页量（e2e/layout-audit.ts）：盒子里有东西伸出去（撑出 / 被裁，有意横滚的区域不算）、按钮链接被切一半（出界）、
 *     不折行的字冲出自己的盒子（字溢出）、可点的东西中心点上是别人（被盖住）、短字被挤成竖排（折行）、整页横滚。顶上量一次，滚到底再量一次
 *
 * 10-28 按宽度拆成三份（排版闸门-1024 / -1280 / -1366.spec.ts，每份三种摆法），CI 好把它们摊到不同片上；
 * 单跑哪一份都行。用例本身在这里，三份 spec 只是调用。
 *
 *   npx playwright test -c playwright.layout.config.ts               # 有问题就红，失败说明里列出每一条
 *   npx playwright test -c playwright.layout.config.ts 排版闸门-1280     # 只跑一个宽度
 *   TEAM_QA_REPORT=1 E2E_SHOT_DIR=… npx playwright test -c playwright.layout.config.ts   # 只记：JSON + 有问题那屏截图，不判红
 *
 * 不许为了变绿放宽检查：真有意横滚的区域在页面上就是 overflow-x: auto，检查自己会跳过；被误伤的先查是不是真问题
 */
import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { 查排版, 说问题, type 排版问题 } from "../e2e/layout-audit";
import { 企业版进门, 企业版种子 } from "./企业版";
import 现存问题清单 from "./现存问题.json";

const 只记 = process.env.TEAM_QA_REPORT === "1";
const 出处 = process.env.E2E_SHOT_DIR ? path.join(process.env.E2E_SHOT_DIR, "闸门") : null;

/*
  现存问题清单（e2e-layout/现存问题.json）：第一次跑出来、在别的会话负责的文件里（10-19 时是 #39 外贸功能会话的客户记录页、商机列表、跟进记录）的问题。
  不是放宽：清单里的每一条照样量、照样记进报告；清单外**新**冒出来的任何一条都判红。
  清单里的修好了（一整轮都没再出现）会在输出里提示「可以从清单删掉」——删掉之后它再回来就红。
  键 = 页面 | 类 | 位置最后两层；不含宽度和像素数，同一处问题在哪个宽度出现都算同一条
*/
// 标上类型：清单删空（[]）时 JSON 推出来是 never[]，下面取 .键 会编译不过
const 现存问题: { 键: string; 归属: string; 在哪几组: string[] }[] = 现存问题清单;
const 已知 = new Map(现存问题.map((x) => [x.键, x.归属]));
const 键 = (页: string, x: 排版问题) => `${页} | ${x.类} | ${x.在哪.split(" > ").slice(-2).join(" > ")}`;

/** 三份 spec 各管一个宽度；playwright.layout.config.ts 的分片表按文件名认 */
export const 宽们 = [1024, 1280, 1366] as const;
const 摆法们 = ["默认", "AI栏常驻", "左栏最宽"] as const;
type 摆法 = (typeof 摆法们)[number];

/** 存：进页前写进 localStorage 的偏好（项目页看板 / 列表两种看法共用一个地址）。项目 id 是起服务前建库时才定的，到用例里再取 */
const 页们 = (种子 = 企业版种子()): { 名: string; 址: string; 存?: Record<string, string> }[] => [
  { 名: "首页", 址: "/" },
  { 名: "客户列表", 址: "/customers" },
  { 名: "客户记录页", 址: "/customers/gate-scandi" },
  { 名: "客户记录页-长英文名", 址: "/customers/gate-long-uk" },
  { 名: "客户记录页-无空格名", 址: "/customers/gate-nospace" },
  { 名: "项目看板", 址: "/projects", 存: { "projects-view": JSON.stringify("看板") } },
  { 名: "项目列表", 址: "/projects", 存: { "projects-view": JSON.stringify("列表") } },
  // 看板 / 列表这个偏好三处共用（项目、公海、新线索），不写就接着上一页的，这里写死成默认的看板
  { 名: "项目公海", 址: "/projects?pool=1", 存: { "projects-view": JSON.stringify("看板") } },
  { 名: "项目详情", 址: `/projects/${种子.项目}` },
  { 名: "跟进记录", 址: "/follow-ups" },
  { 名: "计划", 址: "/follow-ups/plans" },
  { 名: "待跟名单", 址: "/follow-ups/watchlist" },
  { 名: "数据", 址: "/overview" },
  // 企业版的新线索 = 线索阶段的项目（leads/page.tsx 画的是 ProjectsView），不是老线索表
  { 名: "新线索", 址: "/leads", 存: { "projects-view": JSON.stringify("看板") } },
  { 名: "联系人", 址: "/contacts" },
  { 名: "渠道", 址: "/channels" },
  { 名: "设置-团队成员", 址: "/settings?tab=members" },
  { 名: "设置-业务配置", 址: "/settings?tab=business" },
  { 名: "设置-AI", 址: "/settings?tab=ai" },
  { 名: "设置-组织架构", 址: "/settings?tab=org" },
  { 名: "设置-项目模式", 址: "/settings?tab=project" },
  // 10-22 排版普查 #13：导入记录定宽列加起来超过设置页正文，空表就横滚
  { 名: "设置-导入记录", 址: "/settings?tab=imports" },
  { 名: "设置-企业版导入", 址: "/settings?tab=enterprise" },
];

/** antd 的提示、通知是浮在最上面一会儿就走的；水合时 Next 的开发提示也不算 */
const 忽略 = [".ant-message", ".ant-notification", "nextjs-portal"];

/** 「已更新到 …」那个弹窗盖在页面上会把量出来的东西全搅乱，出现就点「知道了」关掉（等 = 0 时只看一眼不等） */
export async function 关掉弹窗(page: Page, 等 = 0) {
  const 弹窗 = page.getByRole("dialog", { name: /已更新到/ });
  if (await 弹窗.waitFor({ state: "visible", timeout: 等 || 1 }).then(() => true, () => false)) {
    await 弹窗.getByRole("button", { name: /知\s*道\s*了/ }).click();
    await expect(弹窗).toBeHidden();
  }
}

/** 新库第一次进主界面会在页面出来之后自己弹「已更新到 …」：等一下，弹了就关（点过一次服务端记住，后面不再弹） */
async function 去(page: Page, 址: string, 摆: 摆法, 存?: Record<string, string>) {
  if (存) {
    await page.evaluate((kv) => {
      try {
        for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v);
      } catch { /* 存不下就是默认 */ }
    }, 存);
  }
  await page.goto(址);
  // networkidle 最多等 5 秒：（当年的）订单详情页在 CI 上一直等不到（10-19 #40 第一次跑卡了 583 秒），落定靠下面那 500ms
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
  await 关掉弹窗(page);
  // 首页（/ → /dashboard）本身就是宽模式的 AI 对话，那里没有右栏（AiDock 在 /dashboard 不画）
  if (摆 === "AI栏常驻" && !new URL(page.url()).pathname.startsWith("/dashboard")) {
    // 不到 1600 宽默认收着；用户「保持常驻」时是 ⌘J / Ctrl+J 打开的
    const 栏 = page.getByRole("complementary", { name: "AI 面板" });
    if (!(await 栏.isVisible().catch(() => false))) await page.keyboard.press("Control+j");
    await expect(栏).toBeVisible();
  }
  // 动画、图表、骨架屏落定
  await page.waitForTimeout(500);
}

async function 滚到(page: Page, 比例: number) {
  await page.evaluate((f) => {
    for (const e of document.querySelectorAll<HTMLElement>("*")) {
      const oy = getComputedStyle(e).overflowY;
      if ((oy === "auto" || oy === "scroll") && e.scrollHeight > e.clientHeight + 1) e.scrollTop = (e.scrollHeight - e.clientHeight) * f;
    }
    window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * f);
  }, 比例);
  await page.waitForTimeout(200);
}

/** 一个宽度的三组（默认 / AI栏常驻 / 左栏最宽）连同收尾；在 spec 文件顶层调用 */
export function 排版闸门(宽: (typeof 宽们)[number]) {
  test.describe.configure({ mode: "serial" });

  const 记录: { 宽: number; 摆法: string; 屏: string; 问题: 排版问题[] }[] = [];
  // 状态放在函数里：同一个 worker 里几份 spec 共用这个模块，放外面会串
  const 见过的已知 = new Set<string>();

  // 数据在企业版服务起之前就灌好了（e2e-layout/企业版.ts，库只给闸门用、每轮重建），这里不用灌也不用删
  test.afterAll(async () => {
    // 只看清单里标了在这个宽度出现过的条目；单跑某一组时别的组才有的问题本来就看不到，三个宽度九组都跑完再信这份名单
    const 好了 = 现存问题.filter((x) => x.在哪几组.some((g) => g.startsWith(`${宽} `)) && !见过的已知.has(x.键)).map((x) => x.键);
    if (好了.length) console.log(`\n排版闸门 ${宽} 宽：现存问题清单里这 ${好了.length} 条这一轮没再出现，整轮确认修好后从 e2e-layout/现存问题.json 删掉：\n${好了.map((k) => `  - ${k}`).join("\n")}`);
    if (出处) { mkdirSync(出处, { recursive: true }); writeFileSync(path.join(出处, `闸门排版问题-${宽}.json`), JSON.stringify(记录, null, 2)); }
  });

  for (const 摆 of 摆法们) {
    test(`${宽} 宽 · ${摆}：主要页面不撑破、不被切、不被盖住`, async ({ page }) => {
      test.setTimeout(10 * 60_000);
      await page.setViewportSize({ width: 宽, height: 680 });
      await 企业版进门(page);
      await page.evaluate((m) => {
        try {
          localStorage.setItem("rail-w", m === "左栏最宽" ? "360" : "220");
          localStorage.setItem("dock-w", "380");
        } catch { /* 存不下就是默认 */ }
      }, 摆);
      const 这一组: string[] = [];
      for (const p of 页们()) {
        await 去(page, p.址, 摆, p.存);
        for (const [比例, 段] of [[0, "顶"], [1, "底"]] as const) {
          await 滚到(page, 比例);
          const 问题 = await 查排版(page, { 忽略 });
          if (!问题.length) continue;
          const 屏 = `${p.名}-${段}`;
          记录.push({ 宽, 摆法: 摆, 屏, 问题 });
          for (const x of 问题) if (已知.has(键(p.名, x))) 见过的已知.add(键(p.名, x));
          const 新的 = 问题.filter((x) => !已知.has(键(p.名, x)));
          if (新的.length) 这一组.push(`「${屏}」\n${说问题(新的)}`);
          if (出处) { mkdirSync(出处, { recursive: true }); await page.screenshot({ path: path.join(出处, `${宽}-${摆}-${屏}.png`) }); }
        }
      }
      if (!只记) expect(这一组, `${宽} 宽 · ${摆}：\n${这一组.join("\n\n")}`).toEqual([]);
    });
  }
}
