import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { UpdateProfileDto } from '../dto/update-profile.dto';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { User } from '../schemas/user.schema';
import { Session } from '../../auth/schemas/session.schema';
import { WithId } from '../../../common/types/with-id.type';
import { WithTimestamps } from '../../../common/types/with-timestamps.type';

type UserLean = User & WithId & WithTimestamps;
type UserWithPassword = User &
  WithId &
  WithTimestamps & { passwordHash?: string };
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
  private readonly minPasswordLength = 8;
  private readonly publicUserProjection =
    'email roles status name studentNo employeeNo createdAt';

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Session.name) private readonly sessionModel: Model<Session>,
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

  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    currentSessionToken?: string,
  ): Promise<{ ok: true }> {
    const user = await this.userModel
      .findById(userId)
      .select('+passwordHash')
      .lean<UserWithPassword>()
      .exec();
    if (!user || !user.passwordHash) {
      throw new NotFoundException('User not found');
    }

    const isCurrentPasswordValid = await bcrypt.compare(
      dto.currentPassword,
      user.passwordHash,
    );
    if (!isCurrentPasswordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const nextPassword = dto.newPassword.trim();
    if (!nextPassword) {
      throw new BadRequestException('New password must not be blank');
    }
    if (nextPassword.length < this.minPasswordLength) {
      throw new BadRequestException(
        `New password must be at least ${this.minPasswordLength} characters`,
      );
    }

    const isSameAsCurrent = await bcrypt.compare(
      nextPassword,
      user.passwordHash,
    );
    if (isSameAsCurrent) {
      throw new BadRequestException(
        'New password must be different from current password',
      );
    }

    const nextPasswordHash = await bcrypt.hash(nextPassword, 10);
    await this.userModel
      .updateOne(
        { _id: user._id },
        { $set: { passwordHash: nextPasswordHash } },
      )
      .exec();

    if (currentSessionToken) {
      await this.sessionModel
        .deleteMany({ userId: user._id, token: { $ne: currentSessionToken } })
        .exec();
    } else {
      await this.sessionModel.deleteMany({ userId: user._id }).exec();
    }

    return { ok: true };
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
