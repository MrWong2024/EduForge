import { IsIn } from 'class-validator';
import {
  CLASSROOM_TASK_STATUS_CLOSED,
  CLASSROOM_TASK_STATUS_RECALLED,
} from '../classroom-task-status.constants';

export const CLASSROOM_TASK_MUTABLE_STATUSES = [
  CLASSROOM_TASK_STATUS_CLOSED,
  CLASSROOM_TASK_STATUS_RECALLED,
] as const;

export type ClassroomTaskMutableStatus =
  (typeof CLASSROOM_TASK_MUTABLE_STATUSES)[number];

export class UpdateClassroomTaskStatusDto {
  @IsIn(CLASSROOM_TASK_MUTABLE_STATUSES)
  status!: ClassroomTaskMutableStatus;
}
