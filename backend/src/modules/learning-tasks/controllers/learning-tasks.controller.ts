import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { LearningTasksService } from '../services/learning-tasks.service';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { CreateTaskDto } from '../dto/create-task.dto';
import { UpdateTaskDto } from '../dto/update-task.dto';
import { QueryTaskDto } from '../dto/query-task.dto';
import { CreateSubmissionDto } from '../dto/create-submission.dto';
import { CreateFeedbackDto } from '../dto/create-feedback.dto';
import { RequestAiFeedbackDto } from '../dto/request-ai-feedback.dto';
import { QueryAiFeedbackJobsDto } from '../dto/query-ai-feedback-jobs.dto';
import { ProcessAiFeedbackJobsDto } from '../dto/process-ai-feedback-jobs.dto';
import { AiFeedbackJobService } from '../ai-feedback/services/ai-feedback-job.service';
import { AiFeedbackProcessor } from '../ai-feedback/services/ai-feedback-processor.service';
import { LearningTasksReportsService } from '../services/learning-tasks-reports.service';
import { AiFeedbackDebugEnabledGuard } from '../ai-feedback/guards/ai-feedback-debug-enabled.guard';
import {
  MEMBER_OR_OWNER_ROLES,
  STUDENT_ROLES,
  TEACHER_ROLES,
} from '../../users/schemas/user-roles.constants';

@Controller('learning-tasks')
export class LearningTasksController {
  constructor(
    private readonly learningTasksService: LearningTasksService,
    private readonly aiFeedbackJobService: AiFeedbackJobService,
    private readonly aiFeedbackProcessor: AiFeedbackProcessor,
    private readonly learningTasksReportsService: LearningTasksReportsService,
  ) {}

  @UseGuards(RolesGuard)
  @Roles(...TEACHER_ROLES)
  @Post('tasks')
  createTask(@Body() dto: CreateTaskDto, @CurrentUser() user: { id: string }) {
    return this.learningTasksService.createTask(dto, user.id);
  }

  @UseGuards(RolesGuard)
  @Roles(...TEACHER_ROLES)
  @Patch('tasks/:id')
  updateTask(
    @Param('id') id: string,
    @Body() dto: UpdateTaskDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.learningTasksService.updateTask(id, dto, user.id);
  }

  @UseGuards(RolesGuard)
  @Roles(...TEACHER_ROLES)
  @Post('tasks/:id/publish')
  publishTask(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.learningTasksService.publishTask(id, user.id);
  }

  @UseGuards(RolesGuard)
  @Roles(...TEACHER_ROLES)
  @Get('tasks')
  listTasks(@Query() query: QueryTaskDto) {
    return this.learningTasksService.listTasks(query);
  }

  @UseGuards(RolesGuard)
  @Roles(...TEACHER_ROLES)
  @Get('tasks/:id')
  getTask(@Param('id') id: string) {
    return this.learningTasksService.getTask(id);
  }

  @UseGuards(RolesGuard)
  @Roles(...STUDENT_ROLES)
  @Post('tasks/:id/submissions')
  createSubmission(
    @Param('id') taskId: string,
    @Body() dto: CreateSubmissionDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.learningTasksService.createSubmission(taskId, dto, user.id);
  }

  @UseGuards(RolesGuard)
  @Roles(...STUDENT_ROLES)
  @Get('tasks/:id/submissions/mine')
  listMySubmissions(
    @Param('id') taskId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.learningTasksService.listMySubmissions(taskId, user.id);
  }

  @UseGuards(RolesGuard)
  @Roles(...TEACHER_ROLES)
  @Get('tasks/:id/submissions')
  listTaskSubmissions(
    @Param('id') taskId: string,
    @CurrentUser() user: { id: string },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.learningTasksService.listTaskSubmissions(
      taskId,
      user.id,
      page,
      limit,
    );
  }

  @UseGuards(RolesGuard)
  @Roles(...TEACHER_ROLES)
  @Post('submissions/:id/feedback')
  createFeedback(
    @Param('id') submissionId: string,
    @Body() dto: CreateFeedbackDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.learningTasksService.createFeedback(submissionId, dto, user.id);
  }

  @UseGuards(RolesGuard)
  @Roles(...MEMBER_OR_OWNER_ROLES)
  @Get('submissions/:id/feedback')
  listFeedback(
    @Param('id') submissionId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.learningTasksService.listFeedback(submissionId, user.id);
  }

  @UseGuards(RolesGuard)
  @Roles(...TEACHER_ROLES, ...STUDENT_ROLES)
  @HttpCode(200)
  @Post('submissions/:submissionId/ai-feedback/request')
  requestAiFeedback(
    @Param('submissionId') submissionId: string,
    @Body() dto: RequestAiFeedbackDto,
    @CurrentUser() user: { id: string; roles?: string[] },
  ) {
    return this.learningTasksService.requestAiFeedback(submissionId, user, dto);
  }

  @UseGuards(RolesGuard)
  @Roles(...TEACHER_ROLES)
  @Get('tasks/:id/stats')
  getStats(@Param('id') taskId: string, @CurrentUser() user: { id: string }) {
    return this.learningTasksService.getStats(taskId, user.id);
  }

  @UseGuards(RolesGuard)
  @Roles(...TEACHER_ROLES)
  @Get('tasks/:id/reports/common-issues')
  getCommonIssuesReport(
    @Param('id') taskId: string,
    @CurrentUser() user: { id: string },
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    if (limit < 1 || limit > 10) {
      throw new BadRequestException('limit must be between 1 and 10');
    }
    return this.learningTasksReportsService.getCommonIssuesReport(
      taskId,
      user.id,
      limit,
    );
  }

  @UseGuards(AiFeedbackDebugEnabledGuard, RolesGuard)
  @Roles(...TEACHER_ROLES)
  @Get('ai-feedback/jobs')
  listAiFeedbackJobs(
    @Query() query: QueryAiFeedbackJobsDto,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    if (limit < 1 || limit > 100) {
      throw new BadRequestException('limit must be between 1 and 100');
    }
    return this.aiFeedbackJobService.listJobs({
      status: query.status,
      limit,
    });
  }

  @UseGuards(AiFeedbackDebugEnabledGuard, RolesGuard)
  @Roles(...TEACHER_ROLES)
  @Post('ai-feedback/jobs/process-once')
  processAiFeedbackOnce(@Body() dto: ProcessAiFeedbackJobsDto) {
    return dto.batchSize === undefined
      ? this.aiFeedbackProcessor.processOnce()
      : this.aiFeedbackProcessor.processOnce(dto.batchSize);
  }
}
