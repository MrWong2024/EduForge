import { IsMongoId, IsString, Matches } from 'class-validator';

export class CreateClassroomDto {
  @IsMongoId()
  courseId!: string;

  @IsString()
  @Matches(/\S/u)
  name!: string;
}
