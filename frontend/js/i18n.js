// 界面文案的加载与切换。
// 语言清单：lang/languages.json；语言包：lang/<code>.json（均由 /static 提供）。
// 语言选择由后端持久化在 config.json；读取不到配置或语言包时回退英文。

const LANG_DIR = '/static/lang';
const DEFAULT_LANG = 'en_us';

let currentLang = DEFAULT_LANG;
let languages = []; // [{ code, name, flag }]
const _packs = {};  // code -> { key: text }

function langLabel(item) {
  return item.flag ? `${item.flag} ${item.name}` : item.name;
}

async function loadLanguages() {
  if (languages.length) return languages;
  const res = await fetch(`${LANG_DIR}/languages.json`);
  if (!res.ok) throw new Error('languages.json not found');
  languages = await res.json();
  return languages;
}

async function loadLangPack(code) {
  if (_packs[code]) return _packs[code];
  const res = await fetch(`${LANG_DIR}/${code}.json`);
  if (!res.ok) throw new Error(`language pack not found: ${code}`);
  _packs[code] = await res.json();
  return _packs[code];
}

// 首次启动：加载语言清单与默认语言包
async function bootstrapI18n() {
  try {
    await loadLanguages();
  } catch (err) {
    languages = [{ code: DEFAULT_LANG, name: 'English (US)', flag: '🇬🇧' }];
  }
  await loadLangPack(DEFAULT_LANG).catch(() => {});
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

function fillLangSelect(sel) {
  if (!sel) return;
  sel.innerHTML = '';
  for (const item of languages) {
    const o = document.createElement('option');
    o.value = item.code;
    o.textContent = langLabel(item);
    sel.appendChild(o);
  }
  sel.value = currentLang;
}

function applyI18n() {
  document.documentElement.lang = currentLang.replace('_', '-');
  document.documentElement.dir = currentLang === 'ar_sa' ? 'rtl' : 'ltr';

  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });

  fillLangSelect(document.getElementById('lang-select'));
  fillLangSelect(document.getElementById('modal-lang-select'));

  // 画布提示语取决于视频是否在显示，单独处理
  const hint = document.getElementById('stage-hint');
  const video = document.getElementById('video');
  if (hint) hint.textContent = video && !video.hidden ? t('stageHintVideo') : t('stageHintAdd');
}

async function setLanguage(code) {
  if (!languages.length) await loadLanguages().catch(() => {});
  const codes = languages.map((l) => l.code);
  let target = codes.includes(code) ? code : DEFAULT_LANG;
  try {
    await loadLangPack(target);
  } catch (err) {
    target = DEFAULT_LANG;
    await loadLangPack(target).catch(() => {});
  }
  currentLang = target;
  applyI18n();
}
