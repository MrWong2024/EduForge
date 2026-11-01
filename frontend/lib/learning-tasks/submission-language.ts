export const SUBMISSION_LANGUAGE_OPTIONS = [
  { value: "auto", label: "自动识别（默认）" },
  { value: "java", label: "Java" },
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "python", label: "Python" },
  { value: "c", label: "C" },
  { value: "cpp", label: "C++" },
  { value: "other", label: "Other" },
] as const;

export const toDisplaySubmissionLanguage = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim()) {
    return "—";
  }

  const language = value.trim();
  return (
    SUBMISSION_LANGUAGE_OPTIONS.find(
      (option) => option.value === language.toLowerCase(),
    )?.label ?? language
  );
};
