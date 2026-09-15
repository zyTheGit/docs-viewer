# Docker 部署指南

> 从 Dockerfile 多阶段构建到 Compose 编排，再到生产环境检查清单，一条龙搞定 NestJS 容器化上线。

---

## 1. 最小可用镜像（踩坑版）

先看最常见的错误写法，理解为什么要多阶段构建：

```dockerfile
# ❌ 反面教材：单阶段，镜像 1.2GB+，还把源码和 node_modules 全打进去
FROM node:22
WORKDIR /app
COPY . .
RUN npm install
CMD ["npm", "run", "start:dev"]   # 生产跑开发模式！
```

问题清单：镜像巨大、含全部 devDependencies、源码完整暴露、进程由 npm 托管（PID 1 信号处理有问题）。

---

## 2. 生产级 Dockerfile（多阶段构建）

```dockerfile
# syntax=docker/dockerfile:1

########## 阶段一：构建 ##########
FROM node:22-alpine AS builder
WORKDIR /app

# 先复制依赖清单，利用 Docker 层缓存（package.json 不变则不重新 install）
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev   # 产出 dist + 生产依赖

########## 阶段二：运行 ##########
FROM node:22-alpine
WORKDIR /app

# 安全基线：非 root 用户运行
USER node

# 只拷贝运行时必需物
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/package.json ./

ENV NODE_ENV=production
EXPOSE 3000

# 直接跑 node：进程自身即 PID 1，正确响应 SIGTERM
CMD ["node", "dist/main.js"]
```

效果对比：单阶段 ~1.2GB → 多阶段 ~180MB，且不含任何源码与构建工具。

> 💡 还可加：`.dockerignore`（见下）、`HEALTHCHECK` 指令、`dumb-init` 处理僵尸进程。

### 2.1 .dockerignore（必配）

```
node_modules
dist
.git
.env*
*.md
coverage
docker-compose.yml
.github
```

> 不配它，构建上下文几百 MB，每次 build 都很慢。

---

## 3. Docker Compose 编排（本地/小规模生产）

```yaml
# docker-compose.yml
services:
  app:
    build: .
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      DB_HOST: postgres
      DB_PORT: 5432
      REDIS_HOST: redis
      REDIS_PORT: 6379
      JWT_SECRET: ${JWT_SECRET}        # 从 .env 注入，不进镜像
    depends_on:
      postgres:
        condition: service_healthy     # 等数据库真正就绪
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/health"]
      interval: 15s
      timeout: 3s
      retries: 3

  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: app
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data   # 数据必须挂卷，容器删除不丢库
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app"]
      interval: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    command: redis-server --requirepass ${REDIS_PASSWORD}
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s

volumes:
  pgdata:
```

```bash
docker compose up -d --build   # 构建并启动
docker compose logs -f app     # 跟踪日志
docker compose down            # 停止（数据在卷里，不丢）
```

> 💡 Nest 侧配套：加一个 `GET /health` 接口（可配合 `@nestjs/terminus`），健康检查才有着力点。

---

## 4. 数据库迁移策略

容器化后 `synchronize` 已关闭，结构变更全部走迁移（见[数据库中级指南](./24-数据库中级指南.md)）。两种模式：

### 4.1 容器启动前执行（推荐小项目）

```yaml
services:
  migrate:
    build: .
    command: sh -c "npx typeorm migration:run -d dist/data-source.js && node dist/main.js"
    environment: *app-env   # 同 app 的环境变量
    depends_on:
      postgres:
        condition: service_healthy
```

### 4.2 独立迁移 Job（推荐 K8s/多实例）

```bash
# 部署流水线中单独跑一次，多实例 Pod 天然避免并发迁移
docker run --rm app-image npx typeorm migration:run -d dist/data-source.js
```

> ⚠️ 多副本同时启动并各自跑迁移 = 迁移竞态。要么用独立 Job，要么迁移工具锁（TypeORM 会加迁移表锁，但不建议依赖）。

---

## 5. 生产环境检查清单

### 5.1 运行时

- [ ] 非 root 用户（`USER node`）
- [ ] `NODE_ENV=production`，`start:dev` 永远不进生产
- [ ] 敏感配置全部来自环境变量 / Secret 管理，不打包进镜像
- [ ] 日志输出到 stdout（JSON 格式），由收集器统一采集，**别写容器内文件**
- [ ] 优雅停机：`app.enableShutdownHooks()` + 收到 SIGTERM 后停止接新请求、等在途请求完成再退出

```typescript
// main.ts
app.enableShutdownHooks();

// 生命周期里做资源清理
@Injectable()
export class ShutdownHook implements OnApplicationShutdown {
  onApplicationShutdown(signal: string) {
    this.logger.log(`收到 ${signal}，开始优雅退出`);
  }
}
```

### 5.2 网络

- [ ] 数据库/Redis 容器**不映射端口到宿主机**（仅内网互通）
- [ ] 反向代理（Nginx/Traefik/云 LB）终止 TLS，转发到容器
- [ ] healthcheck 就绪探测，避免流量打到未就绪实例

### 5.3 资源

- [ ] `deploy.resources.limits` 或 `mem_limit` 设置内存上限（Node 建议设 `NODE_OPTIONS=--max-old-space-size=512` 配合容器限额）
- [ ] `restart: unless-stopped` 自动拉起
- [ ] 数据库卷 + 定期备份验证

---

## 6. CI/CD 集成示例

```yaml
# .github/workflows/deploy.yml（节选）
jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: registry.example.com
          username: ${{ secrets.REG_USER }}
          password: ${{ secrets.REG_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: registry.example.com/nest-app:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max          # 利用 CI 层缓存加速

      - name: 滚动更新
        run: ssh deploy@prod "cd /srv/app && APP_TAG=${{ github.sha }} docker compose up -d --no-deps --build app"
```

> 镜像 tag 用 commit SHA（不可变、可回滚），别用 `latest`（不可追溯）。

---

## 7. 常见问题速查

| 问题 | 原因 | 解决 |
|---|---|---|
| 容器里连不上 DB | `depends_on` 只管启动顺序，不管就绪 | 用 `condition: service_healthy` |
| 收到 SIGTERM 秒死 | npm 包了一层，信号没传给 node | CMD 直接跑 `node dist/main.js` |
| 镜像越构建越大 | 每层 COPY 都叠加缓存 | 依赖清单先行 + `.dockerignore` + 多阶段 |
| 时区不对/日志时间乱码 | Alpine 默认 UTC | `TZ=Asia/Shanghai` 环境变量 |
| OOM Killed | 无内存限额，Node 堆涨爆 | 设 `--max-old-space-size` + 容器限额 |
| ESM 项目构建后跑不起来 | `dist` 缺 `package.json` 的 type 字段 | 运行镜像也 COPY `package.json`（本例已含） |

---

## 8. 本篇小结

- ✅ 多阶段构建：构建器与运行器分离，镜像 1.2GB → ~180MB
- ✅ 层缓存优化：依赖清单先行，`.dockerignore` 收窄构建上下文
- ✅ Compose 编排：healthcheck 依赖就绪、数据卷持久化、环境变量注入
- ✅ 迁移走独立步骤，多实例不并发跑迁移
- ✅ 生产清单：非 root、优雅停机、stdout 日志、资源限额、SHA 镜像 tag
- ✅ CI/CD：Buildx 缓存 + 不可变镜像滚动更新

结合[部署](./14-部署.md)与[最佳实践](./15-最佳实践.md)食用更佳。至此运维篇三部曲（Redis → 消息队列 → Docker）完结 🎉
