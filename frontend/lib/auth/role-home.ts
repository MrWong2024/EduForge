import { paths, type UserRole } from "@/lib/routes/paths";

export type RoleAwareMe = {
  role?: string | null;
  roles?: string[] | null;
};

const normalizeRole = (role: string | null | undefined): string =>
  String(role ?? "")
    .trim()
    .toUpperCase();

export const hasRole = (me: RoleAwareMe, role: UserRole): boolean => {
  if (normalizeRole(me.role) === role) {
    return true;
  }

  if (Array.isArray(me.roles)) {
    return me.roles.some((item) => normalizeRole(item) === role);
  }

  return false;
};

export const getRoleHomePath = (me: RoleAwareMe): string | null => {
  if (hasRole(me, "TEACHER")) {
    return paths.teacher.classrooms;
  }

  if (hasRole(me, "STUDENT")) {
    return paths.student.home;
  }

  return null;
};
