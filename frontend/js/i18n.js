// 界面文案的加载与切换。
// 文案存放在 lang/<code>.json（en_us / zh_cn），由后端通过 /static 提供；
// 语言选择由后端持久化在 config.json，读取不到配置或语言包时回退英文。
// 按钮上显示的是"将要切换到的语言"，因此英文界面显示中文按钮，反之亦然。

const LANG_DIR = '/static/lang';
const DEFAULT_LANG = 'en_us';
const LANGUAGES = ['en_us', 'zh_cn'];

let currentLang = DEFAULT_LANG;
const _packs = {}; // code -> { key: text }

async function loadLangPack(code) {
  if (_packs[code]) return _packs[code];
  const res = await fetch(`${LANG_DIR}/${code}.json`);
  if (!res.ok) throw new Error(`language pack not found: ${code}`);
  _packs[code] = await res.json();
  return _packs[code];
}

function t(key, vars) {
  const pack = _packs[currentLang] || {};
  let text = pack[key];
  if (text === undefined) text = (_packs[DEFAULT_LANG] || {})[key];
  if (text === undefined) return key;
  if (vars) {
    for (const k of Object.keys(vars)) {
      text = text.split(`{${k}}`).join(vars[k]);
    }
  }
  return text;
}

function applyI18n() {
  document.documentElement.lang = currentLang === 'zh_cn' ? 'zh-CN' : 'en';

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

async function setLanguage(code) {
  let target = LANGUAGES.includes(code) ? code : DEFAULT_LANG;
  try {
    await loadLangPack(target);
  } catch (err) {
    target = DEFAULT_LANG;
    await loadLangPack(target).catch(() => {});
  }
  currentLang = target;
  applyI18n();
}
