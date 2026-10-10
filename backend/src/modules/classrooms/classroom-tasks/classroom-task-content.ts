import { Task } from '../../learning-tasks/schemas/task.schema';

export type TaskSnapshot = Pick<
  Task,
  | 'title'
  | 'description'
  | 'knowledgeModule'
  | 'courseLabel'
  | 'stage'
  | 'difficulty'
  | 'rubric'
>;

export enum AiFeedbackMode {
  Disabled = 'DISABLED',
  TeacherOnly = 'TEACHER_ONLY',
  Manual = 'MANUAL',
  FirstSubmissionAuto = 'FIRST_SUBMISSION_AUTO',
}

export const MISSING_TASK_SNAPSHOT_MESSAGE =
  '该课堂任务未保存发布内容，请教师重新布置后继续。';

export function snapshotTask(task: Task): TaskSnapshot {
  return {
    title: task.title,
    description: task.description,
    knowledgeModule: task.knowledgeModule,
    courseLabel: task.courseLabel,
    stage: task.stage,
    difficulty: task.difficulty,
    rubric:
      task.rubric === undefined ? undefined : structuredClone(task.rubric),
  };
}

export function studentCanRequestAi(mode: AiFeedbackMode | undefined): boolean {
  return (
    mode === AiFeedbackMode.Manual ||
    mode === AiFeedbackMode.FirstSubmissionAuto
  );
}
