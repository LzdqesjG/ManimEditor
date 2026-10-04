"""场景数据模型（中间表示 IR）。

编辑器的所有操作最终都落到这份 JSON 上，再由 codegen 转换成 manim 代码。
这样做的好处：可序列化、可撤销、可版本管理，且与 manim 版本解耦。
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class MethodCall(BaseModel):
    """对象创建后的链式方法调用，如 set_color / shift / scale。"""

    name: str
    args: list[Any] = Field(default_factory=list)
    kwargs: dict[str, Any] = Field(default_factory=dict)


class MobjectSpec(BaseModel):
    """一个 manim Mobject 的声明。"""

    id: str
    type: str
    # 位置参数：如 Text 的文本内容，反射元数据会标出哪些参数是必填的
    args: list[Any] = Field(default_factory=list)
    # 关键字参数：对应 manim 构造函数签名
    kwargs: dict[str, Any] = Field(default_factory=dict)
    # 创建后的链式调用
    methods: list[MethodCall] = Field(default_factory=list)
    label: str | None = None
    # 是否在场景开始时就 add 到画面；None 表示由 codegen 自动判断
    # （例如首个动画是 FadeIn/Create 的对象就不预添加）
    visible_at_start: bool | None = None


class AnimationSpec(BaseModel):
    """时间轴上的一个动画，作用于一个或多个 mobject。"""

    id: str
    type: str
    targets: list[str] = Field(default_factory=list)
    args: list[Any] = Field(default_factory=list)
    kwargs: dict[str, Any] = Field(default_factory=dict)
    # 在时间轴上的起始时间（秒）
    start: float = 0.0
    # 动画时长（秒），None 则用 manim 默认 run_time
    run_time: float | None = None


class SceneConfig(BaseModel):
    """场景级配置。"""

    background_color: str = "#000000"
    frame_width: float = 14.222222
    frame_height: float = 8.0
    fps: int = 15
    # 渲染质量：low / medium / high，映射到 manim 的 -ql/-qm/-qh
    quality: str = "low"
    # 场景基类：Scene / ThreeDScene / MovingCameraScene 等
    scene_type: str = "Scene"


class SceneSpec(BaseModel):
    """完整场景。"""

    name: str = "MyScene"
    config: SceneConfig = Field(default_factory=SceneConfig)
    mobjects: list[MobjectSpec] = Field(default_factory=list)
    animations: list[AnimationSpec] = Field(default_factory=list)
    # 场景初始化代码：插在 construct 开头，用于 3D 相机朝向、环境旋转等
    setup_code: str = ""
    # 中段代码：插在对象声明之后、动画之前，如把 2D 文字固定到屏幕
    # （3D 场景中的 add_fixed_in_frame_mobjects / add_fixed_orientation_mobjects）
    frame_code: str = ""
    # 逃生舱：可视化覆盖不到的效果（3D / LaTeX / 自定义 update）直接手写代码，
    # 原样插入 construct 末尾。
    raw_code: str = ""


class AppConfig(BaseModel):
    """应用级配置（持久化到 config.json）。"""

    language: str = "en"
