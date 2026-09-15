# Nest 开发指南

> 一个完整的 NestJS 开发文档体系，涵盖从入门到精通的所有内容。

## 📚 文档目录

### 入门篇

1. [安装与配置](./01-安装与配置.md) - 环境搭建、项目创建、配置管理
2. [核心概念](./02-核心概念.md) - Nest 架构理念、依赖注入、生命周期

### 基础篇

3. [模块系统](./03-模块系统.md) - 模块组织、动态模块、全局模块
4. [控制器](./04-控制器.md) - 路由、请求处理、参数装饰器
5. [提供者](./05-提供者.md) - Service、Repository、工厂提供者

### 进阶篇

6. [中间件](./06-中间件.md) - 请求预处理、日志记录
7. [管道](./07-管道.md) - 数据验证、数据转换
8. [守卫](./08-守卫.md) - 权限控制、认证保护
9. [拦截器](./09-拦截器.md) - 响应转换、日志记录、缓存
10. [异常过滤器](./10-异常过滤器.md) - 异常处理、错误响应

### 数据篇

11. [数据库集成](./11-数据库集成.md) - TypeORM、Prisma、Mongoose
12. [认证与授权](./12-认证与授权.md) - JWT、Passport、RBAC

### 工程篇

13. [测试](./13-测试.md) - 单元测试、E2E 测试、测试覆盖率
14. [部署](./14-部署.md) - Docker、PM2、云平台部署
15. [最佳实践](./15-最佳实践.md) - 项目结构、代码规范、性能优化
16. [常用插件](./16-常用插件.md) - Swagger、Config、Queue、Redis

### 架构篇（高级）

17. [WebSocket 实时通信](./17-WebSocket实时通信.md) - Gateway、命名空间、房间、实时推送
18. [GraphQL 深入](./18-GraphQL深入.md) - Code-first、Dataloader、订阅
19. [微服务架构](./19-微服务架构.md) - TCP/Redis/NATS/Kafka/gRPC 传输层
20. [CQRS 与事件驱动](./20-CQRS与事件驱动.md) - 命令/查询分离、事件、Saga、SSE

### 精通篇

21. [高级特性](./21-高级特性.md) - 注入作用域、生命周期、动态模块、热重载
22. [NestJS 12 新特性与升级](./22-NestJS-12新特性与升级.md) - ESM、Standard Schema、可观测性、迁移指南

---

## 🚀 快速开始

### 什么是 NestJS？

NestJS 是一个用于构建高效、可扩展的 Node.js 服务器端应用程序的框架。它使用 TypeScript（但也支持纯 JavaScript）构建，并融合了 OOP（面向对象编程）、FP（函数式编程）和 FRP（函数式响应式编程）的元素。

### 核心特性

- **TypeScript 支持** - 完整的类型系统
- **模块化架构** - 易于组织和维护
- **依赖注入** - 松耦合、易测试
- **丰富的生态系统** - 大量开箱即用的模块
- **兼容 Express/Fastify** - 灵活的 HTTP 平台选择
- **GraphQL 支持** - 内置 GraphQL 模块
- **WebSocket 支持** - 实时通信能力
- **微服务架构** - 支持多种传输层

### 技术栈

| 技术 | 用途 |
|------|------|
| Node.js | 运行时环境 |
| TypeScript | 编程语言 |
| Express/Fastify | HTTP 平台 |
| TypeORM/Prisma | 数据库 ORM |
| JWT | 身份认证 |
| Swagger | API 文档 |
| Jest | 测试框架 |

### 项目结构

```
nest-project/
├── src/
│   ├── main.ts                 # 应用入口
│   ├── app.module.ts           # 根模块
│   ├── app.controller.ts       # 根控制器
│   ├── app.service.ts          # 根服务
│   ├── common/                 # 公共模块
│   │   ├── decorators/         # 自定义装饰器
│   │   ├── filters/            # 异常过滤器
│   │   ├── guards/             # 守卫
│   │   ├── interceptors/       # 拦截器
│   │   ├── pipes/              # 管道
│   │   └── dto/                # 公共 DTO
│   ├── modules/                # 业务模块
│   │   ├── auth/               # 认证模块
│   │   ├── user/               # 用户模块
│   │   └── post/               # 文章模块
│   └── config/                 # 配置文件
├── test/                       # 测试文件
├── package.json
├── tsconfig.json
├── nest-cli.json
└── README.md
```

### 核心概念速览

```typescript
// 模块 (Module)
@Module({
  imports: [],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

// 控制器 (Controller)
@Controller('users')
export class UsersController {
  @Get()
  findAll(): string {
    return 'This action returns all users';
  }
}

// 提供者 (Provider)
@Injectable()
export class UsersService {
  private readonly users: User[] = [];

  create(user: User) {
    this.users.push(user);
  }

  findAll(): User[] {
    return this.users;
  }
}

// 中间件 (Middleware)
@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: Function) {
    console.log('Request...');
    next();
  }
}

// 管道 (Pipe)
@Injectable()
export class ValidationPipe implements PipeTransform {
  transform(value: any, metadata: ArgumentMetadata) {
    return value;
  }
}

// 守卫 (Guard)
@Injectable()
export class RolesGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    return true;
  }
}

// 拦截器 (Interceptor)
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle();
  }
}

// 异常过滤器 (Exception Filter)
@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
    });
  }
}
```

### 快速创建项目

```bash
# 安装 CLI
npm i -g @nestjs/cli

# 创建新项目
nest new project-name

# 启动开发服务器
npm run start:dev

# 创建模块
nest g module users

# 创建控制器
nest g controller users

# 创建服务
nest g service users

# 完整创建（模块+控制器+服务）
nest g resource users
```

---

## 🎯 学习路线

### 初学者（1-2周）

1. 学习 TypeScript 基础
2. 掌握 Nest 基本概念
3. 理解模块、控制器、服务
4. 完成一个简单的 CRUD 项目

### 中级开发者（2-4周）

1. 深入理解依赖注入
2. 掌握中间件、管道、守卫、拦截器
3. 数据库集成（TypeORM/Prisma）
4. 认证授权实现
5. 测试编写

### 高级开发者（1-2月）

1. 微服务架构
2. GraphQL 集成
3. WebSocket 实时通信
4. CQRS 与事件驱动
5. 性能优化
6. 部署与运维
7. 跟进 NestJS 12 新特性（ESM / Standard Schema / 可观测性）

---

## 🔗 官方资源

- **官方网站：** https://nestjs.com
- **官方文档：** https://docs.nestjs.com
- **GitHub：** https://github.com/nestjs/nest
- **Discord 社区：** https://discord.gg/nestjs
- **Twitter：** @nestframework

---

## 📝 文档说明

本系列文档基于：
- NestJS v12（2026 年最新版）
- TypeScript 5.x
- Node.js 20 LTS+（v12 最低要求 20.19+）
- 实战项目经验总结

每个文档都包含：
- ✅ 详细的概念讲解
- ✅ 完整的代码示例
- ✅ 最佳实践建议
- ✅ 常见问题解答

---

**文档版本：** 2.0  
**最后更新：** 2026-04-06  
**维护者：** opencode AI 助手