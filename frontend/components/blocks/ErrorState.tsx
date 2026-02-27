type ErrorStateProps = {
  status?: 401 | 403 | 404 | 500 | number;
  title?: string;
  description?: string;
};

const getDefaultMessage = (status?: number): { title: string; description: string } => {
  if (status === 403) {
    return {
      title: "403 Forbidden",
      description: "Your current role cannot access this page.",
    };
  }

  if (status === 404) {
    return {
      title: "404 Not Available",
      description: "Resource not found, or this feature is not enabled.",
    };
  }

  if (status === 401) {
    return {
      title: "401 Unauthorized",
      description: "Your login session has expired. Please sign in again.",
    };
  }

  return {
    title: "Request Failed",
    description: "Service is temporarily unavailable. Please retry later.",
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
