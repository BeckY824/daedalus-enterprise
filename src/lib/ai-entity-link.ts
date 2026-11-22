/**
 * 回答里的客户名变链接（设计语言 HC-2b，用户 11-22 选 C6-A）：在回答正文里找出这一轮提到的客户，标出要链成链接的那几段。
 *
 * 规矩（终审 P4，测试见 tests/ent-hc2b-entity-link.test.ts）：
 *   - 只认这一轮 `answer.customers` 里**带 id** 的名字（服务端已按可见范围过滤过）；不为它另查库、不改可见范围
 *   - **从长到短**匹配：「某公司上海分公司」先于「某公司」，长名字里那截短名字不再单独链
 *   - **同名不同 id 不链**：两位客户都叫「张三」时链哪个都可能错，干脆都不链
 *   - 每个名字**只链第一次出现**：一段里同一个名字出现五次，五条下划线只会花
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
      if (叠(i, i + 名.length)) continue;
      占了.push({ 起: i, 止: i + 名.length, id, name: 名 });
      break;
    }
  }
  return 占了.sort((a, b) => a.起 - b.起);
}
