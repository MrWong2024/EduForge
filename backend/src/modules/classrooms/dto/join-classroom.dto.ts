import { IsString } from 'class-validator';

export class JoinClassroomDto {
  @IsString()
  joinCode!: string;
}
