/**
 * 附件区「也可以直接粘贴截图」那句提示（11-17，lib/paste-upload.ts）不撑宽：
 *   项目页右栏「项目附件」每格（.att-compact：上传按钮 + 灰字）、沟通行上的「加截图 / 录音」（.follow-att-add）
 * 按 Windows 1024 / 1280 / 1366 量，右栏 320px（窄时 280px），灰字折行、不出框、不横滚。只钉样式（globals.css），结构照组件现有 class 摆。
 */
import { beforeAll, afterAll, expect, it } from "vitest";
import path from "node:path";
import { chromium, type Browser } from "playwright";

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); }, 120_000);
afterAll(async () => { await browser?.close(); });

const 格 = (名: string) => `<section class="proj-att-sec" data-paste-scope><div class="proj-att-h">${名}（0）</div>
  <div class="att-panel" data-paste-upload><div class="att-compact"><span class="ant-upload"><button style="width:72px;height:24px">上传</button></span>
  <span class="muted">单个最多 20 MB；也可以直接粘贴截图</span></div></div></section>`;
const 页 = `<meta charset='utf-8'><style>body{margin:0;font-family:"Microsoft YaHei","PingFang SC",sans-serif;font-size:14px}</style>
<main style="padding:24px;margin-left:220px;container-type:inline-size;box-sizing:border-box;width:calc(100vw - 220px)">
  <div class="proj-2col">
    <div class="proj-main"><div class="proj-follow-row" data-paste-scope><div class="follow-att" data-paste-upload>
      <div class="follow-att-add"><button style="width:110px;height:24px">加截图 / 录音</button><span class="muted follow-att-tip">也可以直接粘贴截图</span></div>
    </div></div></div>
    <div class="proj-side"><div class="proj-att-card" style="padding:16px 24px;border:1px solid #ddd">${["合同附件", "项目方案", "验收报告", "其它附件"].map(格).join("")}</div></div>
  </div>
</main>`;

for (const width of [1024, 1280, 1366]) {
  it(`${width} 宽：提示文案不溢出、不横滚`, async () => {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    page.setDefaultTimeout(5000);
    await page.route("http://ent.test/**", (r) => r.fulfill({ contentType: "text/html", body: 页 }));
    await page.goto("http://ent.test/projects/x");
    await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
    const 量 = await page.evaluate(() => {
      const 出框 = (内: Element, 外: Element) => { const a = 内.getBoundingClientRect(), b = 外.getBoundingClientRect(); return a.left < b.left - 0.5 || a.right > b.right + 0.5; };
      const 提示们 = [...document.querySelectorAll(".att-compact > .muted, .follow-att-tip")];
      return {
        个数: 提示们.length,
        出框: 提示们.filter((x) => 出框(x, x.closest(".proj-att-card, .proj-follow-row")!)).length,
        横滚: [...document.querySelectorAll(".proj-att-card, .proj-att-sec, .att-compact, .follow-att-add")].filter((x) => x.scrollWidth > x.clientWidth + 1).length,
        页横滚: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        // 每格灰字最后一个字确实在格里能看见（不被遮、不被截）
        看得见: 提示们.every((x) => { const rs = x.getClientRects(); const r = rs[rs.length - 1]; const el = document.elementFromPoint(r.right - 3, r.bottom - 4); return !!el && x.contains(el); }),
      };
    });
    expect(量.个数).toBe(5);
    expect(量.出框).toBe(0);
    expect(量.横滚).toBe(0);
    expect(量.页横滚).toBe(false);
    expect(量.看得见).toBe(true);
    await page.close();
  });
}
