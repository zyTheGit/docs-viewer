import { defineConfig } from 'vitepress'

const chapters = [
  { group: '入门篇', items: ['01-安装与配置', '02-核心概念'] },
  { group: '基础篇', items: ['03-模块系统', '04-控制器', '05-提供者'] },
  { group: '进阶篇', items: ['06-中间件', '07-管道', '08-守卫', '09-拦截器', '10-异常过滤器', '11-数据库集成', '12-认证与授权', '13-测试', '14-部署', '15-最佳实践'] },
  { group: '高级篇', items: ['16-常用插件', '17-WebSocket实时通信', '18-GraphQL深入', '19-微服务架构', '20-CQRS与事件驱动', '21-高级特性', '22-NestJS-12新特性与升级'] },
  { group: '数据库篇', items: ['23-数据库初级指南', '24-数据库中级指南', '25-数据库高级指南'] }
]

const stripPrefix = (name: string) => name.replace(/^\d+-/, '')

export default defineConfig({
  lang: 'zh-CN',
  title: 'Nest 开发指南',
  description: '一个完整的 NestJS 开发文档体系，涵盖从入门到精通的所有内容',
  base: '/docs-viewer/',

  ignoreDeadLinks: [/^http:\/\/localhost/],

  head: [
    ['link', { rel: 'icon', href: '/docs-viewer/logo.svg' }]
  ],

  themeConfig: {
    nav: [
      { text: '指南', link: '/guide/' },
      { text: '速查手册', link: '/guide/Nest 项目开发' }
    ],

    sidebar: [
      {
        text: '总览',
        collapsed: false,
        items: [
          { text: '文档目录', link: '/guide/' },
          { text: '速查手册', link: '/guide/Nest 项目开发' }
        ]
      },
      ...chapters.map(({ group, items }) => ({
        text: group,
        collapsed: true,
        items: items.map(name => ({
          text: stripPrefix(name),
          link: `/guide/${name}`
        }))
      }))
    ],

    outline: {
      level: [2, 3],
      label: '本页目录'
    },

    docFooter: {
      prev: '上一篇',
      next: '下一篇'
    },

    lastUpdated: {
      text: '最后更新于',
      formatOptions: {
        dateStyle: 'short',
        timeStyle: 'short'
      }
    },

    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
          modal: {
            noResultsText: '未找到相关结果',
            resetButtonTitle: '清除查询条件',
            displayDetails: '显示详细列表',
            footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' }
          }
        }
      }
    },

    socialLinks: [{ icon: 'github', link: 'https://github.com/aniu/docs-viewer' }]
  }
})
