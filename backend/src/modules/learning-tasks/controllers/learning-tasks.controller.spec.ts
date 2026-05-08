import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { TEACHER_ROLES } from '../../users/schemas/user-roles.constants';
import { AiFeedbackProcessor } from '../ai-feedback/services/ai-feedback-processor.service';
import { AiFeedbackJobService } from '../ai-feedback/services/ai-feedback-job.service';
import { LearningTasksReportsService } from '../services/learning-tasks-reports.service';
import { LearningTasksService } from '../services/learning-tasks.service';
import { LearningTasksController } from './learning-tasks.controller';

describe('LearningTasksController', () => {
  const createController = () => {
    const learningTasksService = {
      archiveTask: jest
        .fn()
        .mockResolvedValue({ id: 'task-1', status: 'ARCHIVED' }),
      restoreTask: jest
        .fn()
        .mockResolvedValue({ id: 'task-1', status: 'DRAFT' }),
    };
    const controller = new LearningTasksController(
      learningTasksService as unknown as LearningTasksService,
      {} as unknown as AiFeedbackJobService,
      {} as unknown as AiFeedbackProcessor,
      {} as unknown as LearningTasksReportsService,
    );

    return { controller, learningTasksService };
  };

  it('delegates archiveTask to the service with the current teacher id', async () => {
    const { controller, learningTasksService } = createController();

    const result = await controller.archiveTask('task-1', { id: 'teacher-1' });

    expect(result).toEqual({ id: 'task-1', status: 'ARCHIVED' });
    expect(learningTasksService.archiveTask).toHaveBeenCalledWith(
      'task-1',
      'teacher-1',
    );
  });

  it('keeps archiveTask behind teacher roles and RolesGuard', () => {
    createController();
    const archiveHandler = Object.getOwnPropertyDescriptor(
      LearningTasksController.prototype,
      'archiveTask',
    )?.value as ((...args: unknown[]) => unknown) | undefined;
    expect(archiveHandler).toBeDefined();

    const roles = Reflect.getMetadata(
      ROLES_KEY,
      archiveHandler as (...args: unknown[]) => unknown,
    ) as string[] | undefined;
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      archiveHandler as (...args: unknown[]) => unknown,
    ) as unknown[] | undefined;

    expect(roles).toEqual(TEACHER_ROLES);
    expect(guards).toEqual([RolesGuard]);
  });

  it('delegates restoreTask to the service with the current teacher id', async () => {
    const { controller, learningTasksService } = createController();

    const result = await controller.restoreTask('task-1', { id: 'teacher-1' });

    expect(result).toEqual({ id: 'task-1', status: 'DRAFT' });
    expect(learningTasksService.restoreTask).toHaveBeenCalledWith(
      'task-1',
      'teacher-1',
    );
  });

  it('keeps restoreTask behind teacher roles and RolesGuard', () => {
    createController();
    const restoreHandler = Object.getOwnPropertyDescriptor(
      LearningTasksController.prototype,
      'restoreTask',
    )?.value as ((...args: unknown[]) => unknown) | undefined;
    expect(restoreHandler).toBeDefined();

    const roles = Reflect.getMetadata(
      ROLES_KEY,
      restoreHandler as (...args: unknown[]) => unknown,
    ) as string[] | undefined;
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      restoreHandler as (...args: unknown[]) => unknown,
    ) as unknown[] | undefined;

    expect(roles).toEqual(TEACHER_ROLES);
    expect(guards).toEqual([RolesGuard]);
  });
});
