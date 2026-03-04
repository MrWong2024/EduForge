import Link from "next/link";

type AiProcessingHintProps = {
  status: string | null | undefined;
  variant: "submission" | "taskDetail";
  helpHref: string;
};

const normalizeStatus = (status: string | null | undefined): string | null => {
  if (!status) {
    return null;
  }

  const normalized = status.trim().toUpperCase();
  return normalized || null;
};

const toPhaseText = (status: string): string =>
  status === "RUNNING" ? "处理中" : "排队中";

const toVariantTip = (variant: AiProcessingHintProps["variant"]): string =>
  variant === "submission"
    ? "你可以稍后手动刷新本页查看最新反馈结果。"
    : "你可以先查看当前任务状态，稍后再进入提交详情页查看反馈。";

export function AiProcessingHint({ status, variant, helpHref }: AiProcessingHintProps) {
  const normalizedStatus = normalizeStatus(status);
  if (normalizedStatus !== "PENDING" && normalizedStatus !== "RUNNING") {
    return null;
  }

  return (
    <section className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <p className="font-semibold">AI 反馈正在生成</p>
      <p className="mt-1">
        当前状态为{toPhaseText(normalizedStatus)}，属于正常状态。若长时间未出结果，请联系老师或管理员确认 AI
        处理后台是否开启，以及当前配额或网络是否可用。
      </p>
      <p className="mt-1">{toVariantTip(variant)}</p>
      <Link href={helpHref} className="mt-2 inline-block text-amber-800 underline">
        了解原因与处理方式
      </Link>
    </section>
  );
}
