import { paths, type UserRole } from "@/lib/routes/paths";

export type RoleAwareMe = {
  roles?: string[] | null;
};

export const hasRole = (me: RoleAwareMe, role: UserRole): boolean => {
  const apiRole = role === "TEACHER" ? "teacher" : "student";
  return Array.isArray(me.roles) && me.roles.includes(apiRole);
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
