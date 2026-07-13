import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ClassroomsService } from '../services/classrooms.service';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { CreateClassroomDto } from '../dto/create-classroom.dto';
import { UpdateClassroomDto } from '../dto/update-classroom.dto';
import { QueryClassroomDto } from '../dto/query-classroom.dto';
import { QueryStudentDashboardDto } from '../dto/query-student-dashboard.dto';
import { JoinClassroomDto } from '../dto/join-classroom.dto';
import { QueryClassroomWeeklyReportDto } from '../dto/query-classroom-weekly-report.dto';
import { QueryProcessAssessmentDto } from '../dto/query-process-assessment.dto';
import { QueryClassroomExportSnapshotDto } from '../dto/query-classroom-export-snapshot.dto';
import { QueryClassroomStudentsDto } from '../dto/query-classroom-students.dto';
import {
  QueryAiLearningAnalyticsDto,
  QueryAiLearningAnalyticsStudentsDto,
} from '../dto/query-ai-learning-analytics.dto';
import {
  MEMBER_OR_OWNER_ROLES,
  STUDENT_ROLES,
  TEACHER_ROLES,
} from '../../users/schemas/user-roles.constants';

@Controller('classrooms')
export class ClassroomsController {
  constructor(private readonly classroomsService: ClassroomsService) {}

  @UseGuards(RolesGuard)
  @Roles(...TEACHER_ROLES)
  @Post()
  createClassroom(
    @Body() dto: CreateClassroomDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.classroomsService.createClassroom(dto, user.id);
  }

  @UseGuards(RolesGuard)
  @Roles(...TEACHER_ROLES)
  @Patch(':id')
  updateClassroom(
    @Param('id') id: string,
    @Body() dto: UpdateClassroomDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.classroomsService.updateClassroom(id, dto, user.id);
  }

  @UseGuards(RolesGuard)
  @Roles(...TEACHER_ROLES)
  @Delete(':id')
  deleteClassroom(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.classroomsService.deleteClassroom(id, user.id);
  }

  @UseGuards(RolesGuard)
  @Roles(...TEACHER_ROLES)
  @Get()
  listClassrooms(
    @Query() query: QueryClassroomDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.classroomsService.listClassrooms(query, user.id);
  }

  @UseGuards(RolesGuard)
  @Roles(...STUDENT_ROLES)
  @Post('join')
  joinClassroom(
    @Body() dto: JoinClassroomDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.classroomsService.joinClassroom(dto, user.id);
  }

  @UseGuards(RolesGuard)
  @Roles(...STUDENT_ROLES)
  @Get('mine/dashboard')
  getMyLearningDashboard(
    @Query() query: QueryStudentDashboardDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.classroomsService.getMyLearningDashboard(
      query,
      user.id,
      query.includeHistorical === true,
    );
  }

  @UseGuards(RolesGuard)
  @Roles(...TEACHER_ROLES)
  @Get(':id/dashboard')
  getClassroomDashboard(
    @Param('id') id: string,
    @Query('includeClosedTasks')
    includeClosedTasks: string | boolean | undefined,
    @CurrentUser() user: { id: string },
  ) {
    return this.classroomsService.getDashboard(
      id,
      user.id,
      includeClosedTasks === true || includeClosedTasks === 'true',
    );
  }

  @UseGuards(RolesGuard)
  @Roles(...TEACHER_ROLES)
  @Get(':classroomId/ai-learning-analytics')
  getAiLearningAnalytics(
    @Param('classroomId') classroomId: string,
    @Query() query: QueryAiLearningAnalyticsDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.classroomsService.getAiLearningAnalytics(
      classroomId,
      query,
      user.id,
    );
  }

  @UseGuards(RolesGuard)
  @Roles(...TEACHER_ROLES)
  @Get(':classroomId/ai-learning-analytics/students')
  getAiLearningAnalyticsStudents(
    @Param('classroomId') classroomId: string,
    @Query() query: QueryAiLearningAnalyticsStudentsDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.classroomsService.getAiLearningAnalyticsStudents(
      classroomId,
      query,
      user.id,
    );
  }

  @UseGuards(RolesGuard)
  @Roles(...TEACHER_ROLES)
  @Get(':classroomId/ai-learning-analytics/students/:studentId')
  getAiLearningAnalyticsStudentDetail(
    @Param('classroomId') classroomId: string,
    @Param('studentId') studentId: string,
    @Query() query: QueryAiLearningAnalyticsDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.classroomsService.getAiLearningAnalyticsStudentDetail(
      classroomId,
      studentId,
      query,
      user.id,
    );
  }

  @UseGuards(RolesGuard)
  @Roles(...TEACHER_ROLES)
  @Get(':classroomId/process-assessment')
  getProcessAssessment(
    @Param('classroomId') classroomId: string,
    @Query() query: QueryProcessAssessmentDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.classroomsService.getProcessAssessment(
      classroomId,
      query,
      user.id,
    );
  }

  @UseGuards(RolesGuard)
  @Roles(...TEACHER_ROLES)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Get(':classroomId/process-assessment.csv')
  exportProcessAssessmentCsv(
    @Param('classroomId') classroomId: string,
    @Query() query: QueryProcessAssessmentDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.classroomsService.exportProcessAssessmentCsv(
      classroomId,
      query,
      user.id,
    );
  }

  @UseGuards(RolesGuard)
  @Roles(...TEACHER_ROLES)
  @Get(':classroomId/export/snapshot')
  exportSnapshot(
    @Param('classroomId') classroomId: string,
    @Query() query: QueryClassroomExportSnapshotDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.classroomsService.exportSnapshot(classroomId, query, user.id);
  }

  @UseGuards(RolesGuard)
  @Roles(...TEACHER_ROLES)
  @Get(':classroomId/weekly-report')
  getClassroomWeeklyReport(
    @Param('classroomId') classroomId: string,
    @Query() query: QueryClassroomWeeklyReportDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.classroomsService.getWeeklyReport(classroomId, query, user.id);
  }

  @UseGuards(RolesGuard)
  @Roles(...TEACHER_ROLES)
  @Get(':id/students')
  listStudents(
    @Param('id') id: string,
    @Query() query: QueryClassroomStudentsDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.classroomsService.listStudents(id, query, user.id);
  }

  @UseGuards(RolesGuard)
  @Roles(...MEMBER_OR_OWNER_ROLES)
  @Get(':id')
  getClassroom(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.classroomsService.getClassroom(id, user.id);
  }

  @UseGuards(RolesGuard)
  @Roles(...TEACHER_ROLES)
  @Post(':id/archive')
  archiveClassroom(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.classroomsService.archiveClassroom(id, user.id);
  }

  @UseGuards(RolesGuard)
  @Roles(...TEACHER_ROLES)
  @Post(':id/students/:uid/remove')
  removeStudent(
    @Param('id') id: string,
    @Param('uid') studentId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.classroomsService.removeStudent(id, studentId, user.id);
  }
}
