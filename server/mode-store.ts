import Redis from 'ioredis';

export type AgentMode = 'traditional' | 'codemode';

const MODE_TTL_SECONDS = 60 * 60 * 24 * 7;

export class ModeStore {
  private redis: Redis;

  constructor(
    redisUrl: string = process.env.REDIS_URL ?? 'redis://redis:6379'
  ) {
    this.redis = new Redis(redisUrl);
  }

  private key(conversationId: string): string {
    return `conversation:${conversationId}:mode`;
  }

  async getMode(conversationId: string): Promise<AgentMode | undefined> {
    const value = await this.redis.get(this.key(conversationId));
    if (value === 'traditional' || value === 'codemode') return value;
    return undefined;
  }

  async setMode(conversationId: string, mode: AgentMode): Promise<void> {
    await this.redis.set(
      this.key(conversationId),
      mode,
      'EX',
      MODE_TTL_SECONDS
    );
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}
