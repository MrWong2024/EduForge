import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ClassroomTasksService } from '../services/classroom-tasks.service';
import { RolesGuard } from '../../../../common/guards/roles.guard';
import { Roles } from '../../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { CreateClassroomTaskDto } from '../dto/create-classroom-task.dto';
import { QueryClassroomTaskDto } from '../dto/query-classroom-task.dto';
import { QueryAiMetricsDto } from '../dto/query-ai-metrics.dto';
import { QueryMyTaskDetailDto } from '../dto/query-my-task-detail.dto';
import { CreateSubmissionDto } from '../../../learning-tasks/dto/create-submission.dto';
import { AiMetricsService } from '../services/ai-metrics.service';
import {
  MEMBER_OR_OWNER_ROLES,
  STUDENT_ROLES,
  TEACHER_ROLES,
} from '../../../users/schemas/user-roles.constants';

@Controller('classrooms')
export class ClassroomTasksController {
  constructor(
    private readonly classroomTasksService: ClassroomTasksService,
    private readonly aiMetricsService: AiMetricsService,
  ) {}

  @UseGuards(RolesGuard)
  @Roles(...TEACHER_ROLES)
  @Post(':id/tasks')
  createClassroomTask(
    @Param('id') classroomId: string,
    @Body() dto: CreateClassroomTaskDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.classroomTasksService.createClassroomTask(
      classroomId,
      dto,
      user.id,
    );
  }

  @UseGuards(RolesGuard)
  @Roles(...MEMBER_OR_OWNER_ROLES)
  @Get(':id/tasks')
  listClassroomTasks(
    @Param('id') classroomId: string,
    @Query() query: QueryClassroomTaskDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.classroomTasksService.listClassroomTasks(
      classroomId,
      query,
      user.id,
    );
  }

  @UseGuards(RolesGuard)
  @Roles(...MEMBER_OR_OWNER_ROLES)
  @Get(':id/tasks/:classroomTaskId')
  getClassroomTask(
    @Param('id') classroomId: string,
    @Param('classroomTaskId') classroomTaskId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.classroomTasksService.getClassroomTask(
      classroomId,
      classroomTaskId,
      user.id,
    );
  }

  @UseGuards(RolesGuard)
  @Roles(...STUDENT_ROLES)
  @Post(':classroomId/tasks/:classroomTaskId/submissions')
  createClassroomTaskSubmission(
    @Param('classroomId') classroomId: string,
    @Param('classroomTaskId') classroomTaskId: string,
    @Body() dto: CreateSubmissionDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.classroomTasksService.createClassroomTaskSubmission(
      classroomId,
      classroomTaskId,
      dto,
      user.id,
    );
  }

  @UseGuards(RolesGuard)
  @Roles(...STUDENT_ROLES)
  @Get(':classroomId/tasks/:classroomTaskId/my-task-detail')
  getMyTaskDetail(
    @Param('classroomId') classroomId: string,
    @Param('classroomTaskId') classroomTaskId: string,
    @Query() query: QueryMyTaskDetailDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.classroomTasksService.getMyTaskDetail(
      classroomId,
      classroomTaskId,
      query,
      user.id,
    );
  }

  @UseGuards(RolesGuard)
  @Roles(...TEACHER_ROLES)
  @Get(':classroomId/tasks/:classroomTaskId/ai-metrics')
  getAiMetrics(
    @Param('classroomId') classroomId: string,
    @Param('classroomTaskId') classroomTaskId: string,
    @Query() query: QueryAiMetricsDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.aiMetricsService.getAiMetrics(
      classroomId,
      classroomTaskId,
      query.window,
      query.includeTags,
      user.id,
    );
  }
}
