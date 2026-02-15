import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type ReleaseFn = () => void;

@Injectable()
export class AiFeedbackGuardsService {
  private static readonly WINDOW_MS = 60 * 1000;
  private static readonly MAP_CLEANUP_THRESHOLD = 5000;
  private readonly maxConcurrency: number;
  private readonly maxPerMinute: number;
  private readonly queue: Array<(release: ReleaseFn) => void> = [];
  private inFlight = 0;
  private readonly usageMap = new Map<string, number[]>();

  constructor(private readonly configService: ConfigService) {
    this.maxConcurrency = this.readInt('AI_FEEDBACK_MAX_CONCURRENCY', 2);
    this.maxPerMinute = this.readInt(
      'AI_FEEDBACK_MAX_PER_CLASSROOMTASK_PER_MINUTE',
      30,
    );
  }

  async acquire(): Promise<ReleaseFn> {
    if (this.inFlight < this.maxConcurrency) {
      this.inFlight += 1;
      return this.createRelease();
    }
    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  tryConsume(classroomTaskId?: string | null): boolean {
    const key = classroomTaskId ?? 'no-classroomTask';
    const now = Date.now();
    const cutoff = now - AiFeedbackGuardsService.WINDOW_MS;
    const current = this.usageMap.get(key) ?? [];
    const filtered = current.filter((timestamp) => timestamp >= cutoff);

    if (filtered.length >= this.maxPerMinute) {
      this.usageMap.set(key, filtered);
      this.cleanupIfNeeded(now);
      return false;
    }

    filtered.push(now);
    this.usageMap.set(key, filtered);
    this.cleanupIfNeeded(now);
    return true;
  }

  private readInt(key: string, fallback: number) {
    const raw = this.configService.get<string>(key);
    if (!raw) {
      return fallback;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private createRelease(): ReleaseFn {
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.inFlight = Math.max(0, this.inFlight - 1);
      const next = this.queue.shift();
      if (next) {
        this.inFlight += 1;
        next(this.createRelease());
      }
    };
  }

  private cleanupIfNeeded(now: number) {
    if (this.usageMap.size <= AiFeedbackGuardsService.MAP_CLEANUP_THRESHOLD) {
      return;
    }
    const cutoff = now - AiFeedbackGuardsService.WINDOW_MS;
    for (const [key, list] of this.usageMap.entries()) {
      const filtered = list.filter((timestamp) => timestamp >= cutoff);
      if (filtered.length === 0) {
        this.usageMap.delete(key);
      } else if (filtered.length !== list.length) {
        this.usageMap.set(key, filtered);
      }
    }
  }
}
