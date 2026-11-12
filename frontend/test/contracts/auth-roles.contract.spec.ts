import { test, expect } from "@playwright/test";
import {
  getRoleHomePath,
  hasRole,
  type RoleAwareMe,
} from "../../lib/auth/role-home";
import {
  getPrimaryAccountName,
  getRoleLabels,
  getSecondaryAccountHint,
  type AccountUser,
} from "../../components/account/account-types";

test("formal roles match internal teaching roles and preserve home priority", () => {
  for (const scenario of [
    {
      roles: Object.freeze(["teacher"]),
      teacher: true,
      student: false,
      home: "/teacher/classrooms",
      labels: ["教师"],
    },
    {
      roles: Object.freeze(["student"]),
      teacher: false,
      student: true,
      home: "/student",
      labels: ["学生"],
    },
    {
      roles: Object.freeze(["student", "teacher"]),
      teacher: true,
      student: true,
      home: "/teacher/classrooms",
      labels: ["学生", "教师"],
    },
    {
      roles: Object.freeze(["admin"]),
      teacher: false,
      student: false,
      home: null,
      labels: ["管理员"],
    },
    {
      roles: Object.freeze(["user"]),
      teacher: false,
      student: false,
      home: null,
      labels: ["用户"],
    },
  ]) {
    const input: unknown = Object.freeze({ roles: scenario.roles });
    const before = structuredClone(input);

    expect(hasRole(input as RoleAwareMe, "TEACHER")).toBe(scenario.teacher);
    expect(hasRole(input as RoleAwareMe, "STUDENT")).toBe(scenario.student);
    expect(getRoleHomePath(input as RoleAwareMe)).toBe(scenario.home);
    expect(getRoleLabels(input as AccountUser)).toEqual(scenario.labels);
    expect(Object.isFrozen(input)).toBe(true);
    expect(Object.isFrozen(scenario.roles)).toBe(true);
    expect(input).toStrictEqual(before);
  }
});

test("role labels keep original-string order and deduplication with safe unknown text", () => {
  const objectRole = Object.freeze({ role: "teacher" });
  const nestedRole = Object.freeze(["admin"]);
  const roles = Object.freeze([
    "admin",
    "student",
    "teacher",
    "user",
    "teacher",
    "TEACHER",
    " custom-role ",
    "constructor",
    "constructor",
    "custom-role",
    "TEACHER",
    "",
    " \t\n ",
    objectRole,
    nestedRole,
    42,
    true,
  ]);
  const input: unknown = Object.freeze({ roles });
  const before = structuredClone(input);

  expect(getRoleLabels(input as AccountUser)).toEqual([
    "管理员",
    "学生",
    "教师",
    "用户",
    "TEACHER",
    " custom-role ",
    "constructor",
    "custom-role",
  ]);
  expect(Object.isFrozen(input)).toBe(true);
  expect(Object.isFrozen(roles)).toBe(true);
  expect(Object.isFrozen(objectRole)).toBe(true);
  expect(Object.isFrozen(nestedRole)).toBe(true);
  expect(input).toStrictEqual(before);
});

test("legacy role neither fills absent roles nor overrides conflicting formal roles", () => {
  for (const scenario of [
    {
      user: Object.freeze({ role: "teacher" }),
      teacher: false,
      student: false,
      home: null,
      labels: [],
    },
    {
      user: Object.freeze({ role: "student", roles: null }),
      teacher: false,
      student: false,
      home: null,
      labels: [],
    },
    {
      user: Object.freeze({ role: "teacher", roles: Object.freeze([]) }),
      teacher: false,
      student: false,
      home: null,
      labels: [],
    },
    {
      user: Object.freeze({ role: "teacher", roles: "teacher" }),
      teacher: false,
      student: false,
      home: null,
      labels: [],
    },
    {
      user: Object.freeze({ role: "teacher", roles: Object.freeze(["student"]) }),
      teacher: false,
      student: true,
      home: "/student",
      labels: ["学生"],
    },
    {
      user: Object.freeze({ role: "student", roles: Object.freeze(["teacher"]) }),
      teacher: true,
      student: false,
      home: "/teacher/classrooms",
      labels: ["教师"],
    },
  ]) {
    const input: unknown = scenario.user;
    const before = structuredClone(input);

    expect(hasRole(input as RoleAwareMe, "TEACHER")).toBe(scenario.teacher);
    expect(hasRole(input as RoleAwareMe, "STUDENT")).toBe(scenario.student);
    expect(getRoleHomePath(input as RoleAwareMe)).toBe(scenario.home);
    expect(getRoleLabels(input as AccountUser)).toEqual(scenario.labels);
    expect(Object.hasOwn(input as AccountUser, "role")).toBe(true);
    expect(Object.isFrozen(input)).toBe(true);
    expect(input).toStrictEqual(before);
  }
});

test("invalid role elements cannot grant teaching access while exact mixed roles remain valid", () => {
  const nestedTeacher = Object.freeze(["teacher"]);
  const objectTeacher = Object.freeze({ role: "teacher" });
  for (const scenario of [
    {
      roles: Object.freeze([
        "TEACHER",
        "STUDENT",
        "Teacher",
        "Student",
        " teacher ",
        "student ",
        nestedTeacher,
        objectTeacher,
        1,
        true,
        false,
        null,
        undefined,
        "",
        " \t ",
      ]),
      student: false,
      home: null,
      labels: [
        "TEACHER",
        "STUDENT",
        "Teacher",
        "Student",
        " teacher ",
        "student ",
      ],
    },
    {
      roles: Object.freeze([
        nestedTeacher,
        "TEACHER",
        objectTeacher,
        "student",
        1,
        false,
      ]),
      student: true,
      home: "/student",
      labels: ["TEACHER", "学生"],
    },
  ]) {
    // Runtime inputs deliberately include values outside the public roles type.
    const input: unknown = Object.freeze({ roles: scenario.roles });
    const before = structuredClone(input);

    expect(hasRole(input as RoleAwareMe, "TEACHER")).toBe(false);
    expect(hasRole(input as RoleAwareMe, "STUDENT")).toBe(scenario.student);
    expect(getRoleHomePath(input as RoleAwareMe)).toBe(scenario.home);
    expect(getRoleLabels(input as AccountUser)).toEqual(scenario.labels);
    expect(Object.isFrozen(scenario.roles)).toBe(true);
    expect(Object.isFrozen(nestedTeacher)).toBe(true);
    expect(Object.isFrozen(objectTeacher)).toBe(true);
    expect(input).toStrictEqual(before);
  }
});

test("account name and secondary hint retain representative display fallbacks", () => {
  for (const scenario of [
    {
      user: Object.freeze({
        name: " 正式姓名 ",
        email: " member@example.invalid ",
        roles: Object.freeze(["student"]),
      }),
      name: "正式姓名",
      hint: "学生",
    },
    {
      user: Object.freeze({
        name: " \t ",
        email: " member@example.invalid ",
        roles: Object.freeze([]),
        role: "teacher",
      }),
      name: "member@example.invalid",
      hint: "member@example.invalid",
    },
    {
      user: Object.freeze({ name: null, email: " \t ", roles: null }),
      name: "当前用户",
      hint: "已登录",
    },
  ]) {
    const input: unknown = scenario.user;
    const before = structuredClone(input);

    expect(getPrimaryAccountName(input as AccountUser)).toBe(scenario.name);
    expect(getSecondaryAccountHint(input as AccountUser)).toBe(scenario.hint);
    expect(Object.isFrozen(input)).toBe(true);
    expect(input).toStrictEqual(before);
  }
});
