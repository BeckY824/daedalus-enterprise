/**
 * 页面金额框（components/AmountInput，11-20）：真浏览器里敲「5万」「12.5万」「3w」「5万5」「-500」。
 *
 * 原来是 antd InputNumber 默认 parser：「5万」悄悄存成 5、「12.5万」存成 12.5、「3w」停在 3、「-500」失焦压成 0，都没有一句提示。
 * 现在：认得出的换算成元、敲的时候框上方浮「「12.5万」= 125,000」，失焦后框里就是换算后的数；认不出的框标红，
 * 聚焦 / 悬停说为什么、失焦后占位写「认不出「…」」，交上去的是 NaN（表单校验挡住），失焦也不会被压成 0 或上一个数。
 * 375 / 1024 / 1280 / 1366：和币种下拉拼在一起（Space.Compact）提示浮在框外，敲的字不被挤、页面不横撑。
 *
 * 审查 11-20 补：
 * - 项目卡就地改的钱格（真的 ProjectInlineField + money-cell 的 钱编辑器 / 钱格存法，.proj-inline-money）：
 *   原值空着敲「约5万」回车，原来 {数: NaN} 被 JSON 当成 {数: null}、等于原值，直接收起、字丢了也没一句话；
 *   草稿把 NaN 存成 null，刷新后带回再存就把原金额清成 0
 * - 币种记号和选的币种对不上（选美元敲「5000元」）算认不出、说清楚；改了币种对上了照常认
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

let browser: Browser, bundle: string;
beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {App,Button,ConfigProvider,Form,Select,Space} from 'antd';import zhCN from 'antd/locale/zh_CN';
    import AmountInput, {金额框认不出提示, 金额框挡住话, 金额认不出} from '@/components/AmountInput';
    import ProjectInlineField from '@/app/(app)/projects/[id]/ProjectInlineField';
    import {钱编辑器, 钱格存法} from '@/app/(app)/projects/[id]/money-cell';
    import {草稿范围} from '@/components/FormDraft';
    import {金额 as 显金额} from '@/lib/currency';
    function 拼框({起}){
      const [v,setV]=useState(起??null);window.__值=v;
      return <div style={{padding:16}}><Space.Compact style={{width:'100%'}}>
        <Select style={{width:140,flexShrink:0}} value='CNY' options={[{value:'CNY',label:'人民币 CNY'}]}/>
        <AmountInput aria-label='金额' style={{width:'100%'}} min={0} max={1e12} precision={2} value={v} onChange={setV}/>
      </Space.Compact><button id='别处'>别处</button></div>;
    }
    function 表单(){
      const [f]=Form.useForm();
      return <Form form={f} style={{padding:16}} onFinish={(x)=>{window.__交=x.amount}}>
        <Form.Item label='投入金额' required><Form.Item name='amount' noStyle validateFirst rules={[{required:true,message:'请填写金额'},{validator:(_,v)=>金额认不出(v)?Promise.reject(new Error(金额框认不出提示)):Promise.resolve()},{type:'number',min:0.01,message:'金额要大于 0'}]}>
          <AmountInput aria-label='投入金额' min={0} precision={2} style={{width:'100%'}}/>
        </Form.Item></Form.Item>
        <Button htmlType='submit'>保存</Button>
      </Form>;
    }
    // 渠道投入抽屉（ChannelDrawer）那种：币种 + 金额同一个表单，校验拿 on原文 记下的原文配选的币种说话（抽屉里这句上了保存按钮；这里套个带 label 的 Form.Item 让它显示出来）
    function 币表单(){
      const [f]=Form.useForm();const 币=Form.useWatch('currency',f);const 原=React.useRef(null);
      return <Form form={f} style={{padding:16}} initialValues={{currency:'USD'}} onFinish={(x)=>{window.__交=x}}>
        <Form.Item label='投入金额' required><Space.Compact block><Form.Item name='currency' noStyle><Select aria-label='币种' style={{width:140}} options={[{value:'CNY',label:'CNY'},{value:'USD',label:'USD'},{value:'EUR',label:'EUR'}]}/></Form.Item>
        <Form.Item name='amount' noStyle validateFirst dependencies={['currency']} rules={[{required:true,message:'请填写金额'},{validator:(_,v)=>金额认不出(v)?Promise.reject(new Error(金额框挡住话(原.current,f.getFieldValue('currency')))):Promise.resolve()},{type:'number',min:0.01,message:'金额要大于 0'}]}>
          <AmountInput aria-label='投入金额' min={0} precision={2} style={{width:'100%'}} currency={币} on原文={(s)=>(原.current=s)}/>
        </Form.Item></Space.Compact></Form.Item>
        <Button htmlType='submit'>保存</Button>
      </Form>;
    }
    function 币框(){
      const [v,setV]=useState(null);const [币,set币]=useState('USD');window.__值=v;
      return <div style={{padding:16}}><Space.Compact style={{width:'100%'}}>
        <Select aria-label='币种' style={{width:140,flexShrink:0}} value={币} options={[{value:'CNY',label:'CNY'},{value:'USD',label:'USD'}]} onChange={set币}/>
        <AmountInput aria-label='金额' style={{width:'100%'}} min={0} max={1e12} precision={2} currency={币} value={v} onChange={setV}/>
      </Space.Compact><button id='换人民币' onClick={()=>set币('CNY')}>人民币</button><button id='换美元' onClick={()=>set币('USD')}>美元</button></div>;
    }
    // 项目卡就地改的金额格：和 ProjectDetail 同一套（ProjectInlineField + 钱编辑器 + 钱格存法），存项目项 换成记下交了什么
    window.__就地交=[];
    const 存=钱格存法(async(patch)=>{window.__就地交.push(patch);return null;});
    function 就地({起}){
      const [值,set值]=useState(起);
      return <div style={{padding:16}}><div style={{display:'flex',gap:12,alignItems:'center',width:280,minWidth:0}}>
        <span style={{flex:'0 0 4.3em'}}>金额</span>
        <ProjectInlineField 名='金额' 值={值} 能改 回车存 显示={(x)=>x.数?显金额(x.数,x.币):'待填写'} 存={async(x)=>{const r=await 存('金额',x);if(!r)set值(x);return r;}} 编辑器={钱编辑器('金额')}/>
      </div><button id='别处'>别处</button></div>;
    }
    const root=createRoot(document.getElementById('root'));
    const 包=(x)=><ConfigProvider locale={zhCN}><App>{x}</App></ConfigProvider>;
    window.__拼=(起)=>root.render(包(<拼框 起={起}/>));
    window.__表单=()=>root.render(包(<表单/>));
    window.__币框=()=>root.render(包(<币框/>));
    window.__币表单=()=>root.render(包(<币表单/>));
    // 重挂 = 刷新页面：组件状态全丢，localStorage 里的草稿还在
    let 第几回=0;
    window.__就地=(起)=>root.render(包(<草稿范围 value='项目:t1'><就地 key={++第几回} 起={起}/></草稿范围>));
  `, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent" })).outputFiles[0].text;
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function open(画: string, 参?: unknown, width = 1280) {
  const page = await browser.newPage({ viewport: { width, height: 700 } }); page.setDefaultTimeout(5000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("http://amount.test/**", r => r.fulfill({ contentType: "text/html", body: "<meta charset='utf-8'><div id='root'></div>" }));
  await page.goto("http://amount.test"); await page.addStyleTag({ path: path.resolve("src/app/globals.css") });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(([f, a]) => (window as unknown as Record<string, (x: unknown) => void>)[f as string](a), [画, 参] as const);
  return { page, errors };
}
const 值 = (page: Page) => page.evaluate(() => { const v = (window as unknown as { __值: number | null }).__值; return typeof v === "number" && Number.isNaN(v) ? "NaN" : v; });
const 框 = (page: Page, 名 = "金额") => page.getByRole("spinbutton", { name: 名 });
const 根 = (page: Page) => page.locator(".ant-input-number").first();
const 浮层 = (page: Page) => page.locator(".ant-tooltip:not(.ant-tooltip-hidden)");

it.each([
  ["5万", 50000, "「5万」= 50,000", "50,000"],
  ["12.5万", 125000, "「12.5万」= 125,000", "125,000"],
  ["3w", 30000, "「3w」= 30,000", "30,000"],
  ["2.5k", 2500, "「2.5k」= 2,500", "2,500"],
  ["¥18,000", 18000, null, "18,000"],
])("「%s」认成 %d：敲的时候框上方说换算成多少，失焦后框里是换算后的数", async (敲, 数, 换算, 失焦后) => {
  const { page, errors } = await open("__拼");
  try {
    await 框(page).fill(敲);
    await expect.poll(() => 值(page)).toBe(数);
    expect(await 框(page).inputValue()).toBe(敲);
    if (换算) await expect.poll(() => 浮层(page).innerText()).toBe(换算);
    else expect(await 浮层(page).count()).toBe(0);
    await page.locator("#别处").click();
    await expect.poll(() => 框(page).inputValue()).toBe(失焦后);
    expect(await 值(page)).toBe(数);
    await expect.poll(() => 浮层(page).count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it.each([["5万5", "认不出「5万5」"], ["约5万", "认不出「约5万」"], ["-500", "认不出「-500」"], ["20000亿", "超过上限"]])(
  "「%s」认不出：交 NaN、框标红，聚焦 / 悬停说为什么、失焦后占位写着；失焦不压成 0、不退回敲到一半的数",
  async (敲, 话) => {
    const { page, errors } = await open("__拼", 30000);
    try {
      // 一个字一个字敲：「5万5」敲到「5万」时是 50000，最后那个 5 不能让它停在 50000
      await 框(page).click();
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.press("Backspace");
      await page.keyboard.type(敲);
      await expect.poll(() => 值(page)).toBe("NaN");
      expect(await 框(page).inputValue()).toBe(敲);
      expect(await 根(page).evaluate((el) => el.className)).toMatch(/status-error/);
      await expect.poll(() => page.getByRole("tooltip").filter({ hasText: 话 }).count()).toBe(1);
      await page.locator("#别处").click();
      await expect.poll(() => page.getByRole("tooltip").filter({ hasText: 话 }).isVisible()).toBe(false);
      expect(await 值(page)).toBe("NaN");
      expect(await 框(page).inputValue()).toBe("");
      expect(await 框(page).getAttribute("placeholder")).toBe(`认不出「${敲}」`);
      expect(await 根(page).evaluate((el) => el.className)).toMatch(/status-error/);
      await 框(page).hover();
      await expect.poll(() => page.getByRole("tooltip").filter({ hasText: 话 }).isVisible()).toBe(true);
      // 重新敲对了就好；清空 = 没填
      await 框(page).fill("6万");
      await expect.poll(() => 值(page)).toBe(60000);
      expect(await 根(page).evaluate((el) => el.className)).not.toMatch(/status-error/);
      await 框(page).fill("约");
      await expect.poll(() => 值(page)).toBe("NaN");
      await 框(page).fill("");
      await expect.poll(() => 值(page)).toBe(null);
      expect(await 根(page).evaluate((el) => el.className)).not.toMatch(/status-error/);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  },
);

it("拼音输入：敲 wan 选「万」，中途不报认不出，选完认成 50000", async () => {
  const { page, errors } = await open("__拼");
  try {
    await 框(page).click();
    await page.keyboard.type("5");
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.imeSetComposition", { text: "wa", selectionStart: 2, selectionEnd: 2 });
    await cdp.send("Input.imeSetComposition", { text: "wan", selectionStart: 3, selectionEnd: 3 });
    expect(await 根(page).evaluate((el) => el.className)).not.toMatch(/status-error/);
    expect(await 值(page)).toBe(5);
    await cdp.send("Input.insertText", { text: "万" });
    await expect.poll(() => 值(page)).toBe(50000);
    expect(await 框(page).inputValue()).toBe("5万");
    expect(await 根(page).evaluate((el) => el.className)).not.toMatch(/status-error/);
    await expect.poll(() => 浮层(page).innerText()).toBe("「5万」= 50,000");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("表单里（渠道投入那种 Form.Item 校验）：认不出挡住保存并说为什么；「5万」存 50000", async () => {
  const { page, errors } = await open("__表单");
  try {
    const 交 = () => page.evaluate(() => (window as unknown as { __交?: number }).__交);
    await 框(page, "投入金额").fill("5万5");
    await page.getByRole("button", { name: /保\s*存/ }).click();
    await expect.poll(() => page.getByText("金额认不出：只填不小于 0 的数字").count()).toBe(1);
    // validateFirst（和渠道抽屉一样）：认不出只出这一句，不再叠一行「金额要大于 0」
    expect(await page.getByText("金额要大于 0").count()).toBe(0);
    expect(await 交()).toBeUndefined();
    await 框(page, "投入金额").fill("5万");
    await page.getByRole("button", { name: /保\s*存/ }).click();
    await expect.poll(交).toBe(50000);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("表单（渠道投入那种，选美元）敲「5000元」：校验说写的是人民币、币种选的是美元，不说「可带 ¥」；改选欧元句子跟着变；改选人民币就过、存 5000（审查 11-20 第二轮）", async () => {
  const { page, errors } = await open("__币表单");
  try {
    const 交 = () => page.evaluate(() => (window as unknown as { __交?: { amount: number; currency: string } }).__交);
    const 错话 = page.locator(".ant-form-item-explain-error");
    await 框(page, "投入金额").fill("5000元");
    await page.getByRole("button", { name: /保\s*存/ }).click();
    await expect.poll(() => 错话.allInnerTexts()).toEqual([expect.stringContaining("写的是人民币，币种选的是美元")]);
    expect((await 错话.allInnerTexts()).join("")).not.toContain("可带");
    expect(await 交()).toBeUndefined();
    const 选 = async (币: string) => {
      await page.getByRole("combobox", { name: "币种" }).click();
      await page.locator(".ant-select-dropdown:visible .ant-select-item-option").filter({ hasText: 币 }).click();
    };
    await 选("EUR");
    await expect.poll(() => 错话.allInnerTexts()).toEqual([expect.stringContaining("写的是人民币，币种选的是欧元")]);
    await 选("CNY");
    await expect.poll(() => 错话.count()).toBe(0);
    await page.getByRole("button", { name: /保\s*存/ }).click();
    await expect.poll(交).toEqual({ currency: "CNY", amount: 5000 });
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it.each([375, 1024, 1280, 1366])("%ipx：和币种拼在一起，换算 / 认不出浮在框外，敲的字不被挤、浮层在视口里、页面不横撑", async (w) => {
  const { page, errors } = await open("__拼", null, w);
  try {
    for (const 敲 of ["1.5亿", "5万5"]) {
      await 框(page).fill(敲);
      await 浮层(page).waitFor();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      // 敲的字整串放得下（提示没占框里的地方）
      expect(await 框(page).evaluate((i: HTMLInputElement) => i.scrollWidth <= i.clientWidth + 1)).toBe(true);
      // 浮层放出来有个缩放动画、对齐也晚一拍：等它站稳再量
      await expect.poll(async () => { const b = await 浮层(page).boundingBox(); return !!b && b.x >= 0 && b.x + b.width <= w + 0.5; }).toBe(true);
    }
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

const 交了 = (page: Page) => page.evaluate(() => (window as unknown as { __就地交: unknown[] }).__就地交);
const 开格 = async (page: Page) => { await page.getByRole("button", { name: "改金额" }).click(); await 框(page).waitFor(); };

it.each([
  // 金额 0 在卡上也是空（p.amount || null）
  ["原值空着 / 0", null],
  ["原值 2 万", 20000],
])("就地改金额（%s）：敲「约5万」回车 / 点别处都有提示、不收起、不交；改敲「3万」回车存 30000", async (_, 起) => {
  const { page, errors } = await open("__就地", { 数: 起, 币: "CNY" }, 1280);
  try {
    await 开格(page);
    await 框(page).fill("约5万");
    await 框(page).press("Enter");
    await expect.poll(() => page.locator(".proj-inline-err").innerText()).toContain("金额认不出");
    expect(await page.locator(".proj-inline-money").count()).toBe(1);
    await page.locator("#别处").click();
    await page.waitForTimeout(100);
    expect(await page.locator(".proj-inline-money").count()).toBe(1);
    expect(await 框(page).getAttribute("placeholder")).toBe("认不出「约5万」");
    expect(await 交了(page)).toEqual([]);
    await 框(page).fill("3万");
    await 框(page).press("Enter");
    await expect.poll(() => 交了(page)).toEqual([{ amount: 30000, currency: "CNY" }]);
    await expect.poll(() => page.locator(".proj-inline-money").count()).toBe(0);
    expect(await page.locator(".proj-inline-val").innerText()).toContain("30,000");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("就地改金额：敲了认不出的字又改了币种，刷新后带回的草稿不把原金额清掉（原来 NaN 存成 null，带回再存 = 0）", async () => {
  const { page, errors } = await open("__就地", { 数: 50000, 币: "CNY" }, 1280);
  try {
    await 开格(page);
    await page.getByRole("combobox", { name: "金额币种" }).click();
    await page.keyboard.type("USD");
    await page.keyboard.press("Enter");
    await 框(page).fill("约5万");
    await expect.poll(() => 根(page).evaluate((el) => el.className)).toMatch(/status-error/);
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes("就地:金额")).length)).toBe(1);
    const 稿 = await page.evaluate(() => localStorage.getItem(Object.keys(localStorage).find((k) => k.includes("就地:金额"))!)!);
    expect(JSON.parse(稿).v).toEqual({ v: { 数: 50000, 币: "USD" } });
    // 刷新
    await page.evaluate(() => (window as unknown as { __就地: (x: unknown) => void }).__就地({ 数: 50000, 币: "CNY" }));
    await 开格(page);
    await expect.poll(() => page.getByText("已带回上次没提交的内容").count()).toBe(1);
    expect(await 框(page).inputValue()).toBe("50,000");
    await 框(page).press("Enter");
    await expect.poll(() => 交了(page)).toEqual([{ amount: 50000, currency: "USD" }]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("币种记号和选的对不上（选美元敲「5000元」、选人民币敲「USD 5000」）：交 NaN、说清楚；改了币种对上了就认", async () => {
  const { page, errors } = await open("__币框");
  try {
    await 框(page).fill("5000元");
    await expect.poll(() => 值(page)).toBe("NaN");
    await expect.poll(() => page.getByRole("tooltip").filter({ hasText: "写的是人民币，币种选的是美元" }).count()).toBe(1);
    expect(await 根(page).evaluate((el) => el.className)).toMatch(/status-error/);
    await page.locator("#换人民币").click();
    await expect.poll(() => 值(page)).toBe(5000);
    expect(await 根(page).evaluate((el) => el.className)).not.toMatch(/status-error/);
    await 框(page).fill("USD 5000");
    await expect.poll(() => 值(page)).toBe("NaN");
    await expect.poll(() => page.getByRole("tooltip").filter({ hasText: "写的是美元，币种选的是人民币" }).count()).toBe(1);
    await 框(page).fill("¥5万");
    await expect.poll(() => 值(page)).toBe(50000);
    // 没写记号的照常按选的币种
    await page.locator("#换美元").click();
    await 框(page).fill("３ｗ");
    await expect.poll(() => 值(page)).toBe(30000);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it("就地改金额（选美元）敲「5000元」回车：行内说写的是人民币、币种选的是美元，不说「可带 ¥」；改敲「5000」存 5000 美元（审查 11-20 第二轮）", async () => {
  const { page, errors } = await open("__就地", { 数: null, 币: "USD" }, 1280);
  try {
    await 开格(page);
    await 框(page).fill("5000元");
    await 框(page).press("Enter");
    await expect.poll(() => page.locator(".proj-inline-err").innerText()).toContain("写的是人民币，币种选的是美元");
    expect(await page.locator(".proj-inline-err").innerText()).not.toContain("可带");
    expect(await 交了(page)).toEqual([]);
    // 认不出的（不是币种的事）照旧用通用句，句末带上币种那半句
    await 框(page).fill("约5万");
    await 框(page).press("Enter");
    await expect.poll(() => page.locator(".proj-inline-err").innerText()).toContain("金额认不出");
    expect(await page.locator(".proj-inline-err").innerText()).toContain("或字里的币种记号和选的币种对不上");
    await 框(page).fill("5000");
    await 框(page).press("Enter");
    await expect.poll(() => 交了(page)).toEqual([{ amount: 5000, currency: "USD" }]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

it.each([375, 1280])("%ipx：项目卡就地改的钱格（.proj-inline-money，右栏 280 宽）换算 / 认不出浮在框外，敲的字不被挤、浮层在视口里", async (w) => {
  const { page, errors } = await open("__就地", { 数: null, 币: "CNY" }, w);
  try {
    await 开格(page);
    for (const 敲 of ["1.5亿", "5万5"]) {
      await 框(page).fill(敲);
      await 浮层(page).waitFor();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(await 框(page).evaluate((i: HTMLInputElement) => i.scrollWidth <= i.clientWidth + 1)).toBe(true);
      await expect.poll(async () => { const b = await 浮层(page).boundingBox(); return !!b && b.x >= 0 && b.x + b.width <= w + 0.5; }).toBe(true);
    }
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

/*
  K7（设计语言 E2，29O）：就地改金额敲了认不出的字回车——存的那一下框是灰的，焦点掉到页面上：Esc 没人接、还原不了，
  「认不出」浮层也一直挂着。现在没存上之后焦点回到金额框：浮层跟着焦点走，Esc 还原成原值、收起、浮层消失
*/
it.each([375, 1366])("K7 %ipx：就地改金额敲「约5万」回车没存上，焦点留在金额框；Esc 还原原值、收起，「认不出」浮层不挂着", async (w) => {
  const { page, errors } = await open("__就地", { 数: 20000, 币: "CNY" }, w);
  try {
    await 开格(page);
    await 框(page).fill("约5万");
    await 框(page).press("Enter");
    await expect.poll(() => page.locator(".proj-inline-err").innerText()).toContain("金额认不出");
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName)).toBe("金额");
    await page.keyboard.press("Escape");
    await expect.poll(() => page.locator(".proj-inline-money").count()).toBe(0);
    expect(await page.locator(".proj-inline-val").innerText()).toContain("20,000");
    await expect.poll(() => 浮层(page).count()).toBe(0);
    expect(await 交了(page)).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
