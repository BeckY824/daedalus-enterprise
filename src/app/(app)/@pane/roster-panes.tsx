import CustomerRoster from "@/components/CustomerRoster";
import ProjectRoster from "@/components/ProjectRoster";
import { 客户名单数据, 项目名单数据 } from "./roster-data";

/*
  客户 / 项目详情的中栏名单（原来和无中栏、对话列表一起写在 panes.tsx）。
  单独一个文件：只有 @pane/{customers,projects}/(detail)/layout.tsx 引它，别的槽位页（首页的对话列表、各页的无中栏）
  不会因为同一个文件里有名单，就把 CustomerRoster / ProjectRoster 的客户端代码带进自己的首屏包。中栏为什么是并行路由见 panes.tsx 顶部
*/

/**
 * 记录页的窄名单：最近跟进过的 50 位（不含公海，P-看-03）。
 *
 * **只在 `/customers/[id]` 出现，列表页没有**（批 2）。列表页已经是一张全宽的表，
 * 旁边再挂一条同样内容的名单等于把同一件事画两遍；而记录页缺的正是「换一个人」
 * 这条路——原来从林夏切到陈航要退回列表再进去。
 *
 * 它自己渲染 <aside>，不走 包一层：窄屏下整条要变成抽屉，那时不能留一个空的 aside。
 */
export async function 学员名单() {
  const { data, 默认页签 } = await 客户名单数据();
  return <CustomerRoster data={data} 默认页签={默认页签} />;
}

/**
 * 企业版项目详情页的中栏：项目名单（P11，照上面的学员名单）。应用导航 | 项目名单 | 项目详情，三个竖条。
 *
 * 只在 `/projects/[id]` 出现，列表页和新建页没有（理由同学员名单）。只在企业版且开了项目模式时出：
 * 别的版本、项目模式关着，这一格和原来一样是空的。范围走带限定的 prisma，和项目页同一个口径（lib/project/list.ts 读名单项目）
 */
export async function 项目名单() {
  const data = await 项目名单数据();
  return data ? <ProjectRoster data={data} /> : null;
}
