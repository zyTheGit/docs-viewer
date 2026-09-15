# Redis 与缓存实战

> 在 NestJS 中正确使用 Redis：连接管理、缓存模式、分布式锁、限流与发布订阅。

---

## 1. 安装与连接

```bash
npm install ioredis @nestjs/bullmq   # 本篇先只用 ioredis
```

### 1.1 模块化注册

```typescript
// redis.module.ts
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Global()  // 全局模块，一次注册处处可用
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Redis({
          host: config.get('REDIS_HOST'),
          port: +config.get('REDIS_PORT'),
          password: config.get('REDIS_PASSWORD'),
          maxRetriesPerRequest: null,
          enableReadyCheck: true,
          retryStrategy: (times) => Math.min(times * 100, 3000), // 重连退避
        }),
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
```

### 1.2 注入使用

```typescript
@Injectable()
export class CacheService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async set(key: string, value: unknown, ttl?: number) {
    const data = JSON.stringify(value);
    return ttl ? this.redis.set(key, data, 'EX', ttl) : this.redis.set(key, data);
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get(key);
    return raw ? JSON.parse(raw) : null;
  }
}
```

> 💡 连接失败不会立刻抛错，建议在 `onModuleInit` 里 `await this.redis.ping()` 做启动自检。

---

## 2. Cache-Aside 完整封装

```typescript
@Injectable()
export class ArticleCacheService {
  constructor(
    private readonly cache: CacheService,       // 上面的封装
    private readonly articlesRepository: Repository<Article>,
  ) {}

  async getArticle(id: string): Promise<Article> {
    const key = `article:${id}`;

    const cached = await this.cache.get<Article>(key);
    if (cached) return cached;                   // 1. 命中缓存直接返回

    const article = await this.articlesRepository.findOneBy({ id });
    if (!article) throw new NotFoundException('文章不存在');

    await this.cache.set(key, article, 300);     // 2. 回填缓存，TTL 兜底
    return article;
  }

  async invalidate(id: string) {
    await this.cache.del(`article:${id}`);       // 更新库后删缓存
  }
}
```

> 一致性原则见[数据库高级指南](./25-数据库高级指南.md)：**先更新库，再删缓存**，TTL 是最后一道防线。

### 2.1 防缓存击穿：互斥回填

热点 key 过期瞬间，大量请求同时打到数据库。用分布式锁只让一个请求回填：

```typescript
async getHotArticle(id: string) {
  const key = `article:${id}`;
  const cached = await this.cache.get<Article>(key);
  if (cached) return cached;

  const locked = await this.cache.setNx(`lock:${key}`, '1', 10); // 10s 过期
  if (locked) {
    const article = await this.articlesRepository.findOneBy({ id });
    await this.cache.set(key, article, 300);
    await this.cache.del(`lock:${key}`);
    return article;
  }
  // 没抢到锁的请求：短暂等待后重试缓存
  await new Promise((r) => setTimeout(r, 100));
  return this.getHotArticle(id);
}
```

其他防护：
- **缓存穿透**（查不存在的数据）：空结果也缓存 30s，或用布隆过滤器
- **缓存雪崩**（大量 key 同时过期）：TTL 加随机抖动 `300 + Math.random() * 60`

---

## 3. 分布式锁

```typescript
@Injectable()
export class LockService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async lock(key: string, ttlSeconds = 10): Promise<string | null> {
    const token = randomUUID();  // 随机 token 防止误删他人的锁
    // SET key value NX EX ttl —— 原子加锁
    const ok = await this.redis.set(`lock:${key}`, token, 'EX', ttlSeconds, 'NX');
    return ok ? token : null;
  }

  async unlock(key: string, token: string): Promise<void> {
    // Lua 保证"检查 + 删除"原子性，只删自己的锁
    await this.redis.eval(
      `if redis.call("get", KEYS[1]) == ARGV[1]
       then return redis.call("del", KEYS[1])
       else return 0 end`,
      1, `lock:${key}`, token,
    );
  }
}
```

