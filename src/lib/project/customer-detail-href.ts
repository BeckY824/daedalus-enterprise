/**
 * 客户详情合并（11-12 第 2 批）：项目住在客户详情的项目区里，一个项目的地址 = 客户详情 + ?project=<项目 id>。
 * 看板、列表里点项目名直接生成这个地址；老的 /projects/<id> 链接由项目详情页跳过来兜底
 */
export function 客户页项目地址(customerId: string, projectId: string, hash = ""): string {
  return `/customers/${encodeURIComponent(customerId)}?project=${encodeURIComponent(projectId)}${hash}`;
}
