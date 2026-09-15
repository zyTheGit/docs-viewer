# NestJS 12 新特性与升级指南

> 基于 [NestJS v12.0.0 官方发布说明](https://github.com/nestjs/nest/releases/tag/v12.0.0) 与 [官方迁移指南](https://docs.nestjs.com/migration-guide)，总结 NestJS 12 的核心变化与平滑升级路径。

## 目录

- [版本概览](#版本概览)
- [ESM 化的官方包](#esm-化的官方包)
- [Standard Schema 支持（Zod/Valibot/ArkType）](#standard-schema-支持zodvalibotarktype)
- [原生可观测性 @nestjs/observe](#原生可观测性-nestjsobserve)
- [CLI v12 全面重构](#cli-v12-全面重构)
- [其他新特性](#其他新特性)
- [破坏性变更清单](#破坏性变更清单)
- [从 v11 升级步骤](#从-v11-升级步骤)
- [升级后检查清单](#升级后检查清单)

---

## 版本概览

NestJS 12 是近年最重要的平台级更新，围绕四个主题：

| 主题 | 内容 |
|------|------|
| **ESM 化** | 所有官方包以 ESM 发布，借助 Node `require(esm)` 保持 CJS 兼容 |
| **Standard Schema** | 验证与序列化原生支持 Zod / Valibot / ArkType |
| **CLI 重构** | `@nestjs/cli` v12：新命令、Rspack、Vitest、oxlint |
| **原生可观测性** | 官方 `@nestjs/observe` SDK，接入 Nest 请求生命周期 |

### 环境要求

- **Node.js v20.19+ 或 v22.12+**（21.x 不支持）
- CLI 升级命令在旧 Node 版本上会直接拒绝运行

---

## ESM 化的官方包

所有 `@nestjs/*` 核心包现在以 **ESM** 形式发布。得益于现代 Node.js 的 `require(esm)`，大多数现存 CommonJS 应用**无需任何改动**即可继续工作。

```bash
# 新项目创建时 CLI 会询问 CJS 还是 ESM
nest new my-app   # ? Which module system do you prefer? (CommonJS / ESM)
```

**需要自查的点**：

- 自定义 bootstrap 脚本、构建工具链、测试运行器是否假设 CJS-only 包
- 使用 webpack/ts-node 打包运行时的项目，检查 ESM 外部化配置
- 自有代码迁移到 ESM **完全是可选的**，没有时间压力

---

## Standard Schema 支持（Zod/Valibot/ArkType）

### 路由参数校验

参数装饰器 `@Body()`、`@Query()`、`@Param()`、`@RawBody()` 新增 `schema` 选项，直接接受 [Standard Schema](https://standardschema.dev/) 兼容库（如 Zod）的 schema：

```typescript
import { z } from 'zod';

const createUserSchema = z.object({
  name: z.string().min(3),
  email: z.string().email(),
});

@Post()
create(@Body({ schema: createUserSchema }) body: CreateUserDto) {
  return this.usersService.create(body);
}

@Get(':id')
findOne(
  @Param('id', { schema: z.coerce.number().int().positive() }) id: number,
) {
  return this.usersService.findOne(id);
}
```

装饰器只负责挂载元数据，还需要注册全局的 `StandardSchemaValidationPipe` 才会真正执行校验：

```typescript
// main.ts
app.useGlobalPipes(new StandardSchemaValidationPipe());
```

### 响应序列化

```typescript
import { StandardSchemaSerializerInterceptor } from '@nestjs/common';

@UseInterceptors(StandardSchemaSerializerInterceptor)
@SerializeOptions({ schema: userResponseSchema })  // 同一套 schema 复用于出参
@Get(':id')
findOne(@Param('id') id: string) {
  return this.usersService.findOne(id);
}
```

### 如何选择

| 场景 | 推荐方案 |
|------|----------|
| 团队已有 class-validator DTO 体系 | `ValidationPipe` + `ClassSerializerInterceptor`（继续支持，不会移除） |
| 新项目 / 已有 Zod schema（前后端复用） | `StandardSchemaValidationPipe` + `StandardSchemaSerializerInterceptor` |

### Schema 驱动 OpenAPI

Standard Schema 会直接喂给 OpenAPI 文档生成，无需为 Swagger 重复维护一套 `@ApiProperty`。

### @nestjs/config 改用 Standard Schema

```typescript
ConfigModule.forRoot({
  validationSchema: z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(3000),
  }),
});
```

旧 Joi schema 仍然可用，但要注意两点：

1. 升级到 **Joi v18+**（首个实现 Standard Schema 的版本）
2. 库相关配置移到 `validationOptions.libraryOptions`

---

## 原生可观测性 @nestjs/observe

官方 [NestJS Observe](https://observe.nestjs.com) SDK 通过 `instrument` 应用选项接入 Nest 自己的请求生命周期，而非像通用 APM 一样 patch HTTP server。追踪信息以你的**控制器、Provider、Resolver、队列消费者**为单位呈现：

```typescript
export const { ObserveModule, ObserveInstrument } = createObserveModule();

const app = await NestFactory.create(AppModule, {
  instrument: ObserveInstrument,
});
```

- **自动埋点**：HTTP、GraphQL、gRPC、微服务传输层、队列消费、Cron 任务
- 无需手写 Span，无需自建 Collector
- 完全可选、新项目可由 `nest new --observe` / `nest upgrade --observe` 一键接入

---

## CLI v12 全面重构

CLI 源码迁移至 ESM、测试从 Jest 改为 Vitest，并为每条命令增加了 e2e 测试。

### 新命令

```bash
# 一键升级到 v12（自动执行迁移步骤，详见下文）
nest upgrade        # 别名 nest update
nest upgrade --dry-run   # 先看报告不动文件（推荐第一步）

# 部署到云平台（通过 Mau）
nest deploy
```

### 构建器默认值变化

| 项 | v11 | v12 |
|----|-----|-----|
| monorepo 打包器 | webpack | **Rspack** |
| lint | ESLint | **oxlint** |
| 测试运行器（ESM 项目） | Jest | **Vitest**（CJS 项目仍为 Jest） |
| 包管理器 | npm/yarn/pnpm | 增加 **bun** |

```bash
# webpack 相关 flag 已弃用，改用 --builder rspack
nest build --builder rspack
```

### 新增构建选项

```bash
nest build --rspackPath ./custom-rspack.config.js
nest build --emit-declarations    # SWC 下输出声明文件
nest build --no-type-check
nest build --silent
nest build --parallel             # monorepo 并行构建（配合 --all）
```

`nest-cli.json` 新增 `includeLibraryAssets`：把库的静态资源复制进应用构建产物。

> ⚠️ `angular` schematic 已移除；`decorator` schematic 默认生成 `Reflector.createDecorator()` 形式。

---

## 其他新特性

### 路由冲突诊断

路由按声明顺序注册，`@Get(':id')` 可能静默遮蔽其后声明的 `@Get('me')`。v12 提供两个**可选开启**的诊断项：

```typescript
const app = await NestFactory.create(AppModule, {
  routeConflictPolicy: {
    duplicate: 'error',   // 重复路由报错
    shadow: 'warn',       // 被遮蔽的路由告警
  },
  routeResolutionStrategy: 'specificity', // 按特异性（静态段优先）解析
});
```

默认行为与旧版一致，不设置无任何变化。

### 机器可读错误码

`HttpExceptionOptions` 新增 `errorCode`，序列化进响应体，客户端不再解析 message 字符串：

```typescript
throw new BadRequestException('密码强度不足', { errorCode: 'WEAK_PASSWORD' });
// 响应体: { statusCode: 400, message: '密码强度不足', errorCode: 'WEAK_PASSWORD' }
```

### 结构化日志参数

`ConsoleLogger` 把 message 后面的普通对象作为结构化参数合并进同一条日志：

```typescript
logger.log('User created', { userId: 1, email: 'foo@bar.com' });
// JSON 模式下嵌套在 params 下；flattenParams: true 时平铺到根
```

如需恢复旧行为：`structuredParams: false`。

### 其他改进速览

- **`ValidationPipe` 错误格式**可配置
- **`GrpcExceptionFilter`** 与 gRPC 状态异常类：错误映射到真实 gRPC 状态码而非 `UNKNOWN`
- **Kafka 正则模式**：`@MessagePattern()` / `@EventPattern()` 接受 `RegExp`
- **请求级 WebSocket Gateway**：支持 request-scoped Provider，socket 可通过 `REQUEST` 注入
- **WebSocket 断开原因**：`handleDisconnect` 可接收断开原因
- **微服务前置 Hook**：消息 handler 调用前的新钩子
- **Express 优雅关闭**：适配器排水处理中的请求
- **HTTP 适配器错误映射**：核心/Express/Fastify 全面重做

---

## 破坏性变更清单

| 变更 | 需要做什么 |
|------|-----------|
| 官方包以 **ESM** 发布 | 通常无需动作（`require(esm)` 兜底）；检查自定义 bootstrap/打包/测试配置 |
| **Node v20.19+ / v22.12+** 必须 | 升级 Node；21.x 不支持 |
| **生命周期钩子按组件层级触发** | 复查 init/teardown 中 Provider/Module 的顺序假设 |
| **NATS v3**：`nats` 包 → `@nats-io/transport-node` | 卸载旧包装新包，更新导入；载荷序列化为 JSON 字符串，反序列化器读取完整消息 |
| **GraphQL 订阅**移除 `subscriptions-transport-ws` | 切换 `graphql-ws`（协议不兼容，客户端需同步更新）；复查 `onConnect` |
| **GraphQL IDE** 默认 GraphiQL | `playground` 配置改为 `graphiql` |
| **@nestjs/config** 走 Standard Schema | Joi 用户升级到 v18+，库配置移到 `validationOptions.libraryOptions` |
| **管道 transform 签名精简**，`ArgumentMetadata` 泛型化 | 自定义管道签名如有编译报错需调整 |
| **ConsoleLogger 结构化参数**默认开启 | 需要旧行为设 `structuredParams: false` |
| **webpack CLI 工作流弃用** | 迁移到 `--builder rspack` |
| **angular schematic 移除** | — |

---

## 从 v11 升级步骤

### 1. 升级 Node.js

```bash
# 20.19+ 或 22.12+
nvm install 22 && nvm use 22
```

### 2. 升级 CLI

```bash
npm i -g @nestjs/cli@latest
```

### 3. 执行 nest upgrade（推荐）

```bash
nest upgrade --dry-run   # 第一步：预览报告
nest upgrade             # 第二步：自动迁移 + 输出人工复查清单
```

`nest upgrade` 会自动完成：

- 所有 `@nestjs/*` 包移动到 v12 兼容大版本
- `nest-cli.json` 的 webpack 选项迁移
- GraphQL `playground` → `graphiql`、订阅传输替换
- NATS 包替换
- `@nestjs/config` 校验选项、Jest 与 Joi 版本升级

**不会**自动做：项目迁移到 ESM、Vitest、oxlint——新项目默认使用它们，老项目自行择机。

### 4. 人工复查

- 跑全量测试与 E2E
- 检查生命周期钩子顺序依赖
- 微服务项目检查 NATS / gRPC 异常
- GraphQL 项目切换 `graphql-ws` 并更新前端客户端

---

## 升级后检查清单

```markdown
- [ ] Node >= 20.19（或 22.12+）
- [ ] @nestjs/cli 已升级并重跑 nest upgrade
- [ ] 全量单测 + E2E 通过
- [ ] 无自定义管道签名编译错误
- [ ] ConsoleLogger 输出格式确认（或显式关闭 structuredParams）
- [ ] 微服务：NATS 客户端包已替换；gRPC 错误状态码符合预期
- [ ] GraphQL：graphiql 配置生效；订阅走 graphql-ws
- [ ] Config 校验：Joi >= 18 或已迁移 Zod
- [ ] （可选）评估接入 @nestjs/observe
- [ ] （可选）monorepo 构建--builder rspack 验证
- [ ] CI 中移除对 webpack flag / angular schematic 的引用
```

---

## 参考链接

- 发布公告：https://trilon.io/blog/nestjs-12-is-now-available
- Release Notes：https://github.com/nestjs/nest/releases/tag/v12.0.0
- 迁移指南：https://docs.nestjs.com/migration-guide
- Observe SDK：https://observe.nestjs.com
