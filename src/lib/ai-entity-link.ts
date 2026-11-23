/**
 * 回答里的客户名变链接（设计语言 HC-2b，用户 11-22 选 C6-A）：在回答正文里找出这一轮提到的客户，标出要链成链接的那几段。
 *
 * 规矩（终审 P4，测试见 tests/ent-hc2b-entity-link.test.ts）：
 *   - 只认这一轮 `answer.customers` 里**带 id** 的名字（服务端已按可见范围过滤过）；不为它另查库、不改可见范围
 *   - **从长到短**匹配：「某公司上海分公司」先于「某公司」，长名字里那截短名字不再单独链
 *   - **同名不同 id 不链**：两位客户都叫「张三」时链哪个都可能错，干脆都不链
 *   - 每个名字**只链第一次能链上的那一处**：一段里同一个名字出现五次，五条下划线只会花。
 *     第一次落在行内代码里、或那一小段里有 \|（表格格子里转义的竖线）时，Markdown 那边链不上（components/Markdown.tsx 链上），
 *     就往后找下一处（#441 审查可选项；原来只认第一次，那一处链不上整个名字就没链）
 *   - 名字不到 2 个字的不链（「王」「李」到处都是）
 * 偏移按传进来的原文算（Markdown 渲染时每段字都知道自己在全文里的起点，见 components/Markdown.tsx）。
 */
export type 可链实体 = { id: string; name: string };
export type 链段 = { 起: number; 止: number; id: string; name: string };

export function 找实体(文本: string, 实体们: readonly 可链实体[]): 链段[] {
  // 同名的 id 收在一起：只有一个 id 的名字才链
  const 名到id = new Map<string, Set<string>>();
  for (const e of 实体们) {
    const 名 = e.name?.trim();
    if (!e.id || !名 || [...名].length < 2) continue;
    if (!名到id.has(名)) 名到id.set(名, new Set());
    名到id.get(名)!.add(e.id);
  }
  const 候选 = [...名到id]
    .filter(([, ids]) => ids.size === 1)
    .map(([名, ids]) => ({ 名, id: [...ids][0] }))
    .sort((a, b) => b.名.length - a.名.length);
  const 占了: 链段[] = [];
  const 叠 = (起: number, 止: number) => 占了.some((s) => 起 < s.止 && s.起 < 止);
  for (const { 名, id } of 候选) {
    for (let i = 文本.indexOf(名); i !== -1; i = 文本.indexOf(名, i + 1)) {
      if (叠(i, i + 名.length) || !能链(文本, i, i + 名.length)) continue;
      占了.push({ 起: i, 止: i + 名.length, id, name: 名 });
      break;
    }
  }
  return 占了.sort((a, b) => a.起 - b.起);
}

const 表格行 = /^\s*\|/;

/**
 * 文本[起, 止) 这一截 Markdown 能不能整个包成一个链接——和 components/Markdown.tsx 的切法对齐：
 * 同一行；先按加粗 / 行内代码切（Inline 那一刀），行内代码里不链，要整个落在一段里（加粗的落在 ** 里面）；
 * 再按引用 [n]、表格行里没转义的 | 切出那一小段，那一小段里有 \| 的不链（链上 那里认的就是这个）。
 * 只用来跳过链不上的位置，宁可放行：放行了 Markdown 链不上，结果和原来一样只是字
 */
export function 能链(文本: string, 起: number, 止: number): boolean {
  const 行起 = 文本.lastIndexOf("\n", 起 - 1) + 1;
  const 尾 = 文本.indexOf("\n", 起);
  const 行止 = 尾 === -1 ? 文本.length : 尾;
  if (止 > 行止) return false;
  const 行 = 文本.slice(行起, 行止);
  const a = 起 - 行起;
  const b = 止 - 行起;
  let o = 0;
  for (const p of 行.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)) {
    const s = o;
    const e = o + p.length;
    o = e;
    if (b <= s || a >= e) continue;
    if (/^`[^`]+`$/.test(p)) return false;
    const 粗 = /^\*\*[^*]+\*\*$/.test(p) ? 2 : 0;
    const 内s = s + 粗;
    const 内e = e - 粗;
    if (a < 内s || b > 内e) return false;
    let 左 = 内s;
    let 右 = 内e;
    const 刀 = 表格行.test(行) ? /\[\d{1,2}\]|(?<!\\)\|/g : /\[\d{1,2}\]/g;
    for (const m of 行.slice(内s, 内e).matchAll(刀)) {
      const ms = 内s + m.index;
      const me = ms + m[0].length;
      if (me <= a) 左 = me;
      else if (ms >= b) {
        右 = ms;
        break;
      } else return false;
    }
    return !行.slice(左, 右).includes("\\|");
  }
  return true;
}
