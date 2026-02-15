import { IsString } from 'class-validator';

export class CreateCourseDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsString()
  term!: string;
}
