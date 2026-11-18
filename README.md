# 陈芷锐 · 个人简历网站 (GitHub Pages 版)

一个基于 `config.json` 配置驱动的动态个人简历网站。**只需编辑 `config.json` 文件即可更新全部内容**，无需改动任何代码。

内置 **Admin 管理面板**，可在浏览器中直接编辑内容并自动提交部署。

## 快速开始

### 1. 上传到 GitHub

```bash
git init
git add .
git commit -m "init: resume website"
git branch -M main
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

### 2. 开启 GitHub Pages

进入仓库 **Settings → Pages → Build and deployment**：
- Source 选择 **GitHub Actions**
- 推送后 `.github/workflows/deploy.yml` 会自动部署

部署成功后访问：`https://<你的用户名>.github.io/<仓库名>/`

---

## 方式一：使用 Admin 管理面板（推荐）

访问 `https://<你的用户名>.github.io/<仓库名>/admin.html`

### 首次使用

1. **创建 GitHub Token**
   - 打开 https://github.com/settings/tokens/new
   - 勾选 `repo` 权限
   - 生成并复制 Token

2. **在 Admin 面板中连接**
   - 填写 GitHub 用户名、仓库名、分支（默认 main）
   - 粘贴 Token
   - 点击「连接并加载内容」

3. **编辑内容**
   - 左侧侧边栏切换各个板块（个人资料、教育、经历等）
   - 表单中直接修改内容，支持增删条目
   - 点击「预览 JSON」可查看生成的配置

4. **保存并自动部署**
   - 点击右上角「保存并部署」
   - 系统通过 GitHub API 自动提交修改
   - GitHub Actions 自动重新部署网站
   - 1-2 分钟后刷新网站即可看到更新

> Token 仅保存在浏览器 localStorage 中，不会上传到任何第三方服务器。

---

## 方式二：在 GitHub 网页上直接编辑

1. 进入仓库页面
2. 点击 `config.json` 文件
3. 点击右上角铅笔图标
4. 修改内容后点击 **Commit changes**
5. 等待 1-2 分钟，GitHub Actions 自动部署完成
6. 刷新网页即可看到更新

---

## 配置说明

| 配置项 | 说明 |
|--------|------|
| `profile` | 姓名、求职意向、学校、专业、预计毕业年份、简介、电话、邮箱、GitHub |
| `projects` | 项目（名称、简介、技术栈、仓库链接），显示在右侧最上方 |
| `education` | 教育经历（学校、阶段、专业、时间）。未知项写 `TODO` |
| `skillGroups` | 分组技能标签，不使用百分比 |
| `experience` | 经历（标题、组织、日期、描述）。没有日期时保留 `TODO` |
| `certificates` | 证书名称、机构、年份和图片。页面不展示证书编号 |
| `honors` | 荣誉名称 |
| `game` | 底部小作品链接（`tank-battle.html`） |
| `footer` | 页脚版权信息 |

## 文件结构

```
github-resume/
├── config.json              # 内容配置（Admin 面板自动编辑此文件）
├── index.html               # 网站渲染引擎
├── admin.html               # Admin 管理面板（浏览器内编辑+自动部署）
├── tank-battle.html         # 坦克大战游戏
├── assets/                  # 图片资源
│   ├── avatar.jpg
│   ├── cert-ai-senior.jpg
│   └── ...
├── .github/workflows/
│   └── deploy.yml           # GitHub Actions 自动部署
└── README.md                # 本文件
```

## 技术栈

- 纯前端（HTML + CSS + JavaScript），无需后端
- 样式和字体都在本地，不依赖 Tailwind、Google Fonts 或图标 CDN
- Admin 面板通过 GitHub REST API 直接提交修改，可编辑项目、经历、证书等字段
- GitHub Actions 自动部署
