/**
 * crm/no-build-time-env：运行期代码别读 Next 构建时就替换成常量的环境变量（11-17 复盘第 2 类）。
 *
 * 机制：next build 时 Next 把下面这些 process.env.X 直接替换成常量（node_modules/next/dist/build/define-env.js）。
 * 开发模式不替换，照常读进程环境，所以只在生产构建里出错：#333 读 NEXT_DEPLOYMENT_ID，没配部署号时被替换成 false，
 * false.trim() 整站 500。部署时再设这些变量也没用，值早被烤进了产物。
 *
 * 两条：
 *   1. 不许读 Next 替换的变量：NEXT_DEPLOYMENT_ID、NEXT_RUNTIME、NEXT_MINIMAL、NEXT_SUPPORTS_IMMUTABLE_ASSETS、TURBOPACK，
 *      以及所有 __NEXT_ 开头的。NODE_ENV 也会被替换，但值总是 "development" / "production"，各处按它分支是 Next 的标准写法，不拦。
 *   2. 浏览器组件（文件开头 "use client"）只许读 NEXT_PUBLIC_ 开头的和 NODE_ENV：别的在浏览器里永远是 undefined。
 *
 * 有理由要读的，在 eslint.config.mjs 里按文件给 allow 并写清理由，不在源码里逐行关。
 */

/** Next 构建时替换成常量的变量（NODE_ENV 除外，见上） */
export const 构建期变量 = ["NEXT_DEPLOYMENT_ID", "NEXT_RUNTIME", "NEXT_MINIMAL", "NEXT_SUPPORTS_IMMUTABLE_ASSETS", "TURBOPACK"];
const 是构建期 = (名) => 构建期变量.includes(名) || 名.startsWith("__NEXT_");
const 浏览器可读 = (名) => 名.startsWith("NEXT_PUBLIC_") || 名 === "NODE_ENV";

/** node 是不是 process.env（含 process["env"]） */
function 是processEnv(node) {
  if (!node || node.type !== "MemberExpression") return false;
  const o = node.object;
  const p = node.property;
  if (o.type !== "Identifier" || o.name !== "process") return false;
  return node.computed ? p.type === "Literal" && p.value === "env" : p.type === "Identifier" && p.name === "env";
}

/** process.env 上取的键名；动态取（process.env[k]）返回 null */
function 键名(member) {
  const p = member.property;
  if (!member.computed) return p.type === "Identifier" ? p.name : null;
  if (p.type === "Literal" && typeof p.value === "string") return p.value;
  if (p.type === "TemplateLiteral" && p.expressions.length === 0) return p.quasis[0].value.cooked;
  return null;
}

/** @type {import("eslint").Rule.RuleModule} */
const 规则 = {
  meta: {
    type: "problem",
    docs: { description: "运行期代码不读 Next 构建期替换的环境变量；浏览器组件只读 NEXT_PUBLIC_ 开头的" },
    schema: [
      {
        type: "object",
        properties: { allow: { type: "array", items: { type: "string" } } },
        additionalProperties: false,
      },
    ],
    messages: {
      构建期:
        "process.env.{{名}} 在 next build 时被替换成常量（没配就是 false / 空串），运行期读不到真实值（11-17 #333 整站 500）。改用自己的变量名；确有理由的在 eslint.config.mjs 里按文件 allow 并写理由",
      浏览器:
        "浏览器组件里 process.env.{{名}} 永远是 undefined：浏览器只拿得到 NEXT_PUBLIC_ 开头的和 NODE_ENV。从服务端组件用 props 传进来，或改名 NEXT_PUBLIC_…",
    },
  },
  create(context) {
    const allow = new Set(context.options[0]?.allow ?? []);
    const 浏览器组件 = context.sourceCode.ast.body.some(
      (s) => s.type === "ExpressionStatement" && s.directive === "use client",
    );
    function 查(node, 名) {
      if (名 !== null && allow.has(名)) return;
      if (名 !== null && 是构建期(名)) return context.report({ node, messageId: "构建期", data: { 名 } });
      if (浏览器组件 && (名 === null || !浏览器可读(名))) {
        context.report({ node, messageId: "浏览器", data: { 名: 名 ?? "[动态键]" } });
      }
    }
    return {
      MemberExpression(node) {
        if (是processEnv(node.object)) 查(node, 键名(node));
      },
      // const { NEXT_RUNTIME } = process.env
      VariableDeclarator(node) {
        if (node.id.type !== "ObjectPattern" || !是processEnv(node.init)) return;
        for (const p of node.id.properties) {
          if (p.type === "RestElement") {
            if (浏览器组件) 查(p, null);
            continue;
          }
          const 名 = !p.computed && p.key.type === "Identifier" ? p.key.name : p.key.type === "Literal" ? String(p.key.value) : null;
          查(p, 名);
        }
      },
    };
  },
};

export default 规则;
