"""把 SceneSpec（场景 JSON）转换成可直接运行的 manim Python 代码。

这是整个编辑器的"出口"：无论前端怎么操作，最终都要落到一份可读、可编辑、
可手动接管的 manim 脚本上。因此生成结果刻意保持朴素、贴近手写风格。
"""

from __future__ import annotations

import re
from typing import Any

from .schema import AnimationSpec, MobjectSpec, SceneSpec

# 这些动画自带"引入"语义：对象在此动画前不应预先出现在画面上
INTRO_ANIMATIONS = {
    "Create",
    "Uncreate",
    "FadeIn",
    "Write",
    "DrawBorderThenFill",
    "GrowFromCenter",
    "GrowArrow",
    "SpinInFromNothing",
    "FadeInFromPoint",
    "FadeInFromLarge",
    "AddTextLetterByLetter",
}

_QUALITY_FLAG = {"low": "-ql", "medium": "-qm", "high": "-qh"}

# 允许的场景基类白名单，避免场景文件里出现任意类名
_SCENE_TYPES = {
    "Scene",
    "ThreeDScene",
    "MovingCameraScene",
    "VectorScene",
    "LinearTransformationScene",
}


def render_value(value: Any) -> str:
    """把 JSON 值渲染成 Python 字面量。

    逃生舱：字符串以 ":expr:" 开头时视为原始表达式，原样输出。
    例如 ":expr:UP*2" 会生成 UP*2 而不是字符串。
    """
    if isinstance(value, str):
        if value.startswith(":expr:"):
            return value[len(":expr:") :]
        return repr(value)
    if value is None or isinstance(value, (bool, int, float)):
        return repr(value)
    if isinstance(value, (list, tuple)):
        return "[" + ", ".join(render_value(v) for v in value) + "]"
    if isinstance(value, dict):
        inner = ", ".join(f"{k!r}: {render_value(v)}" for k, v in value.items())
        return "{" + inner + "}"
    return repr(value)


def _render_kwarg_value(value: Any, var_map: dict[str, str]) -> str:
    """渲染关键字参数的值，识别"对场景内对象的引用"。

    - {"$ref": "id"} → 对应变量名
    - 字符串恰好等于某个 mobject 的 id → 变量名（兼容手动填写的旧数据）
    """
    if isinstance(value, dict) and "$ref" in value:
        ref = str(value["$ref"])
        return var_map.get(ref, ref)
    if isinstance(value, str) and value in var_map:
        return var_map[value]
    return render_value(value)


def _build_call(
    name: str,
    args: list[Any],
    kwargs: dict[str, Any],
    var_map: dict[str, str] | None = None,
) -> str:
    parts = [render_value(a) for a in args]
    if var_map is None:
        parts += [f"{k}={render_value(v)}" for k, v in kwargs.items()]
    else:
        parts += [f"{k}={_render_kwarg_value(v, var_map)}" for k, v in kwargs.items()]
    return f"{name}({', '.join(parts)})"


def _var_names(specs: list[MobjectSpec]) -> dict[str, str]:
    """为每个 mobject id 生成唯一、合法的 Python 变量名。"""
    used: set[str] = set()
    mapping: dict[str, str] = {}
    for spec in specs:
        base = re.sub(r"\W", "_", spec.id or "obj")
        if not base or base[0].isdigit():
            base = "obj_" + base
        name = base
        i = 2
        while name in used:
            name = f"{base}_{i}"
            i += 1
        used.add(name)
        mapping[spec.id] = name
    return mapping


def _mobject_declaration(spec: MobjectSpec, var: str, var_map: dict[str, str]) -> str:
    decl = _build_call(spec.type, spec.args, spec.kwargs, var_map)
    for call in spec.methods:
        decl += "." + _build_call(call.name, call.args, call.kwargs, var_map)
    return f"{var} = {decl}"


def _animation_expr(anim: AnimationSpec, var_map: dict[str, str]) -> str:
    kwargs = dict(anim.kwargs)
    if anim.run_time is not None:
        kwargs["run_time"] = anim.run_time

    # 动画的第一个位置参数（mobject/vmobject）由 targets 表达；
    # 若 args 里误存了该参数，这里跳过，避免重复传参导致 manim 报错。
    extra_args = anim.args[1:] if (anim.targets and anim.args) else anim.args
    arg_parts = [render_value(a) for a in extra_args]
    kw_parts = [f"{k}={_render_kwarg_value(v, var_map)}" for k, v in kwargs.items()]

    def build(target: str) -> str:
        head = var_map[target] if target in var_map else render_value(target)
        return f"{anim.type}({', '.join([head] + arg_parts + kw_parts)})"

    # 多数动画只接受一个 mobject；同时作用于多个对象时用 AnimationGroup 包起来
    if len(anim.targets) > 1:
        return "AnimationGroup(" + ", ".join(build(t) for t in anim.targets) + ")"
    if anim.targets:
        return build(anim.targets[0])
    return f"{anim.type}({', '.join(arg_parts + kw_parts)})"


