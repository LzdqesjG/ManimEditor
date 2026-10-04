// 主控：初始化、事件绑定、代码面板与渲染流程。

function emit() {
  renderInspector();
  renderCanvas();
  renderTimeline();
  scheduleCodeUpdate();
  saveDraft();
}

// 仅改数值时调用：不重建属性面板，避免输入框失焦
function emitVisuals() {
  renderCanvas();
  renderTimeline();
  scheduleCodeUpdate();
  saveDraft();
}

// 本地自动草稿：刷新页面不丢；正式存档走"保存"按钮写 scenes/*.json
const DRAFT_KEY = 'manimeditor.draft';
let _draftTimer = null;

function saveDraft() {
  clearTimeout(_draftTimer);
  _draftTimer = setTimeout(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(state.scene));
    } catch (err) { /* 忽略隐私模式/容量异常 */ }
  }, 500);
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? normalizeScene(JSON.parse(raw)) : null;
  } catch (err) {
    return null;
  }
}

let _codeTimer = null;
function scheduleCodeUpdate() {
  clearTimeout(_codeTimer);
  _codeTimer = setTimeout(updateCode, 300);
}

async function updateCode() {
  try {
    const result = await API.codegen(state.scene);
    document.getElementById('code-view').textContent = result.code;
  } catch (err) {
    showToast(t('codegenFailed') + err.message, true);
  }
}

let _toastTimer = null;
function showToast(message, isError) {
  const toastEl = document.getElementById('toast');
  toastEl.textContent = message;
  toastEl.hidden = false;
  toastEl.classList.toggle('err', !!isError);
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { toastEl.hidden = true; }, 4500);
}

function setStatus(text, cls) {
  const el = document.getElementById('render-status');
  el.textContent = text;
  el.className = `status${cls ? ` ${cls}` : ''}`;
}

function showVideo(url) {
  const video = document.getElementById('video');
  video.src = `${url}?t=${Date.now()}`;
  video.hidden = false;
  video.play().catch(() => {});
  document.getElementById('stage-hint').textContent = t('stageHintVideo');
}

// 隐藏并释放视频，让画布重新可见（切换场景 / 新建 / 双击返回画布时调用）
function resetVideo() {
  const video = document.getElementById('video');
  video.pause();
  video.hidden = true;
  video.removeAttribute('src');
  video.load();
  document.getElementById('stage-hint').textContent = t('stageHintAdd');
}

function bindTabs() {
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      if (tab === 'mobjects' || tab === 'animations') {
        document.querySelectorAll('.layout > aside.panel:first-child .tab').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.libTab = tab;
        renderLibrary();
      } else {
        document.querySelectorAll('.layout > aside.panel:last-child .tab').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('panel-props').hidden = tab !== 'props';
        document.getElementById('panel-code').hidden = tab !== 'code';
        if (tab === 'code') updateCode();
      }
    });
  });
}

function bindToolbar() {
  document.getElementById('scene-name').addEventListener('input', (e) => {
    state.scene.name = e.target.value || 'MyScene';
    scheduleCodeUpdate();
    saveDraft();
  });
  document.getElementById('quality').addEventListener('change', (e) => {
    state.scene.config.quality = e.target.value;
    saveDraft();
  });
  document.getElementById('scene-type').addEventListener('change', (e) => {
    state.scene.config.scene_type = e.target.value;
    scheduleCodeUpdate();
    saveDraft();
  });
  document.getElementById('lib-search').addEventListener('input', (e) => {
    state.search = e.target.value;
    renderLibrary();
  });
  document.getElementById('btn-render').addEventListener('click', doRender);
  document.getElementById('btn-refresh-code').addEventListener('click', updateCode);
  document.getElementById('btn-lang').addEventListener('click', toggleLanguage);
  document.getElementById('btn-save').addEventListener('click', saveSceneToServer);
  document.getElementById('btn-new').addEventListener('click', newScene);
  document.getElementById('scene-list').addEventListener('change', onSceneSelected);

  const video = document.getElementById('video');
  video.addEventListener('dblclick', () => {
    resetVideo();
    renderCanvas();
  });
}

