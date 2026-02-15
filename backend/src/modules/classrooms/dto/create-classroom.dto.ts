import { IsMongoId, IsString } from 'class-validator';

export class CreateClassroomDto {
  @IsMongoId()
  courseId!: string;

  @IsString()
  name!: string;
}
