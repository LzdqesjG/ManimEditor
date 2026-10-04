# ManimEditor

用图形界面拼装 [manim](https://www.manim.community/) 动画，并导出可编辑的 manim 代码。

ManimEditor 是一个本地运行的 manim 可视化编辑器：在画布上摆放图形、在时间轴上编排动画，实时生成对应的 manim Python 代码，一键渲染成视频预览。它不是要取代写 manim，而是把**常用动画的可视化拼装**和**手写代码**结合起来——可视化覆盖不到的效果，随时可以在代码面板接管。

## 特性

- **对象库自动生成**：通过反射（`inspect`）扫描 manim 命名空间，自动收录全部公共类（当前约 148 个 Mobject、77 个 Animation），manim 升级后无需改动代码即可跟进。
- **参数面板自动生成**：根据 manim 类的构造函数签名自动生成表单，支持必填参数、可选参数、布尔/数值/颜色等类型；需要引用其它对象的参数（如 `Transform` 的 `target_mobject`）会渲染成对象下拉框。
- **时间轴编排**：拖拽调整动画的起始时间，同一起点的动画会自动合并进一次 `self.play()`，空档自动补 `self.wait()`。
- **画布近似预览**：按 manim 坐标绘制图形大致位置，支持拖拽摆位（最终效果以渲染为准）。
- **代码面板**：实时展示生成的 manim 代码；可视化覆盖不到的复杂效果（3D、LaTeX、自定义 `update`）可直接手写。
- **一键渲染**：后台调用 manim 渲染 mp4，完成后直接在页面播放。
- **场景存档**：保存 / 打开 `scenes/*.json`，每个图形和动画的参数、时间都被完整记录。
- **本地草稿**：编辑内容自动存入浏览器本地，刷新页面不丢失。
- **界面多语言**：内置英文与简体中文，右上角一键切换；选择持久化到 `config.json`，读取不到时默认英文。

## 环境要求

- **Python 3.11+**
- **FFmpeg**（manim 编码视频必需，需可在命令行中调用）

安装 FFmpeg：

| 平台 | 命令 |
| --- | --- |
| Windows | `winget install Gyan.FFmpeg`（或从官网下载后加入 PATH） |
| macOS | `brew install ffmpeg` |
| Linux | `sudo apt install ffmpeg` |

验证：

```bash
ffmpeg -version
```

## 安装

```bash
python -m venv .venv
```

激活虚拟环境：

```bash
# Windows PowerShell
.\.venv\Scripts\Activate.ps1

# macOS / Linux
source .venv/bin/activate
```

安装依赖：

```bash
pip install -r requirements.txt
```

> 国内网络较慢时，可使用镜像加速：
> `pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple`

## 运行

```bash
python main.py
```

然后用浏览器打开 <http://127.0.0.1:8000>。

## 使用

1. **添加图形**：左侧「图形」标签中搜索并点击 manim 对象（如 `Circle`、`Text`、`Axes`），即可加入场景。
2. **调整参数**：在画布或右侧属性面板中编辑位置、颜色、尺寸等参数；需要引用其它对象的参数用下拉框选择。
3. **编排动画**：左侧切到「动画」标签，点击动画（如 `Create`、`Transform`）添加；在属性面板勾选「作用对象」，并设置起始时间。
4. **调整时间轴**：拖动时间轴上的色块改变动画起始时间。
5. **查看代码**：右侧「代码」标签实时显示生成的 manim 代码；复杂效果可直接在场景的「手写代码」中补充。
6. **保存与打开**：工具栏「保存」写入 `scenes/<场景名>.json`；「打开场景…」加载已有场景；「新建」清空重开。
7. **渲染**：点击工具栏「渲染」，完成后视频会自动播放（双击视频可返回画布）。

> 仓库自带示例场景 `scenes/Default.json`（数学课：复数与三维函数），在「打开场景…」中选择 `Default` 即可加载并直接渲染。

## 工作原理

```
浏览器 (画布/时间轴/属性/代码)
        │  HTTP / JSON
        ▼
FastAPI 后端 ──► 代码生成器 ──► manim CLI ──► mp4
```

- **场景 JSON（中间表示）**：编辑器中的一切操作都落在 `SceneSpec` 上（图形列表 + 动画列表 + 场景配置 + 手写代码），可序列化、可版本管理，并与 manim 版本解耦。
- **反射**：`backend/manim_api.py` 扫描 manim 命名空间，提取每个类的构造函数参数（名称、类型、默认值、是否必填），作为对象库与参数面板的数据来源。
- **代码生成**：`backend/codegen.py` 把场景 JSON 翻译成手写风格的 manim 脚本，处理对象预添加、引入型动画、时间轴空档、对象引用等细节。
- **渲染**：`backend/renderer.py` 在后台线程中调用 `manim render`，前端通过任务 id 轮询进度。

## 目录结构

```
ManimEditor/
├── main.py                 # 启动入口
├── requirements.txt
├── backend/
│   ├── app.py              # FastAPI 接口与前端托管
│   ├── schema.py           # 场景数据模型（中间表示）
│   ├── manim_api.py        # 反射 manim，生成对象库元数据
│   ├── codegen.py          # 场景 JSON → manim 代码
│   └── renderer.py         # 后台渲染任务调度
├── frontend/
│   ├── index.html
│   ├── css/style.css
│   ├── js/                 # i18n / api / state / catalog / inspector / canvas / timeline / app
│   └── lang/               # 语言包：en_us.json / zh_cn.json
├── scenes/                 # 保存的场景文件（含 Default.json 示例）
└── workspace/              # 渲染产物（自动生成）
```

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/catalog` | manim 对象与动画的反射清单 |
| POST | `/api/codegen` | 场景 JSON → manim 代码 |
| POST | `/api/render` | 提交渲染任务 |
| GET | `/api/render/{id}` | 查询渲染任务状态与日志 |
| GET | `/api/video/{id}` | 获取渲染结果视频 |
| GET | `/api/scenes` | 列出已保存场景 |
| POST | `/api/scenes/{name}` | 保存场景 |
| GET | `/api/scenes/{name}` | 读取场景 |
| DELETE | `/api/scenes/{name}` | 删除场景 |

## 已知限制

- 画布是**近似预览**，用于摆位与结构确认，精确效果以渲染结果为准。
- 可视化参数面板覆盖 manim 的公共构造函数参数；链式方法（`shift`/`scale`/`set_color` 等）与复杂效果请使用代码面板。
- 尚无撤销 / 重做。
- 面向本地单用户使用，**没有鉴权**，请勿直接暴露到公网。

## 许可证

MIT
