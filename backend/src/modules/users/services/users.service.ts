import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UpdateProfileDto } from '../dto/update-profile.dto';
import { User } from '../schemas/user.schema';
import { WithId } from '../../../common/types/with-id.type';
import { WithTimestamps } from '../../../common/types/with-timestamps.type';

type UserLean = User & WithId & WithTimestamps;

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {}

  async getMe(userId: string) {
    const user = await this.userModel
      .findById(userId)
      .select('email roles status createdAt')
      .lean<UserLean>()
      .exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return {
      id: user._id.toString(),
      email: user.email,
      roles: user.roles,
      status: user.status,
      createdAt: user.createdAt,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  updateMe(_dto: UpdateProfileDto) {
    return null;
  }
}
