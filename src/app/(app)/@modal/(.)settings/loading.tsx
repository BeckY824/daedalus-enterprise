import SettingsModal from "@/components/SettingsModal";
import Skeleton from "@/components/Skeleton";

/**
 * 设置浮层的骨架（原型 st.open）：点了立刻出现浮层，正文取数（成员、日志、AI 配置……）回来之前先摆左目录和正文的灰条，
 * 不再干等半秒什么都没有
 */
export default function 设置浮层骨架() {
  return (
    <SettingsModal>
      <div className="set-box">
        <div className="set set-skel">
          <Skeleton 行={8} 高={14} 间距={14} 说法="设置正在打开" className="set-skel-nav" />
          <Skeleton 行={6} 高={14} 间距={14} 说法="设置正在打开" className="set-skel-body" />
        </div>
      </div>
    </SettingsModal>
  );
}
