## Nest 项目开发

### Nest 命令行工具

```bash
# 批量生成源
yarn generate resource
```

### TypeORM

```bash
# 数据库表自动创建
yarn run typeorm migration:generate -d ormconfig.ts src/database/migrations/create-health-table
```
