import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CoursesService } from '../services/courses.service';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { CreateCourseDto } from '../dto/create-course.dto';
import { UpdateCourseDto } from '../dto/update-course.dto';
import { QueryCourseDto } from '../dto/query-course.dto';
import { QueryCourseOverviewDto } from '../dto/query-course-overview.dto';
import { CourseOverviewService } from '../services/course-overview.service';
import { TEACHER_ROLES } from '../../users/schemas/user-roles.constants';

@Controller('courses')
export class CoursesController {
  constructor(
    private readonly coursesService: CoursesService,
    private readonly courseOverviewService: CourseOverviewService,
  ) {}

  @UseGuards(RolesGuard)
  @Roles(...TEACHER_ROLES)
  @Post()
  createCourse(
    @Body() dto: CreateCourseDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.coursesService.createCourse(dto, user.id);
  }

  @UseGuards(RolesGuard)
  @Roles(...TEACHER_ROLES)
  @Patch(':id')
  updateCourse(
    @Param('id') id: string,
    @Body() dto: UpdateCourseDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.coursesService.updateCourse(id, dto, user.id);
  }

  @UseGuards(RolesGuard)
  @Roles(...TEACHER_ROLES)
  @Get()
  listCourses(
    @Query() query: QueryCourseDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.coursesService.listCourses(query, user.id);
  }

  @UseGuards(RolesGuard)
  @Roles(...TEACHER_ROLES)
  @Get(':id')
  getCourse(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.coursesService.getCourse(id, user.id);
  }

  @UseGuards(RolesGuard)
  @Roles(...TEACHER_ROLES)
  @Get(':courseId/overview')
  getCourseOverview(
    @Param('courseId') courseId: string,
    @Query() query: QueryCourseOverviewDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.courseOverviewService.getCourseOverview(
      courseId,
      query,
      user.id,
    );
  }

  @UseGuards(RolesGuard)
  @Roles(...TEACHER_ROLES)
  @Post(':id/archive')
  archiveCourse(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.coursesService.archiveCourse(id, user.id);
  }
}
