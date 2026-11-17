import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { UpdateProfileDto } from '../dto/update-profile.dto';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { User, UserStatus } from '../schemas/user.schema';
import { AuthenticatedUser } from '../../../common/types/authenticated-user.type';
import {
  comparePassword,
  hashPassword,
  validateCurrentPassword,
  validateNewPassword,
} from '../password.utils';
import { SessionService } from '../../auth/services/session.service';
import { PasswordResetToken } from '../../auth/schemas/password-reset-token.schema';

type PublicUserProfileLean = Pick<
  User,
  'email' | 'roles' | 'status' | 'name' | 'studentNo' | 'employeeNo'
> & {
  _id: Types.ObjectId;
  createdAt?: Date;
};
type UserWithPassword = Pick<
  User,
  'passwordHash' | 'status' | 'credentialVersion'
> & { _id: Types.ObjectId };
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
    private readonly sessionService: SessionService,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(PasswordResetToken.name)
    private readonly passwordResetTokenModel: Model<PasswordResetToken>,
  ) {}

  async getMe(userId: string): Promise<PublicUserProfile> {
    const user = await this.userModel
      .findById(userId)
      .select(this.publicUserProjection)
      .lean<PublicUserProfileLean>()
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
        { returnDocument: 'after', runValidators: true },
      )
      .select(this.publicUserProjection)
      .lean<PublicUserProfileLean>()
      .exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return this.toPublicUserProfile(user);
  }

  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    context: Pick<AuthenticatedUser, 'sessionId' | 'credentialVersion'>,
  ): Promise<{ ok: true }> {
    const currentPassword = validateCurrentPassword(dto.currentPassword);
    const nextPassword = validateNewPassword(dto.newPassword);
    const user = await this.userModel
      .findById(userId)
      .select('status credentialVersion +passwordHash')
      .lean<UserWithPassword>()
      .exec();
    if (
      !user ||
      user.status !== UserStatus.Active ||
      user.credentialVersion !== context.credentialVersion
    ) {
      throw new UnauthorizedException('Unauthorized');
    }

    const isCurrentPasswordValid = await comparePassword(
      currentPassword,
      user.passwordHash,
    );
    if (!isCurrentPasswordValid) {
      throw new UnauthorizedException('Unauthorized');
    }

    const isSameAsCurrent = await comparePassword(
      nextPassword,
      user.passwordHash,
    );
    if (isSameAsCurrent) {
      throw new BadRequestException(
        'New password must be different from current password',
      );
    }

    const nextPasswordHash = await hashPassword(nextPassword);
    const updatedUser = await this.userModel
      .updateOne(
        {
          _id: user._id,
          status: UserStatus.Active,
          credentialVersion: context.credentialVersion,
        },
        {
          $set: { passwordHash: nextPasswordHash },
          $inc: { credentialVersion: 1 },
        },
      )
      .exec();
    if (updatedUser.modifiedCount !== 1) {
      throw new UnauthorizedException('Unauthorized');
    }

    const nextVersion = context.credentialVersion + 1;
    const promoted = await this.sessionService.promoteCurrentSession(
      user._id.toString(),
      context.sessionId,
      context.credentialVersion,
      nextVersion,
    );
    if (!promoted) {
      throw new UnauthorizedException('Unauthorized');
    }
    await this.sessionService.clearUserSessionsBeforeVersion(
      user._id.toString(),
      nextVersion,
    );
    await this.passwordResetTokenModel
      .updateMany(
        {
          userId: user._id,
          credentialVersion: { $lt: nextVersion },
          usedAt: null,
        },
        { $set: { usedAt: new Date() } },
      )
      .exec();
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

  private toPublicUserProfile(user: PublicUserProfileLean): PublicUserProfile {
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
