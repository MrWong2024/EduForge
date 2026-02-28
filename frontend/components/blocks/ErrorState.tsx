type ErrorStateProps = {
  status?: 401 | 403 | 404 | 500 | number;
  title?: string;
  description?: string;
};

const getDefaultMessage = (status?: number): { title: string; description: string } => {
  if (status === 401) {
    return {
      title: "401 未登录或会话已过期",
      description: "请重新登录后再继续操作。",
    };
  }

  if (status === 403) {
    return {
      title: "403 无权限访问该页面",
      description: "当前账号角色不匹配，无法访问该页面。",
    };
  }

  if (status === 404) {
    return {
      title: "404 页面不存在或功能未启用",
      description: "请检查访问路径，或确认功能开关是否已开启。",
    };
  }

  return {
    title: "服务暂时不可用，请稍后重试",
    description: "请求失败，可能是网络波动或服务临时异常。",
  };
};

export function ErrorState({ status, title, description }: ErrorStateProps) {
  const defaults = getDefaultMessage(status);

  return (
    <section className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-900">
      <p className="font-semibold">{title ?? defaults.title}</p>
      <p className="mt-1">{description ?? defaults.description}</p>
    </section>
  );
}
