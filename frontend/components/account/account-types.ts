export type AccountUser = {
  id?: string;
  name?: string | null;
  email?: string | null;
  role?: string | null;
  roles?: string[] | null;
  status?: string | null;
  studentNo?: string | null;
  employeeNo?: string | null;
};

const normalizeRole = (role: string | null | undefined): string =>
  String(role ?? "").trim().toUpperCase();

const ROLE_LABELS: Record<string, string> = {
  TEACHER: "教师",
  STUDENT: "学生",
  ADMIN: "管理员",
  USER: "用户",
};

export const getRoleLabels = (user: AccountUser): string[] => {
  const fromRoles = Array.isArray(user.roles) ? user.roles : [];
  const fromSingleRole = user.role ? [user.role] : [];
  const normalized = [...fromRoles, ...fromSingleRole]
    .map((role) => normalizeRole(role))
    .filter((role) => role.length > 0);

  const unique = [...new Set(normalized)];
  return unique.map((role) => ROLE_LABELS[role] ?? role);
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
