// ==UserScript==
// @name         B站批量投稿设置助手
// @namespace    https://github.com/user/bilibili-batch-editor
// @version      1.0.0
// @description  批量设置B站待投稿视频：仅自己可见、封面、分区「绘画」、创意声明「内容无需标注」、推荐标签
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
    // API 基础地址
    API_BASE: 'https://member.bilibili.com',

    // 分区 ID 映射 — 绘画 = 162
    CATEGORY_TID: {
      DRAWING: 162,
    },

    // 创作声明默认值：内容无需标注
    COPYRIGHT: 1,         // 1=原创, 2=转载
    NO_REPRINT: 0,        // 0=允许转载, 1=禁止转载

    // 操作间隔（毫秒），避免触发风控
    DELAY_MS: 2000,

    // 请求超时
    TIMEOUT_MS: 30000,

    // 面板样式色
    ACCENT_COLOR: '#00a1d6',
    ACCENT_HOVER: '#00b5e5',
    BG_COLOR: '#fff',
    PANEL_Z_INDEX: 99999,
  };

  // ===========================
  // 工具函数
  // ===========================

  /** 从 Cookie 中获取值 */
  function getCookie(name) {
    const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : '';
  }

  /** 获取 CSRF Token */
  function getCsrfToken() {
    return getCookie('bili_jct');
  }

  /** 延迟 */
  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** 创建通知提示 */
  function notify(message, type) {
    const types = { success: '#52c41a', error: '#ff4d4f', info: '#1890ff', warning: '#faad14' };
    const el = document.createElement('div');
    el.textContent = `[B站批量投稿] ${message}`;
    Object.assign(el.style, {
      position: 'fixed',
      top: '20px',
      right: '20px',
      zIndex: CONFIG.PANEL_Z_INDEX + 10,
      padding: '12px 20px',
      borderRadius: '6px',
      background: '#1e1e1e',
      color: types[type] || types.info,
      fontSize: '14px',
      fontWeight: '500',
      boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
      animation: 'biliBatchFadeIn 0.3s ease',
      pointerEvents: 'none',
    });
    document.body.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.5s'; }, 3000);
    setTimeout(() => el.remove(), 3500);
  }

  // 注入动画 keyframe
  const styleSheet = document.createElement('style');
  styleSheet.textContent = `
    @keyframes biliBatchFadeIn { from { opacity:0; transform:translateY(-10px); } to { opacity:1; transform:translateY(0); } }
    @keyframes biliBatchSpin { to { transform:rotate(360deg); } }
  `;
  document.head.appendChild(styleSheet);

  // ===========================
  // API 模块
  // ===========================

  /**
   * 获取稿件列表
   * @param {number} status - 状态过滤: 1=进行中, 2=已通过, 3=未通过, 4=已删除（0 为不筛选）
   * @param {number} page
   * @param {number} pageSize
   */
  async function fetchArchiveList(status, page, pageSize) {
    page = page || 1;
    pageSize = pageSize || 50;
    let url = `${CONFIG.API_BASE}/x/vu/web/archive/list?pn=${page}&ps=${pageSize}`;
    if (status !== undefined && status !== 0) {
      url += `&status=${status}`;
    }
    const resp = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!resp.ok) throw new Error(`获取稿件列表失败: HTTP ${resp.status}`);
    const json = await resp.json();
    if (json.code !== 0) throw new Error(`获取稿件列表失败: ${json.message || '未知错误'}`);
    return json.data;
  }

  /**
   * 获取单个稿件编辑信息（尝试多个可能的 API 端点）
   * @param {number} aid - 稿件 archive id
   */
  async function getArchiveEditInfo(aid) {
    const endpoints = [
      `/x/vu/web/archive/pre?aid=${aid}`,
      `/x/vu/web/archive/info?aid=${aid}`,
      `/x/vu/web/archive/view?aid=${aid}`,
    ];

    let lastError = null;
    for (const path of endpoints) {
      try {
        const resp = await fetch(`${CONFIG.API_BASE}${path}`, {
          method: 'GET',
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        if (!resp.ok) continue;
        const json = await resp.json();
        if (json.code !== 0) continue;
        logMsg(`稿件 #${aid} 编辑信息获取成功 (${path})`);
        return json.data;
      } catch (err) {
        lastError = err;
      }
    }
    throw new Error(`获取稿件信息失败(aid=${aid}): ${lastError ? lastError.message : '所有端点均不可用'}`);
  }

  /**
   * 保存/编辑稿件（尝试多个可能的 API 端点）
   * @param {object} params - 稿件表单数据
   */
  async function saveArchive(params) {
    const csrf = getCsrfToken();
    if (!csrf) throw new Error('缺少 CSRF Token，请刷新页面重试');

    // 构建表单数据
    const formData = new URLSearchParams();
    formData.append('csrf', csrf);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        formData.append(key, String(value));
      }
    }

    // 可能的后端保存端点
    const endpoints = [
      `${CONFIG.API_BASE}/x/vu/web/edit`,
      `${CONFIG.API_BASE}/x/vu/web/archive/save`,
    ];

    let lastError = null;
    for (const url of endpoints) {
      try {
        const resp = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body: formData.toString(),
        });
        if (!resp.ok) continue;
        const json = await resp.json();
        if (json.code !== 0) {
          lastError = new Error(json.message || `API code=${json.code}`);
          continue;
        }
        return json.data;
      } catch (err) {
        lastError = err;
      }
    }
    throw new Error(`保存稿件失败(aid=${params.aid}): ${lastError ? lastError.message : '所有端点均不可用'}`);
  }

  /**
   * 上传封面图片
   * @param {string} base64Data - base64 图片数据（含 data URI scheme 前缀）
   * @returns {Promise<string>} 封面的 URL
   */
  async function uploadCover(base64Data) {
    const csrf = getCsrfToken();
    if (!csrf) throw new Error('缺少 CSRF Token');

    if (!base64Data.startsWith('data:image/')) {
      throw new Error('封面图片格式不正确，需要 data URI scheme');
    }

    const formData = new URLSearchParams();
    formData.append('cover', base64Data);
    formData.append('csrf', csrf);

    const resp = await fetch(`${CONFIG.API_BASE}/x/vu/web/cover/up`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: formData.toString(),
    });
    if (!resp.ok) throw new Error(`封面上传失败: HTTP ${resp.status}`);
    const json = await resp.json();
    if (json.code !== 0) throw new Error(`封面上传失败: ${json.message || '未知错误'}`);
    return json.data.url;
  }

  /**
   * 获取推荐标签
   * @param {string} title - 视频标题
   * @param {number} typeid - 分区 ID
   * @param {number} copyright - 1=原创, 2=转载
   */
  async function getRecommendedTags(title, typeid, copyright) {
    const params = new URLSearchParams({ title, typeid: String(typeid), copyright: String(copyright || 1) });
    const resp = await fetch(`${CONFIG.API_BASE}/x/vupre/web/tag/recommend?${params}`, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!resp.ok) throw new Error(`获取推荐标签失败: HTTP ${resp.status}`);
    const json = await resp.json();
    if (json.code !== 0) return [];
    return (json.data && json.data.tags) ? json.data.tags : [];
  }

  /**
   * 从 API 响应中提取稿件列表（兼容多种返回格式）
   */
  function extractArchivesFromData(data) {
    if (!data) return [];
    // 尝试常见的字段名
    const candidates = [data.arc_audits, data.list, data.archives, data.items, data.result];
    for (const arr of candidates) {
      if (Array.isArray(arr) && arr.length > 0) return arr;
    }
    // 如果 data 本身就是数组
    if (Array.isArray(data)) return data;
    return [];
  }

  /**
   * 尝试从页面 DOM 中抓取稿件信息（API 不可用时的降级方案）
   */
  function scrapeDraftsFromDOM() {
    const drafts = [];
    // B站稿件管理页常见的 DOM 选择器
    const selectors = [
      '.archive-item', '.video-item', '.draft-item', '.manage-item',
      '[class*="archive"]', '[class*="draft"]', '[class*="video-item"]',
      'tr[class*="item"]', '.list-item',
    ];
    for (const sel of selectors) {
      try {
        const els = document.querySelectorAll(sel);
        if (els.length > 0) {
          els.forEach((el, idx) => {
            // 尝试提取 aid
            const aidAttr = el.getAttribute('data-aid')
              || el.getAttribute('data-id')
              || el.getAttribute('data-avid');
            const href = el.querySelector('a[href*="aid="]') || el.querySelector('a[href*="av"]');
            let aid = aidAttr;
            if (!aid && href) {
              const m = href.getAttribute('href').match(/(?:aid|av)(\d+)/);
              if (m) aid = m[1];
            }
            const titleEl = el.querySelector('[class*="title"], .title, h3, h4, a');
            const title = titleEl ? titleEl.textContent.trim() : `稿件 #${idx + 1}`;
            if (aid) {
              drafts.push({ id: aid, aid: aid, title: title, _fromDOM: true });
            }
          });
        }
        if (drafts.length > 0) break;
      } catch (_) { /* 选择器可能无效 */ }
    }
    return drafts;
  }

  /**
   * 获取所有稿件（API 优先，DOM 降级，支持翻页）
   */
  async function fetchAllArchives() {
    const allArchives = [];
    const seenIds = new Set();
    // status: 不传=全部, 1=进行中, 2=已通过, 3=未通过, 7=草稿
    const statuses = [7, 1, undefined];

    for (const status of statuses) {
      let page = 1;
      const maxPages = 5; // 每个状态最多翻 5 页（共 500 条）
      while (page <= maxPages) {
        try {
          const data = await fetchArchiveList(status, page, 100);
          const items = extractArchivesFromData(data);
          if (items.length === 0) break;
          for (const item of items) {
            const itemId = item.id || item.aid;
            if (!seenIds.has(itemId)) {
              seenIds.add(itemId);
              allArchives.push(item);
            }
          }
          if (items.length < 100) break; // 最后一页
          page++;
        } catch (_) {
          break;
        }
      }
    }

    // API 无结果时尝试 DOM 抓取
    if (allArchives.length === 0) {
      const domDrafts = scrapeDraftsFromDOM();
      if (domDrafts.length > 0) {
        logMsg('API 未返回稿件，已从页面 DOM 抓取到稿件列表');
        return domDrafts;
      }
    }

    return allArchives;
  }

  // ===========================
  // UI 模块
  // ===========================

  /** 创建并注入整个浮动面板 */
  function createPanel() {
    // 如果已存在则移除重建
    const existing = document.getElementById('bili-batch-panel');
    if (existing) existing.remove();

    const container = document.createElement('div');
    container.id = 'bili-batch-panel';
    Object.assign(container.style, {
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      zIndex: CONFIG.PANEL_Z_INDEX,
      width: '420px',
      maxHeight: '650px',
      background: CONFIG.BG_COLOR,
      borderRadius: '12px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      fontSize: '13px',
      color: '#333',
      overflow: 'hidden',
    });
    container.innerHTML = buildPanelHTML();
    document.body.appendChild(container);

    // 可拖拽
    makeDraggable(container);

    // 事件绑定延迟到 DOM 就绪
    requestAnimationFrame(() => bindPanelEvents(container));
    return container;
  }

  function buildPanelHTML() {
    return `
      <div id="bili-batch-header" style="
        padding:14px 16px; background:${CONFIG.ACCENT_COLOR}; color:#fff; cursor:move;
        display:flex; align-items:center; justify-content:space-between; user-select:none;">
        <span style="font-size:15px; font-weight:600;">B站批量投稿设置</span>
        <div style="display:flex; gap:8px;">
          <button id="bili-batch-minimize" style="
            background:none; border:none; color:#fff; cursor:pointer; font-size:18px; padding:0 4px; line-height:1;
          " title="最小化">&#x2014;</button>
          <button id="bili-batch-close" style="
            background:none; border:none; color:#fff; cursor:pointer; font-size:18px; padding:0 4px; line-height:1;
          " title="关闭">&#x2715;</button>
        </div>
      </div>
      <div id="bili-batch-body" style="
        padding:16px; overflow-y:auto; flex:1; display:flex; flex-direction:column; gap:12px;">
        <!-- 操作按钮区 -->
        <div style="display:flex; flex-wrap:wrap; gap:8px;">
          <button class="bili-batch-btn" data-action="refresh" style="
            flex:1; min-width:80px; padding:8px 10px; border:1px solid #ddd; border-radius:6px;
            background:#f5f5f5; cursor:pointer; font-size:12px; transition:all 0.2s;
          ">&#x21bb; 刷新列表</button>
          <button class="bili-batch-btn" data-action="selectAll" style="
            flex:1; min-width:80px; padding:8px 10px; border:1px solid #ddd; border-radius:6px;
            background:#f5f5f5; cursor:pointer; font-size:12px; transition:all 0.2s;
          ">全选</button>
          <button class="bili-batch-btn" data-action="deselectAll" style="
            flex:1; min-width:80px; padding:8px 10px; border:1px solid #ddd; border-radius:6px;
            background:#f5f5f5; cursor:pointer; font-size:12px; transition:all 0.2s;
          ">取消全选</button>
        </div>
        <!-- 稿件列表 -->
        <div id="bili-batch-list" style="
          max-height:240px; overflow-y:auto; border:1px solid #e8e8e8; border-radius:6px;
          min-height:60px; display:flex; align-items:center; justify-content:center; color:#999;
        ">点击「刷新列表」加载稿件</div>
        <!-- 统计 -->
        <div id="bili-batch-stats" style="font-size:12px; color:#999; display:none;"></div>
        <!-- 封面预览区 -->
        <div id="bili-batch-cover-preview" style="display:none; text-align:center;">
          <img id="bili-batch-cover-img" src="" style="
            max-width:100%; max-height:160px; border-radius:8px; border:1px solid #e8e8e8;
          ">
          <div style="font-size:11px; color:#999; margin-top:4px;">封面预览</div>
          <button class="bili-batch-btn" data-action="clearCover" style="
            padding:4px 12px; border:1px solid #ff4d4f; border-radius:4px; color:#ff4d4f;
            background:#fff; cursor:pointer; font-size:11px; margin-top:4px;
          ">清除封面</button>
        </div>
        <!-- 进度条 -->
        <div id="bili-batch-progress" style="display:none;">
          <div style="font-size:12px; color:#666; margin-bottom:4px;">
            <span id="bili-batch-progress-text">准备中...</span>
          </div>
          <div style="background:#e8e8e8; border-radius:4px; height:6px; overflow:hidden;">
            <div id="bili-batch-progress-bar" style="
              background:${CONFIG.ACCENT_COLOR}; height:100%; width:0%; transition:width 0.3s;
            "></div>
          </div>
        </div>
        <!-- 批量操作按钮 -->
        <div id="bili-batch-actions" style="display:flex; flex-direction:column; gap:6px;">
          <button class="bili-batch-action-btn" data-action="setPrivacy" style="
            padding:10px; border:none; border-radius:6px; background:#ff9800; color:#fff;
            cursor:pointer; font-size:13px; font-weight:500; transition:opacity 0.2s;
          ">&#x1f512; 批量设为「仅自己可见」</button>
          <button class="bili-batch-action-btn" data-action="setCover" style="
            padding:10px; border:none; border-radius:6px; background:#4caf50; color:#fff;
            cursor:pointer; font-size:13px; font-weight:500; transition:opacity 0.2s;
          ">&#x1f5bc; 批量设置封面图片</button>
          <button class="bili-batch-action-btn" data-action="setDeclaration" style="
            padding:10px; border:none; border-radius:6px; background:#2196f3; color:#fff;
            cursor:pointer; font-size:13px; font-weight:500; transition:opacity 0.2s;
          ">&#x270d; 创作声明 →「内容无需标注」</button>
          <button class="bili-batch-action-btn" data-action="setCategory" style="
            padding:10px; border:none; border-radius:6px; background:#9c27b0; color:#fff;
            cursor:pointer; font-size:13px; font-weight:500; transition:opacity 0.2s;
          ">&#x1f3a8; 批量设置分区 →「绘画」</button>
          <button class="bili-batch-action-btn" data-action="setTags" style="
            padding:10px; border:none; border-radius:6px; background:#e91e63; color:#fff;
            cursor:pointer; font-size:13px; font-weight:500; transition:opacity 0.2s;
          ">&#x1f3f7; 批量设置标签（B站推荐）</button>
          <button class="bili-batch-action-btn" data-action="setAll" style="
            padding:12px; border:none; border-radius:6px; background:${CONFIG.ACCENT_COLOR}; color:#fff;
            cursor:pointer; font-size:14px; font-weight:600; transition:opacity 0.2s;
            margin-top:4px;
          ">&#x26a1; 一键全部设置</button>
        </div>
        <!-- 日志区 -->
        <details id="bili-batch-log-wrap" style="font-size:11px;">
          <summary style="cursor:pointer; color:#999;">操作日志</summary>
          <div id="bili-batch-log" style="
            max-height:120px; overflow-y:auto; background:#f9f9f9; border-radius:4px;
            padding:8px; margin-top:4px; font-family:monospace; white-space:pre-wrap;
            word-break:break-all; color:#666;
          "></div>
        </details>
      </div>`;
  }

  // ===========================
  // 面板事件绑定
  // ===========================

  let draftList = [];         // 稿件数据
  let selectedIds = new Set(); // 选中的 aid
  let coverDataUrl = null;    // 用户选择的封面 base64
  let recommendedTag = null;  // 推荐标签

  function bindPanelEvents(container) {
    // 头部按钮
    container.querySelector('#bili-batch-close').onclick = () => {
      container.remove();
      notify('面板已关闭，刷新页面可重新打开', 'info');
    };

    let minimized = false;
    const body = container.querySelector('#bili-batch-body');
    container.querySelector('#bili-batch-minimize').onclick = () => {
      minimized = !minimized;
      body.style.display = minimized ? 'none' : '';
      container.querySelector('#bili-batch-minimize').textContent = minimized ? '+' : '—';
    };

    // 操作用按钮：使用事件委托
    body.addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;

      const action = btn.dataset.action;
      if (!action) return;

      // 防止重复点击
      if (btn.disabled) return;

      switch (action) {
        case 'refresh':
          await handleRefresh();
          break;
        case 'selectAll':
          selectAllDrafts(true);
          break;
        case 'deselectAll':
          selectAllDrafts(false);
          break;
        case 'setPrivacy':
          await handleSetPrivacy();
          break;
        case 'setCover':
          await handleSetCover();
          break;
        case 'setDeclaration':
          await handleSetDeclaration();
          break;
        case 'setCategory':
          await handleSetCategory();
          break;
        case 'setTags':
          await handleSetTagsAuto();
          break;
        case 'setAll':
          await handleSetAll();
          break;
        case 'clearCover':
          handleClearCover();
          break;
      }
    });
  }

  function handleClearCover() {
    coverDataUrl = null;
    window._biliUploadedCoverUrl = null;
    const preview = document.getElementById('bili-batch-cover-preview');
    const img = document.getElementById('bili-batch-cover-img');
    if (preview) preview.style.display = 'none';
    if (img) img.src = '';
    recommendedTag = null;
    logMsg('已清除封面和缓存标签');
    notify('封面已清除，可重新选择', 'info');
  }

  // ===========================
  // 面板拖拽
  // ===========================

  function makeDraggable(panel) {
    const header = panel.querySelector('#bili-batch-header');
    if (!header) return;
    let isDragging = false;
    let startX, startY, startLeft, startTop;

    header.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = panel.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      panel.style.transition = 'none';
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.style.left = `${startLeft + dx}px`;
      panel.style.top = `${Math.max(0, startTop + dy)}px`;
    });

    document.addEventListener('mouseup', () => {
      if (!isDragging) return;
      isDragging = false;
      panel.style.transition = '';
      document.body.style.userSelect = '';
    });
  }

  // ===========================
  // 列表管理
  // ===========================

  async function handleRefresh() {
    const listEl = document.getElementById('bili-batch-list');
    const statsEl = document.getElementById('bili-batch-stats');
    listEl.innerHTML = '<span style="padding:20px;">正在拉取稿件列表...</span>';
    statsEl.style.display = 'none';

    try {
      draftList = await fetchAllArchives();
    } catch (err) {
      listEl.innerHTML = `<span style="padding:20px; color:#ff4d4f;">加载失败: ${err.message}</span>`;
      logMsg(`[ERROR] 获取稿件列表失败: ${err.message}`);
      return;
    }

    if (draftList.length === 0) {
      listEl.innerHTML = '<span style="padding:20px;">暂未找到待处理的稿件</span>';
    } else {
      selectedIds.clear();
      // 默认全选
      draftList.forEach((item) => {
        const id = item.id || item.aid;
        selectedIds.add(String(id));
      });
      renderDraftList();
    }
    statsEl.style.display = draftList.length > 0 ? 'block' : 'none';
    statsEl.textContent = `共 ${draftList.length} 个稿件，已选 ${selectedIds.size} 个`;
  }

  function renderDraftList() {
    const listEl = document.getElementById('bili-batch-list');
    listEl.innerHTML = draftList
      .map((item) => {
        const id = item.id || item.aid;
        const sid = String(id);
        const checked = selectedIds.has(sid) ? 'checked' : '';
        const title = item.title || item.archive_title || '(无标题)';
        const statusText = (item.status === 7 || item.is_draft) ? '[草稿]'
          : (item.status === 1 ? '[进行中]'
          : (item.status === 2 ? '[已通过]'
          : (item.status === 3 ? '[未通过]' : '')));
        return `<label style="
          display:flex; align-items:center; padding:6px 10px; border-bottom:1px solid #f0f0f0;
          cursor:pointer; gap:8px; font-size:12px;
        ">
          <input type="checkbox" class="bili-draft-checkbox" data-id="${sid}" ${checked}
            style="flex-shrink:0;">
          <span style="color:#999; flex-shrink:0;">${statusText}</span>
          <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"
            title="${escapeHtml(title)}">${escapeHtml(title)}</span>
        </label>`;
      })
      .join('');

    // 绑定 checkbox 事件
    listEl.querySelectorAll('.bili-draft-checkbox').forEach((cb) => {
      cb.addEventListener('change', (e) => {
        const id = e.target.dataset.id;
        if (e.target.checked) {
          selectedIds.add(id);
        } else {
          selectedIds.delete(id);
        }
        updateStats();
      });
    });

    updateStats();
  }

  function selectAllDrafts(select) {
    if (select) {
      draftList.forEach((item) => { selectedIds.add(String(item.id || item.aid)); });
    } else {
      selectedIds.clear();
    }
    renderDraftList();
  }

  function updateStats() {
    const statsEl = document.getElementById('bili-batch-stats');
    if (statsEl) {
      statsEl.textContent = `共 ${draftList.length} 个稿件，已选 ${selectedIds.size} 个`;
    }
  }

  function getSelectedArchives() {
    return draftList.filter((item) => selectedIds.has(String(item.id || item.aid)));
  }

  // ===========================
  // 进度 / 日志
  // ===========================

  function showProgress(current, total, text) {
    const wrap = document.getElementById('bili-batch-progress');
    const bar = document.getElementById('bili-batch-progress-bar');
    const txt = document.getElementById('bili-batch-progress-text');
    if (wrap) wrap.style.display = total > 0 ? 'block' : 'none';
    if (bar) bar.style.width = total > 0 ? `${Math.round((current / total) * 100)}%` : '0%';
    if (txt) txt.textContent = text || `${current} / ${total}`;
  }

  function hideProgress() {
    const wrap = document.getElementById('bili-batch-progress');
    if (wrap) wrap.style.display = 'none';
  }

  function logMsg(msg) {
    const el = document.getElementById('bili-batch-log');
    if (!el) return;
    const time = new Date().toLocaleTimeString();
    el.textContent += `[${time}] ${msg}\n`;
    el.scrollTop = el.scrollHeight;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ===========================
  // 批量操作
  // ===========================

  /**
   * 通用批量处理函数
   * @param {Array} archives - 选中的稿件
   * @param {Function} processor - 处理单个稿件的异步函数 (archive) => Promise
   * @param {string} actionName - 操作名称
   */
  async function batchProcess(archives, processor, actionName) {
    if (archives.length === 0) {
      notify('请先选择要操作的稿件', 'warning');
      return;
    }

    let successCount = 0;
    let failCount = 0;
    const total = archives.length;

    logMsg(`==== 开始批量操作: ${actionName} (共 ${total} 个) ====`);
    notify(`开始${actionName}，共 ${total} 个稿件`, 'info');
    showProgress(0, total, `0 / ${total}`);

    for (let i = 0; i < total; i++) {
      const archive = archives[i];
      const id = archive.id || archive.aid;
      const title = archive.title || archive.archive_title || '(无标题)';
      const current = i + 1;

      showProgress(current, total, `${current} / ${total} — ${escapeHtml(title)}`);

      try {
        await processor(archive);
        successCount++;
        logMsg(`[OK] #${id} ${title}`);
      } catch (err) {
        failCount++;
        logMsg(`[FAIL] #${id} ${title}: ${err.message}`);
      }

      if (current < total) {
        await delay(CONFIG.DELAY_MS);
      }
    }

    hideProgress();
    const msg = `${actionName}完成: 成功 ${successCount}, 失败 ${failCount}`;
    logMsg(`==== ${msg} ====`);
    notify(msg, failCount > 0 ? 'warning' : 'success');

    // 刷新列表
    await handleRefresh();
  }

  // ---- 单个操作处理器 ----

  async function processSetPrivacy(archive) {
    const aid = archive.id || archive.aid;
    logMsg(`获取稿件 #${aid} 编辑信息...`);
    const info = await getArchiveEditInfo(aid);
    const archiveData = (info && info.archive) ? info.archive : info;

    // 构建保存参数（基于获取到的原始数据，仅修改必要字段）
    const params = { aid: aid };

    // 拷贝现有关键字段
    if (archiveData) {
      for (const key of ['title', 'tid', 'copyright', 'cover', 'desc', 'tag', 'no_reprint', 'source', 'dynamic', 'videos', 'subtitle', 'tid_v2']) {
        if (archiveData[key] !== undefined) {
          params[key] = archiveData[key];
        }
      }
    }

    // 设置为仅自己可见（通过 state 或 publish_type）
    // B站内部: 存为草稿时 publish=0, 设置隐私状态
    // 这里的 exact 参数名需要根据实际 API 调整
    params.publish = 0; // 不发布，仅保存为草稿
    // 尝试多种可能的参数名
    params.state = 'self_only';
    // 某些版本的 API 可能使用 is_only_up 或其他参数
    params.is_self = 1;

    logMsg(`保存稿件 #${aid}「仅自己可见」...`);
    await saveArchive(params);
  }

  async function processSetCover(archive) {
    const aid = archive.id || archive.aid;
    if (!coverDataUrl) throw new Error('尚未选择封面图片');

    // 如果封面 URL 还没有上传，先上传
    // （封面只需上传一次，在 handleSetCover 中预先处理）
    // 这里直接用已上传的封面 URL

    logMsg(`获取稿件 #${aid} 编辑信息...`);
    const info = await getArchiveEditInfo(aid);
    const archiveData = (info && info.archive) ? info.archive : info;

    const params = { aid: aid };
    if (archiveData) {
      for (const key of ['title', 'tid', 'copyright', 'desc', 'tag', 'no_reprint', 'source', 'dynamic', 'videos', 'subtitle', 'tid_v2']) {
        if (archiveData[key] !== undefined) {
          params[key] = archiveData[key];
        }
      }
    }
    params.publish = 0;
    params.cover = window._biliUploadedCoverUrl; // 全局变量，由 handleSetCover 设置

    logMsg(`保存稿件 #${aid} 封面...`);
    await saveArchive(params);
  }

  async function processSetDeclaration(archive) {
    const aid = archive.id || archive.aid;
    logMsg(`获取稿件 #${aid} 编辑信息...`);
    const info = await getArchiveEditInfo(aid);
    const archiveData = (info && info.archive) ? info.archive : info;

    const params = { aid: aid };
    if (archiveData) {
      for (const key of ['title', 'tid', 'copyright', 'cover', 'desc', 'tag', 'no_reprint', 'source', 'dynamic', 'videos', 'subtitle', 'tid_v2']) {
        if (archiveData[key] !== undefined) {
          params[key] = archiveData[key];
        }
      }
    }
    params.publish = 0;

    // 创作声明：内容无需标注
    // 清除所有可能的声明字段
    params.copyright = CONFIG.COPYRIGHT;
    params.no_reprint = CONFIG.NO_REPRINT;
    // B站创作声明相关字段（根据实际 API 可能需要调整）
    // 内容无需标注 = 不勾选任何 AI生成/危险行为/商业推广 等
    params.is_ai = 0;
    params.is_risk = 0;
    params.is_business = 0;

    logMsg(`保存稿件 #${aid}「内容无需标注」...`);
    await saveArchive(params);
  }

  async function processSetCategory(archive) {
    const aid = archive.id || archive.aid;
    logMsg(`获取稿件 #${aid} 编辑信息...`);
    const info = await getArchiveEditInfo(aid);
    const archiveData = (info && info.archive) ? info.archive : info;

    const params = { aid: aid };
    if (archiveData) {
      for (const key of ['title', 'copyright', 'cover', 'desc', 'tag', 'no_reprint', 'source', 'dynamic', 'videos', 'subtitle']) {
        if (archiveData[key] !== undefined) {
          params[key] = archiveData[key];
        }
      }
    }
    params.publish = 0;
    params.tid = CONFIG.CATEGORY_TID.DRAWING; // 绘画 = 162

    logMsg(`保存稿件 #${aid} 分区→绘画 (tid=162)...`);
    await saveArchive(params);
  }

  async function processSetTags(archive) {
    const aid = archive.id || archive.aid;
    if (!recommendedTag) throw new Error('尚未获取推荐标签，请先执行「设置标签」操作');

    logMsg(`获取稿件 #${aid} 编辑信息...`);
    const info = await getArchiveEditInfo(aid);
    const archiveData = (info && info.archive) ? info.archive : info;

    const params = { aid: aid };
    if (archiveData) {
      for (const key of ['title', 'tid', 'copyright', 'cover', 'desc', 'no_reprint', 'source', 'dynamic', 'videos', 'subtitle', 'tid_v2']) {
        if (archiveData[key] !== undefined) {
          params[key] = archiveData[key];
        }
      }
    }
    params.publish = 0;
    params.tag = recommendedTag; // 使用推荐标签

    logMsg(`保存稿件 #${aid} 标签→「${recommendedTag}」...`);
    await saveArchive(params);
  }

  // ---- 操作入口 ----

  async function handleSetPrivacy() {
    const selected = getSelectedArchives();
    disableAllButtons(true);
    try {
      await batchProcess(selected, processSetPrivacy, '设为「仅自己可见」');
    } finally {
      disableAllButtons(false);
    }
  }

  async function handleSetCover() {
    if (!coverDataUrl) {
      // 触发文件选择
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/jpeg,image/png,image/bmp,image/webp';
      input.style.display = 'none';
      document.body.appendChild(input);

      const fileSelected = new Promise((resolve, reject) => {
        input.onchange = async (e) => {
          const file = e.target.files[0];
          if (!file) { reject(new Error('未选择文件')); return; }
          // 检查文件大小 (≤5MB)
          if (file.size > 5 * 1024 * 1024) {
            reject(new Error('图片大小不能超过 5MB'));
            return;
          }
          // 转为 base64
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('读取图片失败'));
          reader.readAsDataURL(file);
        };
      });

      input.click();

      try {
        coverDataUrl = await fileSelected;
        input.remove();
      } catch (err) {
        input.remove();
        notify(err.message, 'error');
        return;
      }

      // 显示预览
      const previewWrap = document.getElementById('bili-batch-cover-preview');
      const previewImg = document.getElementById('bili-batch-cover-img');
      previewImg.src = coverDataUrl;
      previewWrap.style.display = 'block';

      notify('封面图片已选择，请再次点击「批量设置封面图片」确认上传', 'info');
      return;
    }

    // 确认后上传封面并批量应用
    const selected = getSelectedArchives();
    if (selected.length === 0) {
      notify('请先选择要操作的稿件', 'warning');
      return;
    }

    disableAllButtons(true);
    try {
      // 上传一次封面，拿到 URL
      logMsg('正在上传封面图片...');
      const coverUrl = await uploadCover(coverDataUrl);
      logMsg(`封面上传成功: ${coverUrl}`);
      window._biliUploadedCoverUrl = coverUrl;

      await batchProcess(selected, processSetCover, '设置封面');
    } catch (err) {
      logMsg(`[ERROR] 封面上传失败: ${err.message}`);
      notify(`封面上传失败: ${err.message}`, 'error');
    } finally {
      disableAllButtons(false);
      // 不清除 coverDataUrl，以便用户可以对其他稿件也应用同一封面
    }
  }

  async function handleSetDeclaration() {
    const selected = getSelectedArchives();
    disableAllButtons(true);
    try {
      await batchProcess(selected, processSetDeclaration, '创作声明→「内容无需标注」');
    } finally {
      disableAllButtons(false);
    }
  }

  async function handleSetCategory() {
    const selected = getSelectedArchives();
    disableAllButtons(true);
    try {
      await batchProcess(selected, processSetCategory, '分区→「绘画」');
    } finally {
      disableAllButtons(false);
    }
  }

  async function handleSetTagsAuto() {
    const selected = getSelectedArchives();
    if (selected.length === 0) {
      notify('请先选择要操作的稿件', 'warning');
      return;
    }

    // 取第一个选中稿件的标题获取推荐标签
    const first = selected[0];
    const title = first.title || first.archive_title || '';
    logMsg(`正在获取推荐标签 (title="${title}", typeid=162)...`);

    disableAllButtons(true);
    try {
      const tags = await getRecommendedTags(title, CONFIG.CATEGORY_TID.DRAWING, CONFIG.COPYRIGHT);
      if (!tags || tags.length === 0) {
        throw new Error('B站未返回推荐标签，请手动在编辑页面设置');
      }
      recommendedTag = tags[0].tag || tags[0]; // 取第一个推荐标签
      logMsg(`自动选择推荐标签: 「${recommendedTag}」`);

      await batchProcess(selected, processSetTags, `设置标签→「${recommendedTag}」`);
    } catch (err) {
      logMsg(`[ERROR] ${err.message}`);
      notify(err.message, 'error');
    } finally {
      disableAllButtons(false);
    }
  }

  // 一键设置（分步骤顺序执行）
  async function handleSetAll() {
    if (getSelectedArchives().length === 0) {
      notify('请先选择要操作的稿件', 'warning');
      return;
    }

    logMsg('==== 一键全部设置开始 ====');

    // 1) 封面 — 先选图
    if (!coverDataUrl) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/jpeg,image/png,image/bmp,image/webp';
      input.style.display = 'none';
      document.body.appendChild(input);

      const fileSelected = new Promise((resolve, reject) => {
        input.onchange = async (e) => {
          const file = e.target.files[0];
          if (!file) { reject(new Error('未选择文件')); return; }
          if (file.size > 5 * 1024 * 1024) { reject(new Error('图片大小不能超过 5MB')); return; }
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('读取图片失败'));
          reader.readAsDataURL(file);
        };
      });

      input.click();

      try {
        coverDataUrl = await fileSelected;
        input.remove();
      } catch (err) {
        input.remove();
        notify(err.message, 'error');
        return;
      }

      // 显示预览
      document.getElementById('bili-batch-cover-img').src = coverDataUrl;
      document.getElementById('bili-batch-cover-preview').style.display = 'block';
      notify('请确认封面预览无误后，再次点击「一键全部设置」继续', 'info');
      return;
    }

    // 2) 先获取推荐标签
    const selected = getSelectedArchives();
    const first = selected[0];
    const title = first.title || first.archive_title || '';
    logMsg(`获取推荐标签 (title="${title}")...`);

    disableAllButtons(true);
    try {
      let tags = [];
      try {
        tags = await getRecommendedTags(title, CONFIG.CATEGORY_TID.DRAWING, CONFIG.COPYRIGHT);
      } catch (_) { /* 忽略 */ }
      if (tags && tags.length > 0) {
        recommendedTag = tags[0].tag || tags[0];
        logMsg(`推荐标签: 「${recommendedTag}」`);
      } else {
        logMsg('未获取到推荐标签，将跳过标签设置');
      }

      // 3) 上传封面（如果尚未上传）
      let coverUrl = window._biliUploadedCoverUrl || null;
      if (coverDataUrl && !coverUrl) {
        logMsg('上传封面图片...');
        coverUrl = await uploadCover(coverDataUrl);
        window._biliUploadedCoverUrl = coverUrl;
        logMsg(`封面 URL: ${coverUrl}`);
      } else if (coverUrl) {
        logMsg('使用已上传的封面 URL，跳过重复上传');
      }

      // 4) 逐个处理每个稿件
      const archives = selected;
      const total = archives.length;
      let successCount = 0;
      let failCount = 0;

      logMsg(`开始逐稿件设置 (共 ${total} 个)...`);
      showProgress(0, total, `0 / ${total}`);

      for (let i = 0; i < total; i++) {
        const archive = archives[i];
        const aid = archive.id || archive.aid;
        const arcTitle = archive.title || archive.archive_title || '(无标题)';
        const current = i + 1;
        showProgress(current, total, `${current} / ${total} — ${escapeHtml(arcTitle)}`);

        try {
          // 获取编辑信息
          logMsg(`[${current}/${total}] 获取 #${aid} 编辑信息...`);
          const info = await getArchiveEditInfo(aid);
          const archiveData = (info && info.archive) ? info.archive : info;

          // 构建参数，基于原始数据修改
          const params = { aid: aid, publish: 0 };
          if (archiveData) {
            for (const key of ['title', 'copyright', 'desc', 'source', 'dynamic', 'videos', 'subtitle', 'tid_v2']) {
              if (archiveData[key] !== undefined) params[key] = archiveData[key];
            }
          }
          // 覆盖为我们想要的值
          params.tid = CONFIG.CATEGORY_TID.DRAWING;   // 绘画
          params.no_reprint = CONFIG.NO_REPRINT;      // 允许转载
          params.cover = coverUrl || (archiveData ? archiveData.cover : undefined);
          if (recommendedTag) params.tag = recommendedTag;
          // 仅自己可见
          params.state = 'self_only';
          params.is_self = 1;
          // 创作声明：内容无需标注
          params.is_ai = 0;
          params.is_risk = 0;
          params.is_business = 0;

          await saveArchive(params);
          successCount++;
          logMsg(`[OK] #${aid} 设置完成`);
        } catch (err) {
          failCount++;
          logMsg(`[FAIL] #${aid}: ${err.message}`);
        }

        if (current < total) {
          await delay(CONFIG.DELAY_MS);
        }
      }

      hideProgress();
      const msg = `一键设置完成: 成功 ${successCount}, 失败 ${failCount}`;
      logMsg(`==== ${msg} ====`);
      notify(msg, failCount > 0 ? 'warning' : 'success');

      await handleRefresh();
    } finally {
      disableAllButtons(false);
    }
  }

  function disableAllButtons(disabled) {
    const panel = document.getElementById('bili-batch-panel');
    if (!panel) return;
    panel.querySelectorAll('button.bili-batch-action-btn, button.bili-batch-btn').forEach((btn) => {
      btn.disabled = disabled;
      btn.style.opacity = disabled ? '0.5' : '1';
    });
  }

  // ===========================
  // 主入口
  // ===========================

  function init() {
    // 等待页面关键元素加载
    let retries = 0;
    const maxRetries = 30;
    const tryInit = () => {
      if (document.body) {
        createPanel();
        logMsg('B站批量投稿设置助手已启动');
        logMsg(`当前页面: ${window.location.href}`);
        logMsg('提示: 请在稿件管理页面点击「刷新列表」加载待处理稿件');
      } else if (retries < maxRetries) {
        retries++;
        setTimeout(tryInit, 500);
      }
    };
    tryInit();
  }

  // DOM 就绪后启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
