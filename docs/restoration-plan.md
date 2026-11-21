# 复刻执行说明

来源：`Sac-Y/identity-skill` @ `d46f44264f8747432c1dcbf5a5ed5b051abc6832`。

已读取 `SKILL.md`、`references/visual-quality-gate.md`、`references/taste-calibration.md`、`references/frontend-app-builder.md`（官方 builder v0.1.2 的内置中文译本）、`references/evidence-gate.md`。没有运行 `npx skills add`，也没有生成新的人物图片。

站点形态保持现有单页展示，不是求职简历改版。视觉基线是现有深色页面，不是 taste 样本里的 quiet-cinematic-blue。

## 已确认事实

- 内容来自现有 `config.json` 与站点图片。
- 主人补充的唯一新事实：喜欢健身。
- 健身照片由主人提供。浴室镜前那张没有使用。采用宿舍（表情遮挡面部）、健身房（手机挡住面部）、引体向上三张，并裁成 3:4。
- 没有新增训练计划、成绩、尺寸、日期或变化结论。

## 素材边界

- 导航、标题、按钮、卡片、动效：代码。
- 头像、证书、健身照片：已有真实文件，不生成替身。
- 强调色继续走 `config.json` 的 `theme.accent`，页面里不再写死 `#b4ff39`。

## 允许的变化

- 关于区原有标题、正文和资料卡不动，下面增加「喜欢健身」和三张照片。
- 小字对比度、跳转链接、按钮类型和移动端点击区域按可读性和可访问性微调。
- `prefers-reduced-motion` 时关闭自动动效和卡片位移。
