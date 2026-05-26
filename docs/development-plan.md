# SnapSay 开发计划

## 目标

在当前仓库内实现一个可运行的 Windows 桌面语音输入助手原型，用户睡醒后可以打开软件，配置大模型 API，并完成录音、识别、整理、粘贴和记录查看。

## 技术栈

- Electron：桌面窗口、悬浮窗、全局快捷键、剪贴板和粘贴。
- React + TypeScript：主窗口、设置页、记录页、悬浮提示 UI。
- Vite：前端构建。
- Vitest：单元测试。
- electron-store：本地配置和记录持久化。
- 可选 uiohook-napi：全局鼠标中键和侧键监听；如果当前环境无法安装原生依赖，保留接口并在 UI 中提示当前运行环境不支持。

## 文件结构

```text
src/main/
  main.ts                 Electron 主进程入口
  preload.ts              安全暴露 IPC API
  settingsStore.ts        设置、历史记录、路径配置
  recorderCoordinator.ts  录音状态机与流水线协调
  providers.ts            ASR 和整理 API 提供商接口
  inputController.ts      全局快捷键、鼠标触发、剪贴板粘贴
  floatingWindow.ts       悬浮提示窗生命周期

src/renderer/
  App.tsx                 主窗口应用
  components/             可复用组件
  pages/                  主页、记录、设置
  styles.css              全局样式
  floating.tsx            悬浮提示窗渲染入口

src/shared/
  types.ts                设置、记录、状态、IPC 类型
  defaults.ts             默认配置
  validation.ts           冲突按键、数字输入、存储路径校验

tests/
  validation.test.ts
  settingsStore.test.ts
  providers.test.ts
  recorderCoordinator.test.ts
```

## 任务

1. 项目搭建
   - 创建 Electron + React + TypeScript + Vite 项目。
   - 配置构建、测试、类型检查命令。
   - 配置 `.gitignore`，排除 `node_modules`、构建产物、日志、缓存、模型、数据文件和本地密钥。

2. 共享类型和校验
   - 定义设置、记录、处理状态、供应商、输出模式、触发键类型。
   - 添加冲突按键检测、数字输入过滤、非 C 盘数据目录默认值测试。

3. 持久化与 Provider
   - 实现设置和历史记录存储。
   - 实现 OpenAI-compatible 文案整理 API。
   - 实现 DeepSeek 预设和测试连接。
   - 实现 ASR Provider 接口和占位实现：本地 ASR、豆包 ASR、手动/模拟识别。

4. 桌面能力
   - 全局键盘快捷键注册。
   - 鼠标中键/侧键监听接口。
   - 剪贴板粘贴到当前光标。
   - 悬浮窗创建、状态更新和隐藏。

5. 前端界面
   - 主页。
   - 设置页。
   - 语音记录页。
   - 悬浮录音提示条。
   - 长文本截断、hover 完整内容、复制和重试按钮。

6. 录音和流水线
   - 前端麦克风录音。
   - 点击切换和长按录音。
   - 录音结束后发送音频到主进程。
   - 主进程执行 ASR、API 整理、粘贴和记录保存。

7. 验证和修复
   - 运行单元测试。
   - 运行类型检查。
   - 运行前端构建。
   - 修复失败后循环验证。

## 当前约束

- 文案整理不实现本地 LLM。
- 所有模型、缓存、日志、数据默认路径必须在项目目录或 D 盘目录，不能默认写入 C 盘用户目录。
- 开发服务不能使用默认端口；如需要本地服务，使用 10000 以上端口。
- 修改代码后必须提交 git。
