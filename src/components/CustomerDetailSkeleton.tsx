/**
 * 客户详情的骨架（原 customers/[id]/loading.tsx，跳转优化 PR-A 起不再是那一层的 loading：换客户、列表进详情时旧内容留到新内容就绪，
 * 只在整页打开 / 左栏切进来、本地还没有内容时由 (app)/loading.tsx 按槽位出它，见 components/SlotSkeleton.tsx）。
 * 客户详情加载中（设计语言 D5 · M12-a，规范 D07）：出和页面同形的骨架——页头（头像 + 名字 + 一行小字）+ 三栏卡
 * （左栏客户资料 / 联系人，中栏进程卡 / 沟通，右栏项目资料），--skel-delay（180ms）后才出，快的不闪；减弱动态下灰条不扫光（.skel-bar 那条全局规则）。
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

export default function CustomerDetailSkeleton() {
  return (
    <div className="cd-skel" role="status" aria-label="正在打开客户" data-testid="customer-skeleton">
      <div className="cd-skel-head">
        <div className="cd-skel-av" />
        <div className="cd-skel-hl">
          <div className="skel-bar cd-skel-name" />
          <div className="skel-bar cd-skel-sub" />
        </div>
      </div>
      {/* 栏数照真页面：外层 = 左栏 + 项目区（同 .rec.rec-cd），项目区里再分中栏 + 右栏（同 .rec-zone > .cd-zb），门槛见 globals.css */}
      <div className="cd-skel-cols">
        <div className="cd-skel-col"><卡 行={5} /><卡 行={3} /></div>
        <div className="cd-skel-zone">
          <div className="cd-skel-zb">
            <div className="cd-skel-col"><卡 行={3} /><卡 行={6} /></div>
            <div className="cd-skel-col"><卡 行={8} /></div>
          </div>
        </div>
      </div>
    </div>
  );
}
