const encodeSegment = (value: string) => encodeURIComponent(value);

export const paths = {
  login: "/login",
  teacher: {
    home: "/teacher",
    tasks: "/teacher/tasks",
    tasksFromClassroom: (classroomId: string) =>
      `/teacher/tasks?fromClassroomId=${encodeSegment(classroomId)}&status=PUBLISHED`,
    taskEdit: (taskId: string) => `/teacher/tasks/${encodeSegment(taskId)}/edit`,
    courses: "/teacher/courses",
    courseOverview: (courseId: string) =>
      `/teacher/courses/${encodeSegment(courseId)}/overview`,
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
    classroomTaskDetail: (classroomId: string, classroomTaskId: string) =>
      `/teacher/classrooms/${encodeSegment(classroomId)}/tasks/${encodeSegment(classroomTaskId)}`,
    classroomTaskSubmissions: (classroomId: string, classroomTaskId: string) =>
      `/teacher/classrooms/${encodeSegment(classroomId)}/tasks/${encodeSegment(classroomTaskId)}/submissions`,
    classroomTaskTrajectory: (classroomId: string, classroomTaskId: string) =>
      `/teacher/classrooms/${encodeSegment(classroomId)}/tasks/${encodeSegment(classroomTaskId)}/learning-trajectory`,
    classroomTaskReviewPack: (classroomId: string, classroomTaskId: string) =>
      `/teacher/classrooms/${encodeSegment(classroomId)}/tasks/${encodeSegment(classroomTaskId)}/review-pack`,
    classroomTaskAiMetrics: (classroomId: string, classroomTaskId: string) =>
      `/teacher/classrooms/${encodeSegment(classroomId)}/tasks/${encodeSegment(classroomTaskId)}/ai-metrics`,
    submissionDetail: (submissionId: string) =>
      `/teacher/submissions/${encodeSegment(submissionId)}`,
  },
  student: {
    home: "/student",
    dashboard: "/student/dashboard",
    joinClassroom: "/student/classrooms/join",
    aiHelp: "/student/help/ai",
    submissionDetail: (submissionId: string) =>
      `/student/submissions/${encodeSegment(submissionId)}`,
    taskDetail: (classroomId: string, classroomTaskId: string) =>
      `/student/classrooms/${encodeSegment(classroomId)}/tasks/${encodeSegment(classroomTaskId)}`,
  },
};

export type UserRole = "TEACHER" | "STUDENT";
