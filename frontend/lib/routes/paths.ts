const encodeSegment = (value: string) => encodeURIComponent(value);

export const paths = {
  login: "/login",
  teacher: {
    home: "/teacher",
    courses: "/teacher/courses",
    classrooms: "/teacher/classrooms",
    classroomDashboard: (classroomId: string) =>
      `/teacher/classrooms/${encodeSegment(classroomId)}/dashboard`,
    classroomTasks: (classroomId: string) =>
      `/teacher/classrooms/${encodeSegment(classroomId)}/tasks`,
    classroomMembers: (classroomId: string) =>
      `/teacher/classrooms/${encodeSegment(classroomId)}/members`,
    classroomWeeklyReport: (classroomId: string) =>
      `/teacher/classrooms/${encodeSegment(classroomId)}/weekly-report`,
    classroomProcessAssessment: (classroomId: string) =>
      `/teacher/classrooms/${encodeSegment(classroomId)}/process-assessment`,
    classroomExportSnapshot: (classroomId: string) =>
      `/teacher/classrooms/${encodeSegment(classroomId)}/export/snapshot`,
    classroomTaskBase: (classroomId: string, classroomTaskId: string) =>
      `/teacher/classrooms/${encodeSegment(classroomId)}/tasks/${encodeSegment(classroomTaskId)}`,
    classroomTaskTrajectory: (classroomId: string, classroomTaskId: string) =>
      `/teacher/classrooms/${encodeSegment(classroomId)}/tasks/${encodeSegment(classroomTaskId)}/learning-trajectory`,
    classroomTaskReviewPack: (classroomId: string, classroomTaskId: string) =>
      `/teacher/classrooms/${encodeSegment(classroomId)}/tasks/${encodeSegment(classroomTaskId)}/review-pack`,
    classroomTaskAiMetrics: (classroomId: string, classroomTaskId: string) =>
      `/teacher/classrooms/${encodeSegment(classroomId)}/tasks/${encodeSegment(classroomTaskId)}/ai-metrics`,
  },
  student: {
    home: "/student",
    dashboard: "/student/dashboard",
    joinClassroom: "/student/classrooms/join",
    taskDetail: (classroomId: string, classroomTaskId: string) =>
      `/student/classrooms/${encodeSegment(classroomId)}/tasks/${encodeSegment(classroomTaskId)}`,
  },
};

export type UserRole = "TEACHER" | "STUDENT";
