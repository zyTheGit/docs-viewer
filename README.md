# Nest 开发指南 · docs-viewer

基于 [VitePress](https://vitepress.dev/) 搭建的 NestJS 文档查看站点，内容来自《Nest 开发指南》。

## 本地开发

```bash
npm install
npm run dev      # 启动开发服务器，默认 http://localhost:5173
```

## 构建

```bash
npm run build    # 输出到 docs/.vitepress/dist
npm run preview  # 本地预览构建产物
```

## 部署到 GitHub Pages

1. 将项目推送到 GitHub 仓库 `docs-viewer`
2. 仓库 Settings → Pages → Build and deployment → Source 选择 **GitHub Actions**
3. 推送到 `main` 分支即自动构建部署

如仓库名不是 `docs-viewer`，请同步修改 `docs/.vitepress/config.mts` 中的 `base` 与 `head` 中的路径。

## 文档结构

```
docs/
├── index.md            # 首页
└── guide/              # 文档正文（迁移自《Nest 开发指南》）
    ├── index.md        # 目录总览
    ├── 01-安装与配置.md
    ├── ...
    └── 22-NestJS-12新特性与升级.md
```
