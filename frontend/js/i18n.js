// 界面文案与语言切换。
// 默认语言为英文；读取不到 config.json 时同样回退为英文。
// 按钮上显示的是"将要切换到的语言"，因此英文界面显示中文按钮，反之亦然。

const I18N = {
  en: {
    // 工具栏
    sceneName: 'Scene name',
    save: 'Save',
    newScene: 'New',
    openScene: 'Open scene…',
    quality: 'Quality',
    qualityLow: 'Low 480p15',
    qualityMedium: 'Medium 720p30',
    qualityHigh: 'High 1080p60',
    sceneType: 'Scene type',
    render: 'Render',
    langButton: '🌏切换为中文 (简体)',

    // 左侧对象库
    searchPlaceholder: 'Search manim objects / animations',
    tabMobjects: 'Shapes',
    tabAnimations: 'Animations',
    noResults: 'No matches',

    // 中间画布与时间轴
    canvasTitle: 'Canvas · approximate preview (final result depends on render)',
    stageHintAdd: 'Click a shape on the left to add an object',
    stageHintVideo: 'Double-click the video to return to canvas',
    timeline: 'Timeline',
    timelineEmpty: 'Timeline is empty — select an object, then click an item under "Animations"',
    timelineInfo: '{count} animations · total about {total}s',
    noTarget: '(no target)',

    // 右侧面板
    tabProps: 'Properties',
    tabCode: 'Code',
    generatedCode: 'Generated manim code',
    refresh: 'Refresh',

    // 属性面板
    noSelection: 'Nothing selected — click a shape on the left to add one',
    positionXY: 'Position (x, y)',
    visibleAtStart: 'Visible at start',
    visibleAuto: 'Auto',
    visibleTrue: 'Visible from start',
    visibleFalse: 'Do not pre-add',
    removeParam: 'Remove this parameter',
    addParam: '+ Add parameter…',
    deleteObject: 'Delete object',
    deleteAnimation: 'Delete animation',
    targetsLabel: 'Targets',
    noObjects: 'No objects in scene yet',
    timingLabel: 'Start time / duration (s)',
    none: '(none)',

    // 状态与提示
    submitting: 'Submitting render job…',
    rendering: 'Rendering…',
    renderDone: 'Rendered',
    renderFailed: 'Render failed',
    renderFailedDetail: 'Render failed: ',
    submitFailed: 'Submit failed',
    submitFailedDetail: 'Submit failed: ',
    pollFailed: 'Polling failed',
    pollFailedDetail: 'Polling failed: ',
    savedScene: 'Saved scenes/{name}.json',
    saveFailed: 'Save failed: ',
    openFailed: 'Open failed: ',
    openedScene: 'Opened {name}',
    codegenFailed: 'Code generation failed: ',
    catalogFailed: 'Failed to load manim catalog: ',
  },

  zh: {
    // 工具栏
    sceneName: '场景名',
    save: '保存',
    newScene: '新建',
    openScene: '打开场景…',
    quality: '质量',
    qualityLow: '低 480p15',
    qualityMedium: '中 720p30',
    qualityHigh: '高 1080p60',
    sceneType: '场景类型',
    render: '渲染',
    langButton: 'Switch to English (US)',

    // 左侧对象库
    searchPlaceholder: '搜索 manim 对象 / 动画',
    tabMobjects: '图形',
    tabAnimations: '动画',
    noResults: '无匹配结果',

    // 中间画布与时间轴
    canvasTitle: '画布 · 近似预览（最终效果以渲染为准）',
    stageHintAdd: '点击左侧图形添加对象',
    stageHintVideo: '双击视频可返回画布',
    timeline: '时间轴',
    timelineEmpty: '时间轴为空：选中对象后，点击「动画」标签里的项目即可添加',
    timelineInfo: '共 {count} 个动画 · 总时长约 {total}s',
    noTarget: '(未选对象)',

    // 右侧面板
    tabProps: '属性',
    tabCode: '代码',
    generatedCode: '生成的 manim 代码',
    refresh: '刷新',

    // 属性面板
    noSelection: '未选中任何对象 — 点击左侧图形添加',
    positionXY: '位置 (x, y)',
    visibleAtStart: '起始可见性',
    visibleAuto: '自动判断',
    visibleTrue: '开始时即显示',
    visibleFalse: '不预先显示',
    removeParam: '移除该参数',
    addParam: '+ 添加参数…',
    deleteObject: '删除对象',
    deleteAnimation: '删除动画',
    targetsLabel: '作用对象',
    noObjects: '场景中还没有对象',
    timingLabel: '起始时间 / 时长（秒）',
    none: '（未指定）',

    // 状态与提示
    submitting: '提交渲染任务…',
    rendering: '渲染中…',
    renderDone: '渲染完成',
    renderFailed: '渲染失败',
    renderFailedDetail: '渲染失败：',
    submitFailed: '提交失败',
    submitFailedDetail: '提交失败：',
    pollFailed: '轮询失败',
    pollFailedDetail: '轮询失败：',
    savedScene: '已保存 scenes/{name}.json',
    saveFailed: '保存失败：',
    openFailed: '打开失败：',
    openedScene: '已打开 {name}',
    codegenFailed: '代码生成失败：',
    catalogFailed: '无法加载 manim 对象清单：',
  },
};

let currentLang = 'en';

function t(key, vars) {
  const table = I18N[currentLang] || I18N.en;
  let text = table[key];
  if (text === undefined) text = I18N.en[key];
  if (text === undefined) return key;
  if (vars) {
    for (const k of Object.keys(vars)) {
      text = text.split(`{${k}}`).join(vars[k]);
    }
  }
  return text;
}

function applyI18n() {
  document.documentElement.lang = currentLang === 'zh' ? 'zh-CN' : 'en';

  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });

  const btn = document.getElementById('btn-lang');
  if (btn) btn.textContent = t('langButton');

  // 画布提示语取决于视频是否在显示，单独处理
  const hint = document.getElementById('stage-hint');
  const video = document.getElementById('video');
  if (hint) hint.textContent = video && !video.hidden ? t('stageHintVideo') : t('stageHintAdd');
}

function setLanguage(lang) {
  currentLang = lang === 'zh' ? 'zh' : 'en';
  applyI18n();
}