```typescript
async processOrder(orderId: string) {
  const token = await this.lock.lock(`order:${orderId}`);
  if (!token) throw new ConflictException('订单正在处理中');
  try {
    // ... 幂等业务逻辑
  } finally {
    await this.lock.unlock(`order:${orderId}`, token);
  }
}
```

> 生产级需求（看门狗续期、可重入）直接用 [Redlock](https://github.com/mike-marcacci/node-redlock) 等成熟库。

---

## 4. 限流

### 4.1 固定窗口（简单够用）

```typescript
async isAllowed(clientId: string, limit = 100, windowSec = 60) {
  const key = `rate:${clientId}`;
  const count = await this.redis.incr(key);
  if (count === 1) await this.redis.expire(key, windowSec);
  return count <= limit;
}
```

### 4.2 滑动窗口（更平滑）

```typescript
const now = Date.now();
const windowMs = 60000;
const pipeline = this.redis.pipeline();
pipeline.zremrangebyscore(key, 0, now - windowMs);   // 清理过期记录
pipeline.zadd(key, now, `${now}-${Math.random()}`);  // 记录本次
pipeline.zcard(key);                                  // 计数
pipeline.expire(key, 60);
const results = await pipeline.exec();
const count = results[2][1] as number;
```

### 4.3 挂到全局 Guard

```typescript
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private readonly rateLimiter: RateLimiterService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const key = req.ip;
    const allowed = await this.rateLimiter.isAllowed(key, 100, 60);
    if (!allowed) throw new HttpException('请求过于频繁', 429);
    return true;
  }
}
```

---

## 5. 发布 / 订阅

Redis Pub/Sub 适合轻量实时通知（多实例广播），可靠投递请用消息队列（见[消息队列实战](./27-消息队列实战.md)）。

```typescript
// 订阅者（每个实例都要独立连接，连接被占用后无法复用）
@Injectable()
export class NoticeSubscriber implements OnModuleInit {
  private readonly sub: Redis;
  constructor(@Inject(REDIS_CLIENT) redis: Redis) {
    this.sub = redis.duplicate();  // ⚠️ 必须复制连接
  }

  onModuleInit() {
    this.sub.subscribe('notice');
    this.sub.on('message', (channel, message) => {
      if (channel === 'notice') this.handle(JSON.parse(message));
    });
  }
}

// 发布者
await this.redis.publish('notice', JSON.stringify({ event: 'user.created', userId }));
```

> ⚠️ 三个坑：**订阅必须用 `duplicate()` 的独立连接**；Pub/Sub **不保证送达**（掉线期间消息丢失）；消息**不持久化**。

---

## 6. 会被追问的点

| 问题 | 答案 |
|---|---|
| Redis 单线程为什么快？ | 内存操作 + IO 多路复用 + 单线程无锁竞争（6.0 后网络 IO 多线程） |
| 持久化选 RDB 还是 AOF？ | RDB 快照小恢复快、可能丢数据；AOF 更可靠、文件大；生产常混合 |
| 热点 key 怎么办？ | 本地二级缓存（如 LRU map）、key 分片打散 |
| 内存满了怎么办？ | 配置淘汰策略，缓存场景用 `allkeys-lru` |
| 为什么用 ioredis 不用 node-redis？ | ioredis 对 Pipeline/Cluster/Sentinel 支持更成熟 |

---

## 7. 本篇小结

- ✅ `@Global` 模块统一管理 Redis 连接，含重连策略
- ✅ Cache-Aside 封装：命中短路、回填 TTL、更新后删缓存
- ✅ 三大缓存故障：穿透（空值缓存）、击穿（互斥回填）、雪崩（TTL 抖动）
- ✅ 分布式锁：`SET NX EX` + Lua 原子释放
- ✅ 限流：固定窗口 / 滑动窗口，Guard 全局接入
- ✅ Pub/Sub：独立连接、不保证送达、可靠投递换消息队列

**下一篇**：[消息队列实战](./27-消息队列实战.md) —— 异步任务、延迟队列与事件驱动架构。
