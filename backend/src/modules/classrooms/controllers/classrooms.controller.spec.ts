import { ClassroomsService } from '../services/classrooms.service';
import { ClassroomsController } from './classrooms.controller';

describe('ClassroomsController', () => {
  const createController = () => {
    const classroomsService = {
      getDashboard: jest.fn().mockResolvedValue({ ok: true }),
    };
    const controller = new ClassroomsController(
      classroomsService as unknown as ClassroomsService,
    );

    return { controller, classroomsService };
  };

  it('defaults includeClosedTasks to false for teacher dashboard', async () => {
    const { controller, classroomsService } = createController();

    const result = await controller.getClassroomDashboard(
      'classroom-1',
      undefined,
      { id: 'teacher-1' },
    );

    expect(result).toEqual({ ok: true });
    expect(classroomsService.getDashboard).toHaveBeenCalledWith(
      'classroom-1',
      'teacher-1',
      false,
    );
  });

  it.each([
    ['false', false],
    [false, false],
    ['invalid', false],
    ['true', true],
    [true, true],
  ] as const)(
    'parses includeClosedTasks=%p as %p',
    async (rawIncludeClosedTasks, expected) => {
      const { controller, classroomsService } = createController();

      await controller.getClassroomDashboard(
        'classroom-1',
        rawIncludeClosedTasks,
        { id: 'teacher-1' },
      );

      expect(classroomsService.getDashboard).toHaveBeenCalledWith(
        'classroom-1',
        'teacher-1',
        expected,
      );
    },
  );
});
