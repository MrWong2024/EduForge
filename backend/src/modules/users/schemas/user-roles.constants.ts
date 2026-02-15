export const USER_ROLE_USER = 'user';
export const USER_ROLE_STUDENT = 'student';
export const USER_ROLE_TEACHER = 'teacher';
export const USER_ROLE_ADMIN = 'admin';

export const USER_ROLES = [
  USER_ROLE_USER,
  USER_ROLE_STUDENT,
  USER_ROLE_TEACHER,
  USER_ROLE_ADMIN,
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const AUTHENTICATED_ROLES: readonly UserRole[] = USER_ROLES;
export const STUDENT_ROLES: readonly UserRole[] = [USER_ROLE_STUDENT];
export const TEACHER_ROLES: readonly UserRole[] = [
  USER_ROLE_TEACHER,
  USER_ROLE_ADMIN,
];
export const MEMBER_OR_OWNER_ROLES: readonly UserRole[] = [
  USER_ROLE_STUDENT,
  USER_ROLE_TEACHER,
  USER_ROLE_ADMIN,
];

export const hasAnyRole = (
  userRoles: readonly string[],
  requiredRoles: readonly string[],
): boolean => requiredRoles.some((role) => userRoles.includes(role));
