// 全局状态与场景数据操作。scene 结构直接对应后端的 SceneSpec。

function makeEmptyScene() {
  return {
    name: 'MyScene',
    config: { background_color: '#000000', frame_width: 14.222222, frame_height: 8.0, fps: 15, quality: 'low', scene_type: 'Scene' },
    mobjects: [],
    animations: [],
    setup_code: '',
    frame_code: '',
    raw_code: '',
  };
}

// 补齐缺失字段，保证旧场景文件 / 本地草稿也能安全打开
function normalizeScene(raw) {
  const base = makeEmptyScene();
  const scene = Object.assign(base, raw || {});
  scene.config = Object.assign(base.config, (raw && raw.config) || {});
  scene.mobjects = scene.mobjects || [];
  scene.animations = scene.animations || [];
  scene.setup_code = scene.setup_code || '';
  scene.frame_code = scene.frame_code || '';
  scene.raw_code = scene.raw_code || '';
  return scene;
}

const state = {
  catalog: { mobjects: [], animations: [], priority: [] },
  scene: makeEmptyScene(),
  selection: null, // { kind: 'mobject' | 'animation', id }
  libTab: 'mobjects',
  search: '',
};

function findMeta(kind, name) {
  return (state.catalog[kind] || []).find((x) => x.name === name) || null;
}

function findMobject(id) { return state.scene.mobjects.find((m) => m.id === id) || null; }
function findAnimation(id) { return state.scene.animations.find((a) => a.id === id) || null; }

function selectedItem() {
  if (!state.selection) return null;
  return state.selection.kind === 'mobject'
    ? findMobject(state.selection.id)
    : findAnimation(state.selection.id);
}

function uniqueId(prefix) {
  const used = new Set([
    ...state.scene.mobjects.map((m) => m.id),
    ...state.scene.animations.map((a) => a.id),
  ]);
  let i = 1;
  let id = `${prefix}_${i}`;
  while (used.has(id)) { i += 1; id = `${prefix}_${i}`; }
  return id;
}

function guessDefault(param) {
  const a = (param.annotation || '').toLowerCase();
  if (a.includes('float') || a.includes('int') || a.includes('number')) return 0;
  return '';
}

function makeMobject(type) {
  const meta = findMeta('mobjects', type);
  const spec = {
    id: uniqueId(type.toLowerCase()),
    type,
    args: [],
    kwargs: {},
    methods: [],
    label: type,
    visible_at_start: null,
  };
  if (meta) {
    for (const p of meta.params) {
      if (!p.required) continue;
      if (p.positional) spec.args.push(guessDefault(p));
      else spec.kwargs[p.name] = guessDefault(p);
    }
  }
  return spec;
}

// 动画默认挂到当前选中对象上；起点接在时间轴末尾。
function makeAnimation(type) {
  const target = state.selection && state.selection.kind === 'mobject' ? state.selection.id : null;
  return {
    id: uniqueId(type.toLowerCase()),
    type,
    targets: target ? [target] : [],
    args: [],
    kwargs: {},
    start: timelineEnd(),
    run_time: null,
  };
}

function timelineEnd() {
  let end = 0;
  for (const a of state.scene.animations) {
    const dur = a.run_time == null ? 1 : a.run_time;
    end = Math.max(end, a.start + dur);
  }
  return Math.round(end * 100) / 100;
}

function mobPosition(spec) {
  let x = 0; let y = 0;
  for (const m of spec.methods || []) {
    if (m.name === 'move_to' && Array.isArray(m.args[0])) {
      x = m.args[0][0]; y = m.args[0][1];
    } else if (m.name === 'shift' && Array.isArray(m.args[0])) {
      x += m.args[0][0]; y += m.args[0][1];
    }
  }
  return { x, y };
}

function setMobPosition(spec, x, y) {
  const r = (v) => Math.round(v * 1000) / 1000;
  const pos = [r(x), r(y), 0];
  const existing = (spec.methods || []).find((m) => m.name === 'move_to');
  if (existing) existing.args[0] = pos;
  else spec.methods.push({ name: 'move_to', args: [pos], kwargs: {} });
}

function removeMobject(id) {
  state.scene.mobjects = state.scene.mobjects.filter((m) => m.id !== id);
  state.scene.animations = state.scene.animations.filter((a) => !a.targets.includes(id));
  if (state.selection && state.selection.id === id) state.selection = null;
}

function removeAnimation(id) {
  state.scene.animations = state.scene.animations.filter((a) => a.id !== id);
  if (state.selection && state.selection.id === id) state.selection = null;
}
