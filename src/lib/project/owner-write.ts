/**
 * 写项目负责人（Project.ownerId）只走这两个（P-转-21、X-68，11-10 定）：
 *   - 换负责人：凡是换负责人的动作都清待分配标记——分配、市场转销售 / 客户层分配、转客户、改负责人、
 *     领取 / 分配公海项目、放回公海、超时收回、离职交接、从回收站恢复跟客户、导入改负责人。
 *     待分配只是「新线索没分出去、建的人先占着负责人那一格」，换了人（或进了公海）就不再是待分配，算新负责人持有。
 *   - 还负责人：撤销按原样回滚（P-撤销-01）时用，不动待分配：原来是待分配的由撤销自己还（还待分配状态，要在还项目之前调）。
 * 守门测试 tests/owner-write-guard.test.ts：src 里写 Project.ownerId 不经这两个就报错
 */

/** 换负责人：写 ownerId，同时清待分配 */
export function 换负责人(ownerId: string): { ownerId: string; awaitAssignAt: null } {
  return { ownerId, awaitAssignAt: null };
}

/** 撤销还负责人：只写 ownerId，待分配由撤销那边按留下的时刻还 */
export function 还负责人(ownerId: string): { ownerId: string } {
  return { ownerId };
}
