// ==UserScript==
// @name         B站批量投稿设置助手
// @namespace    https://github.com/user/bilibili-batch-editor
// @version      2.1.0
// @description  批量设置B站批量上传页视频：仅自己可见、封面、分区「绘画」、创作声明「内容无需标注」、推荐标签
// @author       User
// @match        https://member.bilibili.com/platform/upload/video/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  // ===========================
  // 配置
  // ===========================
  const CONFIG = {
    DECLARATION_TEXT: '内容无需标注',
    PRIVACY_TEXT: '仅自己可见',
    DELAY_BETWEEN_TASKS: 2500,
    DELAY_AFTER_CLICK: 800,
    ACCENT_COLOR: '#00a1d6',
    BG_COLOR: '#fff',
    PANEL_Z_INDEX: 99999,
  };

  // ===========================
  // 工具函数
  // ===========================
  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
  function notify(message, type) {
    const types = { success: '#52c41a', error: '#ff4d4f', info: '#1890ff', warning: '#faad14' };
    const el = document.createElement('div');
    el.textContent = `[B站批量投稿] ${message}`;
    Object.assign(el.style, {
      position: 'fixed', top: '20px', right: '20px', zIndex: CONFIG.PANEL_Z_INDEX + 10,
      padding: '12px 20px', borderRadius: '6px', background: '#1e1e1e',
      color: types[type] || types.info, fontSize: '14px', fontWeight: '500',
      boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
      pointerEvents: 'none',
    });
    document.body.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.5s'; }, 3000);
    setTimeout(() => el.remove(), 3500);
  }
  function logMsg(msg) {
    const el = document.getElementById('bili-batch-log');
    if (!el) return;
    const time = new Date().toLocaleTimeString();
    el.textContent += `[${time}] ${msg}\n`;
    el.scrollTop = el.scrollHeight;
  }

  // ===========================
  // 全局状态
  // ===========================
  let selectedCoverFile = null;
  let selectedCoverBase64 = null;
  let processing = false;
  let abortFlag = false;

  // ===========================
  // 表单操作函数（基于实际 DOM 结构）
  // ===========================

  /** 获取任务列表 */
  function getTasks() {
    return document.querySelectorAll('.task');
  }

  /** 点击选中一个任务 */
  function selectTask(taskEl) {
    taskEl.click();
    // 一些任务可能已经有 task-selected 类
  }

  /** 设置创作声明 →「内容无需标注」
   *  原理: 点击 .bcc-select-input-inner 打开下拉，然后点击 .bcc-select-option-list 中的对应项 */
  async function setDeclaration(text) {
    // 检查是否已经选中
    const current = document.querySelector('.bcc-select-input-inner');
    if (!current) { logMsg('  [WARN] 未找到创作声明选择器'); return false; }
    if (current.value === text) { logMsg('  创作声明已是「' + text + '」，跳过'); return true; }

    logMsg('  设置创作声明...');
    // 方式1: 直接点击 bcc-select 打开下拉
    const bccSelect = document.querySelector('.bcc-select');
    if (bccSelect) bccSelect.click();

    await delay(400);

    // 在 .bcc-select-option-list 中找目标（它在 DOM 里，点击 input 后会显示为下拉）
    const optionList = document.querySelector('.bcc-select-option-list');
    if (optionList) {
      const items = optionList.querySelectorAll('li');
      for (const li of items) {
        if (li.textContent.trim() === text) {
          li.click();
          logMsg('  创作声明 →「' + text + '」');
          await delay(CONFIG.DELAY_AFTER_CLICK);
          return true;
        }
      }
    }

    // 方式2: 查找全局 .el-select-dropdown__item
    await delay(200);
    const globalItems = document.querySelectorAll('.el-select-dropdown__item');
    for (const item of globalItems) {
      if (item.textContent.trim() === text && !item.classList.contains('is-disabled')) {
        item.click();
        logMsg('  创作声明 →「' + text + '」(全局下拉)');
        await delay(CONFIG.DELAY_AFTER_CLICK);
        return true;
      }
    }

    logMsg('  [WARN] 未找到创作声明选项「' + text + '」');
    return false;
  }

  /** 设置可见范围 →「仅自己可见」
   *  原理: 找到 .check-radio-v2-name 包含目标文字的元素，点击其父级 radio */
  async function setPrivacy(text) {
    const labels = document.querySelectorAll('.check-radio-v2-name');
    for (const label of labels) {
      if (label.textContent.trim() === text) {
        // 往上找到可点击的 radio wrapper
        let clickable = label.closest('[class*="check-radio"]') ||
                        label.closest('label') ||
                        label.closest('[class*="radio"]');
        if (clickable) {
          // 检查是否已选中
          if (clickable.classList.contains('checked') ||
              clickable.classList.contains('is-checked') ||
              clickable.classList.contains('active') ||
              clickable.classList.contains('selected')) {
            logMsg('  可见范围已是「' + text + '」，跳过');
            return true;
          }
          clickable.click();
          logMsg('  可见范围 →「' + text + '」');
          await delay(CONFIG.DELAY_AFTER_CLICK);
          return true;
        }
      }
    }
    logMsg('  [WARN] 未找到可见范围选项「' + text + '」');
    return false;
  }

  /** 设置标签 — 点击推荐标签 hot-tag-container */
  async function setTagsAuto() {
    const hotTags = document.querySelectorAll('.hot-tag-container');
    if (hotTags.length === 0) {
      // 尝试手动输入
      const tagInput = document.querySelector('input[placeholder*="标签"]');
      if (!tagInput) { logMsg('  [WARN] 未找到标签输入'); return false; }
      logMsg('  未找到推荐标签，手动输入「绘画」...');
      tagInput.focus();
      tagInput.value = '绘画';
      tagInput.dispatchEvent(new Event('input', { bubbles: true }));
      tagInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
      await delay(500);
      return true;
    }

    // 点击第一个未选中的推荐标签
    for (const tag of hotTags) {
      if (tag.classList.contains('hot-tag-container-selected')) {
        logMsg('  标签「' + tag.textContent.trim() + '」已选中，跳过');
        continue;
      }
      tag.click();
      logMsg('  标签 →「' + tag.textContent.trim() + '」');
      await delay(400);
      return true;
    }

    logMsg('  所有推荐标签均已选中');
    return true;
  }

  /** 设置封面 — 点开封面编辑器，找到封面编辑器内的 file input 注入文件 */
  async function setCover(file) {
    if (!file) { logMsg('  [WARN] 未选择封面文件'); return false; }

    // 1. 点开封面编辑器
    const editText = document.querySelector('.edit-text');
    if (!editText) { logMsg('  [WARN] 未找到封面入口'); return false; }
    editText.click();
    logMsg('  已打开封面编辑器');
    await delay(1000);

    // 2. 仅在封面编辑器面板 .cover-editor-panel-select 内查找 file input
    const panel = document.querySelector('.cover-editor-panel-select');
    if (!panel) { logMsg('  [WARN] 封面编辑器面板未出现'); return false; }

    const fileInput = panel.querySelector('input[type="file"]');
    if (!fileInput) { logMsg('  [WARN] 封面编辑器内未找到 file input'); return false; }

    // 3. 注入文件
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      fileInput.dispatchEvent(new Event('input', { bubbles: true }));
      logMsg('  封面已注入: ' + file.name);
    } catch (err) {
      logMsg('  [ERROR] 封面注入失败: ' + err.message);
      return false;
    }

    // 4. 等待上传完成后关闭封面编辑器
    await delay(2000);

    // 点击封面编辑器里的「完成」按钮
    const allBtns = panel.querySelectorAll('button');
    let doneBtn = null;
    for (const btn of allBtns) {
      if (btn.textContent.trim() === '完成') { doneBtn = btn; break; }
    }
    // 也试试 class 名匹配
    if (!doneBtn) {
      doneBtn = panel.querySelector('button[class*="confirm"], button[class*="ok"], button[class*="save"], button[class*="submit"], button[class*="done"], button[class*="complete"]');
    }
    if (doneBtn) {
      doneBtn.click();
      logMsg('  已点击「完成」按钮');
    } else {
      logMsg('  [WARN] 未找到完成按钮，点空白处关闭');
      document.body.click();
    }
    await delay(500);

    return true;
  }

  /** 设置分区（尽力而为 — 当前页面分区机制未完全确认） */
  async function setCategoryIfNeeded() {
    // 检查当前分区
    const inserted = document.querySelector('.select-item-cont-inserted');
    if (inserted && inserted.textContent.trim().includes('绘画')) {
      logMsg('  分区已是「绘画」，跳过');
      return true;
    }

    // 如果不是绘画，尝试点击 selector-container 打开下拉
    const selector = document.querySelector('.selector-container');
    if (!selector) { logMsg('  [WARN] 未找到分区选择器'); return false; }

    selector.click();
    await delay(500);

    // 尝试各种可能的下拉选项
    const options = document.querySelectorAll('.el-select-dropdown__item, .el-popper li, [class*="option-item"], .select-item');
    for (const opt of options) {
      if (opt.textContent.trim().includes('绘画') && !opt.classList.contains('is-disabled')) {
        opt.click();
        logMsg('  分区 →「' + opt.textContent.trim() + '」');
        await delay(CONFIG.DELAY_AFTER_CLICK);
        return true;
      }
    }

    logMsg('  [WARN] 分区不是绘画但未找到绘画选项，已跳过');
    document.body.click();
    return false;
  }

  // ===========================
  // 批量处理主流程
  // ===========================

  async function processSingleTask(task, file, index, total) {
    const title = task.getAttribute('title') || ('任务 #' + (index + 1));
    logMsg(`[${index + 1}/${total}] 处理「${title}」...`);

    // 1. 选中任务
    logMsg('  选中任务...');
    selectTask(task);
    await delay(CONFIG.DELAY_AFTER_CLICK);

    // 2. 创作声明
    await setDeclaration(CONFIG.DECLARATION_TEXT);

    // 3. 可见范围
    await setPrivacy(CONFIG.PRIVACY_TEXT);

    // 4. 分区（如果还不是绘画）
    await setCategoryIfNeeded();

    // 5. 标签
    await setTagsAuto();

    // 6. 封面
    if (file) {
      await setCover(file);
    } else {
      logMsg('  封面: 未选择，跳过');
    }
  }

  async function processAllTasks() {
    if (processing) { notify('正在处理中...', 'warning'); return; }

    const tasks = getTasks();
    if (tasks.length === 0) { notify('未找到视频任务', 'error'); return; }
    if (!selectedCoverFile) {
      notify('请先选择封面图片', 'warning');
      return;
    }

    processing = true;
    abortFlag = false;
    disableButtons(true);

    let ok = 0, fail = 0;
    const total = tasks.length;
    const coverFile = selectedCoverFile;

    logMsg('==== 开始批量处理 ' + total + ' 个视频 ====');
    notify('开始批量处理 ' + total + ' 个视频', 'info');
    showProgress(0, total, '0 / ' + total);

    for (let i = 0; i < total; i++) {
      if (abortFlag) { logMsg('用户中止'); break; }
      const cur = i + 1;
      showProgress(cur, total, cur + ' / ' + total + ' — ' + escapeHtml(tasks[i].getAttribute('title') || ''));

      try {
        await processSingleTask(tasks[i], coverFile, i, total);
        ok++;
        logMsg('  [OK]');
      } catch (err) {
        fail++;
        logMsg('  [FAIL] ' + err.message);
      }

      if (cur < total && !abortFlag) {
        await delay(CONFIG.DELAY_BETWEEN_TASKS);
      }
    }

    processing = false;
    disableButtons(false);
    hideProgress();
    const msg = '完成: 成功 ' + ok + ', 失败 ' + fail;
    logMsg('==== ' + msg + ' ====');
    notify(msg, fail > 0 ? 'warning' : 'success');
  }

  // ===========================
  // 单项操作入口
  // ===========================

  async function processDeclarationOnly() {
    const tasks = getTasks();
    if (tasks.length === 0) { notify('未找到视频任务', 'error'); return; }
    processing = true; abortFlag = false; disableButtons(true);
    let ok = 0, fail = 0;
    logMsg('==== 仅设置创作声明 ====');
    for (let i = 0; i < tasks.length && !abortFlag; i++) {
      showProgress(i + 1, tasks.length, (i + 1) + '/' + tasks.length);
      selectTask(tasks[i]); await delay(800);
      (await setDeclaration(CONFIG.DECLARATION_TEXT)) ? ok++ : fail++;
      if (i < tasks.length - 1) await delay(CONFIG.DELAY_BETWEEN_TASKS);
    }
    processing = false; disableButtons(false); hideProgress();
    notify('创作声明: 成功' + ok + ', 失败' + fail, fail > 0 ? 'warning' : 'success');
  }

  async function processPrivacyOnly() {
    const tasks = getTasks();
    if (tasks.length === 0) { notify('未找到视频任务', 'error'); return; }
    processing = true; abortFlag = false; disableButtons(true);
    let ok = 0, fail = 0;
    logMsg('==== 仅设置可见范围 ====');
    for (let i = 0; i < tasks.length && !abortFlag; i++) {
      showProgress(i + 1, tasks.length, (i + 1) + '/' + tasks.length);
      selectTask(tasks[i]); await delay(800);
      (await setPrivacy(CONFIG.PRIVACY_TEXT)) ? ok++ : fail++;
      if (i < tasks.length - 1) await delay(CONFIG.DELAY_BETWEEN_TASKS);
    }
    processing = false; disableButtons(false); hideProgress();
    notify('可见范围: 成功' + ok + ', 失败' + fail, fail > 0 ? 'warning' : 'success');
  }

  async function processTagsOnly() {
    const tasks = getTasks();
    if (tasks.length === 0) { notify('未找到视频任务', 'error'); return; }
    processing = true; abortFlag = false; disableButtons(true);
    let ok = 0, fail = 0;
    logMsg('==== 仅设置标签 ====');
    for (let i = 0; i < tasks.length && !abortFlag; i++) {
      showProgress(i + 1, tasks.length, (i + 1) + '/' + tasks.length);
      selectTask(tasks[i]); await delay(800);
      (await setTagsAuto()) ? ok++ : fail++;
      if (i < tasks.length - 1) await delay(CONFIG.DELAY_BETWEEN_TASKS);
    }
    processing = false; disableButtons(false); hideProgress();
    notify('标签: 成功' + ok + ', 失败' + fail, fail > 0 ? 'warning' : 'success');
  }

  // ===========================
  // UI
  // ===========================

  function createPanel() {
    const existing = document.getElementById('bili-batch-panel');
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.id = 'bili-batch-panel';
    Object.assign(panel.style, {
      position: 'fixed', bottom: '20px', right: '20px', zIndex: CONFIG.PANEL_Z_INDEX,
      width: '360px', maxHeight: '550px', background: CONFIG.BG_COLOR,
      borderRadius: '12px', boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
      display: 'flex', flexDirection: 'column', fontFamily: 'sans-serif',
      fontSize: '13px', color: '#333', overflow: 'hidden',
    });
    panel.innerHTML = `
      <div id="bili-batch-header" style="padding:10px 14px; background:${CONFIG.ACCENT_COLOR}; color:#fff; cursor:move; display:flex; align-items:center; justify-content:space-between; user-select:none;">
        <span style="font-size:14px; font-weight:600;">B站批量投稿设置 v2.1</span>
        <div style="display:flex; gap:6px;">
          <button id="bili-batch-min" style="background:none; border:none; color:#fff; cursor:pointer; font-size:16px;">–</button>
          <button id="bili-batch-close" style="background:none; border:none; color:#fff; cursor:pointer; font-size:16px;">✕</button>
        </div>
      </div>
      <div id="bili-batch-body" style="padding:12px; overflow-y:auto; flex:1; display:flex; flex-direction:column; gap:8px;">
        <div id="bili-batch-stats" style="font-size:12px; color:#999; text-align:center;"></div>
        <div id="bili-batch-cover-preview" style="display:none; text-align:center;">
          <img id="bili-batch-cover-img" src="" style="max-width:100%; max-height:100px; border-radius:6px; border:1px solid #e8e8e8;">
          <button class="bili-op" data-action="clearCover" style="font-size:11px; color:#ff4d4f; background:none; border:none; cursor:pointer; margin-top:4px;">清除封面</button>
        </div>
        <div id="bili-batch-progress" style="display:none;">
          <div style="font-size:11px; color:#666; margin-bottom:3px;"><span id="bili-batch-progress-text"></span></div>
          <div style="background:#e8e8e8; border-radius:3px; height:5px;"><div id="bili-batch-progress-bar" style="background:${CONFIG.ACCENT_COLOR}; height:100%; width:0%;"></div></div>
          <button class="bili-op" data-action="abort" style="font-size:11px; color:#ff4d4f; background:none; border:1px solid #ff4d4f; border-radius:4px; padding:2px 10px; margin-top:4px; cursor:pointer;">中止</button>
        </div>
        <div style="display:flex; flex-direction:column; gap:5px;">
          <button class="bili-act" data-action="setCover" style="padding:8px; border:none; border-radius:6px; background:#4caf50; color:#fff; cursor:pointer; font-size:12px; font-weight:500;">选择封面图片</button>
          <button class="bili-act" data-action="setAll" style="padding:10px; border:none; border-radius:6px; background:${CONFIG.ACCENT_COLOR}; color:#fff; cursor:pointer; font-size:13px; font-weight:600;">一键全部设置</button>
          <div style="display:flex; gap:5px; flex-wrap:wrap;">
            <button class="bili-act" data-action="setDeclaration" style="flex:1; min-width:60px; padding:6px; border:none; border-radius:5px; background:#2196f3; color:#fff; cursor:pointer; font-size:11px;">仅声明</button>
            <button class="bili-act" data-action="setPrivacy" style="flex:1; min-width:60px; padding:6px; border:none; border-radius:5px; background:#ff9800; color:#fff; cursor:pointer; font-size:11px;">仅隐私</button>
            <button class="bili-act" data-action="setTags" style="flex:1; min-width:60px; padding:6px; border:none; border-radius:5px; background:#e91e63; color:#fff; cursor:pointer; font-size:11px;">仅标签</button>
          </div>
        </div>
        <details style="font-size:10px;">
          <summary style="cursor:pointer; color:#999;">操作日志</summary>
          <div id="bili-batch-log" style="max-height:100px; overflow-y:auto; background:#f9f9f9; border-radius:4px; padding:6px; margin-top:4px; font-family:monospace; white-space:pre-wrap; word-break:break-all; color:#666;"></div>
        </details>
      </div>`;
    document.body.appendChild(panel);
    makeDraggable(panel);
    requestAnimationFrame(() => bindEvents(panel));
  }

  function bindEvents(panel) {
    panel.querySelector('#bili-batch-close').onclick = () => {
      panel.remove(); notify('面板已关闭，刷新页面可重新打开', 'info');
    };
    let minimized = false;
    const body = panel.querySelector('#bili-batch-body');
    panel.querySelector('#bili-batch-min').onclick = () => {
      minimized = !minimized;
      body.style.display = minimized ? 'none' : '';
      panel.querySelector('#bili-batch-min').textContent = minimized ? '+' : '–';
    };

    body.addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      if (!btn || btn.disabled) return;
      const action = btn.dataset.action;
      switch (action) {
        case 'setAll': await processAllTasks(); break;
        case 'setCover': await pickCover(); break;
        case 'setDeclaration': await processDeclarationOnly(); break;
        case 'setPrivacy': await processPrivacyOnly(); break;
        case 'setTags': await processTagsOnly(); break;
        case 'clearCover': clearCover(); break;
        case 'abort': abortFlag = true; break;
      }
    });
  }

  function makeDraggable(panel) {
    const header = panel.querySelector('#bili-batch-header');
    if (!header) return;
    let d = false, sx, sy, sl, st;
    header.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      d = true; sx = e.clientX; sy = e.clientY;
      const r = panel.getBoundingClientRect(); sl = r.left; st = r.top;
      panel.style.transition = 'none'; document.body.style.userSelect = 'none';
    });
    document.addEventListener('mousemove', (e) => {
      if (!d) return;
      panel.style.right = 'auto'; panel.style.bottom = 'auto';
      panel.style.left = (sl + e.clientX - sx) + 'px';
      panel.style.top = Math.max(0, st + e.clientY - sy) + 'px';
    });
    document.addEventListener('mouseup', () => {
      if (!d) return; d = false; panel.style.transition = ''; document.body.style.userSelect = '';
    });
  }

  function showProgress(cur, total, text) {
    const w = document.getElementById('bili-batch-progress');
    if (w) w.style.display = 'block';
    const b = document.getElementById('bili-batch-progress-bar');
    if (b) b.style.width = Math.round((cur / total) * 100) + '%';
    const t = document.getElementById('bili-batch-progress-text');
    if (t) t.textContent = text;
  }

  function hideProgress() {
    const w = document.getElementById('bili-batch-progress');
    if (w) w.style.display = 'none';
  }

  function disableButtons(v) {
    document.querySelectorAll('.bili-act').forEach(b => { b.disabled = v; b.style.opacity = v ? '0.5' : '1'; });
  }

  // ===========================
  // 封面选择
  // ===========================

  async function pickCover() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/jpeg,image/png,image/bmp,image/webp';
    input.style.display = 'none'; document.body.appendChild(input);

    const got = new Promise((resolve, reject) => {
      input.onchange = (e) => {
        const f = e.target.files[0];
        if (!f) reject(new Error('未选择文件'));
        else if (f.size > 5 * 1024 * 1024) reject(new Error('图片不能超过 5MB'));
        else resolve(f);
      };
    });

    input.click();
    try {
      const file = await got;
      input.remove();
      selectedCoverFile = file;
      const reader = new FileReader();
      reader.onload = (e) => {
        document.getElementById('bili-batch-cover-img').src = e.target.result;
        document.getElementById('bili-batch-cover-preview').style.display = 'block';
      };
      reader.readAsDataURL(file);
      logMsg('已选封面: ' + file.name + ' (' + (file.size / 1024).toFixed(0) + 'KB)');
      notify('封面: ' + file.name, 'success');
    } catch (err) {
      input.remove();
      notify(err.message, 'error');
    }
  }

  function clearCover() {
    selectedCoverFile = null;
    const p = document.getElementById('bili-batch-cover-preview');
    if (p) p.style.display = 'none';
    const img = document.getElementById('bili-batch-cover-img');
    if (img) img.src = '';
    logMsg('已清除封面');
    notify('已清除', 'info');
  }

  // ===========================
  // 初始化
  // ===========================

  function init() {
    if (!document.body) { setTimeout(init, 500); return; }
    const style = document.createElement('style');
    style.textContent = `
      @keyframes bbfi { from { opacity:0; transform:translateY(-10px); } to { opacity:1; transform:translateY(0); } }
      .bili-act:hover { filter: brightness(1.15); }
    `;
    document.head.appendChild(style);
    createPanel();

    const tasks = getTasks();
    document.getElementById('bili-batch-stats').textContent = '检测到 ' + tasks.length + ' 个视频任务';
    logMsg('B站批量投稿设置助手 v2.1 已启动');
    logMsg('检测到 ' + tasks.length + ' 个视频任务');
    logMsg('请选择封面图片，然后点击「一键全部设置」');
    logMsg('处理期间请勿操作鼠标');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
