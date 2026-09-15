# WebSocket 实时通信

> 基于 [官方文档 Web Sockets 章节](https://docs.nestjs.com/websockets/gateways)，掌握 NestJS 中实时通信的完整方案。

## 目录

- [Gateway 网关基础](#gateway-网关基础)
- [处理消息](#处理消息)
- [生命周期钩子](#生命周期钩子)
- [命名空间与房间](#命名空间与房间)
- [在服务中使用 WebSocket](#在服务中使用-websocket)
- [认证与鉴权](#认证与鉴权)
- [中间件与异常处理](#中间件与异常处理)
- [原生 WebSocket（ws）](#原生-websocketws)
- [最佳实践](#最佳实践)

---

## Gateway 网关基础

Gateway（网关）是 NestJS 中处理 WebSocket 连接的核心组件，本质上是一个封装了 `@socket.io`（或 `ws` 库）的**特殊提供者**。

### 安装

```bash
# Socket.IO（默认，功能丰富）
npm i --save @nestjs/websockets @nestjs/platform-socket.io

# 或原生 ws（更轻量）
npm i --save @nestjs/websockets @nestjs/platform-ws
```

### 创建 Gateway

```bash
# 使用 CLI 创建
nest g gateway events
```

```typescript
// events.gateway.ts
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway(8080, {
  namespace: 'chat',        // 命名空间，默认 '/'
  cors: { origin: '*' },    // 跨域配置
})
export class ChatGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  // 注入 Socket.IO 的 Server 实例
  @WebSocketServer()
  server: Server;

  // 客户端连接时触发
  handleConnection(client: Socket, ...args: any[]) {
    console.log(`客户端连接: ${client.id}`);
  }

  // 客户端断开时触发
  handleDisconnect(client: Socket) {
    console.log(`客户端断开: ${client.id}`);
  }
}
```

> 💡 **要点**：Gateway 也是一个 Provider，需要在模块的 `providers` 中注册（使用 CLI 创建时会自动注册）。

```typescript
// events.module.ts
@Module({
  providers: [ChatGateway],
})
export class EventsModule {}
```

### 端口与主应用共享

如果传入 `80` 或不指定端口，Gateway 会与 HTTP 服务器共享同一个端口，通常推荐这样做：

```typescript
@WebSocketGateway({ cors: { origin: '*' } })  // 共享 HTTP 端口
```

---

## 处理消息

### @SubscribeMessage

```typescript
import { SubscribeMessage, MessageBody, ConnectedSocket } from '@nestjs/websockets';

@WebSocketGateway()
export class ChatGateway {
  @SubscribeMessage('message')
  handleMessage(
    @MessageBody() data: { room: string; content: string },
    @ConnectedSocket() client: Socket,
  ) {
    // 广播给所有人
    this.server.emit('message', data);
    // 或只回给发送者
    return { event: 'pong', data: 'received' };
  }
}
```

### 消息数据校验（结合管道）

Gateway 方法同样支持 NestJS 的管道系统：

```typescript
import { UsePipes, ValidationPipe } from '@nestjs/common';

class CreateMessageDto {
  @IsString()
  content: string;

  @IsString()
  room: string;
}

@UsePipes(new ValidationPipe())
@SubscribeMessage('create')
handleCreate(@MessageBody() data: CreateMessageDto) {
  // data 已通过 class-validator 校验
}
```

### 客户端响应

处理函数的返回值会自动作为 `ack` 回调发送给客户端；也可以显式指定事件名：

```typescript
@SubscribeMessage('events')
handleEvents(@MessageBody() data: unknown): WsResponse<unknown> {
  const event = 'events';
  return { event, data };
}
```

客户端（Socket.IO）使用 ack 回调：

```typescript
// 前端
socket.emit('events', payload, (response) => {
  console.log(response);
});
```

### 异步处理

```typescript
@SubscribeMessage('fetch')
async handleFetch(@MessageBody() id: number): Promise<any> {
  return this.usersService.findOne(id); // 自动等待 Promise
}
```

---

## 生命周期钩子

Gateway 支持完整的生命周期接口：

| 接口 | 触发时机 |
|------|----------|
| `OnGatewayInit` | Gateway 初始化后（`afterInit`） |
| `OnGatewayConnection` | 客户端连接（`handleConnection`） |
| `OnGatewayDisconnect` | 客户端断开（`handleDisconnect`） |

```typescript
import { OnGatewayInit } from '@nestjs/websockets';

@WebSocketGateway()
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  afterInit(server: Server) {
    console.log('WebSocket 服务器已初始化');
  }

  handleConnection(client: Socket) {
    client.emit('welcome', { msg: '欢迎连接' });
  }

  handleDisconnect(client: Socket, reason?: string) {
    // NestJS 12+：handleDisconnect 可接收断开原因
    console.log(`${client.id} 断开，原因: ${reason}`);
  }
}
```

---

## 命名空间与房间

### 命名空间（Namespace）

```typescript
// 指定命名空间
@WebSocketGateway({ namespace: '/chat' })
export class ChatGateway {
  @WebSocketServer()
  server: Namespace;
}

// 在同一 Gateway 中访问多个命名空间
@WebSocketServer()
server: Server;

someMethod() {
  // 使用任意命名空间
  this.server.of('/chat').emit('msg', 'hello chat');
  this.server.of('/admin').emit('alert', 'admin notice');
}
```

### 房间（Room）

```typescript
@SubscribeMessage('join')
handleJoin(@ConnectedSocket() client: Socket, @MessageBody() room: string) {
  client.join(room);  // 加入房间
  return { joined: room };
}

@SubscribeMessage('leave')
handleLeave(@ConnectedSocket() client: Socket, @MessageBody() room: string) {
  client.leave(room); // 离开房间
}

@SubscribeMessage('roomMessage')
handleRoomMessage(@MessageBody() data: { room: string; content: string }) {
  // 只发送给房间内的客户端（不包含发送者）
  this.server.to(data.room).emit('roomMessage', data.content);
  // 发送给房间内除指定客户端外的所有人
  // this.server.to(data.room).except(client.id).emit('roomMessage', data.content);
}
```

---

## 在服务中使用 WebSocket

业务 Service 中可以通过注入 `IoAdapter` 或直接注入 Gateway 来推送消息。**推荐方式**：注入 Gateway 实例。

```typescript
// notifications.service.ts
import { Injectable } from '@nestjs/common';
import { NotificationsGateway } from './notifications.gateway';

@Injectable()
export class NotificationsService {
  constructor(private readonly gateway: NotificationsGateway) {}

  notifyUser(userId: number, message: string) {
    // 从 HTTP 请求处理中向 WebSocket 客户端推送
    this.gateway.server.to(`user-${userId}`).emit('notification', { message });
  }
}
```

```typescript
// notifications.gateway.ts
@WebSocketGateway()
export class NotificationsGateway {
  @WebSocketServer()
  server: Server;
}
```

> ⚠️ Gateway 必须在同一个模块（或被导出）中才能被注入，否则需要通过模块导入。

---

## 认证与鉴权

### 连接时握手认证

```typescript
@WebSocketGateway()
export class AuthGateway implements OnGatewayConnection {
  constructor(private jwtService: JwtService) {}

  async handleConnection(client: Socket) {
    try {
      // 从握手请求中取 token
      const token = client.handshake.auth?.token
        ?? client.handshake.headers.authorization?.split(' ')[1];

      const payload = await this.jwtService.verifyAsync(token);
      // 将用户信息挂到 socket 上，后续使用
      client.data.user = payload;
    } catch {
      client.emit('error', { message: '认证失败' });
      client.disconnect(); // 断开未授权连接
    }
  }
}
```

### Guard 守卫

WebSocket 同样支持 Guard，通过 `WsException` 抛错：

```typescript
// ws-jwt.guard.ts
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { WsException } from '@nestjs/websockets';

@Injectable()
export class WsJwtGuard extends AuthGuard('jwt') {
  handleRequest(err: any, user: any) {
    if (err || !user) {
      throw new WsException('未授权');
    }
    return user;
  }
}
```

```typescript
@UseGuards(WsJwtGuard)
@SubscribeMessage('privateMessage')
handlePrivate(@ConnectedSocket() client: Socket, @MessageBody() data: any) {
  // client.data.user 由 Guard 注入
}
```

---

## 中间件与异常处理

### WsAdapter

Nest 默认使用 `IoAdapter`（Socket.IO）。自定义适配器可实现 `AbstractWsAdapter`，或在 `main.ts` 中配置：

```typescript
const app = await NestFactory.create(AppModule);
app.useWebSocketAdapter(new IoAdapter(app)); // 默认
// app.useWebSocketAdapter(new WsAdapter(app)); // 原生 ws
```

### 异常过滤器

```typescript
// ws-exception.filter.ts
import { Catch, ArgumentsHost } from '@nestjs/common';
import { BaseWsExceptionFilter, WsException } from '@nestjs/websockets';

@Catch(WsException)
export class WsExceptionFilter extends BaseWsExceptionFilter {
  catch(exception: WsException, host: ArgumentsHost) {
    const client = host.switchToWs().getClient();
    client.emit('error', {
      message: exception.message,
      timestamp: new Date().toISOString(),
    });
  }
}

// 在 Gateway 上应用
@WebSocketGateway()
@UseFilters(new WsExceptionFilter())
export class ChatGateway {}
```

---

## 原生 WebSocket（ws）

如果不需要 Socket.IO 的高级功能（房间、自动重连、降级传输），可以使用更轻量的 `ws` 适配器：

```bash
npm i --save @nestjs/platform-ws
```

```typescript
// main.ts
import { WsAdapter } from '@nestjs/platform-ws';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useWebSocketAdapter(new WsAdapter(app));
  await app.listen(3000);
}
```

```typescript
// gateway 代码基本相同，客户端类型为 WebSocket
@WebSocketGateway(8080)
export class EventsGateway {
  @SubscribeMessage('events')
  onEvent(client: WebSocket, data: unknown) {
    return { event: 'events', data };
  }
}
```

> 💡 前端原生 `ws` 客户端需要手动组装消息格式：`JSON.stringify({ event: 'events', data: payload })`。

---

## 最佳实践

### 1. 共享 HTTP 端口

生产环境通常经过 Nginx/负载均衡，只暴露一个端口。Gateway 不要单独占用端口：

```typescript
@WebSocketGateway({ path: '/socket.io' }) // 不传端口，共享 3000
```

### 2. 心跳与断线检测

Socket.IO 自带心跳；使用原生 `ws` 时需要自己实现 ping/pong。

### 3. 水平扩展时使用 Redis 适配器

多实例部署时，连接分散在不同进程，需要 `socket.io-redis-adapter` 广播事件：

```bash
npm i --save socket.io-redis-adapter redis
```

```typescript
// main.ts（伪代码示例）
const pubClient = createClient({ url: 'redis://localhost:6379' });
const subClient = pubClient.duplicate();
io.adapter(createAdapter(pubClient, subClient));
```

### 4. 不要在 Gateway 中写业务逻辑

保持 Gateway 薄：接收消息 → 转发 Service → 返回/推送结果，业务逻辑全部放在 Service。

### 5. 管控连接数

在 `handleConnection` 中检查在线数量，超过阈值主动断开，防止恶意连接耗尽资源。

---

## 下一步

- [18-GraphQL深入](./18-GraphQL深入.md)：另一种替代 REST 的 API 风格
- [19-微服务架构](./19-微服务架构.md)：服务间实时通信的另一种形态
- 官方文档：https://docs.nestjs.com/websockets/gateways
