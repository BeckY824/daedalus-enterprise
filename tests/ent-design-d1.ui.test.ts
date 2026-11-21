import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import path from "node:path";
import { chromium, type Browser } from "playwright";
/* D1 · 设计语言 11-21（客户详情规范，用户 11-21 定全站照走）：全站 token 和基础控件在真浏览器里量一遍。
   - 输入框、搜索框：白底 + --field-line；悬停 --field-line-hover；聚焦 --brand + --focus-ring；报错 --danger（D17）
   - 复选框、单选框的框 --ctl-line，对白、压行悬停灰、压选中浅蓝都 ≥3:1（D17）
   - 空值「—」一律 --empty-fg（D02）
   - 标签「其余一律灰」真的生效：蓝紫青金和客户状态默认色都落成 --tag-bg（D10：原来和 antd 预设色权重打平、antd 赢）
   - 1024 / 1280 / 1366 / 390 宽：超长公司名不撑出横向滚动
   用真的 lib/theme.ts（ConfigProvider）+ globals.css，antd 样式照线上那样在 globals.css 之后注入 */
let browser: Browser, bundle: string;
const 长名 = "某某超长贸易进出口有限公司".repeat(6);

beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {App,ConfigProvider,Input,Select,Checkbox,Radio,Tag,Table} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import {themeConfig} from '@/lib/theme';import {客户状态色} from '@/lib/enterprise/cust-status-color';
    const 长=${JSON.stringify(长名)};
    const 状态=['潜在','意向','成交','交付','复购','忠诚','丢单','流失','异常'].map((n,i)=>({n,c:客户状态色({id:'dict-custStatus-'+i,name:n})}));
    const root=createRoot(document.getElementById('root'));
    root.render(<ConfigProvider locale={zhCN} theme={themeConfig}><App><main className='main app-content' style={{padding:16}}>
      <div className='rec-page'><div className='ant-card' style={{background:'var(--panel)',padding:16}}>
        <Input id='in' placeholder='搜索客户' defaultValue={长}/>
        <Input id='in2' placeholder='第二格'/>
        <Input.Search id='srch' placeholder='搜索' allowClear/>
        <Input id='bad' status='error' defaultValue='错的'/>
        <Select id='sel' style={{width:200}} options={[{value:1,label:长}]} defaultValue={1}/>
        <div id='cb'><Checkbox>未勾</Checkbox><Checkbox defaultChecked>已勾</Checkbox><Radio>单选</Radio></div>
        <div id='tags'>
          <Tag id='t-blue' color='blue'>蓝</Tag><Tag id='t-purple' color='purple'>紫</Tag><Tag id='t-cyan' color='cyan'>青</Tag><Tag id='t-gold' color='gold'>金</Tag><Tag id='t-def'>灰</Tag>
          <Tag id='t-green' color='green'>完成</Tag><Tag id='t-red' color='red'>出问题</Tag><Tag id='t-orange' color='orange'>要处理</Tag><Tag id='t-key' className='tag-key'>关键</Tag>
          <Tag id='t-long' color='blue' style={{maxWidth:'100%',overflow:'hidden',textOverflow:'ellipsis'}}>{长}</Tag>
          {状态.map(s=><Tag key={s.n} data-st={s.n} color={s.c}>{s.n}</Tag>)}
        </div>
        <div className='rec-field'><span className='rec-field-k'>官网</span> <span id='empty' className='rec-field-empty'>—</span></div>
        <Table id='tb' rowSelection={{}} rowKey='k' pagination={false} dataSource={[{k:1,n:长},{k:2,n:'短名'}]} columns={[{title:'客户',dataIndex:'n',ellipsis:true}]}/>
      </div></div>
    </main></App></ConfigProvider>);
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function open(width: number) {
  const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.route("http://design-d1.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><style>body{margin:0}</style><div id='root'></div>" }));
  await page.goto("http://design-d1.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") }); await page.addScriptTag({ content: bundle });
  await page.locator("#tb").waitFor();
  const 色 = (v: string) => page.evaluate(v => { const s = document.createElement("span"); s.style.color = `var(${v})`; document.body.append(s); const c = getComputedStyle(s).color; s.remove(); return c; }, v);
  const 底 = (v: string) => page.evaluate(v => { const s = document.createElement("span"); s.style.background = `var(${v})`; document.body.append(s); const c = getComputedStyle(s).backgroundColor; s.remove(); return c; }, v);
  const 样 = (sel: string) => page.locator(sel).first().evaluate(e => { const c = getComputedStyle(e); return { 框: c.borderTopColor, 底: c.backgroundColor, 字: c.color, 影: c.boxShadow }; });
  return { page, errors, 色, 底, 样 };
}

