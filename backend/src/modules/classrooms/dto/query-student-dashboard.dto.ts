import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { QueryClassroomDto } from './query-classroom.dto';

export class QueryStudentDashboardDto extends QueryClassroomDto {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeHistorical?: boolean;
}
