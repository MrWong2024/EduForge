export type PasswordKind = "login" | "current" | "new";

export type PasswordValidation = {
  value: string;
  error: string | null;
};

export const PASSWORD_RULES = {
  login: "密码至少需要 6 个字符，且 UTF-8 编码不超过 72 字节。",
  current: "当前密码至少需要 1 个字符，且 UTF-8 编码不超过 72 字节。",
  new: "新密码去除首尾空白后至少需要 8 个字符，且 UTF-8 编码不超过 72 字节。",
} satisfies Record<PasswordKind, string>;

export function validatePassword(
  input: string,
  kind: PasswordKind
): PasswordValidation {
  const value = kind === "new" ? input.trim() : input;
  const minimum = kind === "login" ? 6 : kind === "current" ? 1 : 8;
  const isValid =
    [...value].length >= minimum && new TextEncoder().encode(value).byteLength <= 72;

  return { value, error: isValid ? null : PASSWORD_RULES[kind] };
}

export function validateNewPassword(
  input: string,
  confirmation: string,
  currentPassword?: string
): PasswordValidation {
  const result = validatePassword(input, "new");
  if (result.error) {
    return result;
  }
  if (result.value !== confirmation.trim()) {
    return { value: result.value, error: "两次输入的新密码不一致。" };
  }
  if (currentPassword !== undefined && result.value === currentPassword) {
    return { value: result.value, error: "新密码不能与当前密码相同。" };
  }
  return result;
}
