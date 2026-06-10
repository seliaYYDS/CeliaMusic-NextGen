# Celia Music Next Gen

一个面向 Windows 的第三方音乐播放器桌面应用，当前项目已经完成基础工程搭建，可在本地运行 Tauri 桌面窗口，并能打包生成 Windows `.exe` 安装包。

## 项目目标

- 纯本地运行的轻量化 Windows 桌面应用
- 支持复杂、高自由度的 UI 表现
- 预留歌词动画、沉浸式播放页等高级视觉能力
- 后续接入第三方音乐平台 API 和本地音乐文件

## 技术栈

当前项目使用的核心技术栈如下：

- `Tauri 2`
  - 作为桌面应用壳
  - 负责 Windows 窗口、原生打包、前后端桥接
- `Rust`
  - 作为 Tauri 原生层语言
  - 后续用于本地扫描、播放控制、缓存、数据库和第三方 API 代理
- `React 19`
  - 作为前端 UI 框架
  - 用于构建播放器界面、歌词页、歌单页等复杂交互
- `TypeScript`
  - 作为前端主要开发语言
  - 用于保证类型安全和后续模块化扩展
- `Vite`
  - 作为前端开发服务器和构建工具
- `@tauri-apps/api`
  - 用于前端调用 Tauri 原生能力
- `@tauri-apps/plugin-opener`
  - 当前已接入的 Tauri 插件

## 当前项目结构

```text
CeliaMusicNextGen/
├─ public/
├─ src/
│  ├─ app/
│  │  ├─ AppShell.tsx
│  │  └─ styles.css
│  ├─ App.tsx
│  └─ main.tsx
├─ src-tauri/
│  ├─ src/
│  │  ├─ lib.rs
│  │  └─ main.rs
│  ├─ icons/
│  └─ tauri.conf.json
├─ package.json
└─ README.md
```

## 环境要求

在 Windows 下开发和打包，建议准备以下环境：

- `Node.js 22+`
- `npm 10+`
- `Rust + cargo`
- `Microsoft Edge WebView2 Runtime`

当前项目已经在以下环境中验证通过：

- `Node.js v22.21.0`
- `npm 10.9.4`
- `rustc 1.94.1`
- `cargo 1.94.1`

## 安装依赖

在项目根目录执行：

```powershell
npm install
```

如果本机没有 Rust，请先安装：

```powershell
winget install -e --id Rustlang.Rustup --accept-package-agreements --accept-source-agreements
```

安装完成后，重新打开终端，或者确保 Rust 的路径已加入环境变量：

```powershell
$env:Path += ';' + "$env:USERPROFILE\.cargo\bin"
```

## 开发运行

### 1. 仅启动前端开发服务

```powershell
npm run dev
```

该命令只会启动 Vite 开发服务器，不会打开桌面窗口。

### 2. 启动 Tauri 桌面应用

```powershell
$env:Path += ';' + "$env:USERPROFILE\.cargo\bin"
npm run tauri dev
```

该命令会：

- 启动 Vite 开发服务
- 编译 Rust 原生层
- 打开 Tauri 桌面窗口

当前窗口配置在 [src-tauri/tauri.conf.json](C:\Users\xchzq\Downloads\workplace\CeliaMusicNextGen\src-tauri\tauri.conf.json) 中，主要参数为：

- 标题：`Celia Music Next Gen`
- 默认尺寸：`1280 x 800`
- 最小尺寸：`1024 x 640`

## 调试方式

### 前端调试

前端部分使用 React + Vite，推荐方式：

- 使用浏览器 DevTools 调试页面样式和组件渲染
- 使用编辑器断点调试 TypeScript/React 代码

### Tauri 桌面调试

运行：

```powershell
$env:Path += ';' + "$env:USERPROFILE\.cargo\bin"
npm run tauri dev
```

即可同时调试：

- React 前端界面
- Tauri 桌面窗口
- Rust 原生层编译过程

### Rust 原生层检查

如果只想检查 Rust 代码是否能通过编译，可运行：

```powershell
$env:Path += ';' + "$env:USERPROFILE\.cargo\bin"
cargo check --manifest-path src-tauri\Cargo.toml
```

## 生产构建

### 1. 构建前端静态资源

```powershell
npm run build
```

构建结果输出到：

```text
dist\
```

### 2. 构建 Rust release 可执行文件

```powershell
$env:Path += ';' + "$env:USERPROFILE\.cargo\bin"
npm run tauri build -- --no-bundle
```

这一步会生成桌面应用主程序，但不生成安装包。

生成的可执行文件位于：

```text
C:\Users\xchzq\Downloads\workplace\CeliaMusicNextGen\src-tauri\target\release\tauri-app.exe
```

## 打包为 Windows `.exe`

### 推荐方式：生成 NSIS 安装包

在当前网络环境下，Tauri 默认从 GitHub 下载 NSIS/WiX 打包工具时可能失败，因此推荐在打包时显式设置镜像：

```powershell
$env:Path += ';' + "$env:USERPROFILE\.cargo\bin"
$env:TAURI_BUNDLER_TOOLS_GITHUB_MIRROR_TEMPLATE='https://ghfast.top/https://github.com/<owner>/<repo>/releases/download/<version>/<asset>'
npm run tauri build -- --bundles nsis
```

该命令会生成 Windows 安装包 `.exe`。

### 已验证成功的安装包路径

```text
C:\Users\xchzq\Downloads\workplace\CeliaMusicNextGen\src-tauri\target\release\bundle\nsis\Celia Music Next Gen_0.1.0_x64-setup.exe
```

### 已验证成功的主程序路径

```text
C:\Users\xchzq\Downloads\workplace\CeliaMusicNextGen\src-tauri\target\release\tauri-app.exe
```

## 常见命令

```powershell
npm install
```

安装前端依赖。

```powershell
npm run dev
```

启动前端开发服务器。

```powershell
$env:Path += ';' + "$env:USERPROFILE\.cargo\bin"
npm run tauri dev
```

启动桌面开发模式。

```powershell
npm run build
```

构建前端资源。

```powershell
$env:Path += ';' + "$env:USERPROFILE\.cargo\bin"
cargo check --manifest-path src-tauri\Cargo.toml
```

检查 Rust 原生层。

```powershell
$env:Path += ';' + "$env:USERPROFILE\.cargo\bin"
$env:TAURI_BUNDLER_TOOLS_GITHUB_MIRROR_TEMPLATE='https://ghfast.top/https://github.com/<owner>/<repo>/releases/download/<version>/<asset>'
npm run tauri build -- --bundles nsis
```

生成 Windows `.exe` 安装包。

## 当前状态

当前项目已经完成以下验证：

- 可以正常安装依赖
- 可以正常启动 Tauri 空白窗口
- 可以完成前端生产构建
- 可以完成 Rust release 构建
- 可以成功打包生成 Windows `.exe` 安装包

## 下一步建议

接下来建议按下面顺序继续推进：

1. 搭建播放器主界面布局
2. 引入全局状态管理
3. 规划页面路由和模块目录
4. 抽象本地音乐库和第三方 Provider 接口
5. 再逐步接入播放控制、歌词和平台 API