/** rgb(...) → 相对亮度，算 WCAG 对比度 */
const 亮 = (rgb: string) => {
  const [r, g, b] = (rgb.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map(c => c / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const 对比 = (a: string, b: string) => { const [x, y] = [亮(a), 亮(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

it("输入框：白底 + --field-line；悬停 --field-line-hover；聚焦主色框 + 光晕；报错红框（D17）", async () => {
  const { page, errors, 色, 底, 样 } = await open(1366);
  try {
    const [线, 线深, 主, 红, 白] = [await 色("--field-line"), await 色("--field-line-hover"), await 色("--brand"), await 色("--danger"), await 底("--panel")];
    expect(线).toBe("rgb(199, 199, 204)");
    const 静 = await 样("#in");
    expect(静.框).toBe(线);
    expect(静.底).toBe(白);
    // 带前后缀的搜索框：框画在外层，里面那格不再叠一层框
    const 搜 = await page.locator("#srch").evaluate(e => { const w = e.closest(".ant-input-affix-wrapper")!; return { 外: getComputedStyle(w).borderTopColor, 外底: getComputedStyle(w).backgroundColor, 里宽: getComputedStyle(e).borderTopWidth, 里框: getComputedStyle(e).borderTopColor }; });
    expect(搜.外).toBe(线);
    expect(搜.外底).toBe(白);
    expect(搜.里宽 === "0px" || 搜.里框 === "rgba(0, 0, 0, 0)").toBe(true);
    // antd 6 选择框的框画在 .ant-select 那层（#sel 是里面那格 input）
    expect(await page.locator("#sel").evaluate(e => getComputedStyle(e.closest(".ant-select")!).borderTopColor)).toBe(线);
    await page.hover("#in2");
    await page.waitForTimeout(400); // antd 输入框的框色有 0.2s 过渡，等它走完再量
    expect((await 样("#in2")).框).toBe(线深);
    expect(对比(线深, 白)).toBeGreaterThanOrEqual(3);
    await page.focus("#in2");
    await page.waitForTimeout(400);
    const 焦 = await 样("#in2");
    expect(焦.框).toBe(主);
    expect(焦.影).toContain("3px");
    expect(对比(主, 白)).toBeGreaterThanOrEqual(3);
    const 错 = await 样("#bad");
    expect(错.框).toBe(红);
    expect(对比(红, 白)).toBeGreaterThanOrEqual(3);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 60_000);

it("复选框、单选框的框 --ctl-line：对白、行悬停灰、选中浅蓝都 ≥3:1（D17）", async () => {
  const { page, errors, 色, 底 } = await open(1366);
  try {
    const 框色 = await 色("--ctl-line");
    expect(框色).toBe("rgb(134, 134, 139)");
    const 框们 = await page.locator("#cb .ant-checkbox:not(.ant-checkbox-checked), #cb .ant-radio, #tb .ant-checkbox:not(.ant-checkbox-checked)")
      .evaluateAll(es => es.map(e => getComputedStyle(e).borderTopColor));
    expect(框们.length).toBeGreaterThanOrEqual(3);
    for (const c of 框们) expect(c).toBe(框色);
    for (const v of ["--panel", "--row-hover", "--brand-bg"]) expect(对比(框色, await 底(v)), v).toBeGreaterThanOrEqual(3);
    // 勾上的照 antd 走主色实心（antd 6 没有 -inner 那层，框和底都画在 .ant-checkbox 上）
    const 勾 = await page.locator("#cb .ant-checkbox-checked").evaluate(e => getComputedStyle(e).backgroundColor);
    expect(勾).toBe(await 色("--brand"));
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 60_000);

it("标签：蓝紫青金和客户状态的默认色一律中性灰，只有完成绿 / 出问题红 / 要人处理橙 / 关键浅蓝带色（D10 权重修好）", async () => {
  const { page, errors, 色, 底 } = await open(1366);
  try {
    const [灰底, 灰字] = [await 底("--tag-bg"), await 色("--tag-fg")];
    const 取 = (sel: string) => page.locator(sel).first().evaluate(e => ({ 底: getComputedStyle(e).backgroundColor, 字: getComputedStyle(e).color, 框: getComputedStyle(e).borderTopColor }));
    for (const id of ["#t-blue", "#t-purple", "#t-cyan", "#t-gold", "#t-def"]) expect(await 取(id), id).toEqual({ 底: 灰底, 字: 灰字, 框: "rgba(0, 0, 0, 0)" });
    expect((await 取("#t-green")).底).toBe(await 底("--success-bg"));
    expect((await 取("#t-red")).底).toBe(await 底("--danger-bg"));
    expect((await 取("#t-orange")).底).toBe(await 底("--warning-bg"));
    expect((await 取("#t-key")).底).toBe(await 底("--brand-bg"));
    // 客户状态默认九项：潜在、意向这些落成灰；成交绿；丢单、异常红；流失本来就是 default 灰
    const 状态 = Object.fromEntries(await page.locator("[data-st]").evaluateAll(es => es.map(e => [e.getAttribute("data-st"), getComputedStyle(e).backgroundColor])));
    for (const n of ["潜在", "意向", "交付", "复购", "忠诚", "流失"]) expect(状态[n], n).toBe(灰底);
    expect(状态["成交"]).toBe(await 底("--success-bg"));
    expect(状态["丢单"]).toBe(await 底("--danger-bg"));
    expect(状态["异常"]).toBe(await 底("--danger-bg"));
    expect(对比(灰字, 灰底)).toBeGreaterThanOrEqual(4.5);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 60_000);

it("空值「—」一律 --empty-fg（= muted），白底 ≥4.5、页面灰底 ≥4.5（D02）", async () => {
  const { page, errors, 色, 底 } = await open(1366);
  try {
    const 空 = await page.locator("#empty").evaluate(e => getComputedStyle(e).color);
    expect(空).toBe(await 色("--empty-fg"));
    expect(空).toBe(await 色("--text-muted"));
    expect(对比(空, await 底("--panel"))).toBeGreaterThanOrEqual(4.5);
    expect(对比(空, await 底("--workbench"))).toBeGreaterThanOrEqual(4.5);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
}, 60_000);

it("1024 / 1280 / 1366 / 390：超长公司名在输入框、选择框、标签、表格里都不撑出横向滚动", async () => {
  for (const w of [1024, 1280, 1366, 390]) {
    const { page, errors } = await open(w);
    try {
      const 量 = await page.evaluate(() => ({ 页: document.documentElement.scrollWidth, 窗: window.innerWidth }));
      expect(量.页, `${w}`).toBeLessThanOrEqual(量.窗);
      // 长标签右边不越出卡片；卡片右边的那一点上还是卡片自己（没被别的东西盖）
      const 越 = await page.evaluate(() => {
        const 卡 = document.querySelector(".ant-card")!.getBoundingClientRect();
        const 签 = document.querySelector("#t-long")!.getBoundingClientRect();
        return 签.right - 卡.right;
      });
      expect(越, `${w}`).toBeLessThanOrEqual(1);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
}, 120_000);
