import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AiFeedbackDebugEnabledGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(): boolean {
    const enabled =
      this.configService.get<string>('AI_FEEDBACK_DEBUG_ENABLED') === 'true';
    if (!enabled) {
      throw new NotFoundException('Not Found');
    }
    return true;
  }
}
