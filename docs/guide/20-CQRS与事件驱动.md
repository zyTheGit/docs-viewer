# CQRS 与事件驱动

> 基于 [官方文档 CQRS 章节](https://docs.nestjs.com/recipes/cqrs)，掌握命令查询职责分离与事件驱动架构。

## 目录

- [什么是 CQRS](#什么是-cqrs)
- [Command 命令](#command-命令)
- [Query 查询](#query-查询)
- [Event 事件](#event-事件)
- [Saga 流程管理](#saga-流程管理)
- [与微服务事件结合](#与微服务事件结合)
- [Server-Sent Events](#server-sent-events)
- [适用场景与最佳实践](#适用场景与最佳实践)

---

## 什么是 CQRS

CQRS（Command and Query Responsibility Segregation，命令查询职责分离）把应用的读写拆成两条链路：

```
┌─────────┐    Command（命令）    ┌────────────┐
│  客户端  │ ───────────────────▶ │ Command Bus│ ──▶ CommandHandler ──▶ 写库（聚合）
│         │                      └────────────┘            │
│         │                                                │ 发布 Event
│         │    Query（查询）      ┌────────────┐            ▼
│         │ ───────────────────▶ │ Query Bus  │      EventHandler（更新读模型/发通知）
│         │                      └────────────┘
└─────────┘

写模型（Write Model）：保证业务不变量、事务
读模型（Read Model）：为查询优化的投影（如宽表、ES 索引）
```

| 对比项 | 传统 CRUD | CQRS |
|--------|----------|------|
| 适用规模 | 小中型应用 | 大中型复杂业务 |
| 读写分离 | ❌ 同一模型 | ✅ 独立模型 |
| 事件回溯 | ❌ | ✅ 可审计 |
| 复杂度 | 低 | 高 |

> 💡 CQRS 是 `@nestjs/cqrs` 提供的可选模式，**不要为了模式而模式**——普通 CRUD 场景直接用 Service 即可。

### 安装

```bash
npm i --save @nestjs/cqrs
```

---

## Command 命令

### 定义命令与 Handler

```typescript
// users/commands/create-user.command.ts
export class CreateUserCommand {
  constructor(
    public readonly name: string,
    public readonly email: string,
  ) {}
}
```

```typescript
// users/commands/create-user.handler.ts
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { CreateUserCommand } from './create-user.command';

@CommandHandler(CreateUserCommand)
export class CreateUserHandler implements ICommandHandler<CreateUserCommand> {
  constructor(private readonly usersService: UsersService) {}

  async execute(command: CreateUserCommand): Promise<User> {
    const { name, email } = command;
    return this.usersService.create({ name, email });
  }
}
```

### 注册与发送

```typescript
// users.module.ts
import { CqrsModule } from '@nestjs/cqrs';

@Module({
  imports: [CqrsModule],
  providers: [
    UsersService,
    CreateUserHandler,       // 注册 Handler
    DeleteUserHandler,
  ],
  controllers: [UsersController],
})
export class UsersModule {}
```

```typescript
// users.controller.ts
import { CommandBus } from '@nestjs/cqrs';

@Controller('users')
export class UsersController {
  constructor(private readonly commandBus: CommandBus) {}

  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.commandBus.execute(
      new CreateUserCommand(dto.name, dto.email),
    );
  }
}
```

---

## Query 查询

```typescript
// users/queries/get-user.query.ts
export class GetUserQuery {
  constructor(public readonly id: number) {}
}

// users/queries/get-user.handler.ts
@QueryHandler(GetUserQuery)
export class GetUserHandler implements IQueryHandler<GetUserQuery> {
  constructor(private readonly readModel: UserReadModel) {}

  async execute(query: GetUserQuery): Promise<UserView> {
    return this.readModel.findById(query.id); // 查询走读模型
  }
}
```

```typescript
// controller
constructor(
  private readonly commandBus: CommandBus,
  private readonly queryBus: QueryBus,
) {}

@Get(':id')
findOne(@Param('id') id: number) {
  return this.queryBus.execute(new GetUserQuery(id));
}
```

> 💡 大多数团队实践：Command 走 `CommandBus`，查询直接注入只读 Service —— 只有查询确实需要独立投影时才用 `QueryBus`。

---

## Event 事件

当 Command 执行成功后，发布事件供其他组件响应（同进程解耦）。

### 定义事件与 Handler

```typescript
// users/events/user-created.event.ts
export class UserCreatedEvent {
  constructor(
    public readonly userId: number,
    public readonly email: string,
  ) {}
}

// users/events/user-created.handler.ts
@EventsHandler(UserCreatedEvent)
export class UserCreatedHandler implements IEventHandler<UserCreatedEvent> {
  constructor(
    private readonly mailService: MailService,          // 副作用1：发邮件
    private readonly readModel: UserReadModel,          // 副作用2：更新读模型
  ) {}

  handle(event: UserCreatedEvent) {
    this.mailService.sendWelcome(event.email);
    this.readModel.project(event.userId);
  }
}
```

### 在 Handler 中发布事件

推荐通过 `EventPublisher` 发布，让聚合根自动产生事件：

```typescript
@CommandHandler(CreateUserCommand)
export class CreateUserHandler implements ICommandHandler<CreateUserCommand> {
  constructor(
    private readonly repository: UsersRepository,
    private readonly publisher: EventPublisher,
  ) {}

  async execute(command: CreateUserCommand) {
    const user = this.publisher.mergeObjectContext(
      await this.repository.create(command.name, command.email),
    );
    user.commit(); // 发布聚合内累积的所有事件
    return user;
  }
}

// 聚合根内部
export class User {
  private id: number;

  create(name: string, email: string) {
    this.apply(new UserCreatedEvent(this.id, email)); // 记录事件
  }
}
```

也可以直接在 CommandHandler 中注入 `EventBus` 手动发布：

```typescript
constructor(private readonly eventBus: EventBus) {}

await this.eventBus.publish(new UserCreatedEvent(user.id, user.email));
```

### 事件处理器特性

- **异步执行**：`handle()` 返回的 Promise 不会被 Command 路径 await（发完即走）。
- **可注册多个 Handler**：同一事件可有多个 `@EventsHandler`，全部依次执行。
- **无事务保证**：事件处理失败不会回滚写库，需要自建重试/补偿。

---

## Saga 流程管理

Saga 用于编排跨多个命令的长流程（如：下单 → 扣库存 → 支付 → 通知）。

```typescript
// users/sagas/user.saga.ts
import { Injectable } from '@nestjs/common';
import { CommandBus, EventBus, ofType, Saga } from '@nestjs/cqrs';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { UserCreatedEvent } from '../events/user-created.event';
import { SendVerificationCommand } from '../commands/send-verification.command';

@Injectable()
export class UserSaga {
  @Saga()
  userCreated = (events$: Observable<any>): Observable<any> => {
    return events$.pipe(
      ofType(UserCreatedEvent),                      // 只关心这个事件
      map((event) => {
        console.log('Saga: 用户已创建，发送验证邮件', event.email);
        return new SendVerificationCommand(event.userId); // 触发下一步命令
      }),
    );
  };
}
```

```typescript
// 注册
@Module({
  providers: [UserSaga], // Saga 也是 Provider
})
```

> 💡 Saga 观察 `events$` 流，返回的命令会被自动执行，从而形成 **事件 → 命令 → 事件** 的链式编排。务必在管道中做过滤和限流，避免事件风暴。

---

## 与微服务事件结合

`@nestjs/cqrs` 是进程内的；跨服务传播需把 EventBus 桥接到 `ClientProxy`：

```typescript
// event-bridge.service.ts —— 把进程内事件转发到 Kafka/Redis
@Injectable()
export class EventBridge {
  constructor(
    private readonly eventBus: EventBus,
    @Inject('KAFKA_SERVICE') private readonly client: ClientProxy,
  ) {
    this.eventBus.subscribe((event) => {
      if (event instanceof UserCreatedEvent) {
        this.client.emit('user_created', { id: event.userId, email: event.email });
      }
    });
  }
}
```

> 💡 `EventBus.subscribe()` 在 NestJS 12 的生命周期下建议放在 `OnApplicationBootstrap` 中执行，避免启动顺序问题。

---

## Server-Sent Events

CQRS 事件流可以通过 SSE 直接推给浏览器（单向实时，比 WebSocket 轻量）：

```typescript
// events.controller.ts
import { Sse, MessageEvent } from '@nestjs/common';
import { Observable, map } from 'rxjs';

@Controller('events')
export class EventsController {
  constructor(private readonly eventBus: EventBus) {}

  @Sse('user')
  userEvents(): Observable<MessageEvent> {
    return this.eventBus.pipe(
      ofType(UserCreatedEvent),
      map((event) => ({
        data: { userId: event.userId, email: event.email },
      })),
    );
  }
}
```

前端使用原生 `EventSource` 消费：

```javascript
const es = new EventSource('/events/user');
es.onmessage = ({ data }) => console.log(JSON.parse(data));
```

---

## 适用场景与最佳实践

### 什么时候用 CQRS

✅ 适合：

- 业务规则复杂、写路径有明显领域逻辑（DDD 风格聚合）
- 读写负载差异大，需要独立优化（读走 ES/缓存投影）
- 需要事件审计、回溯（Event Sourcing 配合）

❌ 不适合：

- 简单 CRUD：增加 3 倍代码量却无收益
- 团队对 RxJS / 事件驱动不熟悉

### 最佳实践

1. **命令对象即意图**：命令名用业务动词（`SubmitOrderCommand`），不要叫 `UpdateUserDto`。
2. **一个 Command 一个 Handler**：禁止一个 Handler 处理多种命令。
3. **Command 内校验业务不变量，Controller 内只做格式校验**。
4. **事件只包含事实**：`UserCreatedEvent(email)`，不要放"应该发邮件"这种指令语义。
5. **Saga 每步幂等**：重复投递的事件不能产生重复副作用。
6. **给 Handler 写单测**：`Test.createTestingModule` 中用 `CommandBus`/`EventBus` 直接断言。

### 单元测试示例

```typescript
const moduleRef = await Test.createTestingModule({
  providers: [CreateUserHandler, UsersService, { provide: USER_REPO, useValue: repoMock }],
}).compile();
const handler = moduleRef.get(CreateUserHandler);

const user = await handler.execute(new CreateUserCommand('tom', 'tom@x.com'));
expect(user.email).toBe('tom@x.com');
expect(repoMock.save).toHaveBeenCalled();
```

---

## 下一步

- [21-高级特性](./21-高级特性.md)：注入作用域、动态模块进阶等框架底层能力
- [19-微服务架构](./19-微服务架构.md)：跨服务事件传播
- 官方文档：https://docs.nestjs.com/recipes/cqrs