async function toggleLanguage() {
  const next = currentLang === 'en_us' ? 'zh_cn' : 'en_us';
  await setLanguage(next);
  emit();
  refreshSceneList();
  try {
    await API.saveConfig({ language: next });
  } catch (err) { /* 写入失败则仅本次会话生效 */ }
}

function syncToolbar() {
  document.getElementById('scene-name').value = state.scene.name;
  document.getElementById('quality').value = state.scene.config.quality;
  document.getElementById('scene-type').value = state.scene.config.scene_type || 'Scene';
}

async function refreshSceneList() {
  const sel = document.getElementById('scene-list');
  try {
    const items = await API.scenes();
    const current = sel.value;
    sel.innerHTML = `<option value="">${t('openScene')}</option>`
      + items.map((i) => `<option value="${i.name}">${i.name}</option>`).join('');
    sel.value = current;
  } catch (err) { /* 列表拉取失败不影响编辑 */ }
}

async function saveSceneToServer() {
  const name = state.scene.name || 'MyScene';
  try {
    const result = await API.saveScene(name, state.scene);
    showToast(t('savedScene', { name: result.name }));
    await refreshSceneList();
  } catch (err) {
    showToast(t('saveFailed') + err.message, true);
  }
}

function newScene() {
  resetVideo();
  state.scene = makeEmptyScene();
  state.selection = null;
  syncToolbar();
  emit();
}

async function onSceneSelected(e) {
  const name = e.target.value;
  if (!name) return;
  try {
    const raw = await API.loadScene(name);
    state.scene = normalizeScene(raw);
    state.selection = null;
    e.target.value = '';
    resetVideo();
    syncToolbar();
    emit();
    showToast(t('openedScene', { name }));
  } catch (err) {
    showToast(t('openFailed') + err.message, true);
  }
}

async function doRender() {
  const btn = document.getElementById('btn-render');
  btn.disabled = true;
  setStatus(t('submitting'));
  try {
    const task = await API.render(state.scene);
    pollRender(task.id, btn);
  } catch (err) {
    btn.disabled = false;
    setStatus(t('submitFailed'), 'err');
    showToast(t('submitFailedDetail') + err.message, true);
  }
}

async function pollRender(taskId, btn) {
  try {
    const task = await API.task(taskId);
    if (task.status === 'done') {
      btn.disabled = false;
      setStatus(`${t('renderDone')} · ${task.elapsed}s`, 'ok');
      showVideo(task.video_url);
      return;
    }
    if (task.status === 'error') {
      btn.disabled = false;
      setStatus(t('renderFailed'), 'err');
      showToast(t('renderFailedDetail') + task.error, true);
      console.error('manim log:\n' + task.log);
      return;
    }
    setStatus(`${t('rendering')} ${task.elapsed}s`);
    setTimeout(() => pollRender(taskId, btn), 800);
  } catch (err) {
    btn.disabled = false;
    setStatus(t('pollFailed'), 'err');
    showToast(t('pollFailedDetail') + err.message, true);
  }
}

async function init() {
  bindToolbar();
  bindTabs();
  bindLibrary();
  bindCanvas();

  // 语言：读取 config.json；读取失败时回退英文
  let lang = 'en_us';
  try {
    const config = await API.getConfig();
    if (config && config.language === 'zh_cn') lang = 'zh_cn';
  } catch (err) {
    lang = 'en_us';
  }
  await setLanguage(lang);

  const draft = loadDraft();
  if (draft) {
    state.scene = draft;
    syncToolbar();
  }

  try {
    state.catalog = await API.catalog();
  } catch (err) {
    showToast(t('catalogFailed') + err.message, true);
  }
  renderLibrary();
  emit();
  refreshSceneList();
}

window.addEventListener('DOMContentLoaded', init);
