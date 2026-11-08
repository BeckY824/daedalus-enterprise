import { afterAll, beforeAll, expect, it } from "vitest";
import { build, type Plugin } from "esbuild";
import path from "node:path";
import { readFileSync } from "node:fs";
import { chromium, type Browser } from "playwright";
/* 10-30 用户：「目前渠道页有些都没显示完整。要显示完整。做好排版。其他页面也是一样。」
   11-01 用户：「渠道第一列，把名字和公域引流这个分开显示。也就是拆分为两列。然后所有列都要一行显示。」
   渠道名一列、渠道属性一列；每一格都一行不折。名字列宽按最长的名字估，放得下就整段显示；超过上限才省略、悬停（title）看全称。
   1024 / 1280 / 1366 三个宽度都量；渲染的是真的 ChannelsView + globals.css，只把服务端动作和抽屉换掉 */
let browser: Browser, bundle: string;
const 长名 = "Facebook｜VR STAR SPACE 某某某超长渠道名测试测试测试";
const 无空格名 = "视频号|星际空间InterstellarSpaceOfficialChannel超长渠道名测试测试测试";
const plugin: Plugin = { name: "fulltext-boundaries", setup(b) {
  const stub = (filter: RegExp, code: string) => b.onResolve({ filter }, a => ({ path: a.path, namespace: "fixture", pluginData: code }));
  stub(/^next\/navigation$/, "export const useRouter=()=>({refresh(){},push(){},prefetch(){}});export const usePathname=()=>\"/channels\";export const useSearchParams=()=>new URLSearchParams();");
  stub(/^next\/link$/, "export default function L(p){return <a {...p}/>}");
  stub(/^\.\/actions$/, "export const saveChannel=async()=>({ok:false}),toggleChannel=saveChannel,deleteChannel=saveChannel,saveMainChannel=saveChannel,toggleMainChannel=saveChannel;");
  stub(/^@\/app\/\(app\)\/demo-data$/, "export const 查演示数据状态=async()=>({可灌:false,可清:false}),灌一套演示数据=async()=>({ok:true}),清除演示数据=灌一套演示数据;");
  stub(/^\.\/ChannelDrawer$/, "export default function D(){return null}");
  b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: a.pluginData, loader: "jsx", resolveDir: process.cwd() }));
} };
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import ChannelsView from '@/app/(app)/channels/ChannelsView';import {BusinessProvider} from '@/lib/business-client';import {DEFAULT_BUSINESS} from '@/lib/business-config';
    import {我Provider} from '@/lib/me-client';import {themeConfig} from '@/lib/theme';import ChannelPicker from '@/components/ChannelPicker';
    const root=createRoot(document.getElementById('root'));
    const 行=(id,name,attr,active)=>({id,name,phone:null,remark:'备注',active,attr,platform:null,endDate:null,createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z',createdByName:'QA',channelOwnerId:'qa',channelOwnerName:'QA'});
    const rows=[行('c1',${JSON.stringify(长名)},'公域引流',true),行('c2',${JSON.stringify(无空格名)},'个人自拓',false),行('c3','短名','公域引流',true)];
    window.__render=()=>root.render(<ConfigProvider locale={zhCN} theme={themeConfig}><App><BusinessProvider value={DEFAULT_BUSINESS}><我Provider value={{id:'qa',name:'QA'}}><ChannelsView rows={rows} users={[{id:'qa',name:'QA'}]} 属性选项={['公域引流','个人自拓']}/></我Provider></BusinessProvider></App></ConfigProvider>);
    // 选渠道的级联：属性 / 名称 / 来源三列，放在 1024 宽的弹窗那么宽的格子里
    window.__picker=()=>root.render(<ConfigProvider locale={zhCN}><div style={{width:472,margin:'420px 0 0 276px'}}><ChannelPicker aria-label='渠道' channels={[{id:'c1',name:${JSON.stringify(长名)},attr:'公域引流',platform:'Facebook',active:true},{id:'c2',name:${JSON.stringify(无空格名)},attr:'个人自拓',platform:null,active:true}]}/></div></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin], logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

for (const width of [1024, 1280, 1366]) {
  it(`渠道名、渠道属性分两列，每格一行；名字放得下就整段、放不下省略带全称；标签点得中（${width} 宽）`, async () => {
    const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
    try {
      await page.route("http://fulltext.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
      await page.goto("http://fulltext.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
      await page.evaluate(() => (window as unknown as { __render: () => void }).__render());
      await page.locator(".chan-name").nth(2).waitFor();
      const 量 = await page.evaluate(() => {
        const 表头 = [...document.querySelectorAll<HTMLElement>(".chan-list .ant-table-thead th")].map((th) => th.textContent ?? "");
        const 行们 = [...document.querySelectorAll<HTMLElement>(".chan-list .ant-table-tbody > tr:not(.ant-table-placeholder):not(.ant-table-measure-row)")];
        // 每一格都一行：格高不超过一行字 + 上下留白（量最高的那格，和同一行别的格比）
        const 格们 = 行们.flatMap((tr) => [...tr.querySelectorAll<HTMLElement>(":scope > td")]);
        const 折行格 = 格们.filter((td) => getComputedStyle(td).whiteSpace !== "nowrap").map((td) => td.textContent);
        const 行高 = 行们.map((tr) => tr.getBoundingClientRect().height);
        const 名们 = [...document.querySelectorAll<HTMLElement>(".chan-name")].map((名) => {
          const cs = getComputedStyle(名); const r = 名.getBoundingClientRect();
          const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
          const td = 名.closest("td")!; const tr = td.getBoundingClientRect();
          return {
            文: 名.textContent, 全称: 名.title, 行数: Math.round(r.height / lh),
            截了: 名.scrollWidth > 名.clientWidth + 1,
            省略: cs.textOverflow === "ellipsis" && cs.whiteSpace === "nowrap",
            在格里: r.right <= tr.right - parseFloat(getComputedStyle(td).paddingRight) + 0.5,
          };
        });
        const 属性格 = [...document.querySelectorAll<HTMLElement>(".chan-list td.dl-col-attr")].map((td) => {
          const t = td.getBoundingClientRect();
          return [...td.querySelectorAll<HTMLElement>(".ant-tag")].map((tag) => {
            const r = tag.getBoundingClientRect();
            const 中 = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return { 字: tag.textContent, 顶: Math.round(r.top), 在格里: r.left >= t.left - 0.5 && r.right <= t.right + 0.5, 点中: !!中 && tag.contains(中) };
          });
        });
        const 表 = document.querySelector<HTMLElement>(".chan-list .ant-table-content, .chan-list .ant-table-body");
        return { 表头, 折行格, 行高, 名们, 属性格, 表横滚: 表 ? 表.scrollWidth > 表.clientWidth : false,
          页横滚: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          表头折行: [...document.querySelectorAll<HTMLElement>(".chan-list .ant-table-thead th")].filter((th) => getComputedStyle(th).whiteSpace !== "nowrap").map((th) => th.textContent) };
      });
      // 两列：「渠道」「渠道属性」挨着
      const i = 量.表头.indexOf("渠道");
      expect(i).toBeGreaterThanOrEqual(0);
      expect(量.表头[i + 1]).toBe("渠道属性");
      expect(量.名们.map((x) => x.文)).toEqual([长名, 无空格名, "短名"]);
      // 所有格、表头都不折行，每一行一样高（只有一行字）
      expect(量.折行格).toEqual([]);
      expect(量.表头折行).toEqual([]);
      for (const h of 量.行高) expect(Math.abs(h - 量.行高[0])).toBeLessThan(1);
      for (const x of 量.名们) {
        expect(x.行数, x.文!).toBe(1);
        expect(x.省略, x.文!).toBe(true);
        expect(x.全称, x.文!).toBe(x.文);
        expect(x.在格里, x.文!).toBe(true);
      }
      // 名字列宽按最长的名字估：短名、长名放得下整段；最长的无空格名超了上限才省略
      expect(量.名们[0].截了).toBe(false);
      expect(量.名们[2].截了).toBe(false);
      // 属性标签在自己那一列，「个人自拓 + 已停用」并排一行、都在格里、点得中
      expect(量.属性格.map((ts) => ts.map((t) => t.字))).toEqual([["公域引流"], ["个人自拓", "已停用"], ["公域引流"]]);
      for (const ts of 量.属性格) for (const t of ts) {
        expect(t.在格里, t.字!).toBe(true);
        expect(t.点中, t.字!).toBe(true);
        expect(t.顶).toBe(ts[0].顶);
      }
      // 整页不横滚（列多了表格自己横滚）
      expect(量.页横滚).toBe(false);
      console.log(`[${width}] 名字截了：${量.名们.map((x) => x.截了).join("/")}，表格横滚：${量.表横滚}`);
    } finally { await page.close(); }
  });
}

/* 选渠道的级联（ChannelPicker）原来每列最宽 400，三列并排比 1024 屏还宽，弹层被推出左边。
   11-04 用户：「一行显示不下的用... 但是悬浮要做好」——长来源一行省略（格子 title 有全称），10-30 的折行作废 */
for (const width of [1024, 1366]) {
  it(`选渠道的级联：长来源一行省略、带全称、三列都在屏幕里（${width} 宽）`, async () => {
    const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
    try {
      await page.route("http://fulltext.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
      await page.goto("http://fulltext.test"); await page.addScriptTag({ content: bundle });
      await page.evaluate(() => (window as unknown as { __picker: () => void }).__picker());
      await page.getByRole("combobox", { name: "渠道" }).click();
      const 列 = (k: number) => page.locator(".chan-picker-pop .ant-cascader-menu").nth(k).locator(".ant-cascader-menu-item");
      await 列(0).filter({ hasText: "公域引流" }).hover();
      await 列(1).first().hover();
      await 列(2).first().waitFor();
      // globals.css 放到 antd 运行时样式前面（和应用里一样，同样重的选择器 antd 赢）：只靠先后顺序压不过的写法这里会红
      await page.evaluate((css) => { const s = document.createElement("style"); s.textContent = css; document.head.prepend(s); }, readFileSync(path.resolve("src/app/globals.css"), "utf8"));
      await page.waitForTimeout(100);
      const 量 = await page.evaluate(() => {
        const 格们 = [...document.querySelectorAll<HTMLElement>(".chan-picker-pop .ant-cascader-menu-item-content")];
        const 长 = 格们.filter((e) => (e.textContent ?? "").length > 20);
        const pop = document.querySelector(".chan-picker-pop")!.getBoundingClientRect();
        return {
          长: 长.map((e) => {
            const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
            const 中 = document.elementFromPoint(r.left + 10, r.top + r.height / 2);
            return { 文: e.textContent, 题: e.closest("[title]")?.getAttribute("title") ?? "", 省略: cs.textOverflow === "ellipsis" && cs.whiteSpace === "nowrap", 溢出: e.scrollWidth > e.clientWidth + 1, 折行: r.height > parseFloat(cs.lineHeight) * 1.5, 点中: !!中 && e.contains(中) };
          }),
          左: pop.left, 右: pop.right,
        };
      });
      expect(量.长.length).toBeGreaterThan(0);
      for (const x of 量.长) {
        expect(x.省略, x.文!).toBe(true);
        expect(x.折行, x.文!).toBe(false);
        if (x.溢出) expect(x.题, x.文!).toBe(x.文);
        expect(x.点中, x.文!).toBe(true);
      }
      expect(量.左).toBeGreaterThanOrEqual(0);
      expect(量.右).toBeLessThanOrEqual(width);
    } finally { await page.close(); }
  });
}
