export type AccountUser = {
  id?: string;
  name?: string | null;
  email?: string | null;
  roles?: string[] | null;
  status?: string | null;
  studentNo?: string | null;
  employeeNo?: string | null;
};

const ROLE_LABELS = new Map<string, string>([
  ["teacher", "教师"],
  ["student", "学生"],
  ["admin", "管理员"],
  ["user", "用户"],
]);

export const getRoleLabels = (user: AccountUser): string[] => {
  const roles = Array.isArray(user.roles)
    ? user.roles.filter((role) => typeof role === "string" && role.trim().length > 0)
    : [];
  return Array.from(new Set(roles), (role) => ROLE_LABELS.get(role) ?? role);
};

export const getPrimaryAccountName = (user: AccountUser): string => {
  const name = typeof user.name === "string" ? user.name.trim() : "";
  if (name) {
    return name;
  }

  const email = typeof user.email === "string" ? user.email.trim() : "";
  if (email) {
    return email;
  }

  return "当前用户";
};

export const getSecondaryAccountHint = (user: AccountUser): string => {
  const roleLabel = getRoleLabels(user)[0];
  if (roleLabel) {
    return roleLabel;
  }

  const email = typeof user.email === "string" ? user.email.trim() : "";
  return email || "已登录";
};
