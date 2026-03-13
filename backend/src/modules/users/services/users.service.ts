import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UpdateProfileDto } from '../dto/update-profile.dto';
import { User } from '../schemas/user.schema';
import { WithId } from '../../../common/types/with-id.type';
import { WithTimestamps } from '../../../common/types/with-timestamps.type';

type UserLean = User & WithId & WithTimestamps;
type PublicUserProfile = {
  id: string;
  email: string;
  roles: string[];
  status: string;
  name?: string;
  studentNo?: string;
  employeeNo?: string;
  createdAt?: Date;
};
type ProfileUpdatePayload = Partial<
  Pick<User, 'name' | 'studentNo' | 'employeeNo'>
>;

@Injectable()
export class UsersService {
  private readonly publicUserProjection =
    'email roles status name studentNo employeeNo createdAt';

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {}

  async getMe(userId: string): Promise<PublicUserProfile> {
    const user = await this.userModel
      .findById(userId)
      .select(this.publicUserProjection)
      .lean<UserLean>()
      .exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return this.toPublicUserProfile(user);
  }

  async updateMe(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<PublicUserProfile> {
    const updatePayload = this.buildProfileUpdatePayload(dto);
    if (Object.keys(updatePayload).length === 0) {
      return this.getMe(userId);
    }

    const user = await this.userModel
      .findByIdAndUpdate(
        userId,
        { $set: updatePayload },
        { new: true, runValidators: true },
      )
      .select(this.publicUserProjection)
      .lean<UserLean>()
      .exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return this.toPublicUserProfile(user);
  }

  private buildProfileUpdatePayload(
    dto: UpdateProfileDto,
  ): ProfileUpdatePayload {
    const payload: ProfileUpdatePayload = {};
    if (dto.name !== undefined) {
      payload.name = dto.name;
    }
    if (dto.studentNo !== undefined) {
      payload.studentNo = dto.studentNo;
    }
    if (dto.employeeNo !== undefined) {
      payload.employeeNo = dto.employeeNo;
    }
    return payload;
  }

  private toPublicUserProfile(user: UserLean): PublicUserProfile {
    return {
      id: user._id.toString(),
      email: user.email,
      roles: user.roles,
      status: user.status,
      name: user.name,
      studentNo: user.studentNo,
      employeeNo: user.employeeNo,
      createdAt: user.createdAt,
    };
  }
}