def _intro_set(scene: SceneSpec) -> set[str]:
    """判断哪些对象是被"引入型"动画首次带出来的（不应预添加到画面）。"""
    intro_ids: set[str] = set()
    first_seen: set[str] = set()
    for anim in sorted(scene.animations, key=lambda a: a.start):
        for target in anim.targets:
            if target in first_seen:
                continue
            first_seen.add(target)
            if anim.type in INTRO_ANIMATIONS:
                intro_ids.add(target)
    return intro_ids


def _timeline_body(scene: SceneSpec, var_map: dict[str, str]) -> list[str]:
    """按时间轴生成 self.play / self.wait，同一起点合并为一次 play。"""
    if not scene.animations:
        return []

    ordered = sorted(scene.animations, key=lambda a: a.start)

    # 按 start 分组（浮点用容差归并）
    groups: list[tuple[float, list[AnimationSpec]]] = []
    for anim in ordered:
        if groups and abs(groups[-1][0] - anim.start) < 1e-6:
            groups[-1][1].append(anim)
        else:
            groups.append((anim.start, [anim]))

    body: list[str] = []
    current = 0.0
    for start, anims in groups:
        gap = start - current
        if gap > 1e-6:
            body.append(f"self.wait({round(gap, 4)})")
            current += gap
        exprs = [_animation_expr(a, var_map) for a in anims]
        play_call = "self.play(" + ", ".join(exprs) + ")"
        body.append(play_call)
        durations = [a.run_time if a.run_time else 1.0 for a in anims]
        current += max(durations)
    return body


def scene_class_name(scene: SceneSpec) -> str:
    """把场景名规范成合法的 Python 类名。"""
    name = re.sub(r"\W", "_", scene.name or "MyScene").strip("_") or "MyScene"
    if name[0].isdigit():
        name = "Scene_" + name
    return name


def generate(scene: SceneSpec) -> str:
    """生成完整的 manim 脚本。"""
    class_name = scene_class_name(scene)
    base_class = (
        scene.config.scene_type if scene.config.scene_type in _SCENE_TYPES else "Scene"
    )
    var_map = _var_names(scene.mobjects)
    body: list[str] = []

    # 背景色：非默认黑色才显式设置
    bg = (scene.config.background_color or "").strip()
    if bg and bg.lower() not in ("#000000", "black", "#000"):
        body.append(f'self.camera.background_color = {render_value(bg)}')

    # 场景初始化代码：3D 相机朝向、环境旋转等，插在 construct 开头
    if scene.setup_code.strip():
        body.extend(scene.setup_code.rstrip().split("\n"))

    # 对象声明
    for spec in scene.mobjects:
        body.append(_mobject_declaration(spec, var_map[spec.id], var_map))

    # 预添加到画面的对象（排除被引入型动画带出的）
    intro = _intro_set(scene)
    pre_add: list[str] = []
    for spec in scene.mobjects:
        if spec.visible_at_start is True:
            pre_add.append(var_map[spec.id])
        elif spec.visible_at_start is False:
            continue
        elif spec.id not in intro:
            pre_add.append(var_map[spec.id])
    if pre_add:
        body.append("self.add(" + ", ".join(pre_add) + ")")

    # 中段代码：如把 2D 文字固定到屏幕（3D 场景常用）
    if scene.frame_code.strip():
        body.extend(scene.frame_code.rstrip().split("\n"))

    # 时间轴
    body.extend(_timeline_body(scene, var_map))

    # 逃生舱：手写代码原样插入
    if scene.raw_code.strip():
        for line in scene.raw_code.rstrip().split("\n"):
            body.append(line)

    if not body:
        body.append("pass")

    header = "from manim import *\nimport numpy as np\n\n\n"
    lines = [f"class {class_name}({base_class}):", "    def construct(self):"]
    lines += ["        " + line for line in body]
    return header + "\n".join(lines) + "\n"


def quality_flag(quality: str) -> str:
    return _QUALITY_FLAG.get(quality, "-ql")
