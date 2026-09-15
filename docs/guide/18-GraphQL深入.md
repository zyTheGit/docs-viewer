# GraphQL 深入

> 基于 [官方文档 GraphQL 章节](https://docs.nestjs.com/graphql/quick-start)，深入 NestJS 的 GraphQL 集成。

## 目录

- [安装与配置](#安装与配置)
- [两种开发模式](#两种开发模式)
- [Object Type 与 Resolver](#object-type-与-resolver)
- [输入类型与返回类型](#输入类型与返回类型)
- [与 HTTP 装饰器协同](#与-http-装饰器协同)
- [解决 N+1 问题](#解决-n1-问题)
- [订阅（Subscription）](#订阅subscription)
- [Directive 与中间件](#directive-与中间件)
- [代码生成与最佳实践](#代码生成与最佳实践)

---

## 安装与配置

```bash
# Apollo 驱动
npm i @nestjs/graphql @nestjs/apollo graphql @apollo/server

# 或 Mercurius 驱动（Fastify 生态）
npm i @nestjs/graphql @nestjs/mercurius graphql
```

```typescript
// app.module.ts
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: 'schema.gql',      // Code-first：自动生成 schema 文件
      // sortSchema: true,               // schema 排序
      // autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
      //  context: ({ req }) => ({ req }), // 自定义 context
    }),
  ],
})
export class AppModule {}
```

> ⚠️ **NestJS 12 变更**：GraphQL IDE 默认从 `playground` 改为 `graphiql`，配置项 `playground: true` 需替换为 `graphiql: true`；订阅传输不再支持 `subscriptions-transport-ws`，必须使用 `graphql-ws`。

---

## 两种开发模式

| 模式 | 描述 | 适用场景 |
|------|------|----------|
| **Code First** | 用装饰器定义类型，自动生成 SDL schema | TypeScript 项目（推荐） |
| **Schema First** | 手写 `.gql` schema，Nest 生成对应接口 | 团队已有 schema、多语言协作 |

### Schema First

```typescript
GraphQLModule.forRoot<ApolloDriverConfig>({
  driver: ApolloDriver,
  typePaths: ['./**/*.graphql'],   // 扫描 schema 文件
  definitions: {
    path: join(process.cwd(), 'src/graphql.ts'), // 自动生成 TS 类型
    outputAs: 'class',
  },
})
```

### Code First（推荐）

本篇后续均以 Code First 为例。

---

## Object Type 与 Resolver

```typescript
// user.object.ts —— 定义 GraphQL 类型
import { ObjectType, Field, Int, ID } from '@nestjs/graphql';

@ObjectType()
export class User {
  @Field(() => ID)
  id: number;

  @Field()
  username: string;

  @Field({ nullable: true })
  bio?: string;

  @Field(() => Int)
  age?: number;

  @Field(() => [Post], { nullable: 'items' }) // 数组项可空
  posts?: Post[];
}
```

```typescript
// users.resolver.ts
import { Resolver, Query, Mutation, Args, ID } from '@nestjs/graphql';

@Resolver(() => User)
export class UsersResolver {
  constructor(private usersService: UsersService) {}

  @Query(() => [User], { name: 'users' })   // name 覆盖默认字段名
  findAll() {
    return this.usersService.findAll();
  }

  @Query(() => User, { nullable: true })    // 返回可能为空
  user(@Args('id', { type: () => ID }) id: number) {
    return this.usersService.findOne(id);
  }

  @Mutation(() => User)
  createUser(@Args('input') input: CreateUserInput) {
    return this.usersService.create(input);
  }
}
```

> 💡 **要点**：`@Args()` 的 `type` 函数必须显式提供（TS 元数据在原始类型上会丢失）。GraphQLModule 必须在某个模块中导入，Resolver 需注册到 `providers`。

---

## 输入类型与返回类型

### Input Type（写操作的参数）

```typescript
// dto/create-user.input.ts
import { InputType, Field } from '@nestjs/graphql';
import { MinLength, IsEmail } from 'class-validator';

@InputType()
export class CreateUserInput {
  @Field()
  @MinLength(3)
  username: string;

  @Field()
  @IsEmail()
  email: string;
}
```

### Partial Type（复用 DTO）

```typescript
import { PartialType } from '@nestjs/graphql';
import { CreateUserInput } from './create-user.input';

@InputType()
export class UpdateUserInput extends PartialType(CreateUserInput) {}
// 所有字段变为可选
```

### 嵌套对象与接口

```typescript
import { InterfaceType, Field } from '@nestjs/graphql';

@InterfaceType()
export abstract class Node {
  @Field(() => ID)
  id: number;
}

@ObjectType({ implements: () => Node })
export class User extends Node {}
```

---

## 与 HTTP 装饰器协同

Resolver 中可以使用 `@Req`、`@Res`、`@Context` 等：

```typescript
@Resolver(() => User)
export class UsersResolver {
  @Query(() => User)
  me(@Context() ctx: { req: { user: User } }) {
    return ctx.req.user;
  }

  // 守卫同样可用
  @UseGuards(GqlAuthGuard)
  @Mutation(() => Boolean)
  logout() { return true; }
}
```

### 自定义 Guard 中取 GraphQL context

```typescript
import { GqlExecutionContext } from '@nestjs/graphql';

@Injectable()
export class GqlAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const ctx = GqlExecutionContext.create(context);
    const { req } = ctx.getContext();
    return !!req.user;
  }
}
```

---

## 解决 N+1 问题

GraphQL 按需查询嵌套关系时极易产生 N+1 查询。使用 **Dataloader** 批量合并请求：

```bash
npm i dataloader
```

```typescript
// posts.loader.ts
import { Injectable, Scope } from '@nestjs/common';
import * as DataLoader from 'dataloader';
import { NestDataLoader } from 'nestjs-dataloader';

@Injectable({ scope: Scope.REQUEST }) // 每个请求一个实例（缓存隔离）
export class PostsLoader implements NestDataLoader<number, Post[]> {
  constructor(private postsService: PostsService) {}

  generateDataLoader(): DataLoader<number, Post[]> {
    return new DataLoader<number, Post[]>((authorIds) =>
      this.postsService.findByAuthorIds(authorIds), // 一次 IN 查询
    );
  }
}
```

```typescript
// users.resolver.ts
@ResolveField('posts', () => [Post])
posts(
  @Parent() user: User,
  @Loader(PostsLoader) postsLoader: DataLoader<number, Post[]>,
) {
  return postsLoader.load(user.id);
}
```

> 💡 **要点**：
> - Loader 必须是 `Scope.REQUEST`，防止不同请求间缓存串数据。
> - Dataloader 每个请求内自动合并同一 tick 的多个 `load()` 为一次批量查询。

---

## 订阅（Subscription）

实时推送数据变更，配合 `graphql-ws` 协议（NestJS 12 仅支持该协议）：

```typescript
// app.module.ts 配置
GraphQLModule.forRoot<ApolloDriverConfig>({
  driver: ApolloDriver,
  autoSchemaFile: 'schema.gql',
  subscriptions: {
    'graphql-ws': true,  // 默认协议（Nest 12 要求）
    // path: '/graphql',
  },
})
```

```typescript
// posts.resolver.ts
import { Subscription, Resolver } from '@nestjs/graphql';
import { PubSub } from 'graphql-subscriptions';

const pubSub = new PubSub();

@Resolver(() => Post)
export class PostsResolver {
  @Mutation(() => Post)
  createPost(@Args('input') input: CreatePostInput) {
    const post = this.postsService.create(input);
    // 发布事件
    pubSub.publish('postCreated', { postCreated: post });
    return post;
  }

  @Subscription(() => Post, {
    filter: (payload, variables) =>
      // 只推送给订阅了特定作者的客户
      payload.postCreated.authorId === variables.authorId,
    // resolve: (payload) => payload.postCreated, // 自定义返回结构
  })
  postCreated(@Args('authorId', { nullable: true }) authorId?: number) {
    return pubSub.asyncIterator('postCreated');
  }
}
```

生产环境可将 `PubSub` 换成基于 Redis 的实现（`graphql-redis-subscriptions`），支持多实例广播。

---

## Directive 与中间件

### 自定义 Directive

```typescript
// upper.directive.ts
import { SchemaDirectiveVisitor } from '@graphql-tools/utils';
import { defaultFieldResolver, GraphQLField } from 'graphql';

class UpperCaseDirective {
  visitFieldDefinition(field: GraphQLField<any, any>) {
    const { resolve = defaultFieldResolver } = field;
    field.resolve = async (...args) => {
      const result = await resolve(...args);
      return typeof result === 'string' ? result.toUpperCase() : result;
    };
  }
}

// 注册
GraphQLModule.forRoot({
  schemaDirectives: { upper: UpperCaseDirective },
});
```

### GraphQL 中间件

```typescript
const loggingMiddleware = {
  async resolve(resolve, root, args, context, info) {
    console.time(`resolver ${info.fieldName}`);
    const result = await resolve(root, args, context, info);
    console.timeEnd(`resolver ${info.fieldName}`);
    return result;
  },
};

GraphQLModule.forRoot({
  middlewares: [loggingMiddleware],
});
```

---

## 代码生成与最佳实践

### 前端类型生成

配合 [GraphQL Code Generator](https://the-g.dev/docs/codegen/)，从 Nest 的 `schema.gql` 生成前端 TS 类型：

```yaml
# codegen.yml
schema: http://localhost:3000/graphql
generates:
  src/generated/graphql.ts:
    plugins:
      - typescript
      - typescript-operations
```

### 最佳实践清单

1. **API 层与数据层分离**：不要直接返回 ORM 实体，定义独立的 `@ObjectType` DTO。
2. **开启 introspection 关闭于生产**：`introspection: process.env.NODE_ENV !== 'production'`，配合 depth-limit 防止恶意深查询。
3. **复杂度限制**：配置 `validationRules: [depthLimit(10)]` 防御深层嵌套攻击。
4. **Dataloader 全覆盖**：所有 `@ResolveField` 嵌套关系一律走 Dataloader。
5. **订阅按需开启**：无实时需求不开启 subscriptions，减少连接开销。
6. **Schema review**：把 `schema.gql` 变更纳入 Code Review，作为 API 契约。

---

## 下一步

- [19-微服务架构](./19-微服务架构.md)：GraphQL 之外的分布式方案
- [22-NestJS-12新特性与升级](./22-NestJS-12新特性与升级.md)：GraphQL 相关的 12 版本破坏性变更
- 官方文档：https://docs.nestjs.com/graphql/quick-start
