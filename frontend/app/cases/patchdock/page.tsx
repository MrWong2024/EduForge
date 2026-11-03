import type { Metadata } from "next";
import { PatchDockCase } from "@/components/public/PatchDockCase";

export const metadata: Metadata = {
  title: "PatchDock｜AI 代码补丁审查台",
  description:
    "通过文件快照与差异预览，区分文本匹配、基线一致和路径安全，理解补丁预检的判断依据与应用边界。",
};

export default function PatchDockPage() {
  return <PatchDockCase />;
}
