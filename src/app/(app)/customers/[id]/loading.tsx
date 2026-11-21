import AppLoading from "../../loading";

/**
 * 客户详情加载中（设计语言 D5 · M12-a，规范 D07）：现状主题出和页面同形的骨架——页头（头像 + 名字 + 一行小字）+ 三栏卡
 * （左栏客户资料 / 联系人，中栏进程卡 / 沟通，右栏项目资料），--skel-delay（180ms）后才出，快的不闪；减弱动态下灰条不扫光（.skel-bar 那条全局规则）。
 * 换皮主题照 D5 之前用全站那一份（app/(app)/loading.tsx）：两份都在 DOM 里，globals.css 按主题只露一份（.cd-skel 默认不摆）
 */
const 条 = (n: number) => Array.from({ length: n }, (_, i) => <div key={i} className="skel-bar" />);

function 卡({ 行 }: { 行: number }) {
  return (
    <div className="cd-skel-card">
      <div className="skel-bar cd-skel-ct" />
      {条(行)}
    </div>
  );
}

export default function Loading() {
  return (
    <>
      <div className="cd-skel" role="status" aria-label="正在打开客户" data-testid="customer-skeleton">
        <div className="cd-skel-head">
          <div className="cd-skel-av" />
          <div className="cd-skel-hl">
            <div className="skel-bar cd-skel-name" />
            <div className="skel-bar cd-skel-sub" />
          </div>
        </div>
        <div className="cd-skel-cols">
          <div className="cd-skel-col"><卡 行={5} /><卡 行={3} /></div>
          <div className="cd-skel-col"><卡 行={3} /><卡 行={6} /></div>
          <div className="cd-skel-col"><卡 行={8} /></div>
        </div>
      </div>
      <div className="cd-ld-old"><AppLoading /></div>
    </>
  );
}
