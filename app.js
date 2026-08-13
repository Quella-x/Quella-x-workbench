/* ============================================================
   小筱工作台 v3 - 12项大改造全面升级
   ============================================================ */

/* ===== Utilities ===== */
const $ = (s, p = document) => p.querySelector(s);
const $$ = (s, p = document) => Array.from(p.querySelectorAll(s));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = (s) => { if (s == null) return ''; const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; };
const valIncludes = (val, target) => { if (Array.isArray(val)) return val.includes(target); return val === target; };
const arrVal = (val) => Array.isArray(val) ? val : (val ? [val] : []);
const fmtDate = (d) => { if (!d) return ''; try { const dt = new Date(d); if (isNaN(dt)) return d; return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0'); } catch { return d; } };
const todayStr = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const thisMonthStr = () => todayStr().slice(0, 7);
/* v32: 含时间的文件名戳（YYYY-MM-DD_HH-MM-SS），用于导出报价图避免重名 */
const nowStamp = () => { const d = new Date(); const p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '_' + p(d.getHours()) + '-' + p(d.getMinutes()) + '-' + p(d.getSeconds()); };

/* ===== DB Layer (localStorage) ===== */
const DB = {
  _prefix: 'xx_workbench_',
  get(key, def) { try { const v = localStorage.getItem(this._prefix + key); return v ? JSON.parse(v) : def; } catch { return def; } },
  set(key, val) { try { localStorage.setItem(this._prefix + key, JSON.stringify(val)); if (typeof Sync !== 'undefined' && !Sync._applying) Sync.notify(key); return true; } catch (e) { if (e.name === 'QuotaExceededError') Toast.error('存储空间已满，请清理图片数据'); return false; } },
  list(key) { return this.get(key, []); },
  save(key, arr) { return this.set(key, arr); },
  add(key, obj) { const a = this.list(key); obj.id = obj.id || uid(); obj._ct = Date.now(); obj._mt = Date.now(); a.push(obj); this.save(key, a); return obj; },
  update(key, id, patch) { const a = this.list(key); const i = a.findIndex(r => r.id === id); if (i >= 0) { a[i] = { ...a[i], ...patch, _mt: Date.now() }; this.save(key, a); return a[i]; } return null; },
  remove(key, id) { this.save(key, this.list(key).filter(r => r.id !== id)); },
  getById(key, id) { return this.list(key).find(r => r.id === id); },
};

/* ===== Cloud Sync (Supabase REST) ===== */
/* 同步集合：这些 store 会参与云端同步；其余（ui_state、customOpts_*、syncCfg 等）仅本地 */
const SYNC_STORES = ['publishRecords','groupbuys','factories','samples','calcTemplates','calcRecords','inspirations','commissions','authorizations','priceList','ocCharacters','ocRelations','ocStories','ocTimeline','ocCommissions','appSettings','customCategories','lifeCheckins','lifeRecords','lifeCheckinDefs'];

function hashStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = (h << 5) - h + str.charCodeAt(i); h |= 0; }
  return 'g' + (h >>> 0).toString(36);
}

const Sync = {
  cfg: null,
  status: 'off',            // off | disconnected | connected | syncing
  lastSync: 0,
  versions: {},             // store -> updated_at(ISO)
  _timer: null,
  _pushTimer: null,
  _applying: false,         // 防止拉取落地时触发回流推送
  load() {
    this.cfg = DB.get('syncCfg', null);
    this.lastSync = DB.get('syncLast', 0);
    this.versions = DB.get('syncVersions', {});
    this.updateBadge();
  },
  enabled() { return !!(this.cfg && this.cfg.url && this.cfg.anonKey && this.cfg.syncCode); },
  base() { return (this.cfg.url || '').replace(/\/+$/, ''); },
  headers() { return { 'Content-Type': 'application/json', 'apikey': this.cfg.anonKey, 'Authorization': 'Bearer ' + this.cfg.anonKey }; },
  gkey() { return hashStr(this.cfg.syncCode); },
  table() { return this.base() + '/rest/v1/sync_store'; },
  setStatus(s) { this.status = s; this.updateBadge(); },
  fmtAgo(ts) {
    const d = Math.floor((Date.now() - ts) / 1000);
    if (d < 60) return '刚刚';
    if (d < 3600) return Math.floor(d / 60) + '分钟前';
    if (d < 86400) return Math.floor(d / 3600) + '小时前';
    return Math.floor(d / 86400) + '天前';
  },
  updateBadge() {
    const el = document.getElementById('syncBadge');
    if (!el) return;
    let icon, text, cls;
    if (!this.enabled()) { icon = '☁️'; text = '未同步'; cls = 'off'; }
    else if (this.status === 'syncing') { icon = '🔄'; text = '同步中'; cls = 'syncing'; }
    else if (this.status === 'connected') { icon = '🟢'; text = '已连接' + (this.lastSync ? ' · ' + this.fmtAgo(this.lastSync) : ''); cls = 'connected'; }
    else { icon = '🔴'; text = '未连接'; cls = 'disconnected'; }
    el.className = 'sync-badge ' + cls;
    el.innerHTML = '<span class="sync-dot"></span><span class="sync-ico">' + icon + '</span><span class="sync-txt"> ' + text + '</span>';
  },
  async test() {
    if (!this.enabled()) { Toast.warning('请先在设置中填写 Supabase 配置'); return false; }
    try {
      const r = await fetch(this.table() + '?select=group_key&limit=1', { headers: this.headers() });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      this.setStatus('connected');
      return true;
    } catch (e) {
      this.setStatus('disconnected');
      Toast.error('连接失败：' + e.message);
      return false;
    }
  },
  notify(store) {
    if (!this.enabled() || SYNC_STORES.indexOf(store) === -1) return;
    if (this._pushTimer) clearTimeout(this._pushTimer);
    this._pushTimer = setTimeout(() => this.pushAll(), 800);
  },
  async pushStore(store) {
    const data = DB.list(store);
    const updated_at = new Date().toISOString();
    const body = { group_key: this.gkey(), store, data, updated_at };
    const r = await fetch(this.table(), {
      method: 'POST',
      headers: Object.assign(this.headers(), { 'Prefer': 'resolution=merge-duplicates' }),
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    this.versions[store] = updated_at;
    this.lastSync = Date.now();
    DB.set('syncVersions', this.versions);
    DB.set('syncLast', this.lastSync);
  },
  async pushAll() {
    if (!this.enabled()) return;
    this.setStatus('syncing');
    try {
      for (const store of SYNC_STORES) { await this.pushStore(store); }
      this.setStatus('connected');
    } catch (e) { this.setStatus('disconnected'); }
  },
  async pullStore(store) {
    const r = await fetch(this.table() + '?group_key=eq.' + encodeURIComponent(this.gkey()) + '&store=eq.' + encodeURIComponent(store) + '&select=store,data,updated_at', { headers: this.headers() });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const rows = await r.json();
    if (!rows.length) return false;
    const row = rows[0];
    const localV = this.versions[store];
    if (!localV || (row.updated_at && Date.parse(row.updated_at) > Date.parse(localV || 0))) {
      this._applying = true;
      DB.set(store, row.data || []);
      this._applying = false;
      this.versions[store] = row.updated_at;
      DB.set('syncVersions', this.versions);
      return true;
    }
    return false;
  },
  async pullAll() {
    if (!this.enabled()) return;
    let changed = false;
    try {
      for (const store of SYNC_STORES) { if (await this.pullStore(store)) changed = true; }
      this.lastSync = Date.now();
      DB.set('syncLast', this.lastSync);
      this.setStatus('connected');
    } catch (e) { this.setStatus('disconnected'); }
    if (changed) {
      Toast.info('已从云端同步最新数据');
      const modalOpen = document.getElementById('modalOverlay') && document.getElementById('modalOverlay').classList.contains('show');
      if (!modalOpen && currentPage) navigate(currentPage);
    }
  },
  async fullSync() {
    if (!this.enabled()) { Toast.warning('请先在设置中填写 Supabase 配置'); return; }
    this.setStatus('syncing');
    try {
      await this.pushAll();
      await this.pullAll();
      if (this.status !== 'disconnected') this.setStatus('connected');
      Toast.success('同步完成');
    } catch (e) { this.setStatus('disconnected'); Toast.error('同步失败：' + e.message); }
  },
  startAuto() {
    if (!this.enabled()) { this.updateBadge(); return; }
    this.pullAll();
    if (this._timer) clearInterval(this._timer);
    this._timer = setInterval(() => { if (navigator.onLine !== false) this.pullAll(); }, 30000);
    window.addEventListener('online', () => this.pullAll());
    window.addEventListener('focus', () => { if (navigator.onLine !== false) this.pullAll(); });
  }
};


/* ===== Toast ===== */
const Toast = {
  show(msg, type = 'info', dur = 2500) {
    const c = $('#toastContainer'); const t = document.createElement('div');
    t.className = 'toast ' + type; t.innerHTML = '<span>' + esc(msg) + '</span>';
    c.appendChild(t); setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(100%)'; setTimeout(() => t.remove(), 300); }, dur);
  },
  success(m) { this.show(m, 'success'); }, error(m) { this.show(m, 'error'); },
  warning(m) { this.show(m, 'warning'); }, info(m) { this.show(m, 'info'); },
};

/* ===== Confirm ===== */
function confirmDialog(msg, title = '确认操作') {
  return new Promise(resolve => {
    openModal(title, `<div style="padding:8px 0;font-size:14px;line-height:1.6">${esc(msg)}</div>`, [
      { label: '取消', class: 'btn-ghost', action: () => { closeModal(); resolve(false); } },
      { label: '确认', class: 'btn-primary', action: () => { closeModal(); resolve(true); } },
    ]);
  });
}

/* ===== Modal ===== */
// v29: 手机端弹窗手势返回（横向右滑 = 叉掉）
function initModalSwipe() {
  if (initModalSwipe._done) return;
  initModalSwipe._done = true;
  const modal = document.getElementById('modal');
  if (!modal) return;
  let sx = 0, sy = 0, tracking = false;
  const blocked = (t) => t && t.closest && t.closest('input,textarea,select,[contenteditable="true"],button,a,.btn,.tag,.combobox-dropdown');
  modal.addEventListener('touchstart', (e) => {
    if (window.innerWidth > 768) return;
    if (e.touches.length !== 1 || blocked(e.target)) { tracking = false; return; }
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; tracking = true;
  }, { passive: true });
  modal.addEventListener('touchmove', (e) => {
    if (!tracking || window.innerWidth > 768) return;
    const dx = e.touches[0].clientX - sx, dy = e.touches[0].clientY - sy;
    if (Math.abs(dx) > Math.abs(dy) && dx > 0) {
      modal.style.transition = 'none';
      modal.style.transform = 'translateX(' + dx + 'px)';
      modal.style.opacity = String(Math.max(0.4, 1 - dx / 400));
    }
  }, { passive: true });
  modal.addEventListener('touchend', (e) => {
    if (!tracking || window.innerWidth > 768) { tracking = false; return; }
    tracking = false;
    modal.style.transition = ''; modal.style.transform = ''; modal.style.opacity = '';
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (dx > 70 && Math.abs(dx) > Math.abs(dy) * 1.4) closeModal();
  }, { passive: true });
}

// v-DY: 模态打开时压入一条 history 状态，使手机系统「侧滑返回」手势优先关闭模态而非直接退出 APP
let _modalHistoryPushed = false;
function openModal(title, bodyHTML, footerBtns, size = '') {
  $('#modalTitle').textContent = title; $('#modalBody').innerHTML = bodyHTML;
  const fc = $('#modalFooter'); fc.innerHTML = ''; fc.style.display = '';
  if (footerBtns && footerBtns.length) {
    footerBtns.forEach(b => { const btn = document.createElement('button'); btn.className = 'btn ' + (b.class || 'btn-primary'); btn.textContent = b.label; btn.onclick = () => b.action && b.action(); fc.appendChild(btn); });
  } else { fc.style.display = 'none'; }
  $('#modal').className = 'modal' + (size ? ' ' + size : '');
  $('#modalOverlay').classList.add('show');
  initModalSwipe();
  if (!_modalHistoryPushed) { try { history.pushState({ wbModal: 1 }, ''); _modalHistoryPushed = true; } catch (e) {} }
}
function closeModal() {
  $('#modalOverlay').classList.remove('show'); $('#modalBody').innerHTML = ''; $('#modalFooter').innerHTML = '';
  if (_modalHistoryPushed) { _modalHistoryPushed = false; try { history.back(); } catch (e) {} }
}
// 系统返回手势（Android 侧滑返回 / 浏览器后退）触发 popstate → 关闭当前模态并回到上一级
window.addEventListener('popstate', function () {
  if (_modalHistoryPushed) {
    _modalHistoryPushed = false;
    $('#modalOverlay').classList.remove('show'); $('#modalBody').innerHTML = ''; $('#modalFooter').innerHTML = '';
  }
});

/* ===== Lightbox ===== */
function openLightbox(src) { $('#lightboxImg').src = src; $('#lightbox').classList.add('show'); }

/* ===== Image Upload ===== */
function initImageUpload(containerSelector) {
  const container = $(containerSelector); if (!container) return;
  const area = container.querySelector('.img-upload-area'); const input = container.querySelector('.img-upload-input'); const preview = container.querySelector('.img-preview-grid');
  if (!area || !input) return;
  let images = container._images || [];
  const renderPreview = () => { preview.innerHTML = images.map((src, i) => `<div class="img-preview-item"><img src="${src}" onclick="openLightbox('${src.replace(/'/g, "\\'")}')"><span class="remove-img" onclick="removeImg(${i})">&times;</span></div>`).join(''); };
  container._getImages = () => images; container._setImages = (imgs) => { images = imgs || []; renderPreview(); };
  window.removeImg = (i) => { images.splice(i, 1); renderPreview(); };
  renderPreview();
  area.onclick = () => input.click();
  input.onchange = () => { Array.from(input.files).forEach(file => { if (file.size > 3 * 1024 * 1024) { Toast.warning(`图片 ${file.name} 超过3MB，已跳过`); return; } const reader = new FileReader(); reader.onload = (e) => { images.push(e.target.result); renderPreview(); }; reader.readAsDataURL(file); }); input.value = ''; };
}
function makeImageUploadHTML() {
  return `<div class="img-upload-container" id="imgUpload"><div class="img-upload-area"><span style="font-size:24px;display:block;margin-bottom:4px">📷</span><span style="font-size:12px;color:var(--c-text-muted)">点击上传图片（单张不超过3MB）</span></div><input type="file" class="img-upload-input" accept="image/*" multiple style="display:none"><div class="img-preview-grid"></div></div>`;
}

/* ===== Settings System ===== */
const DEFAULT_NAV_ICONS = {
  'home': '🏠', 'groupbuy': '📦', 'groupbuy-records': '📋', 'groupbuy-factories': '🏭',
  'groupbuy-samples': '🔬', 'groupbuy-calc': '🧮', 'design': '🎨', 'design-inspiration': '💡',
  'design-commission': '📅', 'design-calc': '🧮', 'design-auth': '📜', 'design-pricelist': '💰',
  'oc': '👤', 'oc-profiles': '🎭', 'oc-relations': '🔗', 'oc-stories': '📖', 'oc-timeline': '🕐',   'oc-commission': '🖌️',
  'life-checkin': '✅', 'life-record': '📝'
};
const DEFAULT_SETTINGS = {
  theme: { primary: '#9DC8FF', primaryLight: '#BDE7FF', primaryDark: '#7AB5F5', primaryBg: '#E0F2FF', sidebarStart: '#7AB5F5', sidebarEnd: '#5BA3F0' },
  customThemes: [],
  navIcons: { ...DEFAULT_NAV_ICONS },
  navLabels: {},
  fieldLabels: {},
  fieldOptions: {},
  priceListNotes: [
    { title: '价格浮动', content: '价格会根据复杂程度上下浮动' },
    { title: '用途倍率', content: '自用×1  商用×2  买断×3' },
    { title: '自印买料', content: '自印买料<150\n默认可以打稿展示 会原码\n报蛋样机 简单预览' },
    { title: '同稿改稿', content: '改色+字 ×0.6\n改人+字/色 ×0.8\n改人 ×0.5（包括人）' },
    { title: 'SET 套装折扣', content: '同柄图 > 4 种制品  九折\n同柄图 > 9 种制品  八折' },
    { title: '约稿折扣', content: '约稿制品 > 8 件  九折\n最终同图/同柄随机减价' },
    { title: '默认发图', content: 'RGB —— png/jpg 图片\nCMYK —— 工艺分图 psd\n源文件最多保留一个月' },
    { title: '工期', content: '自排分稿文件 1-2-3 天\n需整理稿 2-4 天\n宣传不接急加急 不含很慢' },
    { title: '付款与改稿', content: '定金 50%，跑单/飞机不退\n免费小改 3 次，超过 3r/次\n大改（如整体换色）10r/次\n尺寸出入不可免费改 1 次' },
    { title: '版权与确认', content: '稿图版权请自行解决\nRGB/CMYK 和尺寸会确认 2 次' },
  ],
};
const PRESET_THEMES = [
  { name: '海豚蓝', primary: '#9DC8FF', primaryLight: '#BDE7FF', primaryDark: '#7AB5F5', primaryBg: '#E0F2FF', sidebarStart: '#7AB5F5', sidebarEnd: '#5BA3F0' },
  { name: '暖橙', primary: '#fa8c16', primaryLight: '#ffc068', primaryDark: '#d46b08', primaryBg: '#fff7e6', sidebarStart: '#d46b08', sidebarEnd: '#ad4e00' },
];
function getSettings() {
  const s = DB.get('appSettings', DEFAULT_SETTINGS);
  if (!s.navIcons) s.navIcons = { ...DEFAULT_NAV_ICONS };
  if (!s.navLabels) s.navLabels = {};
  return s;
}
function saveSettings(s) { DB.set('appSettings', s); }
function applyTheme(theme) {
  const root = document.documentElement;
  root.style.setProperty('--c-primary', theme.primary);
  root.style.setProperty('--c-primary-light', theme.primaryLight);
  root.style.setProperty('--c-primary-dark', theme.primaryDark);
  root.style.setProperty('--c-primary-bg', theme.primaryBg);
  root.style.setProperty('--c-sidebar-start', theme.sidebarStart);
  root.style.setProperty('--c-sidebar-end', theme.sidebarEnd);
  root.style.setProperty('--c-info', theme.primary);
}
function getNavIcon(key) { const s = getSettings(); return (s.navIcons && s.navIcons[key]) || DEFAULT_NAV_ICONS[key] || '📌'; }
function getNavLabel(key, defaultLabel) { const s = getSettings(); return (s.navLabels && s.navLabels[key]) || defaultLabel; }
function getFieldLabel(moduleKey, fieldKey, defaultLabel) {
  const s = getSettings();
  return (s.fieldLabels && s.fieldLabels[moduleKey + '.' + fieldKey]) || defaultLabel;
}
function getFieldOpts(moduleKey, fieldKey, defaultOptions) {
  const s = getSettings();
  const custom = s.fieldOptions && s.fieldOptions[moduleKey + '.' + fieldKey];
  if (custom && custom.length) return custom.map(v => ({ value: v, label: v }));
  return defaultOptions || [];
}

/* ===== Dynamic List Field Configs ===== */
const _dynamicConfigs = {};

/* ===== Form Builder ===== */
function buildFormField(f, data, moduleKey, wrap) {
  if (f.section) return `<div class="form-section">${esc(f.section)}</div>`;
  if (f.type === 'custom') return f.html || '';
  const label = moduleKey ? getFieldLabel(moduleKey, f.key, f.label) : f.label;
  const val = data[f.key] ?? f.default ?? '';
  const valStr = typeof val === 'string' ? val : (Array.isArray(val) ? '' : String(val ?? ''));
  let inner = '';
  if (f.type === 'textarea') {
    inner = `<label class="form-label">${esc(label)}</label><textarea class="form-textarea" data-key="${f.key}" placeholder="${esc(f.placeholder || '')}">${esc(valStr)}</textarea>${f.hint ? `<span class="form-hint">${esc(f.hint)}</span>` : ''}`;
  } else if (f.type === 'combobox') {
    const opts = moduleKey ? getFieldOpts(moduleKey, f.key, f.options) : (f.options || []);
    const shouldSort = !f.noSort && (['factory', 'product', 'category'].includes(f.key) || f.label === '厂家');
    const displayOpts = shouldSort ? opts.slice().sort((a, b) => {
      const la = typeof a === 'string' ? a : a.label;
      const lb = typeof b === 'string' ? b : b.label;
      return String(la).localeCompare(String(lb), 'zh');
    }) : opts;
    const listId = 'cb_' + f.key + '_' + Math.random().toString(36).slice(2, 7);
    const optHTML = displayOpts.map(o => { const v = typeof o === 'string' ? o : o.value; const l = typeof o === 'string' ? o : o.label; return `<div class="combobox-option" onclick="selectComboboxOption('${listId}',this)" data-value="${esc(v)}">${esc(l)}</div>`; }).join('');
    inner = `<label class="form-label">${esc(label)}</label><div class="combobox-wrapper"><input type="text" class="form-input combobox-input" data-key="${f.key}" value="${esc(valStr)}" placeholder="${esc(f.placeholder || '选择或输入...')}" onfocus="showComboboxDropdown('${listId}')" onclick="showComboboxDropdown('${listId}')" oninput="filterComboboxDropdown('${listId}',this.value)"><button type="button" class="combobox-toggle" onclick="toggleComboboxDropdown('${listId}')">▼</button><div class="combobox-dropdown" id="${listId}">${optHTML}</div></div>${f.hint ? `<span class="form-hint">${esc(f.hint)}</span>` : ''}`;
  } else if (f.type === 'multiselect') {
    const opts = moduleKey ? getFieldOpts(moduleKey, f.key, f.options) : (f.options || []);
    const selected = Array.isArray(val) ? val : (val ? String(val).split(',') : []);
    // Merge custom options from DB
    let allOpts = opts;
    if (f.allowCustom && moduleKey) {
      const customOpts = DB.get('customOpts_' + moduleKey + '_' + f.key, []);
      const existingVals = opts.map(o => typeof o === 'string' ? o : o.value);
      customOpts.forEach(cv => { if (!existingVals.includes(cv)) { allOpts = allOpts.concat([{ value: cv, label: cv, custom: true }]); } });
    }
    // 人物关系关系类型按 A-Z 排序（含自定义）
    if (moduleKey === 'oc-relations' && f.key === 'relationType') {
      allOpts = allOpts.slice().sort((a, b) => {
        const av = typeof a === 'string' ? a : (a.label || a.value);
        const bv = typeof b === 'string' ? b : (b.label || b.value);
        return av.localeCompare(bv, 'zh-CN');
      });
    }
    const singleAttr = f.single ? ' data-single="true"' : '';
    const onClickAttr = f.single ? ' onclick="limitSingleCheckbox(this)"' : '';
    const optHTML = allOpts.map(o => {
      const v = typeof o === 'string' ? o : o.value;
      const l = typeof o === 'string' ? o : o.label;
      const isCustom = typeof o === 'object' && o.custom;
      const customAttr = isCustom ? ' data-custom="true"' : '';
      return `<label class="checkbox-item ${selected.includes(v) ? 'selected' : ''}"${customAttr}><input type="checkbox" value="${esc(v)}" ${selected.includes(v) ? 'checked' : ''}${onClickAttr}${customAttr}> ${esc(l)}</label>`;
    }).join('');
    const mainGroupId = 'ms_' + f.key + '_' + Math.random().toString(36).slice(2, 7);
    let msInner = `<label class="form-label">${esc(label)}</label><div class="checkbox-group" id="${mainGroupId}" data-key="${f.key}"${singleAttr}>${optHTML}</div>`;
    if (f.allowCustom) {
      const customInputId = 'customAdd_' + f.key + '_' + Math.random().toString(36).slice(2, 7);
      const customPlaceholder = (moduleKey === 'oc-relations' && f.key === 'relationType') ? '请输入自定义关系类型' : '输入自定义类型后按添加';
      // v32: 人物关系自定义关系类型改为勾选删除（红色删除按钮与添加按钮并排）
      const isRelType = moduleKey === 'oc-relations' && f.key === 'relationType';
      const delBtn = isRelType ? `<button type="button" class="btn btn-danger btn-sm" onclick="removeCheckedCustomRelationTypes('${mainGroupId}')">删除</button>` : '';
      msInner += `<div style="display:flex;gap:6px;margin-top:6px"><input type="text" class="form-input" id="${customInputId}" placeholder="${esc(customPlaceholder)}" style="flex:1;font-size:13px"><button type="button" class="btn btn-outline btn-sm" onclick="addCustomMultiselectOpt('${customInputId}','${moduleKey || ''}','${f.key}',this)">添加</button>${delBtn}</div>`;
    }
    inner = msInner;
  } else if (f.type === 'select') {
    const opts = moduleKey ? getFieldOpts(moduleKey, f.key, f.options) : (f.options || []);
    const optHTML = opts.map(o => {
      const v = typeof o === 'string' ? o : o.value;
      const l = typeof o === 'string' ? o : (o.label || o.value);
      return `<option value="${esc(v)}" ${valStr === v ? 'selected' : ''}>${esc(l)}</option>`;
    }).join('');
    inner = `<label class="form-label">${esc(label)}</label><select class="form-input" data-key="${f.key}">${optHTML}</select>${f.hint ? `<span class="form-hint">${esc(f.hint)}</span>` : ''}`;
  } else if (f.type === 'dynamic-list' || f.type === 'dynamic-products') {
    return buildDynamicListHTML(f, data, moduleKey);
  } else if (f.type === 'image') {
    inner = `<label class="form-label">${esc(label)}</label>${makeImageUploadHTML()}`;
  } else if (f.type === 'readonly') {
    inner = `<label class="form-label">${esc(label)}</label><input type="text" class="form-input" data-key="${f.key}" value="${esc(valStr)}" readonly style="background:var(--c-primary-bg)">${f.hint ? `<span class="form-hint">${esc(f.hint)}</span>` : ''}`;
  } else {
    const type = f.type || 'text';
    // v16: 日期字段除默认当天外，增加"请选择日期"提示词
    let hint = f.hint || '';
    let placeholder = f.placeholder || '';
    if (type === 'date') {
      const isTodayDefault = f.default === todayStr();
      if (!isTodayDefault && !valStr) {
        if (!hint) hint = '请选择日期';
        placeholder = '请选择日期';
      }
    }
    inner = `<label class="form-label">${esc(label)}</label><input type="${type}" class="form-input" data-key="${f.key}" value="${esc(valStr)}" placeholder="${esc(placeholder)}">${hint ? `<span class="form-hint">${esc(hint)}</span>` : ''}`;
  }
  return wrap ? `<div class="form-row">${inner}</div>` : inner;
}
function buildForm(fields, data = {}, moduleKey = '') {
  let html = '';
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (!f.row || f.section || f.type === 'custom') {
      html += buildFormField(f, data, moduleKey, true);
      continue;
    }
    // v32: 同行字段（row 属性相同）合并为一行
    const group = [f];
    while (i + 1 < fields.length && fields[i + 1].row === f.row) { group.push(fields[i + 1]); i++; }
    html += `<div class="form-row form-row-inline"><div class="form-row-label">${esc(f.rowLabel || '')}</div><div class="form-inline-fields">`;
    group.forEach(gf => { html += `<div class="form-inline-field">${buildFormField(gf, data, moduleKey, false)}</div>`; });
    html += '</div></div>';
  }
  return html;
}

function buildDynamicCombobox(col, value) {
  const opts = col.options || [];
  const sortedOpts = opts.slice().sort((a, b) => {
    const la = typeof a === 'string' ? a : a.label;
    const lb = typeof b === 'string' ? b : b.label;
    return String(la).localeCompare(String(lb), 'zh');
  });
  const cbId = 'dycb_' + col.subkey + '_' + Math.random().toString(36).slice(2, 8);
  const optHTML = sortedOpts.map(o => {
    const v = typeof o === 'string' ? o : o.value;
    const l = typeof o === 'string' ? o : o.label;
    return `<div class="combobox-option" onclick="selectComboboxOption('${cbId}',this)" data-value="${esc(v)}">${esc(l)}</div>`;
  }).join('');
  const priceLookupAttr = col.priceLookup ? `fillDynamicPrice(this,'${col.priceLookup}')` : '';
  const oninputStr = `filterComboboxDropdown('${cbId}',this.value);${priceLookupAttr}`;
  return `<div class="combobox-wrapper" data-subkey="${col.subkey}" style="min-width:0;flex:1"><input type="text" class="form-input combobox-input" data-subkey="${col.subkey}" value="${esc(value)}" placeholder="${esc(col.label)}" onfocus="showComboboxDropdown('${cbId}')" onclick="showComboboxDropdown('${cbId}')" oninput="${oninputStr}"><button type="button" class="combobox-toggle" onclick="toggleComboboxDropdown('${cbId}')">▼</button><div class="combobox-dropdown" id="${cbId}">${optHTML}</div></div>`;
}

/* ===== 接稿排期：加价项目「绑定制品」下拉（读取制品序号+制品，首项「无（不绑定）」） ===== */
function commissionBindOptions(products, cbId) {
  let opts = [`<div class="combobox-option" data-value="" onclick="selectComboboxOption('${cbId}',this)">无（不绑定）</div>`];
  (products || []).forEach((p, i) => {
    const seq = String(i + 1).padStart(2, '0');
    const label = p.name ? (seq + ' ' + p.name) : seq;
    opts.push(`<div class="combobox-option" data-value="${esc(label)}" onclick="selectComboboxOption('${cbId}',this)">${esc(label)}</div>`);
  });
  return opts.join('');
}
function buildCommissionBindCombobox(col, value, products) {
  const cbId = 'dybind_' + col.subkey + '_' + Math.random().toString(36).slice(2, 8);
  // products 为空（新建表单尚未注入 DOM）时，从 #products_rows 实时读取
  let items = products;
  if (!items) {
    items = $$('#products_rows .dynamic-list-row').map((row, idx) => {
      const ni = row.querySelector('[data-subkey="name"]');
      return { name: ni ? ni.value.trim() : '', idx: idx };
    });
  }
  const optHTML = commissionBindOptions(items, cbId);
  return `<div class="combobox-wrapper" data-subkey="${col.subkey}" style="min-width:0;flex:0 0 140px"><input type="text" class="form-input combobox-input" data-subkey="${col.subkey}" value="${esc(value)}" placeholder="${esc(col.label)}" onfocus="showComboboxDropdown('${cbId}')" onclick="showComboboxDropdown('${cbId}')" oninput="filterComboboxDropdown('${cbId}',this.value)"><button type="button" class="combobox-toggle" onclick="toggleComboboxDropdown('${cbId}')">▼</button><div class="combobox-dropdown" id="${cbId}" data-bind="productRef">${optHTML}</div></div>`;
}
/* 表单注入后刷新绑定下拉（读取最新制品列表） */
function refreshCommissionBindOptions() {
  const prodRows = $$('#products_rows .dynamic-list-row');
  const labels = prodRows.map((row, idx) => {
    const ni = row.querySelector('[data-subkey="name"]');
    const name = ni ? ni.value.trim() : '';
    const seq = String(idx + 1).padStart(2, '0');
    return { seq: seq, label: name ? (seq + ' ' + name) : seq };
  });
  $$('.combobox-dropdown[data-bind="productRef"]').forEach(dd => {
    const cbId = dd.id;
    let html = `<div class="combobox-option" data-value="" onclick="selectComboboxOption('${cbId}',this)">无（不绑定）</div>`;
    labels.forEach(l => { html += `<div class="combobox-option" data-value="${esc(l.label)}" onclick="selectComboboxOption('${cbId}',this)">${esc(l.label)}</div>`; });
    dd.innerHTML = html;
  });
}
/* 删除动态列表行并重排序号（序号列仅制品列表有） */
function removeDynamicRow(btn) {
  const row = btn.parentElement;
  const container = row.closest('.dynamic-list-container');
  row.remove();
  if (container) {
    const rows = container.querySelectorAll('.dynamic-list-row');
    rows.forEach((r, i) => { const s = r.querySelector('.dl-seq'); if (s) s.textContent = String(i + 1).padStart(2, '0'); });
  }
}

function buildDynamicListHTML(field, data, moduleKey) {
  const label = moduleKey ? getFieldLabel(moduleKey, field.key, field.label) : field.label;
  const items = data[field.key] || [];
  const columns = field.columns || [];
  _dynamicConfigs[field.key] = field;
  let html = `<div class="form-row"><label class="form-label">${esc(label)}</label>`;
  const containerCls = 'dynamic-list-container';
  html += `<div class="${containerCls}" data-key="${field.key}" data-module="${esc(moduleKey)}">`;
  if (columns.length > 1) {
    html += `<div class="dynamic-list-header">`;
    columns.forEach(col => {
      html += `<span data-subkey="${esc(col.subkey)}">${esc(col.label)}</span>`;
    });
    html += `<span>操作</span></div>`;
  }
  html += `<div class="dynamic-list-rows" id="${field.key}_rows">`;
  const rows = items.length > 0 ? items : [{}];
  rows.forEach((item, idx) => {
    html += `<div class="dynamic-list-row">`;
    columns.forEach(col => {
      const v = item[col.subkey] !== undefined ? item[col.subkey] : (col.default !== undefined ? col.default : '');
      if (Array.isArray(v)) v = v[0] !== undefined ? v[0] : '';
      if (col.type === 'seq') {
        html += `<span class="dl-seq" data-subkey="_seq">${String(idx + 1).padStart(2, '0')}</span>`;
      } else if (col.bindProducts) {
        html += buildCommissionBindCombobox(col, v, data ? data.products : null);
      } else if (col.type === 'multiselect' && col.options) {
        const selected = Array.isArray(v) ? v : (v ? String(v).split(',') : []);
        const cbId = 'dymc_' + col.subkey + '_' + Math.random().toString(36).slice(2,6);
        const optsHTML = col.options.map(o => {
          const ov = typeof o === 'string' ? o : o.value;
          const ol = typeof o === 'string' ? o : o.label;
          const isSel = selected.includes(ov);
          return `<label class="ms-item"><input type="checkbox" value="${esc(ov)}"${isSel ? ' checked' : ''} onchange="dcUpdateMultiSel('${cbId}',this)">${esc(ol)}</label>`;
        }).join('');
        html += `<div class="dynamic-multi-sel" id="${cbId}" data-subkey="${col.subkey}">${optsHTML}</div>`;
      } else if (col.type === 'select' && col.options) {
        const opts = col.options.map(o => {
          const ov = typeof o === 'string' ? o : o.value;
          const ol = typeof o === 'string' ? o : (o.label || o.value);
          const isDefault = typeof o === 'object' && o.default;
          const isSelected = (isDefault && !v) || ov === v;
          return `<option value="${esc(ov)}"${isSelected ? ' selected' : ''}>${esc(ol)}</option>`;
        }).join('');
        const hasDefault = col.options.some(o => typeof o === 'object' && o.default);
        const emptyOpt = hasDefault ? '' : `<option value="">-</option>`;
        html += `<select class="form-input" data-subkey="${col.subkey}">${emptyOpt}${opts}</select>`;
      } else if (col.type === 'combobox' || (col.options && col.type !== 'select')) {
        html += buildDynamicCombobox(col, v);
      } else if (col.type === 'checkbox') {
        const chk = v ? 'checked' : '';
        html += `<label class="dl-urgent-cell"><input type="checkbox" data-subkey="${col.subkey}" ${chk}></label>`;
      } else {
        const inputType = col.type || 'text';
        html += `<input type="${inputType}" class="form-input" data-subkey="${col.subkey}" value="${esc(v)}" placeholder="${esc(col.label)}">`;
      }
    });
    html += `<button type="button" class="btn btn-ghost btn-sm" onclick="removeDynamicRow(this)">删除</button>`;
    html += `</div>`;
  });
  html += `</div>`;
  html += `<button type="button" class="btn btn-outline btn-sm" onclick="addDynamicRow('${field.key}')">+ 添加</button>`;
  html += `</div></div>`;
  return html;
}

function addDynamicRow(key) {
  const field = _dynamicConfigs[key];
  if (!field) return;
  const container = $('#' + key + '_rows');
  if (!container) return;
  if (field.maxRows && container.children.length >= field.maxRows) {
    Toast.info('最多' + field.maxRows + '条');
    return;
  }
  const row = document.createElement('div');
  row.className = 'dynamic-list-row';
  let html = '';
  const curCount = container.children.length;
  (field.columns || []).forEach(col => {
    if (col.type === 'seq') {
      html += `<span class="dl-seq" data-subkey="_seq">${String(curCount + 1).padStart(2, '0')}</span>`;
    } else if (col.bindProducts) {
      html += buildCommissionBindCombobox(col, '', null);
    } else if (col.type === 'multiselect' && col.options) {
      const cbId = 'dymc_' + col.subkey + '_' + Math.random().toString(36).slice(2,6);
      // v19: 优先用 col.default 数组（更通用），其次用 o.default 单选项默认
      const colDef = Array.isArray(col.default) ? col.default : null;
      const optsHTML = col.options.map(o => {
        const ov = typeof o === 'string' ? o : o.value;
        const ol = typeof o === 'string' ? o : o.label;
        const isDef = (colDef && colDef.includes(ov)) || (typeof o === 'object' && o.default);
        return `<label class="ms-item"><input type="checkbox" value="${esc(ov)}"${isDef ? ' checked' : ''} onchange="dcUpdateMultiSel('${cbId}',this)">${esc(ol)}</label>`;
      }).join('');
      html += `<div class="dynamic-multi-sel" id="${cbId}" data-subkey="${col.subkey}">${optsHTML}</div>`;
    } else if (col.type === 'select' && col.options) {
      const opts = col.options.map(o => {
        const ov = typeof o === 'string' ? o : o.value;
        const ol = typeof o === 'string' ? o : (o.label || o.value);
        const isDefault = typeof o === 'object' && o.default;
        return `<option value="${esc(ov)}"${isDefault ? ' selected' : ''}>${esc(ol)}</option>`;
      }).join('');
      const hasDefault = col.options.some(o => typeof o === 'object' && o.default);
      const emptyOpt = hasDefault ? '' : `<option value="">-</option>`;
      html += `<select class="form-input" data-subkey="${col.subkey}">${emptyOpt}${opts}</select>`;
    } else if (col.type === 'combobox' || (col.options && col.type !== 'select')) {
      const def = col.default !== undefined ? col.default : '';
      html += buildDynamicCombobox(col, def);
    } else if (col.type === 'checkbox') {
      const chk = col.default ? 'checked' : '';
      html += `<label class="dl-urgent-cell"><input type="checkbox" data-subkey="${col.subkey}" ${chk}></label>`;
    } else {
      const inputType = col.type || 'text';
      const defVal = col.default !== undefined ? col.default : '';
      html += `<input type="${inputType}" class="form-input" data-subkey="${col.subkey}" value="${esc(defVal)}" placeholder="${esc(col.label)}">`;
    }
  });
  html += `<button type="button" class="btn btn-ghost btn-sm" onclick="removeDynamicRow(this)">删除</button>`;
  row.innerHTML = html;
  container.appendChild(row);
}

/* v17: 多选 checkbox 同步到隐藏 input，便于 readForm 读取 */
function dcUpdateMultiSel(cbId, el) { /* no-op，readForm 直接从 checkbox 收集 */ }

/* ===== Dynamic List Price Lookup (v9: 制品/加价项目价格从价目表自动导入) ===== */
const PRODUCT_CATEGORIES = ['纸片类', '其他材质类', '线上&应援类'];
function fillDynamicPrice(input, lookupType) {
  const row = input.closest('.dynamic-list-row');
  if (!row) return;
  const name = input.value.trim();
  if (!name) return;
  const priceList = DB.list('priceList');
  let item;
  let priceSubkey = 'price';
  if (lookupType === 'product') {
    item = priceList.find(p => p.product === name && PRODUCT_CATEGORIES.includes(p.category));
  } else if (lookupType === 'extra') {
    item = priceList.find(p => p.product === name && p.category === '加价项目');
  } else if (lookupType === 'modify') {
    item = priceList.find(p => p.product === name && p.category === '修改类型');
    priceSubkey = 'modifyPrice';
  }
  if (item) {
    const priceInput = row.querySelector('[data-subkey="' + priceSubkey + '"]');
    if (priceInput) priceInput.value = item.price || 0;
    // v19: 尺寸自动识别——不仅 defaultSize，size/specs 字段也兼容
    const sizeVal = item.defaultSize || item.size || (item.specs && item.specs.size) || '';
    if (sizeVal) {
      const sizeInput = row.querySelector('[data-subkey="size"]');
      if (sizeInput) sizeInput.value = sizeVal;
    }
  }
}

function readForm(container) {
  const data = {};
  $$('.form-input, .form-select, .form-textarea', container).forEach(el => {
    if (el.dataset.key) data[el.dataset.key] = el.value;
  });
  $$('.checkbox-group', container).forEach(el => {
    if (!el.dataset.key) return;
    const vals = $$('input[type="checkbox"]:checked', el).map(c => c.value);
    data[el.dataset.key] = el.dataset.single ? (vals[0] || '') : vals;
  });
  $$('.dynamic-list-container', container).forEach(el => {
    if (el.dataset.key) {
      const items = [];
      $$('.dynamic-list-row', el).forEach(row => {
        const item = {};
        // v17: multiselect checkbox → 数组
        $$('.dynamic-multi-sel', row).forEach(ms => {
          const sk = ms.dataset.subkey;
          const checked = $$('input[type="checkbox"]:checked', ms).map(c => c.value);
          item[sk] = checked;
        });
        $$('[data-subkey]', row).forEach(input => {
          if (input.tagName === 'INPUT' && input.type === 'checkbox') {
            if (item[input.dataset.subkey] === undefined) item[input.dataset.subkey] = input.checked;
            return;
          }
          if (input.tagName === 'INPUT' || input.tagName === 'SELECT' || input.tagName === 'TEXTAREA') {
            if (item[input.dataset.subkey] === undefined) item[input.dataset.subkey] = input.value;
          }
        });
        if (Object.values(item).some(v => v && (Array.isArray(v) ? v.length : String(v).trim()))) items.push(item);
      });
      data[el.dataset.key] = items;
    }
  });
  return data;
}
function readFormImages(container) {
  const uploader = container.querySelector('.img-upload-container');
  return (uploader && uploader._getImages) ? uploader._getImages() : [];
}

/* ===== Combobox Dropdown Helpers ===== */
function showComboboxDropdown(id) {
  $$('.combobox-dropdown.show').forEach(d => { if (d.id !== id) d.classList.remove('show'); });
  const dd = document.getElementById(id);
  if (dd) {
    dd.classList.add('show');
    const wrapper = dd.closest('.combobox-wrapper');
    const input = wrapper ? wrapper.querySelector('.combobox-input') : null;
    const hidden = wrapper ? wrapper.querySelector('.combobox-value') : null;
    const currentVal = hidden ? hidden.value : (input ? input.value : '');
    $$('.combobox-option', dd).forEach(o => {
      o.style.display = '';
      const isSelected = o.dataset.value ? (o.dataset.value === currentVal) : (o.textContent === currentVal);
      o.classList.toggle('selected', isSelected);
    });
  }
}
function toggleComboboxDropdown(id) {
  const dd = document.getElementById(id);
  if (!dd) return;
  if (dd.classList.contains('show')) { dd.classList.remove('show'); }
  else { showComboboxDropdown(id); }
}
function filterComboboxDropdown(id, val) {
  const dd = document.getElementById(id);
  if (!dd) return;
  const v = val.toLowerCase();
  $$('.combobox-option', dd).forEach(o => {
    o.style.display = (!v || o.textContent.toLowerCase().includes(v)) ? '' : 'none';
  });
}
function selectComboboxOption(id, el) {
  const wrapper = el.closest('.combobox-wrapper');
  if (!wrapper) return;
  const input = wrapper.querySelector('.combobox-input');
  if (input) {
    input.value = el.dataset.value || el.textContent;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  document.getElementById(id).classList.remove('show');
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('.combobox-wrapper')) {
    $$('.combobox-dropdown.show').forEach(d => d.classList.remove('show'));
  }
});

/* ===== Custom Multiselect Option Adder ===== */
function addCustomMultiselectOpt(inputId, moduleKey, fieldKey, btn) {
  const input = document.getElementById(inputId);
  if (!input || !input.value.trim()) return;
  const val = input.value.trim();
  // Save to DB
  const dbKey = 'customOpts_' + moduleKey + '_' + fieldKey;
  const customOpts = DB.get(dbKey, []);
  if (!customOpts.includes(val)) {
    customOpts.push(val);
    DB.set(dbKey, customOpts);
  }
  // Add checkbox to the group
  const group = btn.closest('.form-row').querySelector('.checkbox-group');
  if (group) {
    const existing = group.querySelector(`input[value="${esc(val)}"]`);
    if (!existing) {
      const label = document.createElement('label');
      label.className = 'checkbox-item';
      const singleAttr = group.dataset.single ? ' onclick="limitSingleCheckbox(this)"' : '';
      const isRelType = moduleKey === 'oc-relations' && fieldKey === 'relationType';
      const customAttr = isRelType ? ' data-custom="true"' : '';
      label.innerHTML = `<input type="checkbox" value="${esc(val)}" checked${singleAttr}${customAttr}> ${esc(val)}`;
      group.appendChild(label);
      // 人物关系关系类型添加自定义后按 A-Z 重新排序
      if (moduleKey === 'oc-relations' && fieldKey === 'relationType') {
        const items = Array.from(group.querySelectorAll('.checkbox-item'));
        items.sort((a, b) => (a.textContent.trim() || '').localeCompare(b.textContent.trim() || '', 'zh-CN'));
        items.forEach(item => group.appendChild(item));
      }
    } else {
      existing.checked = true;
    }
  }
  input.value = '';
}
function removeCustomOpt(btn, moduleKey, fieldKey, val) {
  const dbKey = 'customOpts_' + moduleKey + '_' + fieldKey;
  const customOpts = DB.get(dbKey, []).filter(v => v !== val);
  DB.set(dbKey, customOpts);
  const label = btn.closest('.checkbox-item');
  if (label) label.remove();
}
// v32: 人物关系自定义关系类型——勾选删除（红色删除按钮）
function removeCheckedCustomRelationTypes(groupId) {
  const group = document.getElementById(groupId);
  if (!group) return;
  const checked = Array.from(group.querySelectorAll('input[type="checkbox"][data-custom="true"]:checked')).map(cb => cb.value);
  if (!checked.length) { Toast.warning('请勾选要删除的自定义关系类型'); return; }
  const dbKey = 'customOpts_oc-relations_relationType';
  let customOpts = DB.get(dbKey, []);
  customOpts = customOpts.filter(v => !checked.includes(v));
  DB.set(dbKey, customOpts);
  // 从当前表单所有关系类型 checkbox 组中移除被删项
  const scope = group.closest('.modal-content') || document;
  scope.querySelectorAll('.checkbox-group[data-key="relationType"] .checkbox-item input[type="checkbox"]').forEach(cb => {
    if (checked.includes(cb.value)) cb.closest('.checkbox-item').remove();
  });
  Toast.success('已删除 ' + checked.length + ' 个自定义关系类型');
}

// v32: 时间线重要性胶囊按钮 — JS 兜底切换选中样式（兼容 :has 不支持的环境）
function updateImportancePill(input) {
  const group = input.closest('.checkbox-group');
  if (!group || !group.classList.contains('importance-pills')) return;
  group.querySelectorAll('.checkbox-item').forEach(item => item.classList.remove('selected'));
  group.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
    const item = cb.closest('.checkbox-item');
    if (item) item.classList.add('selected');
  });
}

// 增强 limitSingleCheckbox：单选后同步更新胶囊样式（用于单位单选、重要性单选等）
function limitSingleCheckbox(cb) {
  const group = cb.closest('.checkbox-group');
  if (!group || !group.dataset.single) return;
  group.querySelectorAll('input[type="checkbox"]').forEach(c => { if (c !== cb) c.checked = false; });
  group.querySelectorAll('.checkbox-item').forEach(item => item.classList.remove('selected'));
  if (cb.checked) cb.closest('.checkbox-item').classList.add('selected');
  if (group.classList.contains('importance-pills')) updateImportancePill(cb);
}
function toggleCheckboxItem(cb) {
  const item = cb.closest('.checkbox-item');
  if (item) item.classList.toggle('selected', cb.checked);
}
/* ===== Calendar Component ===== */
const PLATFORM_COLORS = { '小红书': '#ff2442', '抖音': '#161823', '视频号': '#fa8c16', '公众号': '#07a059' };
function renderCalendar(year, month, records, commissionRecords = []) {
  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();
  const today = new Date();
  const todayKey = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  const START_COLOR = '#ff9a3c', END_COLOR = '#f5c518', BOTH_COLOR = '#712258';
  // v193: 深空打卡日期集合（固定位置在开稿/接稿/同天下方）
  const lifeDeepspaceDates = new Set(DB.list('lifeCheckins').filter(r => r.type === 'deepspace').map(r => r.date));
  let html = '<div class="cal-grid">';
  ['日', '一', '二', '三', '四', '五', '六'].forEach(w => { html += `<div class="cal-weekday">${w}</div>`; });
  for (let i = startWeekday - 1; i >= 0; i--) { html += `<div class="cal-day other-month"><span class="cal-date">${prevMonthDays - i}</span></div>`; }
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    const dayRecords = records.filter(r => (r.publishTime || '').startsWith(dateStr));
    const isToday = dateStr === todayKey;
    let topDots = '';
    const dayPlatforms = new Set();
    dayRecords.forEach(r => { arrVal(r.platform).forEach(p => dayPlatforms.add(p)); });
    [...dayPlatforms].forEach(p => { topDots += `<span class="cal-dot" style="background:${PLATFORM_COLORS[p] || '#9DC8FF'}"></span>`; });
    // v226: 日历条数仅统计「已发布」的发布条数
    const publishedDayRecords = dayRecords.filter(r => r.status === '已发布');
    const dayCount = publishedDayRecords.length > 0 ? `<span class="cal-day-count">${publishedDayRecords.length}条</span>` : '';
    const dayComms = commissionRecords.filter(r => (r.startTime || '').startsWith(dateStr) || (r.deadline || '').startsWith(dateStr));
    const hasStart = dayComms.some(r => (r.startTime || '').startsWith(dateStr));
    const hasEnd = dayComms.some(r => (r.deadline || '').startsWith(dateStr));
    let commTag = '';
    if (hasStart && hasEnd) {
      commTag = `<span class="cal-day-tag"><span class="cal-day-tag-dot" style="background:${BOTH_COLOR}"></span><span class="cal-day-tag-text" style="color:${BOTH_COLOR}">开+截</span></span>`;
    } else if (hasStart) {
      commTag = `<span class="cal-day-tag"><span class="cal-day-tag-dot" style="background:${START_COLOR}"></span><span class="cal-day-tag-text" style="color:${START_COLOR}">开稿</span></span>`;
    } else if (hasEnd) {
      commTag = `<span class="cal-day-tag"><span class="cal-day-tag-dot" style="background:${END_COLOR}"></span><span class="cal-day-tag-text" style="color:${END_COLOR}">截稿</span></span>`;
    }
    let deepTag = '';
    if (lifeDeepspaceDates.has(dateStr)) {
      deepTag = `<span class="cal-day-tag"><span class="cal-day-tag-dot" style="background:#9DC8FF"></span><span class="cal-day-tag-text" style="color:#5BA3F0">进入临空</span></span>`;
    }
    html += `<div class="cal-day${isToday ? ' today' : ''}">
      <div class="cal-date-row"><span class="cal-date">${d}</span></div>
      <div class="cal-dots">${topDots}${dayCount}</div>
      <div class="cal-tag-rows">
        <div class="cal-tag-row home-comm-tags">${commTag}</div>
        <div class="cal-tag-row home-deep-tags">${deepTag}</div>
      </div>
    </div>`;
  }
  const totalCells = startWeekday + daysInMonth;
  const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
  for (let i = 1; i <= remaining; i++) { html += `<div class="cal-day other-month"><span class="cal-date">${i}</span></div>`; }
  html += '</div>';
  // v29-fix6: 底部图例 — 平台发布 + 开稿/截稿/同天，按顺序排在公众号后面
  html += '<div class="cal-legend-wrap">';
  html += '<div class="cal-legend">';
  html += `<span class="legend-item"><span class="status-dot" style="background:#ff2442"></span>小红书</span>`;
  html += `<span class="legend-item"><span class="status-dot" style="background:#161823"></span>抖音</span>`;
  html += `<span class="legend-item"><span class="status-dot" style="background:#fa8c16"></span>视频号</span>`;
  html += `<span class="legend-item"><span class="status-dot" style="background:#07a059"></span>公众号</span>`;
  html += '</div>';
  html += '<div class="cal-legend-sep"></div>';
  html += '<div class="cal-legend">';
  html += `<span class="legend-item"><span class="status-dot" style="background:${START_COLOR}"></span>开稿</span>`;
  html += `<span class="legend-item"><span class="status-dot" style="background:${END_COLOR}"></span>截稿</span>`;
  html += `<span class="legend-item"><span class="status-dot" style="background:${BOTH_COLOR}"></span>当天同时存在开稿和截稿项目</span>`;
  html += `<span class="legend-item"><span class="status-dot" style="background:#9DC8FF"></span>进入临空</span>`;
  html += '</div>';
  html += '</div>';
  return html;
}

/* ===== Annual Bar Chart ===== */
function renderAnnualChart(records, dateField, opts = {}) {
  const { title = '', color = '#9DC8FF', valueField = null, isCount = false, series = null } = opts;
  const now = new Date();
  const year = now.getFullYear();
  if (series && series.length) {
    const data = series.map(() => Array(12).fill(0));
    const hasData = () => data.some(arr => arr.some(v => v > 0));
    records.forEach(r => {
      const d = r[dateField]; if (!d || !String(d).startsWith(String(year))) return;
      const m = parseInt(String(d).split('-')[1]) - 1;
      if (m < 0 || m > 11) return;
      series.forEach((s, si) => {
        if (s.compute) data[si][m] += s.compute(r);
        else if (s.isCount) data[si][m] += 1;
        else data[si][m] += parseFloat(r[s.valueField]) || 0;
      });
    });
    const max = Math.max(...data.flat(), 1);
    let bars = '';
    for (let i = 0; i < 12; i++) {
      let total = data.reduce((s, arr) => s + arr[i], 0);
      const maxBarH = Math.max(...series.map((s, si) => (data[si][i] / max) * 100), 0);
      bars += '<div class="annual-chart-bar">';
      bars += `<div style="display:flex;gap:1px;width:70%;height:100%;align-items:flex-end;justify-content:center">`;
      series.forEach((s, si) => {
        const v = data[si][i]; const h = (v / max) * 100;
        bars += `<div style="width:${100 / series.length}%;height:${Math.max(h, 0)}%;background:${s.color};min-height:${v > 0 ? '2px' : '0'};border-radius:0"></div>`;
      });
      bars += '</div></div>';
    }
    let labels = ''; for (let i = 0; i < 12; i++) labels += `<span>${i + 1}月</span>`;
    let legend = '';
    series.forEach(s => { legend += `<span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:2px;background:${s.color}"></span>${esc(s.name)}</span>`; });
    return `<div class="annual-chart"><div class="annual-chart-title">📊 ${esc(title)} · ${year}年</div><div class="annual-chart-bars">${bars}</div><div class="annual-chart-labels">${labels}</div><div style="display:flex;gap:12px;margin-top:8px;font-size:11px;color:var(--c-text-light)">${legend}</div></div>`;
  }
  const months = Array(12).fill(0);
  records.forEach(r => {
    const d = r[dateField]; if (!d || !String(d).startsWith(String(year))) return;
    const m = parseInt(String(d).split('-')[1]) - 1;
    if (m < 0 || m > 11) return;
    if (isCount) months[m] += 1; else months[m] += parseFloat(r[valueField]) || 0;
  });
  const max = Math.max(...months, 1);
  let bars = '';
  months.forEach(v => {
    const h = (v / max) * 100;
    const barH = Math.max(h, v > 0 ? 2 : 0);
    bars += '<div class="annual-chart-bar">';
    if (v > 0) bars += `<span class="annual-chart-bar-value" style="bottom:calc(${barH}% + 3px)">${isCount ? v : '¥' + Math.round(v)}</span>`;
    bars += `<div class="annual-chart-bar-fill" style="height:${barH}%;background:linear-gradient(180deg,${color},${color}88)"></div>`;
    bars += '</div>';
  });
  let labels = ''; for (let i = 0; i < 12; i++) labels += `<span>${i + 1}月</span>`;
  return `<div class="annual-chart"><div class="annual-chart-title">📊 ${esc(title)} · ${year}年</div><div class="annual-chart-bars">${bars}</div><div class="annual-chart-labels">${labels}</div></div>`;
}

/* ===== Navigation Config ===== */
const NAV = [
  { key: 'home', label: '首页' },
  { key: 'life', label: '生活', group: true, children: [
    { key: 'life-checkin', label: '每日打卡' },
    { key: 'life-record', label: '每日记录' },
  ]},
  { key: 'groupbuy', label: '开团', group: true, children: [
    { key: 'groupbuy-records', label: '开团记录' },
    { key: 'groupbuy-factories', label: '厂家记录' },
    { key: 'groupbuy-samples', label: '打样记录' },
    { key: 'groupbuy-calc', label: '价目计算' },
  ]},
  { key: 'design', label: '美工', group: true, children: [
    { key: 'design-inspiration', label: '灵感记录' },
    { key: 'design-commission', label: '接稿排期' },
    { key: 'design-auth', label: '授权记录' },
    { key: 'design-pricelist', label: '价目表' },
    { key: 'design-calc', label: '报价计算' },
  ]},
  { key: 'oc', label: 'OC', group: true, children: [
    { key: 'oc-profiles', label: '人物档案' },
    { key: 'oc-relations', label: '人物关系' },
    { key: 'oc-stories', label: '故事小记' },
    { key: 'oc-timeline', label: '时间线' },
    { key: 'oc-commission', label: '约稿记录' },
  ]},
];
const PAGE_TITLES = {
  'home': '首页 · 自媒体发布记录', 'groupbuy-records': '开团 · 开团记录', 'groupbuy-factories': '开团 · 厂家记录',
  'groupbuy-samples': '开团 · 打样记录', 'groupbuy-calc': '开团 · 价目计算', 'design-inspiration': '美工 · 灵感记录',
  'design-commission': '美工 · 接稿排期', 'design-calc': '美工 · 报价计算', 'design-auth': '美工 · 授权记录', 'design-pricelist': '美工 · 价目表',
  'oc-profiles': 'OC · 人物档案', 'oc-relations': 'OC · 人物关系', 'oc-stories': 'OC · 故事小记', 'oc-timeline': 'OC · 时间线', 'oc-commission': 'OC · 约稿记录',
  'life-checkin': '生活 · 每日打卡', 'life-record': '生活 · 每日记录',
};

/* ===== Module Configs ===== */
const MODULES = {};

// --- Home: Publish Records ---
MODULES['home'] = {
  store: 'publishRecords',
  tabs: [
    { value: '小红书', label: '小红书', color: '#ff2442' },
    { value: '抖音', label: '抖音', color: '#161823' },
    { value: '视频号', label: '视频号', color: '#fa8c16' },
    { value: '公众号', label: '公众号', color: '#07a059' },
  ],
  fields: [
    { section: '基本信息' },
    { key: 'platform', label: '平台', type: 'multiselect', options: [{ value: '小红书', label: '小红书' }, { value: '抖音', label: '抖音' }, { value: '视频号', label: '视频号' }, { value: '公众号', label: '公众号' }] },
    { key: 'publishTime', label: '发布时间', type: 'date', default: todayStr() },
    { key: 'title', label: '作品标题', type: 'text' },
    { key: 'link', label: '作品链接', type: 'text', placeholder: '粘贴作品链接' },
    { key: 'contentType', label: '内容类型', type: 'multiselect', single: true, options: [{ value: '图文', label: '图文' }, { value: '短视频', label: '短视频' }, { value: '推文', label: '推文' }, { value: '直播', label: '直播' }] },
    { key: 'status', label: '发布状态', type: 'multiselect', single: true, options: [{ value: '待发布', label: '待发布' }, { value: '已发布', label: '已发布' }] },
    { section: '24小时数据' },
    { key: 'data24h_likes', label: '点赞', type: 'number', row: 'data24h' },
    { key: 'data24h_saves', label: '收藏', type: 'number', row: 'data24h' },
    { key: 'data24h_plays', label: '播放量', type: 'number', row: 'data24h' },
    { key: 'data24h_reads', label: '阅读量', type: 'number', row: 'data24h' },
    { section: '7天数据' },
    { key: 'data7d_likes', label: '点赞', type: 'number', row: 'data7d' },
    { key: 'data7d_saves', label: '收藏', type: 'number', row: 'data7d' },
    { key: 'data7d_plays', label: '播放量', type: 'number', row: 'data7d' },
    { key: 'data7d_reads', label: '阅读量', type: 'number', row: 'data7d' },
    { key: 'notes', label: '备注', type: 'textarea' },
  ],
  listFields: [
    { label: '平台', key: 'platform', tag: true },
    { label: '状态', key: 'status', tag: true },
    { label: '类型', key: 'contentType' },
    { label: '发布时间', key: 'publishTime', date: true },
    { label: '24h点赞', key: 'data24h_likes' },
    { label: '7天点赞', key: 'data7d_likes' },
    { label: '链接', key: 'link', link: true },
  ],
};

// --- Group Buy Records (需求4: 制品加售卖数量/是否流团, 厂家可选, 购买人数, 制品总价, 邮费总价, 年度柱状图) ---
MODULES['groupbuy-records'] = {
  store: 'groupbuys',
  fields: [
    { key: 'title', label: '开团名称', type: 'text' },
    { key: 'startTime', label: '开团时间', type: 'date' },
    { key: 'endTime', label: '截团时间', type: 'date' },
    { key: 'products', label: '制品列表', type: 'dynamic-products', columns: [
      { subkey: 'name', label: '制品名称', type: 'text', datalistId: 'gb_product_dl' },
      { subkey: 'price', label: '单价', type: 'number' },
      { subkey: 'factory', label: '对应厂家', type: 'text', datalistId: 'gb_factory_dl' },
      { subkey: 'salesCount', label: '售卖数量', type: 'number' },
      { subkey: 'isDisbanded', label: '是否流团', type: 'text', datalistId: 'gb_disbanded_dl', default: '否' },
    ]},
    { key: 'afterSales', label: '售后记录', type: 'dynamic-list', columns: [
      { subkey: 'orderNo', label: '单号', type: 'text' },
      { subkey: 'name', label: '制品名称', type: 'text', datalistId: 'gb_product_dl' },
      { subkey: 'quantity', label: '售后数量', type: 'number' },
      { subkey: 'type', label: '补偿方式', type: 'combobox', default: '补偿', options: [
        { value: '补偿', label: '补偿' }, { value: '补发', label: '补发' }, { value: '补寄', label: '补寄' }, { value: '退款', label: '退款' }
      ]},
      { subkey: 'amount', label: '价格', type: 'number' },
    ]},
    { key: 'purchaseCount', label: '购买人数', type: 'number', row: 'purchaseInfo' },
    { key: 'purchasePopularity', label: '拼团人气', type: 'number', row: 'purchaseInfo' },
    { key: 'productTotal', label: '制品总价', type: 'number', hint: '元', row: 'totalPrice' },
    { key: 'shippingTotal', label: '邮费总价', type: 'number', hint: '元', row: 'totalPrice' },
    { key: 'cost', label: '制品总成本', type: 'number', hint: '元', row: 'totalCost' },
    { key: 'shippingTotalCost', label: '邮费总成本', type: 'number', hint: '元', row: 'totalCost' },
    { key: 'status', label: '进度状态', type: 'multiselect', single: true, default: '进行中', options: [{ value: '筹备中', label: '筹备中' }, { value: '进行中', label: '进行中' }, { value: '已截团', label: '已截团' }, { value: '流团', label: '流团' }, { value: '已结算', label: '已结算' }] },
  ],
  filters: [{ key: 'status', label: '全部状态', options: [{ value: '', label: '全部状态' }, { value: '筹备中', label: '筹备中' }, { value: '进行中', label: '进行中' }, { value: '已截团', label: '已截团' }, { value: '流团', label: '流团' }, { value: '已结算', label: '已结算' }] }],
  listFields: [
    { label: '状态', key: 'status', tag: true },
    { label: '制品数', key: '_productCount' },
    { label: '开团时间', key: 'startTime', date: true },
    { label: '截团时间', key: 'endTime', date: true },
    { label: '购买人数', key: 'purchaseCount' },
  ],
  stats: (records) => {
    const totalRev = records.reduce((s, r) => s + (parseFloat(r.productTotal) || 0) + (parseFloat(r.shippingTotal) || 0), 0);
    const totalCost = records.reduce((s, r) => s + (parseFloat(r.cost) || 0) + (parseFloat(r.shippingTotalCost) || 0), 0);
    const profit = totalRev - totalCost;
    return [
      { label: '累计开团', value: records.length, sub: '个' },
      { label: '总营收', value: '¥' + totalRev.toLocaleString(), sub: '' },
      { label: '总成本', value: '¥' + totalCost.toLocaleString(), sub: '' },
      { label: '总利润', value: '¥' + profit.toLocaleString(), sub: profit >= 0 ? '盈利' : '亏损' },
    ];
  },
  statsTitle: '开团统计',
  chart: (records) => renderAnnualChart(records, 'startTime', {
    title: '开团营收/成本/利润',
    series: [
      { name: '营收', compute: r => (parseFloat(r.productTotal) || 0) + (parseFloat(r.shippingTotal) || 0), color: '#7ec678' },
      { name: '成本', compute: r => (parseFloat(r.cost) || 0) + (parseFloat(r.shippingTotalCost) || 0), color: '#e8857e' },
      { name: '利润', compute: r => (parseFloat(r.productTotal) || 0) + (parseFloat(r.shippingTotal) || 0) - (parseFloat(r.cost) || 0) - (parseFloat(r.shippingTotalCost) || 0), color: '#9DC8FF' },
    ]
  }),
  detailExtra: (r) => {
    const rev = (parseFloat(r.productTotal) || 0) + (parseFloat(r.shippingTotal) || 0), cost = (parseFloat(r.cost) || 0) + (parseFloat(r.shippingTotalCost) || 0);
    return `<div class="detail-row"><span class="detail-label">盈亏统计</span><span class="detail-value"><b style="color:${rev - cost >= 0 ? 'var(--c-green)' : 'var(--c-red)'}">${rev - cost >= 0 ? '+' : ''}¥${(rev - cost).toLocaleString()}</b></span></div>`;
  },
};

// --- Factories (需求5: 去品类提示词, 默认临时合作, 优劣备注→备注) ---
MODULES['groupbuy-factories'] = {
  store: 'factories',
  fields: [
    { key: 'name', label: '厂家名称', type: 'text' },
    { key: 'phone', label: '联系方式', type: 'text' },
    { key: 'category', label: '主营品类', type: 'text' },
    { key: 'platforms', label: '所在平台', type: 'multiselect', options: [{ value: '微信', label: '微信' }, { value: '1688', label: '1688' }, { value: '小红书', label: '小红书' }, { value: '淘宝', label: '淘宝' }, { value: '拼多多', label: '拼多多' }] },
    { key: 'cooperationStatus', label: '合作状态', type: 'multiselect', single: true, default: '临时合作', options: [{ value: '长期合作', label: '长期合作' }, { value: '临时合作', label: '临时合作' }, { value: '暂停合作', label: '暂停合作' }] },
    { key: 'quote', label: '报价', type: 'textarea' },
    { key: 'cooperationRecords', label: '合作记录', type: 'dynamic-list', columns: [
      { subkey: 'project', label: '项目名称', type: 'text' },
      { subkey: 'date', label: '日期', type: 'date' },
      { subkey: 'note', label: '备注', type: 'text' },
    ]},
    { key: 'notes', label: '备注', type: 'textarea' },
    { key: 'images', label: '存档图片', type: 'image' },
  ],
  filters: [{ key: 'cooperationStatus', label: '全部状态', options: [{ value: '', label: '全部状态' }, { value: '长期合作', label: '长期合作' }, { value: '临时合作', label: '临时合作' }, { value: '暂停合作', label: '暂停合作' }] }],
  listFields: [
    { label: '状态', key: 'cooperationStatus', tag: true },
    { label: '平台', key: 'platforms' },
    { label: '电话', key: 'phone' },
    { label: '主营品类', key: 'category' },
  ],
  detailExtra: (r) => {
    const related = DB.list('groupbuys').filter(g => {
      const prods = g.products || [];
      return prods.some(p => p.factory && p.factory.includes(r.name));
    });
    if (!related.length) return '';
    return `<div class="detail-row"><span class="detail-label">关联开团</span><span class="detail-value">${related.map(g => `<span class="tag tag-info" style="margin-right:4px">${esc(g.title || '未命名')}</span>`).join('')}</span></div>`;
  },
};

// --- Samples (需求6: 年度柱状图, 厂家可选, 复盘备注→备注) ---
MODULES['groupbuy-samples'] = {
  store: 'samples',
  fields: [
    { key: 'factory', label: '厂家', type: 'combobox', options: [], hint: '从厂家记录加载' },
    { key: 'category', label: '打样品类', type: 'combobox', options: [], placeholder: '选择或输入品类...' },
    { key: 'sampleName', label: '样品名称', type: 'text' },
    { key: 'sampleTime', label: '打样时间', type: 'date', default: todayStr() },
    { key: 'cost', label: '打样费用', type: 'number', hint: '元', row: 'sampleCostQty' },
    { key: 'quantity', label: '打样数量', type: 'number', default: 1, row: 'sampleCostQty' },
    { key: 'receiveTime', label: '收货时间', type: 'date' },
    { key: 'evaluation', label: '样品评价', type: 'multiselect', single: true, options: [{ value: '合格', label: '合格' }, { value: '中等', label: '中等' }, { value: '不合格', label: '不合格' }] },
    { key: 'images', label: '样品图片', type: 'image' },
    { key: 'notes', label: '备注', type: 'textarea' },
  ],
  filters: [{ key: 'evaluation', label: '全部评价', options: [{ value: '', label: '全部评价' }, { value: '合格', label: '合格' }, { value: '中等', label: '中等' }, { value: '不合格', label: '不合格' }] }],
  listFields: [
    { label: '厂家', key: 'factory' },
    { label: '打样费用', key: 'cost', prefix: '¥' },
    { label: '打样数量', key: 'quantity' },
    { label: '样品评价', key: 'evaluation', tag: true },
    { label: '打样时间', key: 'sampleTime', date: true },
  ],
  stats: (records) => {
    const totalCost = records.reduce((s, r) => s + (parseFloat(r.cost) || 0), 0);
    return [
      { label: '打样总数', value: records.length, sub: '次' },
      { label: '打样总费用', value: '¥' + totalCost.toLocaleString(), sub: '' },
      { label: '合格率', value: records.length ? Math.round(records.filter(r => valIncludes(r.evaluation, '合格')).length / records.length * 100) + '%' : '0%', sub: '' },
    ];
  },
  statsTitle: '打样统计',
  chart: (records) => renderAnnualChart(records, 'sampleTime', { title: '打样费用', valueField: 'cost', color: '#fa8c16' }),
};

// --- Inspiration ---
function getInspirationCategories() {
  const custom = DB.get('customCategories', []);
  const defaults = ['封面', '明信片', '其他', '镭射票', '壁纸', '海报'];
  return [...new Set([...defaults, ...custom])].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}
function saveCustomCategory(cat) {
  if (!cat) return;
  const defaults = ['封面', '明信片', '其他', '镭射票', '壁纸', '海报'];
  const custom = DB.get('customCategories', []);
  if (!custom.includes(cat) && !defaults.includes(cat)) { custom.push(cat); DB.set('customCategories', custom); }
}
// v29-fix3: 打样品类固定选项 + 自定义记录，A-Z 排序
const SAMPLE_DEFAULTS = ['吧唧', '明信片', '镭射票', '大肠发圈', '发带', '小卡', '封口贴', '贴纸', '手提袋', '色纸'];
function getSampleCategories() {
  const custom = DB.get('customSampleCategories', []);
  return [...new Set([...SAMPLE_DEFAULTS, ...custom])].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}
function saveCustomSampleCategory(cat) {
  if (!cat) return;
  const custom = DB.get('customSampleCategories', []);
  if (!custom.includes(cat) && !SAMPLE_DEFAULTS.includes(cat)) { custom.push(cat); DB.set('customSampleCategories', custom); }
}
MODULES['design-inspiration'] = {
  store: 'inspirations',
  fields: [
    { key: 'theme', label: '灵感主题', type: 'text' },
    { key: 'category', label: '制品', type: 'combobox', options: [], placeholder: '请选择或输入制品' },
    { key: 'tags', label: '标签分类', type: 'multiselect', options: [{ value: '简约', label: '简约' }, { value: '高级', label: '高级' }, { value: '复古', label: '复古' }, { value: '古风', label: '古风' }, { value: '清新', label: '清新' }, { value: '可爱', label: '可爱' }, { value: '炫酷', label: '炫酷' }, { value: '土味', label: '土味' }] },
    { key: 'thoughts', label: '文字思路', type: 'textarea' },
    { key: 'images', label: '素材图片', type: 'image' },
    { key: 'source', label: '灵感来源', type: 'text' },
    { key: 'createTime', label: '创建时间', type: 'date', default: todayStr() },
  ],
  filters: [{ key: 'category', label: '全部制品', options: [{ value: '', label: '全部制品' }] }],
  listFields: [
    { label: '制品', key: 'category', tag: true },
    { label: '标签', key: 'tags', tag: true },
    { label: '创建时间', key: 'createTime', date: true },
  ],
};

// --- Commission (v5: 报价金额+最终金额手动, 进度选项更新) ---
MODULES['design-commission'] = {
  store: 'commissions',
  fields: [
    { key: 'clientInfo', label: '单主', type: 'text' },
    { key: 'acceptTime', label: '接稿时间', type: 'date', default: todayStr() },
    { key: 'startTime', label: '开稿时间', type: 'date' },
    { key: 'deadline', label: '截稿时间', type: 'date' },
    { key: 'usageType', label: '稿件用途', type: 'multiselect', single: true, default: '自用', options: [{ value: '自用', label: '自用' }, { value: '无盈利', label: '无盈利' }, { value: '商用', label: '商用' }, { value: '买断', label: '买断' }, { value: '企业', label: '企业' }] },
    { key: 'products', label: '制品列表', type: 'dynamic-list', columns: [
      { subkey: '_seq', label: '序号', type: 'seq' },
      { subkey: 'name', label: '制品', type: 'text', datalistId: 'comm_product_dl', priceLookup: 'product' },
      { subkey: 'patternId', label: '柄图标识', type: 'text' },
      { subkey: 'price', label: '价格', type: 'number' },
      { subkey: 'size', label: '尺寸', type: 'text' },
      { subkey: 'quantity', label: '数量', type: 'number', default: 1 },
      { subkey: 'sameModel', label: '同模', type: 'text', datalistId: 'comm_sameModel_dl', default: '无同模', options: [
        { value: '无同模', label: '无同模' },
        { value: '改色+字', label: '改色+字' }, { value: '改人+字/色', label: '改人+字/色' }, { value: '改人', label: '改人' }
      ]},
      { subkey: 'urgent', label: '加急', type: 'checkbox' },
    ]},
    { key: 'sameDesign', label: '同柄图', type: 'multiselect', single: true, options: [
      { value: '是', label: '是' }, { value: '否', label: '否' }, { value: '部分同柄', label: '部分同柄' }
    ]},
    { key: 'extraItems', label: '加价项目', type: 'dynamic-list', columns: [
      { subkey: 'productRef', label: '绑定制品', type: 'combobox', bindProducts: true, placeholder: '绑定制品（选填）' },
      { subkey: 'name', label: '加价项目', type: 'text', datalistId: 'comm_extra_dl', priceLookup: 'extra' },
      { subkey: 'quantity', label: '数量', type: 'number' },
      { subkey: 'price', label: '价格', type: 'number' },
    ]},
    { key: 'isUrgent', label: '是否加急', type: 'multiselect', single: true, default: '否', options: [{ value: '是', label: '是' }, { value: '否', label: '否' }] },
    { key: 'quoteAmount', label: '报价金额', type: 'number', hint: '元（手动输入）' },
    { key: 'deposit', label: '定金', type: 'readonly', row: 'depositBalance', hint: '自动计算（报价金额50%）' },
    { key: 'balance', label: '尾款', type: 'readonly', row: 'depositBalance', hint: '自动计算' },
    { key: 'paymentStatus', label: '支付状态', type: 'multiselect', single: true, default: '定金', options: [{ value: '未付', label: '未付' }, { value: '定金', label: '定金' }, { value: '尾款', label: '尾款' }, { value: '全款', label: '全款' }] },
    { key: 'progress', label: '稿件进度', type: 'multiselect', single: true, default: '已接稿', options: [{ value: '待接稿', label: '待接稿' }, { value: '已接稿', label: '已接稿' }, { value: '修改中', label: '修改中' }, { value: '已交付', label: '已交付' }] },
    { key: 'deliveredTime', label: '交付时间', type: 'date', hint: '设为「已交付」时自动记录；用于报价导入接稿过滤' },
    { key: 'modifications', label: '修改项目', type: 'dynamic-list', maxRows: 2, columns: [
      { subkey: 'modifyType', label: '修改类型', type: 'combobox', datalistId: 'comm_modify_dl', priceLookup: 'modify', options: [] },
      { subkey: 'modifyCount', label: '次数', type: 'number' },
      { subkey: 'modifyPrice', label: '价格（元）', type: 'number' },
      { subkey: 'note', label: '备注', type: 'text' },
    ]},

    { key: 'amount', label: '最终金额', type: 'number', hint: '元（手动输入）' },
    { key: 'notes', label: '备注', type: 'textarea' },
  ],
  filters: [
    { key: 'progress', label: '全部进度', options: [{ value: '', label: '全部进度' }, { value: '待接稿', label: '待接稿' }, { value: '已接稿', label: '已接稿' }, { value: '修改中', label: '修改中' }, { value: '已交付', label: '已交付' }] },
    { key: 'paymentStatus', label: '全部支付', options: [{ value: '', label: '全部支付' }, { value: '未付', label: '未付' }, { value: '定金', label: '定金' }, { value: '尾款', label: '尾款' }, { value: '全款', label: '全款' }] },
  ],
  listFields: [
    { label: '稿件进度', key: 'progress', tag: true },
    { label: '支付状态', key: 'paymentStatus', tag: true },
    { label: '稿件用途', key: 'usageType' },
    { label: '制品', key: '_firstProduct' },
    { label: '截稿日期', key: 'deadline', date: true },
  ],
  stats: (records) => {
    const isPaid = r => valIncludes(r.paymentStatus, '全款') || valIncludes(r.paymentStatus, '尾款');
    const totalRev = records.filter(isPaid).reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
    const monthRev = records.filter(r => (r.acceptTime || '').startsWith(thisMonthStr()) && isPaid(r)).reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
    const now = todayStr();
    const overdue = records.filter(r => r.deadline && r.deadline < now && !valIncludes(r.progress, '已交付')).length;
    return [
      { label: '总接稿', value: records.length, sub: '单' },
      { label: '本月收入', value: '¥' + monthRev.toLocaleString(), sub: '已收款' },
      { label: '总收入', value: '¥' + totalRev.toLocaleString(), sub: '累计' },
      { label: '逾期预警', value: overdue, sub: overdue > 0 ? '需关注' : '正常' },
    ];
  },
  statsTitle: '接稿统计',
  chart: (records) => {
    const processed = records.map(r => ({ ...r, acceptTime: r.acceptTime || r.startTime || r.deadline || '' }));
    return renderAnnualChart(processed, 'acceptTime', { title: '接稿收入', series: [
      { name: '最终金额', compute: r => parseFloat(r.amount) || parseFloat(r.quoteAmount) || 0, color: '#7ab5f5' },
    ]});
  },
  isOverdue: (r) => { const now = todayStr(); return r.deadline && r.deadline < now && !valIncludes(r.progress, '已交付'); },
};

// --- Authorization (需求8: 年度柱状图, 默认商用) ---
MODULES['design-auth'] = {
  store: 'authorizations',
  fields: [
    { key: 'artworkName', label: '稿件名称', type: 'text' },
    { key: 'clientInfo', label: '客户信息', type: 'text' },
    { key: 'authType', label: '授权类型', type: 'multiselect', single: true, default: '商用', options: [{ value: '自用', label: '自用' }, { value: '无盈利', label: '无盈利' }, { value: '商用', label: '商用' }, { value: '买断', label: '买断' }, { value: '企业', label: '企业' }] },
    { key: 'authScope', label: '授权范围', type: 'multiselect', options: [{ value: '单次', label: '单次' }, { value: '多次', label: '多次' }, { value: '不限', label: '不限' }, { value: '单图单用', label: '单图单用' }, { value: '单图多用', label: '单图多用' }] },
    { key: 'authFee', label: '授权费用', type: 'number', hint: '元' },
    { key: 'authDate', label: '授权日期', type: 'date' },
    { key: 'notes', label: '备注', type: 'textarea' },
  ],
  filters: [{ key: 'authType', label: '全部类型', options: [{ value: '', label: '全部类型' }, { value: '自用', label: '自用' }, { value: '无盈利', label: '无盈利' }, { value: '商用', label: '商用' }, { value: '买断', label: '买断' }, { value: '企业', label: '企业' }] }],
  listFields: [
    { label: '授权类型', key: 'authType', tag: true },
    { label: '授权范围', key: 'authScope' },
    { label: '授权费用', key: 'authFee', prefix: '¥' },
    { label: '授权日期', key: 'authDate', date: true },
  ],
  stats: (records) => {
    const totalFee = records.reduce((s, r) => s + (parseFloat(r.authFee) || 0), 0);
    return [{ label: '授权总数', value: records.length, sub: '条' }, { label: '授权总收入', value: '¥' + totalFee.toLocaleString(), sub: '' }];
  },
  statsTitle: '授权统计',
  chart: (records) => renderAnnualChart(records, 'authDate', { title: '授权收入', valueField: 'authFee', color: '#fa8c16' }),
};

// --- Price List (需求9: 去提示词, 删单位, 分类说明→备注, 菜单风格, 其他说明可折叠) ---
MODULES['design-pricelist'] = {
  store: 'priceList',
  fields: [
    { key: 'category', label: '制品分类', type: 'combobox', noSort: true, options: [{ value: '纸片类', label: '纸片类' }, { value: '其他材质类', label: '其他材质类' }, { value: '线上&应援类', label: '线上&应援类' }, { value: '加价项目', label: '加价项目' }, { value: '修改类型', label: '修改类型' }] },
    { key: 'product', label: '制品', type: 'text' },
    { key: 'defaultSize', label: '默认尺寸', type: 'text', hint: '如: 10cm（选填）' },
    { key: 'price', label: '单价', type: 'number', hint: '元' },
    { key: 'priceUnit', label: '单位', type: 'multiselect', single: true, default: '元', options: [{ value: '元', label: '元' }, { value: '元/p', label: '元/p' }, { value: '元/次', label: '元/次' }] },
    { key: 'description', label: '备注', type: 'textarea' },
  ],
  listFields: [
    { label: '分类', key: 'category', tag: true },
    { label: '制品', key: 'product' },
    { label: '单价', key: 'price', prefix: '¥' },
  ],
  detailExtra: (r) => {
    if (r.description) return `<div class="detail-row"><span class="detail-label">备注</span><span class="detail-value">${esc(r.description)}</span></div>`;
    return '';
  },
  special: 'priceList',
};

// --- OC Profiles ---
MODULES['oc-profiles'] = {
  store: 'ocCharacters',
  fields: [
    { section: '基础信息' },
    { key: 'name', label: '姓名', type: 'text' },
    { key: 'alias', label: '道号/外号', type: 'text' },
    { key: 'age', label: '年龄', type: 'text' },
    { key: 'gender', label: '性别', type: 'multiselect', single: true, options: [{ value: '女', label: '女' }, { value: '男', label: '男' }] },
    { key: 'height', label: '身高', type: 'text' },
    { key: 'birthplace', label: '出生地', type: 'text' },
    { section: '种族体质' },
    { key: 'race', label: '种族', type: 'text' },
    { key: 'constitution', label: '体质', type: 'text' },
    { section: '门派身份' },
    { key: 'sect', label: '门派', type: 'text' },
    { key: 'identity', label: '身份', type: 'text' },
    { key: 'occupation', label: '职业', type: 'text' },
    { section: '修炼设定' },
    { key: 'spiritRoot', label: '灵根', type: 'text' },
    { key: 'realm', label: '境界', type: 'text' },
    { key: 'cultivationMethod', label: '功法', type: 'text' },
    { key: 'weapon', label: '武器', type: 'text' },
    { section: '社会关系' },
    { key: 'parents', label: '父母', type: 'text' },
    { key: 'siblings', label: '兄弟姐妹', type: 'text' },
    { key: 'master', label: '师徒', type: 'text' },
    { key: 'companion', label: '道侣', type: 'text' },
    { key: 'friends', label: '好友', type: 'text' },
    { key: 'fellow', label: '同门', type: 'text' },
    { section: '人物立绘' },
    { key: 'images', label: '人物立绘/图片存档', type: 'image' },
  ],
  listFields: [
    { label: '性别', key: 'gender' },
    { label: '种族', key: 'race' },
    { label: '门派', key: 'sect' },
    { label: '境界', key: 'realm' },
  ],
  cardImage: (r) => r.images && r.images[0] ? r.images[0] : null,
};

// --- OC Relations (需求10: 箭头标明, 档案社会关系自动同步, 缩略姓名按钮可展开) ---
MODULES['oc-relations'] = {
  store: 'ocRelations',
  fields: [
    { key: 'charA', label: '人物1', type: 'combobox', options: [], hint: '从人物档案加载' },
    { key: 'charB', label: '人物2', type: 'combobox', options: [], hint: '从人物档案加载' },
    { key: 'relationType', label: '关系类型', type: 'multiselect', allowCustom: true, options: [{ value: '表亲', label: '表亲' }, { value: '道侣', label: '道侣' }, { value: '敌对', label: '敌对' }, { value: '父女', label: '父女' }, { value: '父子', label: '父子' }, { value: '好友', label: '好友' }, { value: '姐弟', label: '姐弟' }, { value: '交好', label: '交好' }, { value: '姐妹', label: '姐妹' }, { value: '母女', label: '母女' }, { value: '母子', label: '母子' }, { value: '师徒', label: '师徒' }, { value: '上下级', label: '上下级' }, { value: '同门', label: '同门' }, { value: '堂亲', label: '堂亲' }, { value: '兄弟', label: '兄弟' }, { value: '兄妹', label: '兄妹' }] },
    { key: 'relationDetail', label: '关系细节', type: 'textarea' },
    { key: 'relationStatus', label: '关系状态', type: 'multiselect', single: true, default: '稳定', options: [{ value: '稳定', label: '稳定' }, { value: '变化中', label: '变化中' }] },
  ],
  listFields: [
    { label: '类型', key: 'relationType', tag: true },
    { label: '状态', key: 'relationStatus', tag: true },
    { label: '细节', key: 'relationDetail' },
  ],
  special: 'mindMap',
};

// --- OC Stories (需求11: 关联OC多选, 默认灵感, 默认连载中) ---
MODULES['oc-stories'] = {
  store: 'ocStories',
  fields: [
    { key: 'title', label: '剧情标题', type: 'text' },
    { key: 'characterIds', label: '关联OC', type: 'multiselect', options: [], hint: '从人物档案加载' },
    { key: 'tags', label: '剧情标签', type: 'multiselect', single: true, default: '灵感', options: [{ value: '主线', label: '主线' }, { value: '支线', label: '支线' }, { value: '日常', label: '日常' }, { value: '随笔', label: '随笔' }, { value: '灵感', label: '灵感' }] },
    { key: 'isComplete', label: '剧情状态', type: 'multiselect', single: true, default: '连载中', options: [{ value: '连载中', label: '连载中' }, { value: '已完结', label: '已完结' }] },
    { key: 'content', label: '剧情内容', type: 'textarea', hint: '支持多段落写作' },
    { key: 'createTime', label: '创作时间', type: 'date', default: todayStr() },
  ],
  filters: [{ key: 'tags', label: '全部标签', options: [{ value: '', label: '全部标签' }, { value: '主线', label: '主线' }, { value: '支线', label: '支线' }, { value: '日常', label: '日常' }, { value: '随笔', label: '随笔' }, { value: '灵感', label: '灵感' }] }],
  listFields: [
    { label: '标签', key: 'tags', tag: true },
    { label: '状态', key: 'isComplete', tag: true },
    { label: '关联', key: 'characterIds' },
    { label: '创作', key: 'createTime', date: true },
  ],
  personFilterField: 'characterIds',
};

// --- OC Timeline (时间轨迹) ---
MODULES['oc-timeline'] = {
  store: 'ocTimeline',
  fields: [
    { key: 'date', label: '时间', type: 'date' },
    { key: 'title', label: '事件标题', type: 'text' },
    { key: 'description', label: '事件描述', type: 'textarea' },
    { key: 'importance', label: '重要性', type: 'multiselect', single: true, options: [
      { value: '红', label: '重要' },
      { value: '橙', label: '较重要' },
      { value: '绿', label: '一般' },
      { value: '蓝', label: '次要' },
    ]},
    { key: 'characterIds', label: '关联人物', type: 'multiselect', options: [], hint: '从人物档案加载' },
    { key: 'source', label: '事件来源', type: 'text', hint: '手动创建或从故事小记导入' },
  ],
  listFields: [
    { label: '重要性', key: 'importance', tag: true },
    { label: '关联', key: 'characterIds' },
  ],
  special: 'timeline',
};

// --- OC Commission (需求12: 年度柱状图, 平台可选, 用途多选, 状态移至成品图前, 备注改名) ---
MODULES['oc-commission'] = {
  store: 'ocCommissions',
  fields: [
    { key: 'oc', label: 'OC', type: 'combobox', options: [], hint: '从人物档案加载' },
    { key: 'artistName', label: '画师名称', type: 'text' },
    { key: 'commissionType', label: '约稿类型', type: 'multiselect', options: [{ value: '头像', label: '头像' }, { value: '半身', label: '半身' }, { value: '立绘', label: '立绘' }, { value: '插画', label: '插画' }, { value: 'Q版', label: 'Q版' }, { value: '服装', label: '服装' }, { value: '武器', label: '武器' }, { value: '小物', label: '小物' }, { value: '印象', label: '印象' }] },
    { key: 'usageType', label: '稿件用途', type: 'multiselect', single: true, default: '自用', options: [{ value: '自用', label: '自用' }, { value: '无盈利', label: '无盈利' }, { value: '商用', label: '商用' }, { value: '买断', label: '买断' }, { value: '企业', label: '企业' }] },
    { key: 'fee', label: '约稿费用', type: 'number', hint: '元' },
    { key: 'platform', label: '约稿平台', type: 'multiselect', single: true, options: [{ value: '画加', label: '画加' }, { value: '米画师', label: '米画师' }, { value: '小红书', label: '小红书' }, { value: '微博', label: '微博' }, { value: '微信', label: '微信' }] },
    { key: 'commissionTime', label: '约稿时间', type: 'date', default: todayStr() },
    { key: 'deliveryTime', label: '交付时间', type: 'date' },
    { key: 'status', label: '交易状态', type: 'multiselect', single: true, options: [{ value: '待接稿', label: '待接稿' }, { value: '进行中', label: '进行中' }, { value: '已完成', label: '已完成' }, { value: '已取消', label: '已取消' }] },
    { key: 'artwork', label: '稿件成品图', type: 'image' },
    { key: 'notes', label: '备注', type: 'textarea' },
  ],
  filters: [{ key: 'status', label: '全部状态', options: [{ value: '', label: '全部状态' }, { value: '待接稿', label: '待接稿' }, { value: '进行中', label: '进行中' }, { value: '已完成', label: '已完成' }, { value: '已取消', label: '已取消' }] }],
  listFields: [
    { label: '状态', key: 'status', tag: true },
    { label: '画师', key: 'artistName' },
    { label: '类型', key: 'commissionType' },
    { label: 'OC', key: 'oc' },
    { label: '平台', key: 'platform' },
    { label: '费用', key: 'fee', prefix: '¥' },
    { label: '交付', key: 'deliveryTime', date: true },
  ],
  stats: (records) => {
    const totalFee = records.reduce((s, r) => s + (parseFloat(r.fee) || 0), 0);
    return [
      { label: '约稿总数', value: records.length, sub: '单' },
      { label: '总花费', value: '¥' + totalFee.toLocaleString(), sub: '' },
      { label: '已完成', value: records.filter(r => valIncludes(r.status, '已完成')).length, sub: '单' },
    ];
  },
  statsTitle: '约稿统计',
  chart: (records) => renderAnnualChart(records, 'commissionTime', { title: '约稿花费', valueField: 'fee', color: '#fa8c16' }),
  personFilterField: 'oc',
};

/* ===== State ===== */
let currentPage = 'home';
let pageState = {};
let _searchTimer, _homeSearchTimer;

/* ===== Page Sizes (v13: 分页) ===== */
const PAGE_SIZES = {
  'home': 5, 'groupbuy-records': 5, 'groupbuy-samples': 5,
  'design-commission': 5, 'design-auth': 5, 'oc-commission': 5,
  'groupbuy-factories': 20, 'design-inspiration': 20, 'oc-profiles': 20, 'oc-stories': 10, 'oc-relations': 10,
};
const TWO_COL_MODULES = ['groupbuy-factories', 'design-inspiration', 'oc-profiles'];

/* ===== Router ===== */
function navigate(page) {
  currentPage = page;
  DB.set('ui_state', { sidebarCollapsed: $('#sidebar').classList.contains('collapsed'), lastPage: page });
  $('#pageTitle').textContent = PAGE_TITLES[page] || page;
  renderSidebar();
  $('#sidebar').classList.remove('show');
  $('#sidebarOverlay').classList.remove('show');
  const body = $('#mainBody');
  body.innerHTML = ''; body.classList.add('fade-in');
  setTimeout(() => body.classList.remove('fade-in'), 300);
  if (page === 'home') return renderHome();
  if (page === 'groupbuy-calc') return renderPriceCalc();
  if (page === 'oc-relations') return renderRelations();
  if (page === 'oc-timeline') return renderTimeline();
  if (page === 'design-pricelist') return renderPriceList();
  if (page === 'design-calc') return renderDesignCalc();
  if (page === 'life-checkin') return renderLifeCheckin();
  if (page === 'life-record') return renderLifeRecord();
  const mod = MODULES[page];
  if (mod) return renderListPage(page, mod);
  body.innerHTML = '<div class="empty-state"><div class="empty-icon">🔧</div><div class="empty-text">页面开发中...</div></div>';
}

/* ===== Sidebar Rendering ===== */
function renderSidebar() {
  const nav = $('#sidebarNav');
  let html = `<div class="nav-item ${currentPage === 'home' ? 'active' : ''}" onclick="navigate('home')"><span class="nav-icon">${getNavIcon('home')}</span><span class="nav-label">${esc(getNavLabel('home', '首页'))}</span></div>`;
  NAV.slice(1).forEach(group => {
    html += `<div class="nav-group"><div class="nav-group-title">${esc(group.label)}</div>`;
    group.children.forEach(child => {
      html += `<div class="nav-item ${currentPage === child.key ? 'active' : ''}" onclick="navigate('${child.key}')"><span class="nav-icon">${getNavIcon(child.key)}</span><span class="nav-label">${esc(getNavLabel(child.key, child.label))}</span></div>`;
    });
    html += '</div>';
  });
  nav.innerHTML = html;
}

/* ===== Stats Section Helper ===== */
function renderStatsSection(stats, title) {
  let html = `<div class="stats-section">`;
  html += `<div class="stats-section-title">📊 ${esc(title || '总结')}</div>`;
  html += '<div class="stats-grid">';
  stats.forEach(s => {
    html += `<div class="stat-card"><div class="stat-label">${esc(s.label)}</div><div class="stat-value">${esc(s.value)}</div>${s.sub ? `<div class="stat-sub">${esc(s.sub)}</div>` : ''}</div>`;
  });
  html += '</div></div>';
  return html;
}

/* ===== Generic List Page ===== */
function renderListPage(pageKey, mod) {
  const body = $('#mainBody');
  const store = mod.store;
  let records = DB.list(store);
  if (!pageState[pageKey]) pageState[pageKey] = { search: '', filters: {} };
  const ps = pageState[pageKey];
  if (ps.pageNo == null) ps.pageNo = 1;
  if (pageKey === 'design-commission') {
    if (!ps.viewMode) ps.viewMode = 'calendar';
    if (!ps.calYear) { ps.calYear = new Date().getFullYear(); ps.calMonth = new Date().getMonth(); }
    if (!ps.dateFilter) ps.dateFilter = '';
  }
  if (ps.search) records = records.filter(r => JSON.stringify(r).toLowerCase().includes(ps.search.toLowerCase()));
  if (mod.filters) { mod.filters.forEach(f => { const fv = ps.filters[f.key]; if (fv) records = records.filter(r => valIncludes(r[f.key], fv)); }); }
  if (pageKey === 'oc-profiles') {
    records.sort((a, b) => {
      const ao = a.order != null ? a.order : 999999;
      const bo = b.order != null ? b.order : 999999;
      if (ao !== bo) return ao - bo;
      return (a._ct || 0) - (b._ct || 0);
    });
  } else {
    records.sort((a, b) => (b._ct || 0) - (a._ct || 0));
  }

  let html = '<div class="fade-in">';
  // 顶部视图切换行：接稿排期「列表 / 日历」按钮挪至页面最顶部
  if (pageKey === 'design-commission') {
    html += '<div class="view-toggle-top">';
    html += `<button class="btn btn-sm ${ps.viewMode === 'calendar' ? 'btn-primary' : 'btn-outline'}" onclick="commissionToggleView('calendar')">日历</button>`;
    html += `<button class="btn btn-sm ${ps.viewMode === 'list' ? 'btn-primary' : 'btn-outline'}" onclick="commissionToggleView('list')">列表</button>`;
    html += '</div>';
  }
  // Person filter buttons (for oc-stories and oc-commission) — 纯文字，不显示图片
  if (mod.personFilterField) {
    const chars = DB.list('ocCharacters');
    if (!ps.personFilter) ps.personFilter = null;
    html += '<div class="relation-person-row">';
    html += `<div class="relation-person-btn ${!ps.personFilter ? 'active' : ''}" onclick="setPersonFilter('${pageKey}','')"><span>📋 全部</span></div>`;
    html += '<div class="relation-person-grid collapsed distribute">';
    chars.forEach(c => {
      const active = ps.personFilter === c.name ? 'active' : '';
      html += `<div class="relation-person-btn ${active}" onclick="setPersonFilter('${pageKey}','${esc(c.name)}')"><span>${esc(c.name)}</span></div>`;
    });
    html += '</div>';
    html += '<button class="relation-toggle-btn" onclick="togglePersonGrid(this)">展开 ▾</button>';
    html += '</div>';
  }
  // Apply person filter
  if (mod.personFilterField && ps.personFilter) {
    const pf = ps.personFilter;
    const fieldName = mod.personFilterField;
    records = records.filter(r => {
      const val = r[fieldName];
      if (Array.isArray(val)) return val.includes(pf);
      return val === pf;
    });
  }
  // Toolbar (新增置顶)
  html += '<div class="toolbar">';
  html += `<div class="search-box"><input type="text" placeholder="搜索..." value="${esc(ps.search)}" oninput="onSearch('${pageKey}', this.value)"><span class="search-icon">🔍</span></div>`;
  if (mod.filters) {
    let modFilters = mod.filters;
    if (pageKey === 'design-inspiration') {
      const cats = getInspirationCategories();
      modFilters = [{ key: 'category', label: '全部制品', options: [{ value: '', label: '全部制品' }, ...cats.map(c => ({ value: c, label: c }))] }];
    }
    modFilters.forEach(f => {
      const cv = ps.filters[f.key] || '';
      const displayOpts = [...f.options];
      const cbId = 'flt_' + f.key + '_' + Math.random().toString(36).slice(2, 6);
      const optHTML = displayOpts.map(o => `<div class="combobox-option${cv === o.value ? ' selected' : ''}" onclick="onFilterCombobox('${pageKey}','${f.key}',this.dataset.value,'${cbId}')" data-value="${esc(o.value)}">${esc(o.label)}</div>`).join('');
      const selectedOpt = displayOpts.find(o => o.value === cv);
      const displayVal = selectedOpt ? selectedOpt.label : (displayOpts[0] ? displayOpts[0].label : '');
      html += `<div class="combobox-wrapper filter-combobox"><input type="text" class="form-input combobox-input filter-combobox-input" value="${esc(displayVal)}" placeholder="${esc(f.label || '筛选')}" readonly onfocus="showComboboxDropdown('${cbId}')" onclick="showComboboxDropdown('${cbId}')"><button type="button" class="combobox-toggle" onclick="toggleComboboxDropdown('${cbId}')">▼</button><div class="combobox-dropdown" id="${cbId}">${optHTML}</div></div>`;
    });
  }
  html += '<div class="spacer"></div>';
  if (pageKey === 'oc-profiles') {
    html += `<button class="btn btn-outline toolbar-eq" onclick="openProfileSortModal()">↕️ 调整排序</button>`;
  }
  html += `<button class="btn btn-primary" onclick="openAddForm('${pageKey}')">+ 新增记录</button>`;
  html += '</div>';

  // Commission calendar view: 默认日历视图；日历在上，列表在下
  let commissionAllRecords = null;
  if (pageKey === 'design-commission' && ps.viewMode === 'calendar') {
    commissionAllRecords = records.slice();
    let calFiltered = records;
    if (ps.dateFilter) calFiltered = records.filter(r => (r.startTime || r.acceptTime || '').startsWith(ps.dateFilter));
    records = calFiltered;
  }

  // Commission calendar view rendered before records (日历在上，列表在下)
  if (commissionAllRecords) {
    html += '<div class="calendar" style="margin-bottom:16px">';
    html += '<div class="calendar-header">';
    html += `<span class="cal-title">${ps.calYear}年${ps.calMonth + 1}月</span>`;
    html += '<div class="cal-nav">';
    html += `<button class="btn btn-sm btn-ghost" onclick="commissionCalNav(-1)">‹ 上月</button>`;
    html += `<button class="btn btn-sm btn-ghost" onclick="commissionCalNav(0)">本月</button>`;
    html += `<button class="btn btn-sm btn-ghost" onclick="commissionCalNav(1)">下月 ›</button>`;
    html += '</div></div>';
    html += renderCommissionCalendar(ps.calYear, ps.calMonth, commissionAllRecords);
    if (ps.dateFilter) {
      html += `<div style="text-align:center;margin-top:8px"><span class="tag tag-info" style="cursor:pointer" onclick="commissionClearDate()">清除日期筛选: ${ps.dateFilter} ✕</span></div>`;
    }
    html += '</div>';
  }

  // Records
  const pageSize = PAGE_SIZES[pageKey] || 10;
  const totalPages = Math.ceil(records.length / pageSize);
  if (ps.pageNo > totalPages) ps.pageNo = 1;
  const pageNo = ps.pageNo || 1;
  const pagedRecords = records.slice((pageNo - 1) * pageSize, pageNo * pageSize);

  if (!records.length) {
    html += '<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-text">暂无记录，点击新增开始添加</div></div>';
  } else {
    const twoCol = TWO_COL_MODULES.includes(pageKey) ? ' two-col' : '';
    html += `<div class="record-list${twoCol}">`;
    pagedRecords.forEach(r => {
      const isOverdue = mod.isOverdue && mod.isOverdue(r);
      html += `<div class="record-card" onclick="openDetail('${pageKey}','${r.id}')">`;
      html += '<div class="record-card-header">';
      const cardImg = mod.cardImage ? mod.cardImage(r) : null;
      if (cardImg) html += `<img src="${cardImg}" style="width:40px;height:40px;border-radius:6px;object-fit:cover;flex-shrink:0">`;
      let titleText = r.title || r.name || r.theme || r.sampleName || r.artworkName || r.clientInfo || '未命名记录';
      if (isOverdue) titleText = '⚠️ ' + titleText;
      html += `<div class="record-card-title">${esc(titleText)}</div>`;
      html += '<div class="record-card-actions">';
      html += `<span class="btn-icon" onclick="event.stopPropagation();openEditForm('${pageKey}','${r.id}')">✏️</span>`;
      html += `<span class="btn-icon danger" onclick="event.stopPropagation();onDelete('${pageKey}','${r.id}')">🗑️</span>`;
      html += '</div>';
      html += '</div>';
      html += '<div class="record-card-body">';
      (mod.listFields || []).forEach(f => {
        let v = r[f.key];
        if (f.key === '_productCount') v = calcProductQty(r) + '件';
        if (f.key === 'clientInfo') return; // 单主已在卡片标题展示，正文不再重复
        if (f.key === '_firstProduct') {
          if (pageKey === 'design-commission') return; // 接稿排期在下面用复选框展示
          const names = (r.products || []).map(p => p.name).filter(Boolean); v = names.join('、');
        }
        if (v == null || v === '') return;
        if (f.tag && Array.isArray(v)) {
          const tags = v.map(val => {
            let tc = 'tag-info';
            if (['进行中', '全款', '长期合作', '合格', '稳定', '已完结', '尾款', '已接稿', '已交付', '交好'].includes(val)) tc = 'tag-success';
            if (['筹备中', '未付', '临时合作', '连载中', '定金', '待接稿', '中等', '变化中'].includes(val)) tc = 'tag-warning';
            if (['已截团', '暂停合作', '已取消', '流团'].includes(val)) tc = 'tag-gray';
            if (['不合格'].includes(val)) tc = 'tag-danger';
            if (['买断', '敌对', '已结算'].includes(val)) tc = 'tag-purple';
            return `<span class="tag ${tc}">${esc(String(val))}</span>`;
          }).join(' ');
          html += `<span class="field"><span class="field-label">${esc(f.label)}:</span>${tags}</span>`;
          return;
        }
        if (Array.isArray(v)) v = v.join('、');
        if (f.date) v = fmtDate(v);
        if (f.prefix) v = f.prefix + v;
        if (f.tag) {
          let tc = 'tag-info';
          if (['进行中', '全款', '长期合作', '合格', '稳定', '已完结', '尾款', '已接稿', '已交付', '交好'].includes(v)) tc = 'tag-success';
          if (['筹备中', '未付', '临时合作', '连载中', '定金', '待接稿', '中等', '变化中'].includes(v)) tc = 'tag-warning';
          if (['已截团', '暂停合作', '已取消', '流团'].includes(v)) tc = 'tag-gray';
          if (['不合格'].includes(v)) tc = 'tag-danger';
          if (['买断', '敌对', '已结算'].includes(v)) tc = 'tag-purple';
          html += `<span class="field"><span class="field-label">${esc(f.label)}:</span><span class="tag ${tc}">${esc(String(v))}</span></span>`;
        } else if (f.link) {
          if (v && v.startsWith('http')) html += `<span class="field"><span class="field-label">${esc(f.label)}:</span><a href="${esc(v)}" target="_blank" style="color:var(--c-primary)">链接</a></span>`;
        } else {
          html += `<span class="field"><span class="field-label">${esc(f.label)}:</span><span class="field-value">${esc(String(v))}</span></span>`;
        }
      });
      if (pageKey === 'design-commission' && r.products && r.products.length) {
        const doneCount = r.products.filter(p => p.done).length;
        html += `<div class="field comm-products-field" onclick="event.stopPropagation()"><span class="field-label">制品:</span><div class="comm-product-checklist">`;
        r.products.forEach((p, idx) => {
          html += `<label class="comm-product-item ${p.done ? 'done' : ''}">
            <input type="checkbox" ${p.done ? 'checked' : ''} onchange="event.stopPropagation();commissionToggleProductDone('${r.id}',${idx},this.checked,true)">
            <span>${esc(p.name || '未命名')}</span>
          </label>`;
        });
        html += `</div></div>`;
        html += `<span class="field"><span class="field-label">完成:</span><span class="field-value" style="color:${doneCount === r.products.length ? 'var(--c-green)' : 'var(--c-text)'}">${doneCount}/${r.products.length}</span></span>`;
      }
      html += '</div>';
      if (isOverdue) html += `<div style="margin-top:8px;padding:4px 8px;background:#fff1f0;border-radius:4px;font-size:11px;color:var(--c-red)">⚠️ 已过截止日期</div>`;
      html += '</div>';
    });
    html += '</div>';
    // Pagination controls
    if (totalPages > 1) {
      html += '<div class="pagination">';
      html += `<button class="btn btn-sm btn-ghost" ${pageNo <= 1 ? 'disabled' : ''} onclick="goPage('${pageKey}',${pageNo - 1})">‹ 上一页</button>`;
      html += `<span class="page-info">第 ${pageNo} / ${totalPages} 页 (共 ${records.length} 条)</span>`;
      html += `<button class="btn btn-sm btn-ghost" ${pageNo >= totalPages ? 'disabled' : ''} onclick="goPage('${pageKey}',${pageNo + 1})">下一页 ›</button>`;
      html += '</div>';
    }
  }

  // Chart + Stats (总结部分与记录隔开, 两列布局, 实色分割线)
  if (mod.chart || mod.stats) {
    html += '<div class="stats-divider"></div>';
    if (mod.chart) html += mod.chart(DB.list(store));
    if (mod.stats) html += renderStatsSection(mod.stats(DB.list(store)), mod.statsTitle);
  }
  html += '</div>';
  body.innerHTML = html;
}

function onSearch(pageKey, val) {
  if (!pageState[pageKey]) pageState[pageKey] = { search: '', filters: {} };
  pageState[pageKey].search = val;
  pageState[pageKey].pageNo = 1;
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(() => {
    if (pageKey === 'design-pricelist') return renderPriceList();
    if (pageKey === 'oc-timeline') return renderTimeline();
    renderListPage(pageKey, MODULES[pageKey]);
  }, 200);
}
function onFilter(pageKey, fkey, val) {
  if (!pageState[pageKey]) pageState[pageKey] = { search: '', filters: {} };
  pageState[pageKey].pageNo = 1;
  pageState[pageKey].filters[fkey] = val;
  renderListPage(pageKey, MODULES[pageKey]);
}
function onFilterCombobox(pageKey, fkey, val, cbId) {
  const dd = document.getElementById(cbId);
  if (dd) {
    dd.classList.remove('show');
    const wrapper = dd.parentElement;
    const input = wrapper.querySelector('.combobox-input');
    if (input) input.value = val ? (dd.querySelector(`[data-value="${val.replace(/"/g,'&quot;')}"]`)?.textContent || val) : '';
  }
  onFilter(pageKey, fkey, val);
}
function goPage(pageKey, pageNo) {
  if (!pageState[pageKey]) pageState[pageKey] = { search: '', filters: {} };
  pageState[pageKey].pageNo = pageNo;
  renderListPage(pageKey, MODULES[pageKey]);
}

/* ===== Commission Calendar View (v16: 开稿~截稿时间段连续显示, 不同稿件不同颜色) ===== */
const CAL_URGENCY_COLORS = ['#e8857e', '#7ec678', '#7ab5f5']; // soft red, green, blue — by urgency, matched to theme
const CAL_MAX_TRACKS = 3;
const CAL_BAR_HEIGHT = 11;
const CAL_BAR_GAP = 2;
// Sum product quantities (e.g. 吧唧×4 + 明信片×2 = 6件)
function calcProductQty(r) {
  const prods = r.products || [];
  if (!prods.length) return 1; // fallback: count as 1 if no products
  return prods.reduce((sum, p) => sum + (parseInt(p.quantity) || 1), 0);
}
function renderCommissionCalendar(year, month, records) {
  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();
  const today = new Date();
  const todayKey = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  const ps = pageState['design-commission'] || {};
  const START_COLOR = '#ff9a3c', END_COLOR = '#f5c518', BOTH_COLOR = '#712258';
  // Filter records with valid periods
  const periodRecords = records.filter(r => {
    const start = r.startTime || r.acceptTime || '';
    const end = r.deadline || '';
    return start && end;
  }).sort((a, b) => {
    const aStart = a.startTime || a.acceptTime || '';
    const bStart = b.startTime || b.acceptTime || '';
    return aStart.localeCompare(bStart);
  });
  // Assign colors by urgency based on absolute deadline thresholds (not ranking)
  // 紧急(截稿临近)=红, 正常=绿, 充裕=蓝
  const recordColorMap = {};
  const todayTime = today.getTime();
  const URGENT_MS = 3 * 86400000;   // ≤3 days = 紧急 (red)
  const NORMAL_MS = 7 * 86400000;   // 4-7 days = 正常 (green)
  // >7 days = 充裕 (blue)
  periodRecords.forEach(r => {
    const deadlineTime = new Date(r.deadline).getTime();
    const timeLeft = deadlineTime - todayTime;
    if (timeLeft <= URGENT_MS) {
      recordColorMap[r.id] = CAL_URGENCY_COLORS[0]; // red = 紧急
    } else if (timeLeft <= NORMAL_MS) {
      recordColorMap[r.id] = CAL_URGENCY_COLORS[1]; // green = 正常
    } else {
      recordColorMap[r.id] = CAL_URGENCY_COLORS[2]; // blue = 充裕
    }
  });
  // Greedy track assignment — each task gets a consistent vertical row across all days
  const tracks = []; // tracks[t] = array of records on that track
  const recordTrack = {}; // record.id -> track index
  periodRecords.forEach(r => {
    const rStart = r.startTime || r.acceptTime || '';
    const rEnd = r.deadline || '';
    let assigned = false;
    for (let t = 0; t < tracks.length; t++) {
      const conflict = tracks[t].some(o => {
        const oStart = o.startTime || o.acceptTime || '';
        const oEnd = o.deadline || '';
        return !(rEnd < oStart || rStart > oEnd);
      });
      if (!conflict) { tracks[t].push(r); recordTrack[r.id] = t; assigned = true; break; }
    }
    if (!assigned) { tracks.push([r]); recordTrack[r.id] = tracks.length - 1; }
  });

  let html = '<div class="cal-grid commission-cal-grid">';
  ['日', '一', '二', '三', '四', '五', '六'].forEach(w => { html += `<div class="cal-weekday">${w}</div>`; });
  for (let i = startWeekday - 1; i >= 0; i--) { html += `<div class="cal-day other-month"><span class="cal-date">${prevMonthDays - i}</span></div>`; }
  const barAreaTop = 22; // px from top of cell where bars start (date+开稿 on one row)
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    const dayPeriods = periodRecords.filter(r => {
      const start = r.startTime || r.acceptTime || '';
      const end = r.deadline || '';
      return dateStr >= start && dateStr <= end;
    }).sort((a, b) => (recordTrack[a.id] || 0) - (recordTrack[b.id] || 0));
    const startRecords = records.filter(r => (r.startTime || r.acceptTime || '').startsWith(dateStr));
    const deadlineRecords = records.filter(r => r.deadline === dateStr);
    const isToday = dateStr === todayKey;
    const isSelected = ps.dateFilter === dateStr;
    // v29-fix2: 开稿/截稿统一恢复为 v27 样式：日期同行实心圆点+文字
    // v29-fix6: 日期数字靠左，截稿不再固定右侧，同天合并为"开+截"
    let startTag = '', endTag = '';
    if (startRecords.length > 0 && deadlineRecords.length > 0) {
      startTag = `<span class="cal-day-tag"><span class="cal-day-tag-dot" style="background:${BOTH_COLOR}"></span><span class="cal-day-tag-text" style="color:${BOTH_COLOR}">开+截</span></span>`;
    } else {
      if (startRecords.length > 0) startTag = `<span class="cal-day-tag"><span class="cal-day-tag-dot" style="background:${START_COLOR}"></span><span class="cal-day-tag-text" style="color:${START_COLOR}">开稿</span></span>`;
      if (deadlineRecords.length > 0) endTag = `<span class="cal-day-tag"><span class="cal-day-tag-dot" style="background:${END_COLOR}"></span><span class="cal-day-tag-text" style="color:${END_COLOR}">截稿</span></span>`;
    }
    let info = '';
    // Build period bars by track (max 3 visible, excess ignored)
    let bars = '';
    dayPeriods.forEach(r => {
      const track = recordTrack[r.id] != null ? recordTrack[r.id] : 0;
      if (track >= CAL_MAX_TRACKS) return; // excess ignored, no folding
      const start = r.startTime || r.acceptTime || '';
      const end = r.deadline || '';
      const isStart = dateStr === start;
      const isEnd = dateStr === end;
      const color = recordColorMap[r.id] || '#9DC8FF';
      let cls = 'cal-period-bar middle';
      if (isStart && isEnd) cls = 'cal-period-bar full';
      else if (isStart) cls = 'cal-period-bar start';
      else if (isEnd) cls = 'cal-period-bar end';
      const productCount = calcProductQty(r);
      const label = isStart ? `${esc(r.clientInfo || '未命名')} ${productCount}件` : '';
      const topPx = barAreaTop + track * (CAL_BAR_HEIGHT + CAL_BAR_GAP);
      bars += `<div class="${cls}" style="background:${color};top:${topPx}px;height:${CAL_BAR_HEIGHT}px;line-height:${CAL_BAR_HEIGHT}px">${label}</div>`;
    });
    const cellMinHeight = 76; // fits 3 bars (22+3*13=61px) + padding
    html += `<div class="cal-day${isToday ? ' today' : ''}${isSelected ? ' selected' : ''}" onclick="commissionDateClick('${dateStr}')" style="cursor:pointer;min-height:${cellMinHeight}px"><div class="cal-date-row"><span class="cal-date">${d}</span>${startTag}${endTag}</div>${info}${bars}</div>`;
  }
  const totalCells = startWeekday + daysInMonth;
  const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
  for (let i = 1; i <= remaining; i++) { html += `<div class="cal-day other-month"><span class="cal-date">${i}</span></div>`; }
  html += '</div>';
  // Legend (v29-fix4: 改回 v27 样式 — 开稿/截稿 用实际色，加同天开+截)
  html += '<div class="cal-legend-wrap">';
  html += '<div class="cal-legend">';
  html += `<span class="legend-item"><span class="status-dot" style="background:${START_COLOR}"></span>开稿</span>`;
  html += `<span class="legend-item"><span class="status-dot" style="background:${END_COLOR}"></span>截稿</span>`;
  html += `<span class="legend-item"><span class="status-dot" style="background:${BOTH_COLOR}"></span>当天同时存在开稿和截稿项目</span>`;
  html += '</div>';
  html += '<div class="cal-legend-sep"></div>';
  html += '<div class="cal-legend">';
  html += `<span class="legend-item"><span style="display:inline-block;width:14px;height:8px;border-radius:2px;background:${CAL_URGENCY_COLORS[0]}"></span>紧急（截稿≤3天）</span>`;
  html += `<span class="legend-item"><span style="display:inline-block;width:14px;height:8px;border-radius:2px;background:${CAL_URGENCY_COLORS[1]}"></span>正常（4-7天）</span>`;
  html += `<span class="legend-item"><span style="display:inline-block;width:14px;height:8px;border-radius:2px;background:${CAL_URGENCY_COLORS[2]}"></span>充裕（>7天）</span>`;
  html += '</div>';
  html += '</div>';
  return html;
}
function commissionToggleView(mode) {
  const ps = pageState['design-commission'] || (pageState['design-commission'] = { search: '', filters: {} });
  ps.viewMode = mode;
  renderListPage('design-commission', MODULES['design-commission']);
}
function commissionCalNav(dir) {
  const ps = pageState['design-commission'];
  if (dir === 0) { ps.calYear = new Date().getFullYear(); ps.calMonth = new Date().getMonth(); }
  else { ps.calMonth += dir; if (ps.calMonth < 0) { ps.calMonth = 11; ps.calYear--; } if (ps.calMonth > 11) { ps.calMonth = 0; ps.calYear++; } }
  renderListPage('design-commission', MODULES['design-commission']);
}
function commissionDateClick(dateStr) {
  const ps = pageState['design-commission'];
  ps.dateFilter = (ps.dateFilter === dateStr) ? '' : dateStr;
  renderListPage('design-commission', MODULES['design-commission']);
}
function commissionClearDate() {
  pageState['design-commission'].dateFilter = '';
  renderListPage('design-commission', MODULES['design-commission']);
}
function setPersonFilter(pageKey, name) {
  if (!pageState[pageKey]) pageState[pageKey] = { search: '', filters: {} };
  pageState[pageKey].personFilter = name || null;
  renderListPage(pageKey, MODULES[pageKey]);
}

/* ===== OC Profile Manual Reorder ===== */
function profileMove(id, dir) {
  const records = DB.list('ocCharacters');
  records.sort((a, b) => {
    const ao = a.order != null ? a.order : 999999;
    const bo = b.order != null ? b.order : 999999;
    if (ao !== bo) return ao - bo;
    return (a._ct || 0) - (b._ct || 0);
  });
  const idx = records.findIndex(r => r.id === id);
  if (idx < 0) return;
  const swapIdx = idx + dir;
  if (swapIdx < 0 || swapIdx >= records.length) return;
  // Ensure both have order values
  records.forEach((r, i) => { if (r.order == null) r.order = i; });
  const tmp = records[idx].order;
  records[idx].order = records[swapIdx].order;
  records[swapIdx].order = tmp;
  DB.save('ocCharacters', records);
  Toast.success('顺序已调整');
  renderListPage('oc-profiles', MODULES['oc-profiles']);
}

// v29-fix2: 人物档案独立排序弹窗
function openProfileSortModal() {
  let list = DB.list('ocCharacters').slice();
  list.sort((a, b) => {
    const ao = a.order != null ? a.order : 999999;
    const bo = b.order != null ? b.order : 999999;
    if (ao !== bo) return ao - bo;
    return (a._ct || 0) - (b._ct || 0);
  });
  list.forEach((r, i) => { if (r.order == null) r.order = i; });
  const render = () => {
    let html = '<div class="sortable-list">';
    list.forEach((r, i) => {
      html += `<div class="sortable-item"><span class="sortable-name">${esc(r.name || '未命名')}</span>`;
      html += `<div class="sortable-actions">`;
      html += `<button class="btn btn-ghost btn-sm" ${i === 0 ? 'disabled' : ''} onclick="profileSortMove(${i},-1)">▲</button>`;
      html += `<button class="btn btn-ghost btn-sm" ${i === list.length - 1 ? 'disabled' : ''} onclick="profileSortMove(${i},1)">▼</button>`;
      html += '</div></div>';
    });
    html += '</div>';
    $('#modalBody').innerHTML = html;
  };
  window._profileSortList = list;
  window.profileSortMove = (idx, dir) => {
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= list.length) return;
    const tmp = list[idx].order;
    list[idx].order = list[swapIdx].order;
    list[swapIdx].order = tmp;
    list.sort((a, b) => {
      const ao = a.order != null ? a.order : 999999;
      const bo = b.order != null ? b.order : 999999;
      if (ao !== bo) return ao - bo;
      return (a._ct || 0) - (b._ct || 0);
    });
    render();
  };
  openModal('调整人物档案排序', '', [
    { label: '取消', class: 'btn-outline', action: () => closeModal() },
    { label: '保存', class: 'btn-primary', action: () => {
      DB.save('ocCharacters', list);
      Toast.success('排序已保存');
      closeModal();
      renderListPage('oc-profiles', MODULES['oc-profiles']);
    }}
  ]);
  render();
}

/* ===== Add/Edit Form ===== */
function prepareFields(pageKey, fields) {
  let f = JSON.parse(JSON.stringify(fields));
  if (pageKey === 'oc-relations') {
    const chars = DB.list('ocCharacters');
    const opts = chars.map(c => ({ value: c.name, label: c.name + (c.alias ? ' (' + c.alias + ')' : '') }));
    const fa = f.find(ff => ff.key === 'charA'); if (fa) fa.options = opts;
    const fb = f.find(ff => ff.key === 'charB'); if (fb) fb.options = opts;
  }
  if (pageKey === 'groupbuy-samples') {
    const facs = DB.list('factories');
    const ff = f.find(x => x.key === 'factory'); if (ff) ff.options = facs.map(fc => ({ value: fc.name, label: fc.name }));
  }
  if (pageKey === 'oc-stories') {
    const chars = DB.list('ocCharacters');
    const ff = f.find(x => x.key === 'characterIds'); if (ff) ff.options = chars.map(c => ({ value: c.name, label: c.name }));
  }
  if (pageKey === 'oc-timeline') {
    const chars = DB.list('ocCharacters');
    const ff = f.find(x => x.key === 'characterIds'); if (ff) ff.options = chars.map(c => ({ value: c.name, label: c.name }));
  }
  if (pageKey === 'oc-commission') {
    const chars = DB.list('ocCharacters');
    const ff = f.find(x => x.key === 'oc'); if (ff) ff.options = chars.map(c => ({ value: c.name, label: c.name }));
  }
  if (pageKey === 'design-inspiration') {
    const cats = getInspirationCategories();
    const ff = f.find(x => x.key === 'category'); if (ff) ff.options = cats.map(c => ({ value: c, label: c }));
  }
  if (pageKey === 'groupbuy-samples') {
    const cats = getSampleCategories();
    const ff = f.find(x => x.key === 'category'); if (ff) ff.options = cats.map(c => ({ value: c, label: c }));
  }
  if (pageKey === 'groupbuy-records') {
    const facs = DB.list('factories').map(fc => fc.name);
    const priceList = DB.list('priceList');
    const productNames = [...new Set(priceList.filter(p => PRODUCT_CATEGORIES.includes(p.category) && p.product).map(p => p.product))];
    const prodField = f.find(ff => ff.key === 'products');
    if (prodField) {
      const nameCol = prodField.columns.find(c => c.subkey === 'name');
      if (nameCol) { nameCol.datalistId = 'gb_product_dl'; }
      const facCol = prodField.columns.find(c => c.subkey === 'factory');
      if (facCol) { facCol.options = facs.map(n => ({ value: n, label: n })); facCol.datalistId = 'gb_factory_dl'; }
      const disbandedCol = prodField.columns.find(c => c.subkey === 'isDisbanded');
      if (disbandedCol) { disbandedCol.options = [{ value: '是', label: '是' }, { value: '否', label: '否' }]; disbandedCol.datalistId = 'gb_disbanded_dl'; }
    }
    // 售后记录：制品名称也用同一份产品列表
    const aftsField = f.find(ff => ff.key === 'afterSales');
    if (aftsField) {
      const aNameCol = aftsField.columns.find(c => c.subkey === 'name');
      if (aNameCol) { aNameCol.datalistId = 'gb_product_dl'; }
    }
  }
  if (pageKey === 'design-commission') {
    const priceList = DB.list('priceList');
    const prodField = f.find(ff => ff.key === 'products');
    if (prodField) {
      const nameCol = prodField.columns.find(c => c.subkey === 'name');
      if (nameCol) {
        const productNames = priceList.filter(p => PRODUCT_CATEGORIES.includes(p.category) && p.product).map(p => p.product);
        nameCol.options = [...new Set(productNames)].map(n => ({ value: n, label: n }));
        nameCol.datalistId = 'comm_product_dl';
      }
      // v17: 同模下拉选项注入 combobox
      const smCol = prodField.columns.find(c => c.subkey === 'sameModel');
      if (smCol && smCol.options && !smCol.datalistId) smCol.datalistId = 'comm_sameModel_dl';
    }
    const extraField = f.find(ff => ff.key === 'extraItems');
    if (extraField) {
      const nameCol = extraField.columns.find(c => c.subkey === 'name');
      if (nameCol) {
        const extraNames = priceList.filter(p => p.category === '加价项目' && p.product).map(p => p.product);
        nameCol.options = [...new Set(extraNames)].map(n => ({ value: n, label: n }));
        nameCol.datalistId = 'comm_extra_dl';
      }
    }
    // v29: 修改项目类型从价目表「修改类型」分类加载
    const modField = f.find(ff => ff.key === 'modifications');
    if (modField) {
      const mtCol = modField.columns.find(c => c.subkey === 'modifyType');
      if (mtCol) {
        const modifyTypeNames = priceList.filter(p => p.category === '修改类型' && p.product).map(p => p.product);
        mtCol.options = [...new Set(modifyTypeNames)].map(n => ({ value: n, label: n }));
        mtCol.datalistId = 'comm_modify_dl';
      }
    }
  }
  return f;
}

function openAddForm(pageKey) {
  const mod = MODULES[pageKey];
  let fields = prepareFields(pageKey, mod.fields);
  let defaultData = {};
  if (pageKey === 'home' && pageState.home && pageState.home.tab) defaultData.platform = [pageState.home.tab];
  // Apply defaults from field config
  fields.forEach(f => { if (f.default !== undefined) defaultData[f.key] = f.default; });
  const bodyHTML = buildForm(fields, defaultData, pageKey);
  openModal('新增记录', bodyHTML, [
    { label: '取消', class: 'btn-ghost', action: closeModal },
    { label: '保存', class: 'btn-primary', action: () => saveForm(pageKey, mod, null) },
  ]);
  setTimeout(() => { setupFormInteractions(pageKey); refreshCommissionBindOptions(); }, 50);
}

function openEditForm(pageKey, id) {
  const mod = MODULES[pageKey];
  const record = DB.getById(mod.store, id);
  if (!record) return Toast.error('记录不存在');
  let fields = prepareFields(pageKey, mod.fields);
  const bodyHTML = buildForm(fields, record, pageKey);
  openModal('编辑记录', bodyHTML, [
    { label: '取消', class: 'btn-ghost', action: closeModal },
    { label: '保存', class: 'btn-primary', action: () => saveForm(pageKey, mod, id) },
  ]);
  setTimeout(() => {
    setupFormInteractions(pageKey);
    refreshCommissionBindOptions();
    if ($('#imgUpload')) {
      initImageUpload('#imgUpload');
      if (record.images) $('#imgUpload')._setImages(record.images);
    }
  }, 50);
}

function setupFormInteractions(pageKey) {
  if ($('#imgUpload')) initImageUpload('#imgUpload');
  if (pageKey === 'design-commission') {
    const modalBody = $('#modalBody');
    const recalc = () => {
      const data = readForm(modalBody);
      calcCommissionPrice(data);
      const depositInput = $('[data-key="deposit"]', modalBody);
      if (depositInput) depositInput.value = data.deposit || 0;
      const balanceInput = $('[data-key="balance"]', modalBody);
      if (balanceInput) balanceInput.value = data.balance || 0;
      // Auto-sync amount field in real-time if it's 0 or empty
      const amountInput = $('[data-key="amount"]', modalBody);
      if (amountInput && !parseFloat(amountInput.value)) amountInput.value = data.quoteAmount || 0;
    };
    modalBody.addEventListener('input', (e) => {
      if (e.target.dataset.key === 'quoteAmount') recalc();
    });
    setTimeout(recalc, 100);
  }
}

function saveForm(pageKey, mod, id) {
  const data = readForm($('#modalBody'));
  const imgs = readFormImages($('#modalBody'));
  if (imgs.length) data.images = imgs;
  else if (id) delete data.images;
  if (pageKey === 'design-commission') {
    calcCommissionPrice(data);
    // DU轮：标记为「已交付」且无交付时间时，自动记录交付日期（用于报价导入接稿的7天过滤）
    if (valIncludes(data.progress, '已交付') && !data.deliveredTime) {
      data.deliveredTime = todayStr();
    }
  }
  if (pageKey === 'design-inspiration' && data.category) saveCustomCategory(data.category);
  if (pageKey === 'groupbuy-samples' && data.category) saveCustomSampleCategory(data.category);
  if (id) { DB.update(mod.store, id, data); Toast.success('记录已更新'); }
  else { DB.add(mod.store, data); Toast.success('记录已添加'); }
  closeModal();
  navigate(pageKey);
}

/* ===== Commission Price Calculation (v15: 定金尾款两位小数) ===== */
function calcCommissionPrice(data) {
  const quoteAmount = parseFloat(data.quoteAmount) || 0;
  data.deposit = Math.round(quoteAmount * 0.5 * 100) / 100;
  data.balance = Math.round(quoteAmount * 0.5 * 100) / 100;
  // Auto-sync: if final amount is 0 or empty, sync from quoteAmount
  if (!parseFloat(data.amount)) data.amount = quoteAmount;
}

/* ===== Detail View ===== */
function openDetail(pageKey, id) {
  const mod = MODULES[pageKey];
  const r = DB.getById(mod.store, id);
  if (!r) return;
  let html = '<div class="detail-view">';
  mod.fields.forEach(f => {
    if (f.section) { html += `<div style="font-size:13px;font-weight:600;color:var(--c-primary);margin:12px 0 6px;padding-bottom:4px;border-bottom:1px solid var(--c-border-light)">${esc(f.section)}</div>`; return; }
    if (f.type === 'custom' || f.type === 'readonly') return;
    const label = getFieldLabel(pageKey, f.key, f.label);
    if (f.type === 'image') {
      if (r.images && r.images.length) {
        html += `<div class="detail-row"><span class="detail-label">${esc(label)}</span><div class="detail-value"><div class="detail-images">${r.images.map(src => `<img src="${src}" onclick="openLightbox('${src.replace(/'/g, "\\'")}')">`).join('')}</div></div></div>`;
      }
      return;
    }
    if (f.type === 'multiselect') {
      const vals = Array.isArray(r[f.key]) ? r[f.key] : [];
      if (vals.length) html += `<div class="detail-row"><span class="detail-label">${esc(label)}</span><span class="detail-value">${vals.map(v => `<span class="tag tag-info" style="margin-right:4px">${esc(v)}</span>`).join('')}</span></div>`;
      return;
    }
    if (f.type === 'dynamic-list' || f.type === 'dynamic-products') {
      const items = r[f.key];
      if (items && items.length) {
        const cols = f.columns || [];
        const isCommProd = (pageKey === 'design-commission' && f.key === 'products');
        const extraHead = isCommProd ? '<th style="width:54px">完成</th>' : '';
        const extraCell = isCommProd
          ? (item, idx) => `<td class="comm-prod-done"><label><input type="checkbox" ${item.done ? 'checked' : ''} onclick="commissionToggleProductDone('${id}',${idx},this.checked)"> ${item.done ? '✓' : ''}</label></td>`
          : null;
        html += `<div class="detail-row"><span class="detail-label">${esc(label)}</span><div class="detail-value"><table class="detail-table"><tr>${cols.map(c => `<th>${esc(c.label)}</th>`).join('')}${extraHead}</tr>`;
        items.forEach((item, idx) => {
          html += `<tr class="${item.done ? 'prod-done' : ''}">`;
          cols.forEach(c => {
            if (c.type === 'seq') html += `<td style="text-align:center;font-weight:700;color:var(--c-text-light)">${String(idx + 1).padStart(2, '0')}</td>`;
            else if (c.type === 'checkbox') html += `<td style="text-align:center">${item[c.subkey] ? '✓' : ''}</td>`;
            else html += `<td>${esc(item[c.subkey] || '')}</td>`;
          });
          html += extraCell ? extraCell(item, idx) : '';
          html += `</tr>`;
        });
        html += `</table></div></div>`;
      }
      return;
    }
    let v = r[f.key];
    if (v == null || v === '') return;
    if (f.type === 'date') v = fmtDate(v);
    if (f.type === 'textarea') v = `<div style="white-space:pre-wrap">${esc(v)}</div>`;
    else v = esc(String(v));
    html += `<div class="detail-row"><span class="detail-label">${esc(label)}</span><span class="detail-value">${v}</span></div>`;
  });
  if (mod.detailExtra) html += mod.detailExtra(r);
  html += '</div>';
  openModal('记录详情', html, [
    { label: '关闭', class: 'btn-ghost', action: closeModal },
    { label: '编辑', class: 'btn-primary', action: () => { closeModal(); openEditForm(pageKey, id); } },
  ], 'lg');
}

// 接稿排期：制品完成勾选（持久化到 commission.products[idx].done）
function commissionToggleProductDone(id, idx, checked, fromList = false) {
  const r = DB.getById('commissions', id);
  if (!r || !r.products || !r.products[idx]) return;
  r.products[idx].done = checked;
  DB.update('commissions', id, r);
  Toast.success(checked ? '已标记完成' : '已取消完成');
  if (fromList) renderListPage('design-commission');
  else openDetail('design-commission', id);
}

/* ===== Delete ===== */
async function onDelete(pageKey, id) {
  const mod = MODULES[pageKey];
  const r = DB.getById(mod.store, id);
  if (!r) return;
  const name = r.title || r.name || r.theme || r.artworkName || r.clientInfo || '此记录';
  if (await confirmDialog(`确定要删除「${name}」吗？此操作不可撤销。`)) {
    DB.remove(mod.store, id); Toast.success('已删除'); navigate(pageKey);
  }
}

/* ===== Home Page (v5: 平台按钮一排4个, 进平台隐藏日历, 图表在统计上) ===== */
function renderHome() {
  const body = $('#mainBody');
  if (!pageState.home) pageState.home = { tab: null, calYear: new Date().getFullYear(), calMonth: new Date().getMonth(), view: 'main', search: '', dateFilter: '' };
  const ps = pageState.home;
  const allRecords = DB.list('publishRecords');

  let html = '<div class="fade-in">';

  const statusOf = (r) => (r.status === '已发布' ? '已发布' : '待发布');

  // Platform buttons (always visible, 4 in a row, for switching)
  // 每个平台按钮底部直接显示该平台「待发布 / 已发布」数量（待发布左、已发布右）
  html += '<div class="platform-buttons">';
  const platformIcons = { '小红书': '📕', '抖音': '🎵', '视频号': '📹', '公众号': '📝' };
  MODULES.home.tabs.forEach(t => {
    const tRecords = allRecords.filter(r => valIncludes(r.platform, t.value));
    const pendingForT = tRecords.filter(r => statusOf(r) === '待发布').length;
    const publishedForT = tRecords.filter(r => statusOf(r) === '已发布').length;
    const activeStyle = (ps.view === 'platform' && ps.tab === t.value) ? 'box-shadow:0 0 0 3px rgba(255,255,255,.6);transform:translateY(-2px)' : '';
    html += `<button class="platform-btn" style="background:${t.color};${activeStyle}">`;
    html += `<span class="platform-main" onclick="enterPlatformView('${t.value}')">`;
    html += `<span class="platform-icon">${platformIcons[t.value] || '📝'}</span>`;
    html += `<span class="platform-name">${esc(t.label)}</span>`;
    html += '</span>';
    html += `<span class="platform-status-row"><span class="platform-pending" onclick="homeSetPlatformStatusFilter('${t.value}', '待发布');event.stopPropagation();">待发布 ${pendingForT}</span><span class="platform-sep">·</span><span class="platform-published" onclick="homeSetPlatformStatusFilter('${t.value}', '已发布');event.stopPropagation();">已发布 ${publishedForT}</span></span>`;
    html += '</button>';
  });
  html += '</div>';

  if (ps.view === 'main') {
    // Main view: 日历（v221：全局待发布按钮不再出现在日历视图，改到各平台模块内）
    html += '<div class="calendar" style="margin-top:4px">';
    html += '<div class="calendar-header">';
    html += `<span class="cal-title">${ps.calYear}年${ps.calMonth + 1}月</span>`;
    html += '<div class="cal-nav">';
    html += `<button class="btn btn-sm btn-ghost" onclick="homeCalNav(-1)">‹ 上月</button>`;
    html += `<button class="btn btn-sm btn-ghost" onclick="homeCalNav(0)">本月</button>`;
    html += `<button class="btn btn-sm btn-ghost" onclick="homeCalNav(1)">下月 ›</button>`;
    html += '</div></div>';
    html += renderCalendar(ps.calYear, ps.calMonth, allRecords, DB.list('commissions'));
    html += '</div>';
    // v29-fix2: 首页灵感速记模块（写入 inspirations，首页不展示，进入「美工·灵感记录」）
    const inspCats = getInspirationCategories();
    const hCatOpts = inspCats.map(c => `<div class="combobox-option" onclick="selectComboboxOption('hInspCatList',this)" data-value="${esc(c)}">${esc(c)}</div>`).join('');
    html += '<div class="home-insp">';
    html += '<div class="home-insp-title">💡 灵感速记 <span class="hint">随手记，保存后收入「灵感记录」</span></div>';
    html += '<div class="home-insp-row">';
    html += '<input type="text" class="form-input" id="hInspTheme" placeholder="灵感主题">';
    html += '<div class="combobox-wrapper home-insp-combo"><input type="text" class="form-input combobox-input" id="hInspCat" placeholder="请选择或输入制品" onfocus="showComboboxDropdown(\'hInspCatList\')" onclick="showComboboxDropdown(\'hInspCatList\')" oninput="filterComboboxDropdown(\'hInspCatList\',this.value)"><button type="button" class="combobox-toggle" onclick="toggleComboboxDropdown(\'hInspCatList\')">▼</button><div class="combobox-dropdown" id="hInspCatList">' + hCatOpts + '</div></div>';
    html += '</div>';
    html += '<textarea class="form-input home-insp-textarea" id="hInspThoughts" placeholder="文字思路…"></textarea>';
    html += '<div class="home-insp-actions"><button class="btn btn-primary" onclick="homeAddInspiration()">保存灵感</button></div>';
    html += '</div>';
  } else if (ps.view === 'platform') {
    // Platform view: 当前平台记录 + 状态筛选 + 分页列表 + 图表统计
    const records = allRecords.filter(r => valIncludes(r.platform, ps.tab));

    // Toolbar
    html += '<div class="toolbar" style="margin-top:4px">';
    html += `<div class="search-box"><input type="text" placeholder="搜索标题..." value="${esc(ps.search)}" oninput="homeSearch(this.value)"><span class="search-icon">🔍</span></div>`;
    html += `<input type="date" class="filter-select" value="${ps.dateFilter}" onchange="homeDateFilter(this.value)" style="padding:8px" placeholder="请选择日期" title="请选择日期">`;
    html += `<button class="filter-select" onclick="homeClearFilter()" style="cursor:pointer;border:1px solid var(--c-border)">清除筛选</button>`;
    html += '<div class="spacer"></div>';
    html += '<button class="btn btn-primary" onclick="openAddForm(\'home\')">+ 新增记录</button>';
    html += '</div>';

    html += renderHomeStatusFilterBar();

    // Records（v223：待发布/已发布筛选与全部列表使用同一模块）
    let filteredRecords = records;
    if (ps.statusFilter) filteredRecords = filteredRecords.filter(r => statusOf(r) === ps.statusFilter);
    if (ps.search) filteredRecords = filteredRecords.filter(r => (r.title || '').toLowerCase().includes(ps.search.toLowerCase()));
    if (ps.dateFilter) filteredRecords = filteredRecords.filter(r => (r.publishTime || '').startsWith(ps.dateFilter));
    filteredRecords.sort((a, b) => (b.publishTime || '').localeCompare(a.publishTime || ''));

    // Pagination
    if (ps.homePageNo == null) ps.homePageNo = 1;
    const homePageSize = 5;
    const homeTotalPages = Math.ceil(filteredRecords.length / homePageSize);
    if (ps.homePageNo > homeTotalPages) ps.homePageNo = 1;
    const homePaged = filteredRecords.slice((ps.homePageNo - 1) * homePageSize, ps.homePageNo * homePageSize);

    if (!filteredRecords.length) {
      html += '<div class="empty-state"><div class="empty-icon">📝</div><div class="empty-text">暂无发布记录</div></div>';
    } else {
      html += '<div class="record-list">';
      homePaged.forEach(r => { html += renderHomeRecordCard(r); });
      html += '</div>';
      if (homeTotalPages > 1) {
        html += '<div class="pagination">';
        html += `<button class="btn btn-sm btn-ghost" ${ps.homePageNo <= 1 ? 'disabled' : ''} onclick="homeGoPage(${ps.homePageNo - 1})">‹ 上一页</button>`;
        html += `<span class="page-info">第 ${ps.homePageNo} / ${homeTotalPages} 页 (共 ${filteredRecords.length} 条)</span>`;
        html += `<button class="btn btn-sm btn-ghost" ${ps.homePageNo >= homeTotalPages ? 'disabled' : ''} onclick="homeGoPage(${ps.homePageNo + 1})">下一页 ›</button>`;
        html += '</div>';
      }
    }

    // Chart (above stats at bottom)
    html += '<div class="stats-divider"></div>';
    html += renderAnnualChart(records, 'publishTime', { title: ps.tab + '年度发布', isCount: true, color: PLATFORM_COLORS[ps.tab] || '#9DC8FF' });

    // Stats: only current platform
    html += renderStatsSection([
      { label: ps.tab + '发布数', value: records.length, sub: '当前平台' },
    ], ps.tab + '统计');
  }

  html += '</div>';
  body.innerHTML = html;
}

function renderHomeRecordCard(r) {
  let html = `<div class="record-card record-card-minimal" onclick="openDetail('home','${r.id}')">`;
  html += '<div class="record-card-header">';
  html += '<div class="record-card-title">' + esc(r.title || '未命名') + '</div>';
  html += '<div class="record-card-actions">';
  html += `<span class="btn-icon" onclick="event.stopPropagation();openEditForm('home','${r.id}')">✏️</span>`;
  html += `<span class="btn-icon danger" onclick="event.stopPropagation();onDelete('home','${r.id}')">🗑️</span>`;
  html += '</div></div>';
  html += '<div class="record-card-body-minimal">';
  const platforms = arrVal(r.platform);
  platforms.forEach(p => {
    const pColor = PLATFORM_COLORS[p] || '#9DC8FF';
    html += `<span class="field"><span class="field-label">平台:</span><span class="tag" style="background:${pColor}20;color:${pColor}">${esc(p)}</span></span>`;
  });
  const ct = arrVal(r.contentType);
  html += `<span class="field"><span class="field-label">内容类型:</span><span class="field-value">${esc(ct.join('、') || '-')}</span></span>`;
  html += `<span class="field"><span class="field-label">发布时间:</span><span class="field-value">${fmtDate(r.publishTime)}</span></span>`;
  html += '</div></div>';
  return html;
}

function enterPlatformView(tab) {
  const ps = pageState.home;
  if (ps.view === 'platform' && ps.tab === tab && !ps.statusFilter) {
    ps.view = 'main';
  } else {
    ps.tab = tab;
    ps.view = 'platform';
    ps.statusFilter = '';
    ps.search = '';
    ps.dateFilter = '';
    ps.homePageNo = 1;
  }
  renderHome();
}
function homeBackToMain() { pageState.home.view = 'main'; pageState.home.statusFilter = ''; renderHome(); }
function homeSearch(val) { pageState.home.search = val; pageState.home.homePageNo = 1; clearTimeout(_homeSearchTimer); _homeSearchTimer = setTimeout(renderHome, 200); }
function homeDateFilter(val) { pageState.home.dateFilter = val; pageState.home.homePageNo = 1; renderHome(); }
function homeClearFilter() { pageState.home.search = ''; pageState.home.dateFilter = ''; pageState.home.homePageNo = 1; renderHome(); }
function homeGoPage(pageNo) { pageState.home.homePageNo = pageNo; renderHome(); }
function homeSetStatusFilter(s) {
  const ps = pageState.home;
  if (!ps) pageState.home = {};
  if (ps.statusFilter === s) { ps.statusFilter = ''; }
  else { ps.statusFilter = s; ps.search = ''; ps.dateFilter = ''; }
  ps.homePageNo = 1;
  renderHome();
}
function homeSetPlatformStatusFilter(platform, s) {
  const ps = pageState.home;
  if (!ps) pageState.home = {};
  ps.tab = platform || '';
  ps.view = 'platform';
  // v223: 再次点击同一状态按钮则返回该平台全部记录
  if (ps.statusFilter === s) { ps.statusFilter = ''; }
  else { ps.statusFilter = s || ''; ps.search = ''; ps.dateFilter = ''; }
  ps.homePageNo = 1;
  renderHome();
}
// 平台「待发布 / 已发布」筛选按钮（v223：仅在平台模块内展示，点击已选中项返回全部）
function renderHomeStatusFilterBar() {
  const ps = pageState.home || {};
  const allRecords = DB.list('publishRecords');
  const statusOf = (r) => (r.status === '已发布' ? '已发布' : '待发布');
  const scopeRecords = ps.tab ? allRecords.filter(r => valIncludes(r.platform, ps.tab)) : allRecords;
  const pendingCount = scopeRecords.filter(r => statusOf(r) === '待发布').length;
  const publishedCount = scopeRecords.filter(r => statusOf(r) === '已发布').length;
  const sf = ps.statusFilter;
  const onPending = ps.tab ? `homeSetPlatformStatusFilter('${ps.tab}','待发布')` : `homeSetStatusFilter('待发布')`;
  const onPublished = ps.tab ? `homeSetPlatformStatusFilter('${ps.tab}','已发布')` : `homeSetStatusFilter('已发布')`;
  let h = '<div class="home-status-filter">';
  h += `<button class="home-status-btn ${sf === '待发布' ? 'active pending' : ''}" onclick="${onPending}">待发布 <b>${pendingCount}</b></button>`;
  h += `<button class="home-status-btn ${sf === '已发布' ? 'active published' : ''}" onclick="${onPublished}">已发布 <b>${publishedCount}</b></button>`;
  h += '</div>';
  return h;
}

// v29: 首页灵感速记 → 写入 inspirations（首页不展示，进入「美工·灵感记录」）
function homeAddInspiration() {
  const theme = (document.getElementById('hInspTheme') || {}).value || '';
  const category = (document.getElementById('hInspCat') || {}).value || '';
  const thoughts = (document.getElementById('hInspThoughts') || {}).value || '';
  if (!theme.trim() && !category.trim() && !thoughts.trim()) { Toast.info('请先填写灵感内容'); return; }
  DB.add('inspirations', {
    theme: theme.trim(),
    category: category.trim(),
    thoughts: thoughts.trim(),
    tags: [], images: [], source: '首页速记',
    createTime: todayStr()
  });
  Toast.success('灵感已保存');
  ['hInspTheme', 'hInspCat', 'hInspThoughts'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
}
function homeCalNav(dir) {
  const ps = pageState.home;
  if (dir === 0) { const n = new Date(); ps.calYear = n.getFullYear(); ps.calMonth = n.getMonth(); }
  else { ps.calMonth += dir; if (ps.calMonth < 0) { ps.calMonth = 11; ps.calYear--; } if (ps.calMonth > 11) { ps.calMonth = 0; ps.calYear++; } }
  renderHome();
}

/* ===== Price Calculator ===== */
function renderPriceCalc() {
  const body = $('#mainBody');
  const templates = DB.list('calcTemplates');
  const history = DB.list('calcRecords').sort((a, b) => (b._ct || 0) - (a._ct || 0)).slice(0, 5);
  let html = '<div class="fade-in calc-page">';
  html += '<div class="calc-page-grid">';
  // Left: Input column
  html += '<div class="calc-input-col">';
  html += '<div class="calc-card"><div class="calc-card-title price-calc-title">成本参数 <span class="calc-card-hint">输入各项成本自动计算</span></div>';
  html += '<div class="form-row"><label class="form-label">单品成本（元）</label><input type="number" class="form-input" id="calc_itemCost" value="" placeholder="0" oninput="calcPrice()"></div>';
  html += '<div class="form-row"><label class="form-label">样品成本（元）</label><input type="number" class="form-input" id="calc_sampleCost" value="" placeholder="0" oninput="calcPrice()"></div>';
  html += '<div class="form-row"><label class="form-label">人工成本（元/件）</label><input type="number" class="form-input" id="calc_laborCost" value="" placeholder="0" oninput="calcPrice()"></div>';
  html += '<div class="form-row"><label class="form-label">运费（元/件）</label><input type="number" class="form-input" id="calc_shipping" value="" placeholder="0" oninput="calcPrice()"></div>';
  html += '<div class="form-row"><label class="form-label">抽成比例（%）</label><input type="number" class="form-input" id="calc_commissionRate" value="" placeholder="0" oninput="calcPrice()"></div>';
  html += '<div class="form-row"><label class="form-label">预期利润率（%）</label><input type="number" class="form-input" id="calc_profitMargin" value="30" oninput="calcPrice()"></div>';
  html += '<div class="form-row"><label class="form-label">开团数量</label><input type="number" class="form-input" id="calc_quantity" value="100" oninput="calcPrice()"></div>';
  html += '<div class="form-row"><label class="form-label">模板名称</label><input type="text" class="form-input" id="calc_templateName" placeholder="保存为模板便于复用"></div>';
  html += '<div style="display:flex;gap:8px;margin-top:12px">';
  html += '<button class="btn btn-primary" onclick="saveCalcTemplate()">💾 保存模板</button>';
  html += '<button class="btn btn-outline" onclick="saveCalcHistory()">📋 保存记录</button>';
  html += '</div></div>';
  html += '</div>';
  // Right: Receipt column
  html += '<div class="calc-receipt-col">';
  html += '<div class="calc-receipt" id="calcResult"></div>';
  html += '<div class="calc-card"><div class="calc-card-title">📋 常用模板</div>';
  if (templates.length) {
    html += '<div class="template-list">';
    templates.forEach((t, i) => {
      html += `<div class="template-item" onclick="loadCalcTemplate('${t.id}')"><span class="template-name">${esc(t.name || '模板' + (i + 1))}</span><div class="template-actions"><button class="btn-icon danger" onclick="event.stopPropagation();deleteCalcTemplate('${t.id}')">🗑️</button></div></div>`;
    });
    html += '</div>';
  } else { html += '<div style="font-size:12px;color:var(--c-text-muted);padding:8px">暂无模板</div>'; }
  html += '</div>';
  html += '<div class="calc-card"><div class="calc-card-title">🕐 历史计算</div>';
  if (history.length) {
    html += '<div class="template-list">';
    history.forEach(h => {
      html += `<div class="template-item" onclick="loadCalcHistory('${h.id}')"><span class="template-name">${esc(h.name || '记录')} · 售价¥${h.salePrice || '?'}</span><span style="font-size:11px;color:var(--c-text-muted)">${fmtDate(new Date(h._ct).toISOString())}</span></div>`;
    });
    html += '</div>';
  } else { html += '<div style="font-size:12px;color:var(--c-text-muted);padding:8px">暂无历史</div>'; }
  html += '</div>';
  html += '</div>';
  html += '</div></div>';
  body.innerHTML = html;
  calcPrice();
}
function calcPrice() {
  const get = id => parseFloat($(id).value) || 0;
  const itemCost = get('#calc_itemCost'), sampleCost = get('#calc_sampleCost'), laborCost = get('#calc_laborCost');
  const shipping = get('#calc_shipping'), commissionRate = get('#calc_commissionRate'), profitMargin = get('#calc_profitMargin') / 100;
  const quantity = get('#calc_quantity') || 1;
  const perSampleCost = sampleCost / quantity;
  const unitCost = itemCost + perSampleCost + laborCost + shipping;
  const commission = unitCost * commissionRate / 100;
  const salePrice = Math.ceil((unitCost + commission) * (1 + profitMargin) * 100) / 100;
  const unitProfit = salePrice - unitCost - commission;
  const r = $('#calcResult'); if (!r) return;
  r.innerHTML = `
    <div class="dc-r-title">📊 成本计算</div>
    <div class="dc-r-section">
      <div class="dc-r-sub">成本明细（每件）</div>
      <div class="dc-rr"><span>单品成本</span><span>¥${itemCost.toFixed(2)}</span></div>
      <div class="dc-rr"><span>样品分摊/件</span><span>¥${perSampleCost.toFixed(2)}</span></div>
      <div class="dc-rr"><span>人工成本/件</span><span>¥${laborCost.toFixed(2)}</span></div>
      <div class="dc-rr"><span>运费/件</span><span>¥${shipping.toFixed(2)}</span></div>
      <div class="dc-rr"><span>抽成/件 (${commissionRate}%)</span><span>¥${commission.toFixed(2)}</span></div>
      <div class="dc-rr total"><span>综合单位成本</span><span>¥${unitCost.toFixed(2)}</span></div>
    </div>
    <div class="dc-r-section">
      <div class="dc-r-sub">利润分析</div>
      <div class="dc-rr"><span>单件利润</span><span>¥${unitProfit.toFixed(2)}</span></div>
      <div class="dc-rr"><span>整单利润 (${quantity}件)</span><span>¥${(unitProfit * quantity).toFixed(2)}</span></div>
      <div class="dc-rr"><span>总成本</span><span>¥${(unitCost * quantity).toFixed(2)}</span></div>
      <div class="dc-rr"><span>总营收</span><span>¥${(salePrice * quantity).toFixed(2)}</span></div>
    </div>
    <div class="dc-r-final">
      <div class="dc-r-final-label">建议售价</div>
      <div class="dc-r-final-val">¥${salePrice.toFixed(2)}</div>
    </div>`;
}
function readCalcData(name) {
  const get = id => parseFloat($(id).value) || 0;
  const itemCost = get('#calc_itemCost'), sampleCost = get('#calc_sampleCost'), laborCost = get('#calc_laborCost');
  const shipping = get('#calc_shipping'), commissionRate = get('#calc_commissionRate'), profitMargin = get('#calc_profitMargin') / 100;
  const quantity = get('#calc_quantity') || 1;
  const unitCost = itemCost + sampleCost / quantity + laborCost + shipping;
  const salePrice = Math.ceil((unitCost + unitCost * commissionRate / 100) * (1 + profitMargin) * 100) / 100;
  return { name, itemCost, sampleCost, laborCost, shipping, commissionRate, profitMargin: profitMargin * 100, quantity, unitCost, salePrice };
}
function saveCalcTemplate() { DB.add('calcTemplates', readCalcData($('#calc_templateName').value || '模板' + (DB.list('calcTemplates').length + 1))); Toast.success('模板已保存'); renderPriceCalc(); }
function saveCalcHistory() { DB.add('calcRecords', readCalcData($('#calc_templateName').value || '计算记录')); Toast.success('记录已保存'); renderPriceCalc(); }
function loadCalcTemplate(id) { const t = DB.getById('calcTemplates', id); if (!t) return; $('#calc_itemCost').value = t.itemCost||''; $('#calc_sampleCost').value=t.sampleCost||''; $('#calc_laborCost').value=t.laborCost||''; $('#calc_shipping').value=t.shipping||''; $('#calc_commissionRate').value=t.commissionRate||''; $('#calc_profitMargin').value=t.profitMargin||30; $('#calc_quantity').value=t.quantity||100; $('#calc_templateName').value=t.name||''; calcPrice(); Toast.info('已加载模板'); }
function loadCalcHistory(id) { loadCalcTemplate(id); Toast.info('已加载历史记录'); }
function deleteCalcTemplate(id) { DB.remove('calcTemplates', id); Toast.success('已删除'); renderPriceCalc(); }

/* ===== OC Timeline — 时间轨迹 (需求4) ===== */
const TIMELINE_COLORS = {
  '红': { color: '#e74c3c', label: '重要' },
  '橙': { color: '#fa8c16', label: '较重要' },
  '绿': { color: '#27ae60', label: '一般' },
  '蓝': { color: '#3498db', label: '次要' },
};
function renderTimeline() {
  const body = $('#mainBody');
  if (!pageState['oc-timeline']) pageState['oc-timeline'] = { search: '', filters: {}, colorFilter: null, personFilter: null, pageNo: 1 };
  const ps = pageState['oc-timeline'];
  let records = DB.list('ocTimeline');
  const chars = DB.list('ocCharacters');
  if (ps.search) records = records.filter(r => JSON.stringify(r).toLowerCase().includes(ps.search.toLowerCase()));

  // Filter by color
  if (ps.colorFilter) {
    records = records.filter(r => valIncludes(r.importance, ps.colorFilter));
  }
  // Filter by person
  if (ps.personFilter) {
    const pf = ps.personFilter;
    records = records.filter(r => {
      const val = r.characterIds;
      if (Array.isArray(val)) return val.includes(pf);
      return val === pf;
    });
  }

  // Sort by date descending (newest first)
  records.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  let html = '<div class="fade-in">';
  // Person name buttons (text only) — at very top (like stories page)
  // v16: 全部按钮常驻，即使没有人物档案也显示
  html += '<div class="relation-person-row">';
  html += `<div class="relation-person-btn ${!ps.personFilter ? 'active' : ''}" onclick="timelinePersonFilter('')"><span>📋 全部</span></div>`;
  html += '<div class="relation-person-grid collapsed distribute">';
  chars.forEach(c => {
    const active = ps.personFilter === c.name ? 'active' : '';
    html += `<div class="relation-person-btn ${active}" onclick="timelinePersonFilter('${esc(c.name)}')"><span>${esc(c.name)}</span></div>`;
  });
  html += '</div>';
  html += '<button class="relation-toggle-btn" onclick="togglePersonGrid(this)">展开 ▾</button>';
  html += '</div>';
  // Toolbar
  html += '<div class="toolbar">';
  html += `<div class="search-box"><input type="text" placeholder="搜索事件..." value="${esc(ps.search)}" oninput="onSearch('oc-timeline', this.value)"><span class="search-icon">🔍</span></div>`;
  html += '<div class="spacer"></div>';
  html += '<button class="btn btn-outline toolbar-eq" onclick="importStoriesToTimeline()">📥 导入故事小记</button>';
  html += '<button class="btn btn-primary" onclick="openAddForm(\'oc-timeline\')">+ 新增事件</button>';
  html += '</div>';

  // Color filter buttons — v32 圆角胶囊单选，选中带 ✓
  html += '<div class="timeline-filter-bar">';
  Object.keys(TIMELINE_COLORS).forEach(c => {
    const tc = TIMELINE_COLORS[c];
    const active = ps.colorFilter === c;
    const cls = active ? ' active' : '';
    html += `<div class="timeline-color-filter${cls}" data-color="${esc(c)}" onclick="timelineColorFilter('${esc(c)}')"><span class="timeline-color-label">${esc(tc.label)}</span></div>`;
  });
  html += '</div>';

  // Timeline
  if (!records.length) {
    html += '<div class="empty-state"><div class="empty-icon">🕐</div><div class="empty-text">暂无时间线记录</div></div>';
  } else {
    html += '<div class="timeline-container">';
    records.forEach(r => {
      const impArr = arrVal(r.importance);
      const imp = impArr[0] || '绿';
      const impInfo = TIMELINE_COLORS[imp] || TIMELINE_COLORS['绿'];
      html += `<div class="timeline-item importance-${imp === '红' ? 'red' : imp === '橙' ? 'orange' : imp === '绿' ? 'green' : 'blue'}">`;
      html += `<div class="timeline-time">${fmtDate(r.date)}</div>`;
      html += '<div class="timeline-axis"></div>';
      html += '<div class="timeline-content">';
      html += `<div class="timeline-event-title">${esc(r.title || '未命名事件')}</div>`;
      if (r.description) html += `<div class="timeline-event-desc">${esc(r.description)}</div>`;
      html += '<div class="timeline-event-meta">';
      html += `<span class="tag" style="background:${impInfo.color}20;color:${impInfo.color}">${esc(impInfo.label)}</span>`;
      const charIds = arrVal(r.characterIds);
      if (charIds.length) {
        charIds.forEach(c => html += `<span class="tag tag-info">${esc(c)}</span>`);
      }
      html += '</div>';
      html += '<div style="margin-top:6px;display:flex;gap:4px">';
      html += `<span class="btn-icon" style="font-size:12px;width:24px;height:24px" onclick="event.stopPropagation();openEditForm('oc-timeline','${r.id}')">✏️</span>`;
      html += `<span class="btn-icon danger" style="font-size:12px;width:24px;height:24px" onclick="event.stopPropagation();onDelete('oc-timeline','${r.id}')">🗑️</span>`;
      html += '</div>';
      html += '</div></div>';
    });
    html += '</div>';
  }
  html += '</div>';
  body.innerHTML = html;
}

function timelineColorFilter(color) {
  const ps = pageState['oc-timeline'];
  ps.colorFilter = (ps.colorFilter === color || !color) ? null : color;
  renderTimeline();
}
function timelinePersonFilter(name) {
  const ps = pageState['oc-timeline'];
  ps.personFilter = name || null;
  renderTimeline();
}

/* Import stories as timeline events (下拉框选择) */
function importStoriesToTimeline() {
  const stories = DB.list('ocStories');
  if (!stories.length) { Toast.warning('暂无故事小记可导入'); return; }
  const chars = DB.list('ocCharacters');
  const timelineEvents = DB.list('ocTimeline');
  // v228: 已导入过的故事小记不再显示
  const importedTitles = new Set(timelineEvents.filter(t => t.source && t.source.startsWith('故事小记: ')).map(t => t.source));
  const availableStories = stories.filter(s => !importedTitles.has('故事小记: ' + (s.title || '')));
  if (!availableStories.length) { Toast.warning('所有故事小记都已导入过'); return; }
  let html = '';
  // v228: 改为 combobox 下拉选择器，支持手动输入筛选
  const storyOpts = availableStories.map(s => {
    const charNames = arrVal(s.characterIds).map(cid => {
      const c = chars.find(ch => ch.name === cid);
      return c ? c.name : cid;
    });
    const label = (s.title || '未命名') + ' (' + fmtDate(s.createTime) + ' · ' + charNames.join('、') + ')';
    return `<div class="combobox-option" onclick="document.getElementById('importStorySelect').value='${esc(s.id)}';document.getElementById('importStoryInput').value='${esc(label)}'" data-value="${esc(s.id)}">${esc(label)}</div>`;
  }).join('');
  html += '<div><div style="font-size:13px;margin-bottom:6px">选择故事小记</div>';
  html += '<div class="form-row"><div class="combobox-wrapper import-story-combo">';
  html += '<input type="hidden" id="importStorySelect" class="combobox-value" value="">';
  html += '<input type="text" class="form-input combobox-input" id="importStoryInput" placeholder="请选择或输入故事小记" onfocus="showComboboxDropdown(\'importStoryList\')" onclick="showComboboxDropdown(\'importStoryList\')" oninput="filterComboboxDropdown(\'importStoryList\',this.value)">';
  html += '<button type="button" class="combobox-toggle" onclick="toggleComboboxDropdown(\'importStoryList\')">▼</button>';
  html += '<div class="combobox-dropdown" id="importStoryList">' + storyOpts + '</div>';
  html += '</div></div></div>';
  const impDef = '红';
  const impOpts = Object.keys(TIMELINE_COLORS).map(c => {
    const tc = TIMELINE_COLORS[c];
    return `<div class="combobox-option" onclick="document.getElementById('importImportanceValue').value='${esc(c)}';document.getElementById('importImportanceInput').value='${esc(tc.label)}'" data-value="${esc(c)}">${esc(tc.label)}</div>`;
  }).join('');
  html += `<div style="margin-top:12px"><div style="font-size:13px;margin-bottom:6px">重要性</div>`;
  html += '<div class="combobox-wrapper import-importance-combo">';
  html += `<input type="hidden" id="importImportanceValue" class="combobox-value" value="${esc(impDef)}">`;
  html += `<input type="text" class="form-input combobox-input" id="importImportanceInput" value="${esc(TIMELINE_COLORS[impDef].label)}" readonly onclick="showComboboxDropdown('importImportanceList')" onfocus="showComboboxDropdown('importImportanceList')">`;
  html += '<button type="button" class="combobox-toggle" onclick="toggleComboboxDropdown(\'importImportanceList\')">▼</button>';
  html += `<div class="combobox-dropdown" id="importImportanceList">${impOpts}</div>`;
  html += '</div></div>';
  openModal('导入故事小记', html, [
    { label: '取消', class: 'btn-ghost', action: closeModal },
    { label: '导入', class: 'btn-primary', action: () => {
      const storyId = $('#importStorySelect').value;
      const imp = $('#importImportanceValue').value;
      if (!storyId) { Toast.warning('请选择故事小记'); return; }
      const story = availableStories.find(s => s.id === storyId);
      if (!story) { Toast.warning('故事不存在'); return; }
      // Check if already imported
      const existing = DB.list('ocTimeline').find(t => t.source === '故事小记: ' + (story.title || ''));
      if (existing) { Toast.warning('该故事已导入过'); return; }
      DB.add('ocTimeline', {
        date: story.createTime || todayStr(),
        title: story.title || '未命名事件',
        description: (story.content || '').slice(0, 500),
        importance: [imp],
        characterIds: story.characterIds || [],
        source: '故事小记: ' + (story.title || ''),
      });
      closeModal();
      Toast.success('已导入 1 条事件');
      renderTimeline();
    }},
  ], 'import-story');
}

/* ===== OC Relations — Mind Map (需求10: 箭头标明, 档案社会关系自动同步, 缩略姓名按钮) ===== */
const RELATION_COLORS = {
  '母女': '#ff9f43', '母子': '#ff9f43', '父女': '#ff9f43', '父子': '#ff9f43',
  '姐妹': '#ff9f43', '姐弟': '#ff9f43', '兄妹': '#ff9f43', '兄弟': '#ff9f43',
  '表亲': '#ffb380', '堂亲': '#ffb380',
  '师徒': '#faad14', '道侣': '#ff6b81', '好友': '#7ec678',
  '同门': '#9DC8FF', '交好': '#95de64', '敌对': '#e8857e', '上下级': '#722ed1',
  '亲属': '#ff9f43', '恋人': '#ff6b81', '自动同步': '#b0b8c0',
};
function renderRelations() {
  const body = $('#mainBody');
  const chars = DB.list('ocCharacters');
  const relations = DB.list('ocRelations');
  let html = '<div class="fade-in">';
  html += '<div class="toolbar"><div class="spacer"></div>';
  html += '<button class="btn btn-primary" onclick="openAddForm(\'oc-relations\')">+ 新增关系</button></div>';
  // v30-fix: 自定义关系类型管理放回「关系类型」字段内，不再外置独立卡片
  if (chars.length === 0) {
    html += '<div class="empty-state"><div class="empty-icon">🔗</div><div class="empty-text">请先在「人物档案」中添加OC人物</div></div>';
  } else {
    // Mind map (with zoom controls)
    html += '<div class="mindmap-container" id="mindmapContainer">';
    html += '<div class="mindmap-zoom-controls">';
    html += '<button class="mindmap-zoom-btn" onclick="mmZoom(1.2)" title="放大">＋</button>';
    html += '<button class="mindmap-zoom-btn" onclick="mmZoom(1/1.2)" title="缩小">－</button>';
    html += '<button class="mindmap-zoom-btn" onclick="mmZoomReset()" title="重置">⊙</button>';
    html += '</div>';
    html += '<div class="mindmap-hint">双指捏合缩放 · 单指拖动平移</div>';
    html += '<div class="mindmap-canvas-wrapper" id="mindmapCanvas"></div>';
    html += '</div>';
    // Person buttons (缩略为姓名按钮可展开)
    if (chars.length) {
      html += '<div style="margin-top:16px"><div style="font-size:13px;font-weight:600;color:var(--c-primary-dark);margin-bottom:8px">👥 人物关系快捷查看</div>';
      html += '<div class="relation-person-row">';
      html += '<div class="relation-person-btn active" onclick="clearPersonRelations()"><span>📋 全部</span></div>';
      html += '<div class="relation-person-grid collapsed distribute">';
      chars.forEach(c => {
        html += `<div class="relation-person-btn" onclick="togglePersonRelations('${esc(c.name)}', this)"><span>${esc(c.name)}</span></div>`;
      });
      html += '</div>';
      html += '<button class="relation-toggle-btn" onclick="togglePersonGrid(this)">展开 ▾</button>';
      html += '</div>';
      html += '<div id="personRelationsExpand" class="relation-expand"></div>';
      html += '</div>';
    }
    // Relations list (two-column, paginated)
    if (relations.length) {
      if (!pageState['oc-relations']) pageState['oc-relations'] = { pageNo: 1 };
      const ps = pageState['oc-relations'];
      const pageSize = 10;
      const totalPages = Math.ceil(relations.length / pageSize);
      if (ps.pageNo > totalPages) ps.pageNo = 1;
      const pageNo = ps.pageNo || 1;
      const pagedRelations = relations.slice((pageNo - 1) * pageSize, pageNo * pageSize);
      html += '<div class="record-list two-col" style="margin-top:16px">';
      pagedRelations.forEach(r => {
        html += `<div class="record-card" onclick="openDetail('oc-relations','${r.id}')">`;
        html += '<div class="record-card-header"><div class="record-card-title">';
        html += `${esc(r.charA)} <span style="color:var(--c-text-muted)">↔</span> ${esc(r.charB)}`;
        html += '</div><div class="record-card-actions">';
        html += `<span class="btn-icon" onclick="event.stopPropagation();openEditForm('oc-relations','${r.id}')">✏️</span>`;
        html += `<span class="btn-icon danger" onclick="event.stopPropagation();onDelete('oc-relations','${r.id}')">🗑️</span>`;
        html += '</div></div>';
        html += '<div class="record-card-body">';
        const rtArr = arrVal(r.relationType);
        rtArr.forEach(rt => { html += `<span class="field"><span class="tag tag-purple">${esc(rt)}</span></span>`; });
        const rsArr = arrVal(r.relationStatus);
        rsArr.forEach(rs => { html += `<span class="field"><span class="tag tag-info">${esc(rs)}</span></span>`; });
        if (r.relationDetail) html += `<span class="field"><span class="field-value">${esc(r.relationDetail)}</span></span>`;
        html += '</div></div>';
      });
      html += '</div>';
      if (totalPages > 1) {
        html += '<div class="pagination">';
        html += `<button class="btn btn-sm btn-ghost" ${pageNo <= 1 ? 'disabled' : ''} onclick="goRelationPage(${pageNo - 1})">‹ 上一页</button>`;
        html += `<span class="page-info">第 ${pageNo} / ${totalPages} 页 (共 ${relations.length} 条)</span>`;
        html += `<button class="btn btn-sm btn-ghost" ${pageNo >= totalPages ? 'disabled' : ''} onclick="goRelationPage(${pageNo + 1})">下一页 ›</button>`;
        html += '</div>';
      }
    }
  }
  html += '</div>';
  body.innerHTML = html;
  if (chars.length > 0) drawMindMap(chars, relations);
}

function goRelationPage(pageNo) {
  if (!pageState['oc-relations']) pageState['oc-relations'] = { pageNo: 1 };
  pageState['oc-relations'].pageNo = pageNo;
  renderRelations();
}

function togglePersonGrid(btn) {
  const grid = btn.previousElementSibling;
  if (!grid || !grid.classList.contains('relation-person-grid')) return;
  const collapsed = grid.classList.toggle('collapsed');
  btn.textContent = collapsed ? '展开 ▾' : '收起 ▴';
}
function clearPersonRelations() {
  $$('.relation-person-btn').forEach(b => b.classList.remove('active'));
  const expand = $('#personRelationsExpand');
  if (expand) { expand.classList.remove('show'); expand.dataset.current = ''; expand.innerHTML = ''; }
}
function togglePersonRelations(name, btn) {
  $$('.relation-person-btn').forEach(b => b.classList.remove('active'));
  const expand = $('#personRelationsExpand');
  if (expand.dataset.current === name) {
    expand.classList.remove('show');
    expand.dataset.current = '';
    return;
  }
  btn.classList.add('active');
  expand.dataset.current = name;
  const chars = DB.list('ocCharacters');
  const relations = DB.list('ocRelations');
  const char = chars.find(c => c.name === name);
  if (!char) return;
  let html = `<div style="font-weight:600;margin-bottom:6px">${esc(name)}的关系网络</div>`;
  // Explicit relations
  const myRels = relations.filter(r => r.charA === name || r.charB === name);
  if (myRels.length) {
    html += '<div style="margin-bottom:8px"><b>显式关系:</b></div>';
    myRels.forEach(r => {
      const other = r.charA === name ? r.charB : r.charA;
      const rtArr = arrVal(r.relationType);
      const rsArr = arrVal(r.relationStatus);
      rtArr.forEach(rt => {
        const color = RELATION_COLORS[rt] || '#b0b8c0';
        html += `<div style="padding:4px 0"><span class="tag" style="background:${color}20;color:${color}">${esc(rt)}</span> → <b>${esc(other)}</b> (${esc(rsArr.join('、'))})</div>`;
      });
    });
  }
  // Auto-synced from profile social fields
  const socialFields = [
    { key: 'parents', type: '亲属' }, { key: 'siblings', type: '亲属' },
    { key: 'master', type: '师徒' }, { key: 'companion', type: '道侣' },
    { key: 'friends', type: '好友' }, { key: 'fellow', type: '同门' },
  ];
  const autoRels = [];
  socialFields.forEach(sf => {
    const val = char[sf.key];
    if (val) {
      const targets = chars.filter(c => c.name !== name && (val.includes(c.name) || (c.alias && val.includes(c.alias))));
      targets.forEach(t => autoRels.push({ name: t.name, type: sf.type, field: sf.key }));
    }
  });
  if (autoRels.length) {
    html += '<div style="margin:8px 0"><b>档案自动同步:</b></div>';
    autoRels.forEach(ar => {
      const color = RELATION_COLORS[ar.type] || '#b0b8c0';
      html += `<div style="padding:4px 0"><span class="tag" style="background:${color}20;color:${color}">${esc(ar.type)}</span> → <b>${esc(ar.name)}</b> <span style="font-size:10px;color:var(--c-text-muted)">(档案同步)</span></div>`;
    });
  }
  if (!myRels.length && !autoRels.length) html += '<div style="color:var(--c-text-muted)">暂无关系记录</div>';
  expand.innerHTML = html;
  expand.classList.add('show');
}

let _mmZoom = 1;
let _mmPanX = 0;
let _mmPanY = 0;
let _mmDragging = false;
let _mmLastX = 0;
let _mmLastY = 0;
let _mmPinchDist = 0;
let _mmPinchStartZoom = 1;

function mmApplyTransform() {
  const inner = $('#mindmapInner');
  if (inner) inner.style.transform = `translate(${_mmPanX}px,${_mmPanY}px) scale(${_mmZoom})`;
}

function mmInitDrag() {
  const canvas = $('#mindmapCanvas');
  if (!canvas) return;
  canvas.style.cursor = 'grab';
  canvas.onmousedown = function(e) {
    if (e.target.closest('.mindmap-node')) return;
    _mmDragging = true;
    _mmLastX = e.clientX;
    _mmLastY = e.clientY;
    canvas.style.cursor = 'grabbing';
    e.preventDefault();
  };
  document.addEventListener('mousemove', function(e) {
    if (!_mmDragging) return;
    _mmPanX += e.clientX - _mmLastX;
    _mmPanY += e.clientY - _mmLastY;
    _mmLastX = e.clientX;
    _mmLastY = e.clientY;
    mmApplyTransform();
  });
  document.addEventListener('mouseup', function() {
    if (_mmDragging) { _mmDragging = false; canvas.style.cursor = 'grab'; }
  });
  // Touch support — 双指捏合缩放 + 单指拖动 pan
  canvas.ontouchstart = function(e) {
    if (e.target.closest('.mindmap-node')) return;
    if (e.touches.length === 1) {
      _mmDragging = true;
      _mmPinchDist = 0;
      _mmLastX = e.touches[0].clientX;
      _mmLastY = e.touches[0].clientY;
    } else if (e.touches.length === 2) {
      // pinch start
      _mmDragging = false;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      _mmPinchDist = Math.hypot(dx, dy);
      _mmPinchStartZoom = _mmZoom;
    }
  };
  canvas.ontouchmove = function(e) {
    if (e.touches.length === 2) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      if (_mmPinchDist > 0 && dist > 0) {
        const ratio = dist / _mmPinchDist;
        _mmZoom = Math.min(3, Math.max(0.3, _mmPinchStartZoom * ratio));
        mmApplyTransform();
      }
      return;
    }
    if (!_mmDragging || e.touches.length !== 1) return;
    e.preventDefault();
    _mmPanX += e.touches[0].clientX - _mmLastX;
    _mmPanY += e.touches[0].clientY - _mmLastY;
    _mmLastX = e.touches[0].clientX;
    _mmLastY = e.touches[0].clientY;
    mmApplyTransform();
  };
  canvas.ontouchend = function(e) {
    if (e.touches.length === 0) {
      _mmDragging = false;
      _mmPinchDist = 0;
    }
  };
  canvas.ontouchcancel = function() {
    _mmDragging = false;
    _mmPinchDist = 0;
  };
}
function drawMindMap(chars, relations) {
  const canvas = $('#mindmapCanvas');
  if (!canvas) return;
  const container = $('#mindmapContainer');
  const w = Math.max(container.clientWidth - 40, 600);
  const h = 520;
  const cx = w / 2, cy = h / 2;
  const n = chars.length;
  const radius = Math.min(w, h) / 2 - 90;
  const positions = {};
  chars.forEach((c, i) => {
    const angle = (i / Math.max(n, 1)) * 2 * Math.PI - Math.PI / 2;
    positions[c.name] = { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
  });

  // Build all connections: explicit + auto-synced
  const allConnections = [];
  relations.forEach(r => {
    const types = arrVal(r.relationType);
    const type = types[0] || '关系';
    allConnections.push({ a: r.charA, b: r.charB, type, auto: false });
  });
  // Auto-sync from profile social fields
  const socialFields = [
    { key: 'parents', type: '亲属' }, { key: 'siblings', type: '亲属' },
    { key: 'master', type: '师徒' }, { key: 'companion', type: '道侣' },
    { key: 'friends', type: '好友' }, { key: 'fellow', type: '同门' },
  ];
  chars.forEach(c => {
    socialFields.forEach(sf => {
      const val = c[sf.key];
      if (val) {
        chars.forEach(t => {
          if (t.name !== c.name && (val.includes(t.name) || (t.alias && val.includes(t.alias)))) {
            const exists = allConnections.some(conn =>
              ((conn.a === c.name && conn.b === t.name) || (conn.a === t.name && conn.b === c.name)) && !conn.auto
            );
            if (!exists) allConnections.push({ a: c.name, b: t.name, type: sf.type, auto: true });
          }
        });
      }
    });
  });

  // Wrap everything in a zoomable inner div
  let inner = `<div class="mindmap-inner" id="mindmapInner" style="position:relative;width:${w}px;height:${h}px;transform-origin:center center;transform:translate(${_mmPanX}px,${_mmPanY}px) scale(${_mmZoom});transition:transform .15s">`;
  inner += `<svg class="mindmap-svg" width="${w}" height="${h}">`;
  allConnections.forEach(conn => {
    const a = positions[conn.a], b = positions[conn.b];
    if (!a || !b) return;
    const color = RELATION_COLORS[conn.type] || '#b0b8c0';
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dx = b.x - a.x, dy = b.y - a.y;
    const ctrlX = mx + dy * 0.15, ctrlY = my - dx * 0.15;
    const dashArray = conn.auto ? '4,3' : 'none';
    const opacity = conn.auto ? 0.4 : 0.6;
    // Adjust endpoints to circle edge (radius ~25, circular node 60px)
    const nodeR = 25;
    const angA = Math.atan2(a.y - cy, a.x - cx);
    const angB = Math.atan2(b.y - cy, b.x - cx);
    // Use direction from center to node, then offset
    const aDir = Math.atan2(b.y - a.y, b.x - a.x);
    const bDir = Math.atan2(a.y - b.y, a.x - b.x);
    const ax = a.x + nodeR * Math.cos(aDir), ay = a.y + nodeR * Math.sin(aDir);
    const bx = b.x + nodeR * Math.cos(bDir), by = b.y + nodeR * Math.sin(bDir);
    inner += `<path d="M${ax},${ay} Q${ctrlX},${ctrlY} ${bx},${by}" fill="none" stroke="${color}" stroke-width="2" opacity="${opacity}" stroke-dasharray="${dashArray}"/>`;
    // Arrow head at end
    const angle = Math.atan2(by - ctrlY, bx - ctrlX);
    const arrowSize = 8;
    const arx = bx - arrowSize * Math.cos(angle - 0.4);
    const ary = by - arrowSize * Math.sin(angle - 0.4);
    const arx2 = bx - arrowSize * Math.cos(angle + 0.4);
    const ary2 = by - arrowSize * Math.sin(angle + 0.4);
    inner += `<polygon points="${bx},${by} ${arx},${ary} ${arx2},${ary2}" fill="${color}" opacity="${opacity}"/>`;
    // Label on arrow
    inner += `<text x="${ctrlX}" y="${ctrlY}" text-anchor="middle" font-size="10" fill="${color}" style="paint-order:stroke;stroke:#fff;stroke-width:3" font-weight="600">${esc(conn.type)}</text>`;
  });
  inner += '</svg>';
  // Nodes (circular, text only — no images)
  chars.forEach(c => {
    const pos = positions[c.name];
    const nodeHTML = `<div class="mindmap-node circular" style="left:${pos.x - 25}px;top:${pos.y - 25}px" onclick="navigate('oc-profiles')" title="${esc(c.name)}">` +
      `<div style="width:44px;height:44px;border-radius:50%;background:var(--c-primary-bg);display:flex;align-items:center;justify-content:center;font-size:${(c.name||'?').length>3?'8px':(c.name||'?').length>2?'10px':'12px'};font-weight:700;color:var(--c-primary-dark);text-align:center;word-break:break-all;overflow:hidden;padding:2px">${esc(c.name || '?')}</div>` +
      '</div>';
    inner += nodeHTML;
  });
  inner += '</div>';
  canvas.innerHTML = inner;
  mmInitDrag();
}
function mmZoom(factor) {
  _mmZoom = Math.min(3, Math.max(0.3, _mmZoom * factor));
  mmApplyTransform();
}
function mmZoomReset() {
  _mmZoom = 1; _mmPanX = 0; _mmPanY = 0;
  mmApplyTransform();
}

/* ===== Design Quote Calculator (v10: 报价计算器) ===== */
const DC_USAGE = [
  { value: '自用', rate: 1.0 },
  { value: '无盈利', rate: 2.0 },
  { value: '商用', rate: 2.0 },
  { value: '买断', rate: 3.0 },
  { value: '企业', rate: 5.0 },
];
const DC_MODEL = [
  { value: 'none', label: '无同模', rate: 1.0 },
  { value: '改色+字', rate: 0.6 },
  { value: '改人+字/色', rate: 0.8 },
  { value: '改人', rate: 0.5 },
];
const DC_SET = [
  { value: 'set4', label: '同柄≥4种品类', rate: 0.9 },
  { value: 'set9', label: '同柄≥9种品类', rate: 0.8 },
];

// v-NEW: 制品行工厂（含行内同模类型/倍率字段）
function newProduct() {
  return { _pid: _dcProdSeq++, name: '', patternId: '', size: '', quantity: 1, price: 0, sameModel: false, sameModelType: '', sameModelRate: 1.0, urgent: false, setGroup: '' };
}
// v-NEW: 加价项目工厂（含绑定制品序号字段）
function newExtra() {
  return { name: '', quantity: 1, price: 0, bindSeq: 'none' };
}
// AS轮：修改加价工厂
function newModification() {
  return { modifyType: '', modifyCount: 1, modifyPrice: 0, note: '' };
}

let _dcMode = 'custom';
let _dcImportId = null;
let _dcProdSeq = 1;          // CX轮：制品稳定序号（用于手动SET分组）
let _dcProducts = [newProduct()];
let _dcExtras = [];
let _dcModifications = [];
let _dcCustomDiscs = DB.get('calcCustomDiscs', []); // {name, type:'rate'|'amount', value} — persisted
let _dcFanReduce = 0; // 同担/同推随机减价金额
let _dcWholeOrderUrgent = false; // 整单加急（默认关闭）
let _dcGlobalModelType = ''; // 全局同模类型（单选可空；默认不选择）

function renderDesignCalc() {
  const body = $('#mainBody');
  const settings = DB.get('calcSettings', {});
  // v228: 导入模式下整单加急由接稿记录决定，不要从 settings 覆盖
  if (_dcMode !== 'import') _dcWholeOrderUrgent = !!(settings && settings.wholeOrderUrgent);
  const commissions = DB.list('commissions');

  let html = '<div class="fade-in calc-page"><div class="calc-page-grid">';

  // === Left: Input ===
  html += '<div class="calc-input-col">';

  // Mode selector
  html += '<div class="calc-card">';
  html += '<div class="calc-card-title">录入模式</div>';
  html += '<div class="calc-mode-tabs">';
  html += `<button class="calc-mode-tab${_dcMode === 'custom' ? ' active' : ''}" onclick="dcSetMode('custom')">✏️ 自定义录入</button>`;
  html += `<button class="calc-mode-tab${_dcMode === 'import' ? ' active' : ''}" onclick="dcSetMode('import')">📥 导入接稿</button>`;
  html += '</div>';
  if (_dcMode === 'import') {
    // DU轮：已交付且交付日期距今超过7天的订单不显示在导入选项中
    const _today = new Date(); _today.setHours(0, 0, 0, 0);
    const isImportHidden = (c) => {
      if (!valIncludes(c.progress, '已交付') || !c.deliveredTime) return false;
      const d = new Date(c.deliveredTime);
      if (isNaN(d.getTime())) return false;
      return Math.floor((_today - d) / 86400000) > 7;
    };
    const visibleCommissions = commissions.filter(c => !isImportHidden(c));
    const selectedRec = _dcImportId ? visibleCommissions.find(c => c.id === _dcImportId) : null;
    const selectedLabel = selectedRec ? ((selectedRec.clientInfo || '未命名') + ' · ' + (selectedRec.acceptTime || '')) : '';
    const importOpts = visibleCommissions.map(c => {
      const label = (c.clientInfo || '未命名') + ' · ' + (c.acceptTime || '');
      return `<div class="combobox-option" onclick="dcImportRecord('${c.id}');document.getElementById('dcImportSelectInput').value='${esc(label)}';document.getElementById('dcImportSelectValue').value='${esc(c.id)}'" data-value="${esc(c.id)}">${esc(label)}</div>`;
    }).join('');
    html += '<div class="combobox-wrapper calc-import-combo">';
    html += `<input type="hidden" class="combobox-value" id="dcImportSelectValue" value="${esc(_dcImportId || '')}">`;
    html += `<input type="text" class="form-input combobox-input" id="dcImportSelectInput" value="${esc(selectedLabel)}" placeholder="请选择或输入接稿记录" onfocus="showComboboxDropdown('dcImportSelectList')" onclick="showComboboxDropdown('dcImportSelectList')" oninput="filterComboboxDropdown('dcImportSelectList',this.value)">`;
    html += '<button type="button" class="combobox-toggle" onclick="toggleComboboxDropdown(\'dcImportSelectList\')">▼</button>';
    html += '<div class="combobox-dropdown" id="dcImportSelectList"><div class="combobox-option" onclick="dcImportRecord(\'\');document.getElementById(\'dcImportSelectInput\').value=\'\';document.getElementById(\'dcImportSelectValue\').value=\'\'" data-value="">请选择接稿记录</div>' + importOpts + '</div>';
    html += '</div>';
  }
  html += '</div>';

  // Product list
  html += '<div class="calc-card">';
  html += '<div class="calc-card-title">制品列表 <span class="calc-card-hint">（单个柄图SET选完制品后，可点击「归为SET」归组）</span></div>';
  html += '<div class="dc-product-header"><span>序号</span><span>制品</span><span>柄图标识</span><span>价格</span><span>数量</span><span>加急</span><span>同模</span><span></span></div>';
  html += '<div id="dc-products"></div>';
  html += '<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;align-items:center">';
  html += '<button type="button" class="btn btn-outline btn-sm" onclick="dcAddProduct()">+ 添加制品</button>';
  html += '<button type="button" class="btn btn-danger btn-sm" onclick="dcClearProducts()">🗑️ 一键清除</button>';
  html += '<button type="button" class="btn btn-primary btn-sm" onclick="dcMakeSet()">🏷️ 归为SET</button>';
  html += '<span id="dc-sel-hint" style="font-size:12px;color:var(--c-text-muted)"></span>';
  html += '</div>';
  html += '</div>';

  // Extra items
  html += '<div class="calc-card">';
  html += '<div class="calc-card-title">加价项目 <span class="calc-card-hint">（不参与同模计价）</span></div>';
  html += '<div class="dc-extra-header"><span>绑定制品</span><span>加价项目</span><span>数量</span><span>单价</span><span></span></div>';
  html += '<div id="dc-extras"></div>';
  html += '<button type="button" class="btn btn-outline btn-sm" onclick="dcAddExtra()" style="margin-top:8px">+ 添加加价项目</button>';
  html += '</div>';

  // AS轮：修改加价（导入接稿时显示，可手动维护）
  html += '<div class="calc-card"' + (_dcMode === 'import' ? '' : ' style="display:none"') + '>';
  html += '<div class="calc-card-title">修改加价 <span class="calc-card-hint">（次数×价格，计入最终总价）</span></div>';
  html += '<div class="dc-mod-header"><span>修改类型</span><span>次数</span><span>价格</span><span>备注</span><span></span></div>';
  html += '<div id="dc-modifications"></div>';
  html += '<button type="button" class="btn btn-outline btn-sm" onclick="dcAddModification()" style="margin-top:8px">+ 添加修改加价</button>';
  html += '</div>';

  // Usage rate
  html += '<div class="calc-card">';
  html += '<div class="calc-card-title">稿件用途倍率 <span class="calc-card-hint">（可更改数值）</span></div>';
  DC_USAGE.forEach((t, i) => {
    const rate = (settings.usageRates && settings.usageRates[t.value]) ?? t.rate;
    html += '<div class="calc-rate-row">';
    html += `<label class="calc-rate-label"><input type="radio" class="calc-circle" name="dcUsage" value="${t.value}"${i === 0 ? ' checked' : ''} onchange="dcRecalc()"> ${t.value}</label>`;
    html += `<input type="number" class="calc-rate-input" step="0.1" value="${rate}" data-usage="${t.value}" oninput="dcRecalc()">`;
    html += '</div>';
  });
  html += '</div>';

  // Discount system (SET与折扣互斥，同担/同推独立) — 置于加急之前
  html += '<div class="calc-card">';
  html += '<div class="calc-card-title">优惠体系 <span class="calc-card-hint">（SET优惠与折扣优惠互斥，可自行添加折扣优惠方案）</span></div>';
  html += '<div class="calc-rate-row"><label class="calc-rate-label"><input type="radio" class="calc-circle" name="dcDiscMode" value="none" checked onchange="dcDiscModeChange()"> 无优惠</label></div>';
  // SET
  html += '<div class="calc-rate-row"><label class="calc-rate-label"><input type="radio" class="calc-circle" name="dcDiscMode" value="set" onchange="dcDiscModeChange()"> SET优惠</label></div>';
  html += '<div id="dc-set-area" class="calc-sub-area disabled">';
  html += '<div style="font-size:12px;color:var(--c-text-muted);padding:4px 0;line-height:1.5">系统根据柄图自动分组，档位不叠加。</div>';
  DC_SET.forEach(s => {
    const rate = (settings.setRates && settings.setRates[s.value]) ?? s.rate;
    html += '<div class="calc-rate-row">';
    html += `<label class="calc-rate-label">${s.label}</label>`;
    html += `<input type="number" class="calc-rate-input" step="0.1" value="${rate}" data-set="${s.value}" oninput="dcRecalc()">`;
    html += '</div>';
  });
  html += '</div>';
  // Discount (with custom discount support)
  html += '<div class="calc-rate-row"><label class="calc-rate-label"><input type="radio" class="calc-circle" name="dcDiscMode" value="discount" onchange="dcDiscModeChange()"> 折扣优惠</label></div>';
  html += '<div id="dc-disc-area" class="calc-sub-area disabled">';
  const discMultiRate = settings.discMultiRate ?? 0.9;
  html += '<div class="calc-rate-row">';
  html += '<label class="calc-rate-label"><input type="checkbox" id="dcDiscMulti" onchange="dcSystemDiscToggle()"> 不同制品≥8件</label>';
  html += `<input type="number" class="calc-rate-input" step="0.1" value="${discMultiRate}" data-disc="multi" oninput="dcRecalc()">`;
  html += '</div>';
  // Custom discount rows
  html += '<div id="dc-custom-discs"></div>';
  html += '<div id="dc-custom-disc-add-area" style="display:none;margin-top:4px;padding:8px;border:1px dashed var(--c-border);border-radius:6px;background:var(--c-primary-bg)">';
  html += '<div class="calc-rate-row" style="gap:4px">';
  html += '<input type="text" class="calc-rate-input" id="dcNewDiscName" placeholder="方案名称" style="width:auto;flex:1;text-align:left;font-size:13px">';
  html += '<select class="calc-rate-input" id="dcNewDiscType" style="width:auto;font-size:12px"><option value="rate">折扣率</option><option value="amount">减免额</option></select>';
  html += '<input type="number" class="calc-rate-input" id="dcNewDiscVal" step="0.01" placeholder="数值" style="width:60px;font-size:13px">';
  html += '<button type="button" class="btn btn-primary btn-sm" onclick="dcConfirmAddCustomDisc()" style="padding:4px 10px;font-size:12px">确认</button>';
  html += '<button type="button" class="btn btn-ghost btn-sm" onclick="dcCancelAddCustomDisc()" style="padding:4px 10px;font-size:12px">取消</button>';
  html += '</div>';
  html += '</div>';
  html += '<div style="margin-top:4px">';
  html += '<button type="button" class="btn btn-outline btn-sm" onclick="dcShowAddCustomDisc()" style="width:100%">+ 添加优惠方案</button>';
  html += '<div style="display:flex;gap:6px;margin-top:4px">';
  html += '<button type="button" class="btn btn-danger btn-sm" onclick="dcDeleteCheckedCustomDisc()" style="flex:1">🗑️ 删除方案</button>';
  html += '<button type="button" class="btn btn-primary btn-sm" onclick="dcSaveCustomDiscsFeedback()" style="flex:1">💾 保存方案</button>';
  html += '</div>';
  html += '</div>';
  html += '</div>';
  html += '</div>'; // end discount card

  // Bk轮：加急功能 — 整单加急（默认关闭，开启后全部制品与加价×倍率）+ 制品单独勾选
  // BN轮：任一行制品勾选加急后，整单加急开关置灰（互斥）
  const anyProductUrgent = _dcProducts.some(p => p.urgent);
  html += '<div class="calc-card">';
  html += '<div class="calc-card-title">加急 <span class="calc-card-hint">（此为整单加急，制品行勾选，可单独选择部分制品加急）</span></div>';
  html += '<div class="calc-rate-row">';
  html += `<label class="calc-rate-label${anyProductUrgent ? ' calc-rate-label-disabled' : ''}"><input type="checkbox" class="dc-urgent-toggle" id="dcWholeOrderUrgentChk" ${_dcWholeOrderUrgent ? 'checked' : ''} ${anyProductUrgent ? 'disabled' : ''} onchange="dcToggleWholeOrderUrgent(this.checked)"> 加急（整单）</label>`;
  html += '<input type="number" class="calc-rate-input" step="0.1" value="2" data-urgent="rate" oninput="dcRecalc()">';
  html += '</div>';
  html += '</div>';

  // Bu轮: 全局同模阶梯价倍率单选（可空，去掉无同模；制品行未选类型时读取此项）
  html += '<div class="calc-card">';
  html += '<div class="calc-card-title">同模阶梯价倍率 <span class="calc-card-hint">（制品行勾选启用，可单独选择同模类型）</span></div>';
  DC_MODEL.filter(m => m.value !== 'none').forEach(m => {
    html += '<div class="calc-rate-row">';
    html += `<label class="calc-rate-label"><input type="checkbox" class="calc-circle" name="dc_model_rule" value="${m.value}" ${_dcGlobalModelType === m.value ? 'checked' : ''} onchange="dcSelectGlobalModel('${m.value}', this.checked)"> ${m.value}</label>`;
    html += `<input type="number" class="calc-rate-input" step="0.1" value="${m.rate}" readonly>`;
    html += '</div>';
  });
  html += '</div>';

  // 同担/同推优惠 (独立板块，不与任何优惠互斥)
  html += '<div class="calc-card">';
  html += '<div class="calc-card-title">同担/同推优惠 <span class="calc-card-hint">（独立，不与任何优惠互斥）</span></div>';
  html += '<div class="calc-rate-row">';
  html += '<label class="calc-rate-label">随机减价</label>';
  html += `<input type="number" class="calc-rate-input" step="0.01" value="" data-fan="reduce" oninput="_dcFanReduce=parseFloat(this.value)||0;dcRecalc()" placeholder="0">`;
  html += '</div>';
  html += '</div>';

  html += '</div>'; // end left col

  // === Right: Receipt ===
  html += '<div class="calc-receipt-col">';
  html += '<div class="calc-receipt" id="dc-receipt"></div>';
  html += '<div class="calc-actions">';
  html += '<button class="dc-export-btn" style="flex:1" onclick="dcExportReceipt()">📷 导出报价图</button>';
  if (_dcMode === 'import') {
    html += '<button class="btn btn-primary" style="flex:1" onclick="dcUpdateQuote()">更新报价至接稿</button>';
  } else {
    html += '<button class="btn btn-primary" style="flex:1" onclick="dcCreateCommission()">新增接稿记录</button>';
  }
  html += '</div>';
  html += '</div>'; // end right col

  html += '</div></div>';
  // Datalists for product and extra name dropdowns (sorted A-Z)
  const priceList = DB.list('priceList');
  const productNames = [...new Set(priceList.filter(p => PRODUCT_CATEGORIES.includes(p.category) && p.product).map(p => p.product))].sort((a,b)=>a.localeCompare(b,'zh'));
  const extraNames = [...new Set(priceList.filter(p => p.category === '加价项目' && p.product).map(p => p.product))].sort((a,b)=>a.localeCompare(b,'zh'));
  html += `<datalist id="dc_product_dl">${productNames.map(n => `<option value="${esc(n)}">`).join('')}</datalist>`;
  html += `<datalist id="dc_extra_dl">${extraNames.map(n => `<option value="${esc(n)}">`).join('')}</datalist>`;
  body.innerHTML = html;
  dcRenderProducts();
  dcRenderExtras();
  dcRenderModifications();
  dcRenderCustomDiscs();
  setTimeout(dcRecalc, 50);
}

function dcSetMode(mode) {
  _dcMode = mode;
  if (mode === 'custom') { _dcImportId = null; _dcProducts = [newProduct()]; _dcExtras = []; _dcModifications = []; _dcFanReduce = 0; }
  renderDesignCalc();
}

function dcImportRecord(id) {
  _dcImportId = id;
  const hidden = document.getElementById('dcImportSelectValue');
  const input = document.getElementById('dcImportSelectInput');
  if (hidden) hidden.value = id || '';
  if (!id) {
    if (input) input.value = '';
    _dcProducts = [newProduct()]; _dcExtras = []; _dcModifications = [];
    dcRenderProducts(); dcRenderExtras(); dcRenderModifications(); dcRecalc();
    return;
  }
  const rec = DB.getById('commissions', id);
  if (!rec) return;
  // v-NEW: 导入时还原行内同模类型/倍率与加价绑定
  _dcProducts = (rec.products || []).map(p => {
    const sm = p.sameModel;
    let sameModel = false, sameModelType = '', sameModelRate = 1;
    if (sm && sm !== '无同模' && sm !== '' && sm !== true) {
      const m = DC_MODEL.find(m => m.value === sm || m.label === sm);
      if (m) { sameModel = true; sameModelType = m.value; sameModelRate = (p.sameModelRate != null ? parseFloat(p.sameModelRate) : m.rate); }
      else { sameModel = true; sameModelType = '改人'; sameModelRate = (p.sameModelRate != null ? parseFloat(p.sameModelRate) : 0.5); }
    } else if (sm === true) {
      sameModel = true; sameModelType = ''; sameModelRate = 1.0; // 无默认类型，提示用户选择
    }
    // AS轮：加急仅由 per-product urgent 字段决定，不再用旧版整单 urgentEnabled 覆盖
    const urgent = p.urgent === true;
    return { _pid: _dcProdSeq++, name: p.name || '', patternId: p.patternId || '', size: p.size || '', quantity: parseInt(p.quantity) || 1, price: parseFloat(p.price) || 0, sameModel, sameModelType, sameModelRate, urgent, setGroup: '' };
  });
  if (!_dcProducts.length) _dcProducts = [newProduct()];
  _dcExtras = (rec.extraItems || []).map(e => ({ name: e.name || '', quantity: parseInt(e.quantity) || 1, price: parseFloat(e.price) || 0, bindSeq: e.bindSeq || 'none' }));
  // AS轮：导入接稿的修改加价
  _dcModifications = (rec.modifications || []).map(m => ({ modifyType: m.modifyType || '', modifyCount: parseInt(m.modifyCount) || 1, modifyPrice: parseFloat(m.modifyPrice) || 0, note: m.note || '' }));
  // v227: 接稿排期「是否加急」=整单加急；制品 urgent=单项加急
  _dcWholeOrderUrgent = (rec.isUrgent === '是') || (Array.isArray(rec.isUrgent) && rec.isUrgent.includes('是')) || (rec.isUrgent === true);
  renderDesignCalc();
  setTimeout(() => {
    const usageVal = Array.isArray(rec.usageType) ? rec.usageType[0] : rec.usageType;
    if (usageVal) { const r = document.querySelector(`input[name="dcUsage"][value="${usageVal}"]`); if (r) r.checked = true; }
    if (rec.urgentRate != null) { const ur = document.querySelector('input[data-urgent="rate"]'); if (ur) ur.value = rec.urgentRate; }
    const tog = document.getElementById('dcWholeOrderUrgentChk');
    if (tog) { tog.checked = _dcWholeOrderUrgent; dcSyncWholeOrderToggle(); }
    dcRecalc();
  }, 60);
}

function dcRenderProducts() {
  const c = $('#dc-products');
  if (!c) return;
  const priceList = DB.list('priceList');
  const productNames = [...new Set(priceList.filter(p => PRODUCT_CATEGORIES.includes(p.category) && p.product).map(p => p.product))].sort((a,b)=>a.localeCompare(b,'zh'));
  let html = '';
  _dcProducts.forEach((p, i) => {
    const cbId = 'dcp_' + i + '_' + Math.random().toString(36).slice(2,6);
    const optHTML = productNames.map(n => `<div class="combobox-option" onclick="dcSelectProduct(${i},this,'${cbId}')" data-value="${esc(n)}">${esc(n)}</div>`).join('');
    const seq = String(i + 1).padStart(2, '0');
    // AS轮：同模类型下拉改成与制品名称同款的 combobox 下拉选择器
    const modelCbId = 'dcm_' + i + '_' + Math.random().toString(36).slice(2,6);
    const modelOptsHTML = DC_MODEL.filter(m => m.value !== 'none').map(m => `<div class="combobox-option" onclick="dcSelectModelType(${i},this,'${modelCbId}')" data-value="${esc(m.value)}" data-rate="${m.rate}">${esc(m.value)}</div>`).join('');
    const modelTypeLabel = p.sameModelType || '';
    html += `<div class="dc-product-row">`;
    html += `<div class="dc-prod-seq${p.setGroup ? ' setgroup' : ''}">${seq}</div>`;
    html += `<div class="combobox-wrapper dc-prod-name-wrapper" style="min-width:0"><input type="text" class="form-input combobox-input dc-prod-name" value="${esc(p.name)}" placeholder="制品" data-key="name" onfocus="showComboboxDropdown('${cbId}')" onclick="showComboboxDropdown('${cbId}')" oninput="dcUpdateProduct(${i},'name',this.value);dcFillPrice(this,'product',${i});filterComboboxDropdown('${cbId}',this.value)"><button type="button" class="combobox-toggle" onclick="toggleComboboxDropdown('${cbId}')">▼</button><div class="combobox-dropdown" id="${cbId}">${optHTML}</div></div>`;
    html += `<input type="text" class="form-input dc-prod-pattern" value="${esc(p.patternId||'')}" placeholder="柄图标识" oninput="dcUpdateProduct(${i},'patternId',this.value)">`;
    html += `<input type="number" class="form-input dc-prod-price" value="${p.price}" placeholder="单价" min="0" step="0.01" oninput="dcUpdateProduct(${i},'price',this.value)">`;
    html += `<input type="number" class="form-input dc-prod-qty" value="${p.quantity}" placeholder="数量" min="1" oninput="dcUpdateProduct(${i},'quantity',this.value)">`;
    html += `<div class="dc-prod-row2">`;
    const urgChk = p.urgent || _dcWholeOrderUrgent;
    html += `<label class="dc-prod-check dc-prod-urgent"><input type="checkbox" ${urgChk ? 'checked' : ''} ${_dcWholeOrderUrgent ? 'disabled' : ''} onchange="dcUpdateProduct(${i},'urgent',this.checked)">加急</label>`;
    html += `<label class="dc-prod-check dc-prod-same"><input type="checkbox" ${p.sameModel ? 'checked' : ''} onchange="dcUpdateProduct(${i},'sameModel',this.checked)">同模</label>`;
    if (p.sameModel) {
      html += `<div class="combobox-wrapper dc-prod-model-type-wrapper"><input type="text" class="form-input combobox-input dc-prod-model-type" value="${esc(modelTypeLabel)}" placeholder="请选择同模类型" readonly onfocus="showComboboxDropdown('${modelCbId}')" onclick="showComboboxDropdown('${modelCbId}')"><button type="button" class="combobox-toggle" onclick="toggleComboboxDropdown('${modelCbId}')">▼</button><div class="combobox-dropdown" id="${modelCbId}">${modelOptsHTML}</div></div>`;
    }
    html += `<button type="button" class="btn btn-ghost btn-sm dc-prod-del" onclick="dcRemoveProduct(${i})">✕</button>`;
    html += `</div>`;
    html += '</div>';
  });
  c.innerHTML = html;
}

function dcSelectProduct(idx, el, cbId) {
  const wrapper = el.closest('.combobox-wrapper');
  if (!wrapper) return;
  const input = wrapper.querySelector('.combobox-input');
  if (input) {
    input.value = el.dataset.value || el.textContent;
    dcUpdateProduct(idx, 'name', input.value);
    dcFillPrice(input, 'product', idx);
  }
  document.getElementById(cbId).classList.remove('show');
}

// CX轮（简化）：将当前全部制品归为同一个SET组；再次点击取消；自动确保SET优惠模式开启
function dcMakeSet() {
  // 已全归为同一组 → 取消分组；否则全部归为同一组
  const allSame = _dcProducts.length > 0 && _dcProducts.every(p => p.setGroup && p.setGroup === _dcProducts[0].setGroup);
  if (allSame) {
    _dcProducts.forEach(p => p.setGroup = '');
  } else {
    const gid = 'SG' + (_dcProdSeq++);
    _dcProducts.forEach(p => p.setGroup = gid);
  }
  // 自动开启SET优惠模式（无需用户先手动选；确保折扣生效）
  const setRadio = document.querySelector('input[name="dcDiscMode"][value="set"]');
  if (setRadio && !setRadio.checked) { setRadio.checked = true; dcDiscModeChange(); }
  dcRenderProducts(); dcRecalc();
}

// AS轮：同模类型 combobox 选择回调
function dcSelectModelType(idx, el, modelCbId) {
  const wrapper = el.closest('.combobox-wrapper');
  if (!wrapper) return;
  const input = wrapper.querySelector('.combobox-input');
  const val = el.dataset.value || el.textContent;
  const rate = parseFloat(el.dataset.rate) || 1.0;
  if (input) input.value = val;
  dcUpdateProduct(idx, 'sameModelType', val); // 内部会刷新 sameModelRate
  // 等待 dcUpdateProduct 中的 dcRenderProducts 后 input 会被重新渲染，这里先关闭下拉
  document.getElementById(modelCbId).classList.remove('show');
}

// Bu轮：全局同模单选（可空切换：再次点击已选项则取消选择）
function dcSelectGlobalModel(val, checked) {
  // Bu轮：原生 radio 无法二次点击取消，改 checkbox 实现"单选 + 可空"
  if (checked) {
    _dcGlobalModelType = val; // 选中即设为当前项
  } else {
    _dcGlobalModelType = '';  // 再次点击已选项 → 取消选择
  }
  // 单选约束：只保留与当前值一致的复选框为选中态
  document.querySelectorAll('input[name="dc_model_rule"]').forEach(r => { r.checked = (r.value === _dcGlobalModelType); });
  dcRecalc();
}

function dcAddProduct() { _dcProducts.push(newProduct()); dcRenderProducts(); dcRecalc(); }
function dcClearProducts() { _dcProducts = [newProduct()]; dcSyncWholeOrderToggle(); dcRenderProducts(); dcRecalc(); }
function dcRemoveProduct(idx) { _dcProducts.splice(idx, 1); if (!_dcProducts.length) _dcProducts = [newProduct()]; dcSyncWholeOrderToggle(); dcRenderProducts(); dcRecalc(); }
function dcUpdateProduct(idx, field, val) {
  if (!_dcProducts[idx]) return;
  const p = _dcProducts[idx];
  if (field === 'sameModel') {
    p.sameModel = !!val;
    // Bk轮：勾选同模不再默认类型，等待用户选择（提示"请选择同模类型"）
    if (p.sameModel) { p.sameModelType = ''; p.sameModelRate = 1.0; }
    // 同柄图标识的其他行自动继承同模勾选（不预设类型）
    if (p.sameModel && p.patternId) {
      _dcProducts.forEach((q, j) => {
        if (j !== idx && q.patternId === p.patternId) { q.sameModel = true; }
      });
    }
    dcRenderProducts(); dcRecalc(); return;
  }
  else if (field === 'sameModelType') {
    p.sameModelType = val;
    const m = DC_MODEL.find(m => m.value === val);
    p.sameModelRate = m ? m.rate : 1.0;
    dcRenderProducts(); dcRecalc(); return;
  }
  else if (field === 'sameModelRate') { p.sameModelRate = parseFloat(val) || 0; dcRecalc(); return; }
  else if (field === 'name') { p.name = val; }
  else if (field === 'patternId') {
    p.patternId = val;
    const pVal = parseFloat(val);
    // 柄图标识 > 1 自动勾选本行同模（Bk轮：仅自动勾选，不预设类型，等待用户选择）
    if (!isNaN(pVal) && pVal > 1) {
      p.sameModel = true;
      _dcProducts.forEach((q, j) => {
        if (j !== idx && q.patternId === p.patternId) { q.sameModel = true; }
      });
    }
    dcRenderProducts(); dcRecalc(); return;
  }
  else if (field === 'quantity') { p.quantity = parseInt(val) || 1; }
  else if (field === 'price') { p.price = parseFloat(val) || 0; }
  else if (field === 'urgent') { p.urgent = !!val; dcSyncWholeOrderToggle(); }
  dcRecalc();
}
function dcFillPrice(input, lookupType, idx) {
  const name = input.value.trim();
  if (!name) return;
  const priceList = DB.list('priceList');
  let item;
  if (lookupType === 'product') {
    item = priceList.find(p => p.product === name && PRODUCT_CATEGORIES.includes(p.category));
  } else if (lookupType === 'extra') {
    item = priceList.find(p => p.product === name && p.category === '加价项目');
  }
  if (item) {
    if (lookupType === 'product') {
      _dcProducts[idx].price = parseFloat(item.price) || 0;
      const priceInput = input.closest('.dc-product-row').querySelector('.dc-prod-price');
      if (priceInput) priceInput.value = _dcProducts[idx].price;
    } else {
      _dcExtras[idx].price = parseFloat(item.price) || 0;
      const priceInput = input.closest('.dc-extra-row').querySelector('.dc-extra-price');
      if (priceInput) priceInput.value = _dcExtras[idx].price;
    }
    dcRecalc();
  }
}

function dcRenderExtras() {
  const c = $('#dc-extras');
  if (!c) return;
  const priceList = DB.list('priceList');
  const extraNames = [...new Set(priceList.filter(p => p.category === '加价项目' && p.product).map(p => p.product))].sort((a,b)=>a.localeCompare(b,'zh'));
  let html = '';
  _dcExtras.forEach((e, i) => {
    const bindCbId = 'dceb_' + i + '_' + Math.random().toString(36).slice(2,6);
    const nameCbId = 'dcen_' + i + '_' + Math.random().toString(36).slice(2,6);
    const optHTML = extraNames.map(n => `<div class="combobox-option" onclick="dcSelectExtra(${i},this,'${nameCbId}')" data-value="${esc(n)}">${esc(n)}</div>`).join('');
    // 绑定制品下拉：读取制品列表自动生成的序号+制品，首项为「无（不绑定）」
    const bindOptHTML = ['<div class="combobox-option" data-value="none" onclick="dcSelectExtraBind(' + i + ',this,\'' + bindCbId + '\')">无（不绑定）</div>']
      .concat(_dcProducts.map((p, j) => {
        const seq = String(j + 1).padStart(2, '0');
        const label = p.name ? (seq + ' ' + p.name) : seq;
        return `<div class="combobox-option" data-value="${seq}" onclick="dcSelectExtraBind(${i},this,'${bindCbId}')">${esc(label)}</div>`;
      })).join('');
    html += '<div class="dc-extra-row">';
    // 绑定制品 combobox（置于名称前面，与灵感记录制品下拉同款，保留【下拉选择器】结构）
    html += `<div class="combobox-wrapper dc-extra-bind-wrapper"><input type="text" class="form-input combobox-input dc-extra-bind-input" value="${esc(dcExtraBindDisplay(e.bindSeq))}" placeholder="绑定制品" onfocus="showComboboxDropdown('${bindCbId}')" onclick="showComboboxDropdown('${bindCbId}')" oninput="filterComboboxDropdown('${bindCbId}',this.value)"><button type="button" class="combobox-toggle" onclick="toggleComboboxDropdown('${bindCbId}')">▼</button><div class="combobox-dropdown" id="${bindCbId}">${bindOptHTML}</div></div>`;
    // 名称 combobox（保留原结构）
    html += `<div class="combobox-wrapper" style="min-width:0"><input type="text" class="form-input combobox-input dc-extra-name" value="${esc(e.name)}" placeholder="名称" onfocus="showComboboxDropdown('${nameCbId}')" onclick="showComboboxDropdown('${nameCbId}')" oninput="dcUpdateExtra(${i},'name',this.value);dcFillPrice(this,'extra',${i});filterComboboxDropdown('${nameCbId}',this.value)"><button type="button" class="combobox-toggle" onclick="toggleComboboxDropdown('${nameCbId}')">▼</button><div class="combobox-dropdown" id="${nameCbId}">${optHTML}</div></div>`;
    html += `<input type="number" class="form-input dc-extra-qty" value="${e.quantity}" placeholder="数量" min="1" oninput="dcUpdateExtra(${i},'quantity',this.value)">`;
    html += `<input type="number" class="form-input dc-extra-price" value="${e.price}" placeholder="单价" min="0" step="0.01" oninput="dcUpdateExtra(${i},'price',this.value)">`;
    html += `<button type="button" class="btn btn-ghost btn-sm dc-extra-del" onclick="dcRemoveExtra(${i})">✕</button>`;
    html += '</div>';
  });
  c.innerHTML = html;
}

function dcSelectExtra(idx, el, cbId) {
  const wrapper = el.closest('.combobox-wrapper');
  if (!wrapper) return;
  const input = wrapper.querySelector('.combobox-input');
  if (input) {
    input.value = el.dataset.value || el.textContent;
    dcUpdateExtra(idx, 'name', input.value);
    dcFillPrice(input, 'extra', idx);
  }
  document.getElementById(cbId).classList.remove('show');
}
function dcExtraBindDisplay(seq) {
  if (!seq || seq === 'none') return '';
  const bi = parseInt(seq, 10) - 1;
  if (bi >= 0 && bi < _dcProducts.length) {
    const p = _dcProducts[bi];
    return String(bi + 1).padStart(2, '0') + ' ' + (p.name || '');
  }
  return seq;
}
function dcSelectExtraBind(idx, el, cbId) {
  const wrapper = el.closest('.combobox-wrapper');
  if (!wrapper) return;
  const input = wrapper.querySelector('.combobox-input');
  if (input) {
    input.value = (el.dataset.value === 'none') ? '' : (el.textContent || '');
    dcUpdateExtra(idx, 'bindSeq', el.dataset.value || 'none');
  }
  const dd = document.getElementById(cbId);
  if (dd) dd.classList.remove('show');
}
function dcAddExtra() { _dcExtras.push(newExtra()); dcRenderExtras(); dcRecalc(); }
function dcRemoveExtra(idx) { _dcExtras.splice(idx, 1); dcRenderExtras(); dcRecalc(); }
function dcUpdateExtra(idx, field, val) {
  if (!_dcExtras[idx]) return;
  if (field === 'name') { _dcExtras[idx].name = val; }
  else if (field === 'quantity') { _dcExtras[idx].quantity = parseInt(val) || 1; }
  else if (field === 'price') { _dcExtras[idx].price = parseFloat(val) || 0; }
  else if (field === 'bindSeq') { _dcExtras[idx].bindSeq = val; }
  dcRecalc();
}

/* ===== Modification Surcharge (AS轮: 导入接稿的修改加价，次数×价格) ===== */
function dcRenderModifications() {
  const c = $('#dc-modifications');
  if (!c) return;
  const priceList = DB.list('priceList');
  const modifyTypeNames = [...new Set(priceList.filter(p => p.category === '修改类型' && p.product).map(p => p.product))].sort((a,b)=>a.localeCompare(b,'zh'));
  let html = '';
  _dcModifications.forEach((m, i) => {
    const cbId = 'dcm_' + i + '_' + Math.random().toString(36).slice(2,6);
    const optHTML = modifyTypeNames.map(n => `<div class="combobox-option" onclick="dcSelectModification(${i},this,'${cbId}')" data-value="${esc(n)}">${esc(n)}</div>`).join('');
    html += '<div class="dc-mod-row">';
    html += `<div class="combobox-wrapper" style="min-width:0"><input type="text" class="form-input combobox-input dc-mod-type" value="${esc(m.modifyType||'')}" placeholder="修改类型" onfocus="showComboboxDropdown('${cbId}')" onclick="showComboboxDropdown('${cbId}')" oninput="dcUpdateModification(${i},'modifyType',this.value);filterComboboxDropdown('${cbId}',this.value)"><button type="button" class="combobox-toggle" onclick="toggleComboboxDropdown('${cbId}')">▼</button><div class="combobox-dropdown" id="${cbId}">${optHTML}</div></div>`;
    html += `<input type="number" class="form-input dc-mod-count" value="${m.modifyCount}" placeholder="次数" min="1" oninput="dcUpdateModification(${i},'modifyCount',this.value)">`;
    html += `<input type="number" class="form-input dc-mod-price" value="${m.modifyPrice}" placeholder="价格" min="0" step="0.01" oninput="dcUpdateModification(${i},'modifyPrice',this.value)">`;
    html += `<input type="text" class="form-input dc-mod-note" value="${esc(m.note||'')}" placeholder="备注" oninput="dcUpdateModification(${i},'note',this.value)">`;
    html += `<button type="button" class="btn btn-ghost btn-sm dc-mod-del" onclick="dcRemoveModification(${i})">✕</button>`;
    html += '</div>';
  });
  c.innerHTML = html;
}

function dcSelectModification(idx, el, cbId) {
  const wrapper = el.closest('.combobox-wrapper');
  if (!wrapper) return;
  const input = wrapper.querySelector('.combobox-input');
  if (input) {
    input.value = el.dataset.value || el.textContent;
    dcUpdateModification(idx, 'modifyType', input.value);
  }
  document.getElementById(cbId).classList.remove('show');
}

function dcAddModification() { _dcModifications.push(newModification()); dcRenderModifications(); dcRecalc(); }
function dcRemoveModification(idx) { _dcModifications.splice(idx, 1); dcRenderModifications(); dcRecalc(); }
// 修改类型价格从价目表「修改类型」分类自动获取
function dcLookupModPrice(name) {
  if (!name) return null;
  const priceList = DB.list('priceList');
  const item = priceList.find(p => p.product === name && p.category === '修改类型');
  if (item && item.price !== undefined && item.price !== null) return parseFloat(item.price) || 0;
  return null;
}
function dcUpdateModification(idx, field, val) {
  if (!_dcModifications[idx]) return;
  const m = _dcModifications[idx];
  if (field === 'modifyType') {
    m.modifyType = val;
    const price = dcLookupModPrice(val);
    if (price != null) {
      m.modifyPrice = price;
      const c = $('#dc-modifications');
      if (c) {
        const row = c.querySelectorAll('.dc-mod-row')[idx];
        if (row) {
          const pi = row.querySelector('.dc-mod-price');
          if (pi) pi.value = price;
        }
      }
    }
  }
  else if (field === 'modifyCount') { m.modifyCount = parseInt(val) || 1; }
  else if (field === 'modifyPrice') { m.modifyPrice = parseFloat(val) || 0; }
  else if (field === 'note') { m.note = val; }
  dcRecalc();
}

function dcCalcModTotal() {
  return _dcModifications.reduce((s, m) => s + (parseInt(m.modifyCount) || 0) * (parseFloat(m.modifyPrice) || 0), 0);
}

/* ===== Custom Discount Management (persisted, mutually exclusive with system discount) ===== */
function dcSaveCustomDiscs() { DB.set('calcCustomDiscs', _dcCustomDiscs); }
function dcRenderCustomDiscs() {
  const c = $('#dc-custom-discs');
  if (!c) return;
  let html = '';
  _dcCustomDiscs.forEach((d, i) => {
    html += '<div class="calc-rate-row">';
    const typeLabel = d.type === 'rate' ? '折扣率' : '减免额';
    const displayName = d.name || ('自定义' + (i + 1));
    html += `<label class="calc-rate-label"><input type="checkbox" data-cdisc-check="${i}" onchange="dcCustomDiscToggle(${i})"> ${esc(displayName)}（${typeLabel}）</label>`;
    const valStr = d.type === 'rate' ? (d.value || 0.9) : (d.value || 0);
    html += '<div style="display:flex;align-items:center;gap:4px">';
    html += `<input type="number" class="calc-rate-input" step="0.01" value="${valStr}" data-cdisc-val="${i}" oninput="_dcCustomDiscs[${i}].value=parseFloat(this.value)||0;dcSaveCustomDiscs();dcRecalc()">`;
    html += '</div>';
    html += '</div>';
  });
  c.innerHTML = html;
}
// When a custom discount is checked, uncheck system discount
function dcCustomDiscToggle(idx) {
  const cdCheck = document.querySelector(`input[data-cdisc-check="${idx}"]`);
  if (cdCheck && cdCheck.checked) {
    const sysCheck = document.getElementById('dcDiscMulti');
    if (sysCheck) sysCheck.checked = false;
  }
  dcRecalc();
}
// When system discount is checked, uncheck all custom discounts
function dcSystemDiscToggle() {
  const sysCheck = document.getElementById('dcDiscMulti');
  if (sysCheck && sysCheck.checked) {
    document.querySelectorAll('input[data-cdisc-check]').forEach(c => { c.checked = false; });
  }
  dcRecalc();
}
function dcAddCustomDisc() { _dcCustomDiscs.push({ name: '', type: 'rate', value: 0.9 }); dcSaveCustomDiscs(); dcRenderCustomDiscs(); dcRecalc(); }
function dcRemoveCustomDisc(idx) { _dcCustomDiscs.splice(idx, 1); dcSaveCustomDiscs(); dcRenderCustomDiscs(); dcRecalc(); }
function dcDeleteCheckedCustomDisc() {
  const checked = [];
  document.querySelectorAll('input[data-cdisc-check]').forEach(c => { if (c.checked) checked.push(parseInt(c.dataset.cdiscCheck)); });
  if (!checked.length) { Toast.warning('请先勾选要删除的方案'); return; }
  checked.sort((a, b) => b - a).forEach(i => _dcCustomDiscs.splice(i, 1));
  dcSaveCustomDiscs(); dcRenderCustomDiscs(); dcRecalc();
  Toast.success('已删除' + checked.length + '个方案');
}
function dcShowAddCustomDisc() {
  const area = document.getElementById('dc-custom-disc-add-area');
  if (area) { area.style.display = 'block'; const nameInp = document.getElementById('dcNewDiscName'); if (nameInp) nameInp.focus(); }
}
function dcCancelAddCustomDisc() {
  const area = document.getElementById('dc-custom-disc-add-area');
  if (area) area.style.display = 'none';
  const nameInp = document.getElementById('dcNewDiscName'); if (nameInp) nameInp.value = '';
  const valInp = document.getElementById('dcNewDiscVal'); if (valInp) valInp.value = '';
}
function dcConfirmAddCustomDisc() {
  const nameInp = document.getElementById('dcNewDiscName');
  const typeInp = document.getElementById('dcNewDiscType');
  const valInp = document.getElementById('dcNewDiscVal');
  if (!nameInp || !nameInp.value.trim()) { Toast.error('请输入方案名称'); return; }
  const type = typeInp ? typeInp.value : 'rate';
  const value = valInp && valInp.value ? parseFloat(valInp.value) : (type === 'rate' ? 0.9 : 0);
  _dcCustomDiscs.push({ name: nameInp.value.trim(), type, value });
  dcSaveCustomDiscs();
  dcRenderCustomDiscs();
  dcCancelAddCustomDisc();
  dcRecalc();
}
function dcSaveCustomDiscsFeedback() {
  dcSaveCustomDiscs();
  const btn = event.target;
  const orig = btn.textContent;
  btn.textContent = '✓ 已保存';
  btn.style.background = 'var(--c-green)';
  setTimeout(() => { btn.textContent = orig; btn.style.background = ''; }, 1500);
}

function dcDiscModeChange() {
  const sel = document.querySelector('input[name="dcDiscMode"]:checked');
  const mode = sel ? sel.value : 'none';
  const setArea = $('#dc-set-area'); const discArea = $('#dc-disc-area');
  if (setArea) setArea.classList.toggle('disabled', mode !== 'set');
  if (discArea) discArea.classList.toggle('disabled', mode !== 'discount');
  dcRecalc();
}

function dcSyncWholeOrderToggle() {
  // Bn轮：任一行制品勾选/取消"加急"时，同步整单加急开关的置灰状态
  const tog = document.getElementById('dcWholeOrderUrgentChk');
  if (!tog) return;
  const any = _dcProducts.some(p => p.urgent);
  tog.disabled = any;
  const lbl = tog.closest('.calc-rate-label');
  if (lbl) lbl.classList.toggle('calc-rate-label-disabled', any);
}
function dcToggleWholeOrderUrgent(val) {
  _dcWholeOrderUrgent = !!val;
  const settings = DB.get('calcSettings', {});
  settings.wholeOrderUrgent = _dcWholeOrderUrgent;
  DB.set('calcSettings', settings);
  dcRenderProducts(); dcRecalc();
}

function dcRecalc() {
  const uRadio = document.querySelector('input[name="dcUsage"]:checked');
  const uType = uRadio ? uRadio.value : '自用';
  const uRateInp = document.querySelector(`input[data-usage="${uType}"]`);
  const uRate = uRateInp ? (parseFloat(uRateInp.value) || 1.0) : 1.0;

  // v-NEW: 加急倍率（作用于勾选制品）
  const urgentInp = document.querySelector('input[data-urgent="rate"]');
  const urgentRate = urgentInp ? (parseFloat(urgentInp.value) || 1.0) : 1.0;

  const dRadio = document.querySelector('input[name="dcDiscMode"]:checked');
  const dMode = dRadio ? dRadio.value : 'none';

  const set4Inp = document.querySelector('input[data-set="set4"]');
  const set9Inp = document.querySelector('input[data-set="set9"]');
  const set4Rate = set4Inp ? (parseFloat(set4Inp.value) || 0.9) : 0.9;
  const set9Rate = set9Inp ? (parseFloat(set9Inp.value) || 0.8) : 0.8;

  // Step 1: Per-item subtotal (same-model per-row; 选类型才启用阶梯价，否则全额)
  const productDetails = [];
  _dcProducts.forEach((p, idx) => {
    const price = parseFloat(p.price) || 0;
    const qty = parseInt(p.quantity) || 0;
    // Bu轮：同模类型优先级 = 本行下拉 > 全局单选 > 皆空则提示且不计算同模报价
    let useModel = false, modelType = '', mRate = 1.0;
    if (p.sameModel) {
      if (p.sameModelType) {
        useModel = true; modelType = p.sameModelType; mRate = parseFloat(p.sameModelRate) || 1.0;
      } else if (_dcGlobalModelType) {
        const gm = DC_MODEL.find(m => m.value === _dcGlobalModelType);
        useModel = true; modelType = _dcGlobalModelType; mRate = gm ? (parseFloat(gm.rate) || 1.0) : 1.0;
      }
    }
    let lt, modelBreakdown = '';
    if (useModel) {
      if (qty > 1) {
        lt = price + price * (qty - 1) * mRate;
        modelBreakdown = `${modelType || '同模'} 首件 ¥${price.toFixed(2)} + 余${qty-1}件 ×¥${(price * mRate).toFixed(2)}`;
      } else {
        lt = price * mRate;
        modelBreakdown = `${modelType || '同模'} ¥${price.toFixed(2)} ×${mRate}`;
      }
    } else {
      lt = price * qty;
    }
    const effectiveUrgent = !!p.urgent || _dcWholeOrderUrgent;
    productDetails.push({ idx, name: p.name, patternId: p.patternId || '', qty, price, lt, useModel, mRate, modelBreakdown, actualUrgent: !!p.urgent, urgent: effectiveUrgent, setGroup: p.setGroup || '' });
  });

  // Step 2: Group by patternId for SET discount (only in SET mode)
  let productsTotal = 0;
  const groupDetails = [];
  const itemGroupRate = new Array(productDetails.length).fill(1.0);

  if (dMode === 'set') {
    // CX轮：分组键优先级 = 手动SET组(setGroup) > 柄图(patternId) > 无柄图
    const groups = {};
    const noPatternIdx = [];
    productDetails.forEach((d, i) => {
      let key = null;
      if (d.setGroup) key = 'SG:' + d.setGroup;
      else if (d.patternId) key = 'P:' + d.patternId;
      if (key) {
        if (!groups[key]) groups[key] = { isManual: !!d.setGroup, label: d.setGroup || d.patternId, items: [] };
        groups[key].items.push({ d, i });
      } else { noPatternIdx.push(i); }
    });
    Object.keys(groups).forEach(key => {
      const g = groups[key];
      const items = g.items.map(e => e.d);
      const groupSubtotal = items.reduce((s, d) => s + d.lt, 0);
      const categories = new Set(items.map(d => d.name).filter(n => n));
      const catCount = categories.size;
      let setRate = 1.0, setLabel = '';
      if (catCount >= 9) { setRate = set9Rate; setLabel = `≥9种品类`; }
      else if (catCount >= 4) { setRate = set4Rate; setLabel = `≥4种品类`; }
      const groupDiscounted = groupSubtotal * setRate;
      productsTotal += groupDiscounted;
      g.items.forEach(e => { itemGroupRate[e.i] = setRate; });
      groupDetails.push({ patternId: g.label, isManual: g.isManual, items, groupSubtotal, catCount, setRate, setLabel, groupDiscounted });
    });
    noPatternIdx.forEach(i => { productsTotal += productDetails[i].lt; });
  } else {
    productsTotal = productDetails.reduce((s, d) => s + d.lt, 0);
  }

  // Step 3: Extras (no same-model, no SET) — split bound / unbound by 制品序号
  // AP轮：绑定加价继承绑定制品的 SET 组折扣率
  let extrasTotal = 0;
  const extraDetails = [];
  const boundMap = {};   // origIdx -> [extras]
  const unboundExtras = [];
  _dcExtras.forEach(e => {
    const price = parseFloat(e.price) || 0;
    const qty = parseInt(e.quantity) || 0;
    const lt = price * qty;
    const bs = e.bindSeq || 'none';
    // CT轮：加价项目与制品一起算入折扣——绑定加价继承其绑定制品的 SET 组折扣率；未绑定保持原价
    let groupRate = 1.0;
    if (bs !== 'none') {
      const bi = parseInt(bs, 10) - 1;
      if (bi >= 0 && bi < _dcProducts.length) groupRate = itemGroupRate[bi] ?? 1.0;
    }
    const ex = { name: e.name, qty, lt, bindSeq: bs, groupRate };
    extraDetails.push(ex);
    extrasTotal += lt;
    if (bs !== 'none') {
      const bi = parseInt(bs, 10) - 1;
      if (bi >= 0 && bi < _dcProducts.length) {
        if (!boundMap[bi]) boundMap[bi] = [];
        boundMap[bi].push(ex);
      } else { unboundExtras.push(ex); }
    } else { unboundExtras.push(ex); }
  });

  // Step 4: 拆分 制品(原价) 与 加价项目(原价) 的 加急/非加急 基数
  // 计算顺序：制品→同模→SET/折扣→加价项目→加急→用途；加价项目不纳入SET/折扣
  // 单制品/部分加急时，加急溢价基于原价（不受SET/折扣影响），故这里按原价拆分
  let prodUrgentBase = 0, prodNonUrgentBase = 0;     // 制品 原价 基数（用于加急溢价）
  let extraUrgentBase = 0, extraNonUrgentBase = 0;   // 加价项目 原价 基数
  productDetails.forEach(d => {
    if (d.urgent) prodUrgentBase += d.lt; else prodNonUrgentBase += d.lt;   // 制品按原价拆分
    // 绑定加价项目不随制品加急乘倍率，仅作为 extrasTotal 原价计入总价
  });
  // 未绑定加价：不随单制品加急乘倍率；整单加急时统一在 Step7 对 (afterDiscount+extrasTotal) 乘倍率
  unboundExtras.forEach(ex => {
    extraNonUrgentBase += ex.lt;
  });
  const baseBeforeDiscount = prodUrgentBase + prodNonUrgentBase;   // 折扣只作用于制品原价（不含加价项目）
  const urgentEnabled = (prodUrgentBase + extraUrgentBase) > 0;    // 加急基数含制品+加价项目

  // Step 5: 折扣（作用于（制品+加价），在加急之前）——符合 原价-同模-加价-折扣-加急-用途
  let discHTML = '';
  let fanHTML = '';     // DL轮：同担/同推优惠独立列出（最终抵扣，从 finalPrice 扣除）
  let discFirst = true; // 折扣HTML内首行加 promo-first，让制品→首条优惠间距加大
  const discCls = () => {
    const cls = 'dc-rr disc' + (discFirst ? ' promo-first' : '');
    discFirst = false;
    return cls;
  };
  let afterDiscount = baseBeforeDiscount + extrasTotal;   // 默认无优惠模式：总价含加价项目
  if (dMode === 'set') {
    // CT轮：加价项目与制品一起算入折扣——绑定加价跟随对应制品的SET组折扣率，未绑定加价保持原价
    let extrasAfterSet = 0;
    extraDetails.forEach(ex => { extrasAfterSet += ex.lt * (ex.groupRate || 1.0); });
    afterDiscount = productsTotal + extrasAfterSet;
  }
  if (dMode === 'discount') {
    let d = baseBeforeDiscount + extrasTotal;    // CT轮：折扣作用于（制品+加价）整体
    const mCheck = document.getElementById('dcDiscMulti');
    if (mCheck && mCheck.checked) {
      // Bn轮：阈值=净不同制品数量（排除同模、同柄）；九折只作用于净制品金额，加价项目保持原价
      const patternFreq = {};
      productDetails.forEach(x => { if (x.patternId) patternFreq[x.patternId] = (patternFreq[x.patternId] || 0) + 1; });
      let netQty = 0, netBase = 0;
      productDetails.forEach((x, i) => {
        const p = _dcProducts[i];
        if (!p) return;
        if (p.sameModel) return;                                  // 同模排除
        if (x.patternId && patternFreq[x.patternId] > 1) return;   // 同柄（共享柄图标识）排除
        const gr = itemGroupRate[i] || 1.0;
        const basePre = x.lt * gr;                                // 制品基价(含SET组折扣)，不含加价项目/加急/用途
        netBase += basePre;
        netQty += x.qty;
      });
      if (netQty >= 8) {
        const mInp = document.querySelector('input[data-disc="multi"]');
        const mR = mInp ? (parseFloat(mInp.value) || 0.9) : 0.9;
        const after = netBase * mR;
        d = baseBeforeDiscount + extrasTotal - netBase + after;    // 仅净制品部分打折；加价项目保持原价
        discHTML += `<div class="${discCls()}"><span>折扣优惠：不同制品≥8件</span><span>×${mR}</span></div>`;
      }
    }
    _dcCustomDiscs.forEach((cd, ci) => {
      const cdCheck = document.querySelector(`input[data-cdisc-check="${ci}"]`);
      if (cdCheck && cdCheck.checked && cd.value > 0) {
        if (cd.type === 'rate') {
          d = d * cd.value;   // CT轮：对整体（含加价）打折
          discHTML += `<div class="${discCls()}"><span>${esc(cd.name || '自定义' + (ci+1))}</span><span>×${cd.value}</span></div>`;
        } else {
          d = d - cd.value;
          discHTML += `<div class="${discCls()}"><span>${esc(cd.name || '自定义' + (ci+1))}</span><span>-¥${cd.value.toFixed(2)}</span></div>`;
        }
      }
    });
    afterDiscount = d;
  }

  // Step 6: 同担/同推优惠（仅生成展示 HTML；计算移到 Step 8 之后，作为最终抵扣）
  if (_dcFanReduce > 0) {
    fanHTML += `<div class="${discCls()}"><span>同担/同推优惠</span><span>-¥${_dcFanReduce.toFixed(2)}</span></div>`;
  }

  // Step 7: 加急
  // 顺序：制品→同模→SET/折扣→加价项目→加急→用途
  // CT轮：afterDiscount 已含加价折扣后金额；加价项目不乘加急倍率，加急溢价仅基于制品原价 prodUrgentBase
  // 单制品/部分加急：加急溢价 = prodUrgentBase * (urgentRate-1)
  // 整单加急：grandTotal = afterDiscount * urgentRate（折扣后整体含加价乘倍率）
  let grandTotal = 0;
  if (baseBeforeDiscount > 0) {
    if (_dcWholeOrderUrgent) {
      grandTotal = afterDiscount * urgentRate;
    } else {
      const urgentPremium = prodUrgentBase * (urgentRate - 1);
      grandTotal = afterDiscount + urgentPremium;
    }
  }

  // Step 8: 用途倍率作用于折扣后整体（afterDiscount 已含制品+加价折扣后金额）
  // DL/DM轮：同担/同推优惠作为最终抵扣，在倍率计算之后扣除；倍率小计保持未扣前金额
  const priceBeforeFan = grandTotal + afterDiscount * (uRate - 1);
  const finalPrice = Math.max(0, priceBeforeFan - _dcFanReduce);

  // Save rates
  const settings = DB.get('calcSettings', {});
  settings.usageRates = {}; DC_USAGE.forEach(t => { const inp = document.querySelector(`input[data-usage="${t.value}"]`); if (inp) settings.usageRates[t.value] = parseFloat(inp.value) || t.rate; });
  settings.setRates = {}; DC_SET.forEach(s => { const inp = document.querySelector(`input[data-set="${s.value}"]`); if (inp) settings.setRates[s.value] = parseFloat(inp.value) || s.rate; });
  const mInp = document.querySelector('input[data-disc="multi"]'); if (mInp) settings.discMultiRate = parseFloat(mInp.value) || 0.9;
  DB.set('calcSettings', settings);

  // Render receipt
  const receipt = $('#dc-receipt');
  if (!receipt) return;
  let r = '<div class="dc-r-title">实时报价</div>';
  let prodIdx = 0;
  // 渲染某制品序号下绑定的加价项目（缩进展示，构成 ├─/└─ 树）
  // urgentAfter=true 时表示该产品下方还会紧跟「└─加急」行，故绑定加价最后一项用 ├─（而非 └─），树形才正确
  const renderBoundExtras = (origIdx, urgentAfter) => {
    const list = boundMap[origIdx];
    if (!list || !list.length) return '';
    const visible = list.filter(d => d.name || d.lt);
    const n = visible.length;
    if (!n) return '';
    const lastConnector = urgentAfter ? '├─' : '└─';
    let s = '';
    visible.forEach((d, k) => {
      const tree = (k === n - 1) ? lastConnector : '├─';
      s += `<div class="dc-rr bound"><span><i class="dc-r-tree">${tree}</i>${esc(d.name || '未命名')} ×${d.qty}</span><span>¥${d.lt.toFixed(2)}</span></div>`;
    });
    return s;
  };

  const whole = !!_dcWholeOrderUrgent;
  const showInlineUrgent = urgentEnabled && !whole;   // 单行/部分制品加急→分组内内联；整单→底部独立块
  const pad2 = n => String(n).padStart(2, '0');

  if (dMode === 'set' && groupDetails.length) {
    groupDetails.forEach(g => {
      r += `<div class="dc-r-section"><div class="dc-r-sub">${g.isManual ? 'SET组' : '柄图：' + esc(g.patternId)}（${g.catCount}种品类）</div>`;
      const urgentSeqs = [];
      g.items.forEach(d => {
        if (!d.name && !d.price) return;
        const tag = d.useModel ? '（同模）' : '';
        prodIdx++;
        r += `<div class="dc-rr"><span><i class="dc-r-no">${pad2(prodIdx)}</i>${esc(d.name || '未命名')} ×${d.qty}${tag}</span><span>¥${d.lt.toFixed(2)}</span></div>`;
        if (d.useModel) r += `<div class="dc-rr sub"><span>${d.modelBreakdown}</span><span></span></div>`;
        // 若本品单行加急（非整单），绑定加价下方还会紧跟「└─加急」，故传入 urgentAfter 修正末连接符
        r += renderBoundExtras(d.idx, !whole && d.actualUrgent);
        // 单项加急：制品下方树状「└─加急」（非整单；整单加急在底部独立块），与汇总行「加急：序号 ×倍率」并存
        if (!whole && d.actualUrgent) {
          r += `<div class="dc-rr bound"><span><i class="dc-r-tree">└─</i>加急</span><span></span></div>`;
        }
        if (d.actualUrgent) urgentSeqs.push(prodIdx);
      });
      // 组内基数：制品含SET折扣，绑定加价跟随其制品SET折扣率（CT轮：一起算入折扣）
      let groupWithBound = 0, groupUrgentWB = 0;
      g.items.forEach(d => {
        const boundLt = (boundMap[d.idx] || []).reduce((s, ex) => s + ex.lt * ex.groupRate, 0);  // 绑定加价跟随SET折扣
        const base = d.lt * (itemGroupRate[d.idx] ?? 1.0) + boundLt;  // 制品折扣后 + 加价折扣后
        groupWithBound += base;
        if (d.actualUrgent) groupUrgentWB += d.lt;  // 单制品加急溢价仅基于制品原价，不含绑定加价
      });
      // 整单加急：组内不含加急；否则按组内加急原价上浮溢价
      const groupDisplay = whole ? groupWithBound : (groupWithBound + groupUrgentWB * (urgentRate - 1));
      // SET优惠（行下方接加急/小计）
      if (g.setRate < 1.0) {
        r += `<div class="dc-rr promo promo-first"><span>SET优惠：${esc(g.setLabel)}</span><span>×${g.setRate}</span></div>`;
      }
      // 单行/部分制品加急→置于SET优惠行下方，样式与SET优惠统一（整单加急不在组内输出）
      if (showInlineUrgent && urgentSeqs.length) {
        const allUrgent = urgentSeqs.length === g.items.length;
        const label = allUrgent ? 'SET加急' : `加急：${urgentSeqs.map(pad2).join('、')}`;
        r += `<div class="dc-rr promo"><span>${label}</span><span>×${urgentRate}</span></div>`;
      }
      // 折后小计（整单含加急；组内已含加急则上浮后金额）
      r += `<div class="dc-rr total"><span>${g.setRate < 1.0 ? '折后小计' : '金额'}</span><span>¥${groupDisplay.toFixed(2)}</span></div>`;
      r += '</div>';
    });
    const noPatternItems = productDetails.filter(d => !d.setGroup && !d.patternId && (d.name || d.price));
    if (noPatternItems.length) {
      r += '<div class="dc-r-section"><div class="dc-r-sub">无柄图制品</div>';
      const urgentSeqs = [];
      noPatternItems.forEach(d => {
        const tag = d.useModel ? '（同模）' : '';
        prodIdx++;
        r += `<div class="dc-rr"><span><i class="dc-r-no">${pad2(prodIdx)}</i>${esc(d.name || '未命名')} ×${d.qty}${tag}</span><span>¥${d.lt.toFixed(2)}</span></div>`;
        if (d.useModel) r += `<div class="dc-rr sub"><span>${d.modelBreakdown}</span><span></span></div>`;
        // 若本品单行加急（非整单），绑定加价下方还会紧跟「└─加急」，故传入 urgentAfter 修正末连接符
        r += renderBoundExtras(d.idx, !whole && d.actualUrgent);
        // 单项加急：制品下方树状「└─加急」（非整单；整单加急在底部独立块），与汇总行「加急：序号 ×倍率」并存
        if (!whole && d.actualUrgent) {
          r += `<div class="dc-rr bound"><span><i class="dc-r-tree">└─</i>加急</span><span></span></div>`;
        }
        if (d.actualUrgent) urgentSeqs.push(prodIdx);
      });
      let groupWithBound = 0, groupUrgentWB = 0;
      noPatternItems.forEach(d => {
        const boundLt = (boundMap[d.idx] || []).reduce((s, ex) => s + ex.lt * ex.groupRate, 0);  // 加价跟随折扣
        const base = d.lt + boundLt;
        groupWithBound += base;
        if (d.actualUrgent) groupUrgentWB += d.lt;  // 单制品加急溢价仅基于制品原价，不含绑定加价
      });
      const groupDisplay = whole ? groupWithBound : (groupWithBound + groupUrgentWB * (urgentRate - 1));
      if (showInlineUrgent && urgentSeqs.length) {
        r += `<div class="dc-rr promo promo-first"><span>加急：${urgentSeqs.map(pad2).join('、')}</span><span>×${urgentRate}</span></div>`;
      }
      r += `<div class="dc-rr total"><span>金额</span><span>¥${groupDisplay.toFixed(2)}</span></div>`;
      r += '</div>';
    }
    // 同担/同推优惠（订单级折扣）置于分组之后、加急底部块之前
    if (discHTML) { r += '<div class="dc-r-section"><div class="dc-r-sub">优惠</div>' + discHTML + '</div>'; }
  } else {
    r += '<div class="dc-r-section"><div class="dc-r-sub">制品明细</div>';
    const urgentSeqs = [];
    productDetails.forEach(d => {
      if (!d.name && !d.price) return;
      const tag = d.useModel ? '（同模）' : '';
      const pTag = d.patternId ? `［${esc(d.patternId)}］` : '';
      prodIdx++;
      r += `<div class="dc-rr"><span><i class="dc-r-no">${pad2(prodIdx)}</i>${esc(d.name || '未命名')} ×${d.qty}${tag}${pTag}</span><span>¥${d.lt.toFixed(2)}</span></div>`;
      if (d.useModel) r += `<div class="dc-rr sub"><span>${d.modelBreakdown}</span><span></span></div>`;
      // 若本品单行加急（非整单），绑定加价下方还会紧跟「└─加急」，故传入 urgentAfter 修正末连接符
      r += renderBoundExtras(d.idx, !whole && d.actualUrgent);
      // 单项加急：制品下方树状「└─加急」，并汇总到分组尾部「加急：序号」
      if (!whole && d.actualUrgent) {
        r += `<div class="dc-rr bound"><span><i class="dc-r-tree">└─</i>加急</span><span></span></div>`;
      }
      if (d.actualUrgent) urgentSeqs.push(prodIdx);
    });
    // 折扣优惠（多件折扣/自定义/同担）内联于明细内、加急行之前
    if (discHTML) { r += discHTML; }
    if (showInlineUrgent && urgentSeqs.length) {
      const urgentFirstCls = discHTML ? '' : ' promo-first';
      r += `<div class="dc-rr promo${urgentFirstCls}"><span>加急：${urgentSeqs.map(pad2).join('、')}</span><span>×${urgentRate}</span></div>`;
    }
    // 折后小计：整单加急时不含加急溢价（下方独立展示）；单项/部分加急时，加急溢价已内联在明细中，折后小计含该溢价
    const flatSubtotal = whole ? afterDiscount : grandTotal;
    // v229: 没有折扣时显示“制品小计”
    const noDiscountLabel = !discHTML && !_dcFanReduce ? '制品小计' : '折后小计';
    r += `<div class="dc-rr total"><span>${noDiscountLabel}</span><span>¥${flatSubtotal.toFixed(2)}</span></div>`;
    r += '</div>';
  }
  if (unboundExtras.length) {
    r += '<div class="dc-r-section"><div class="dc-r-sub">加价项目（不绑定）</div>';
    unboundExtras.forEach(d => {
      if (!d.name && !d.lt) return;
      r += `<div class="dc-rr"><span><i class="dc-r-no">${pad2(++prodIdx)}</i>${esc(d.name || '未命名')} ×${d.qty}</span><span>¥${d.lt.toFixed(2)}</span></div>`;
    });
    r += `<div class="dc-rr total"><span>加价合计</span><span>¥${extrasTotal.toFixed(2)}</span></div></div>`;
  }
  // 整单加急：底部独立区块（分组内不输出加急行）；基数含制品+加价折扣后整体
  if (whole && urgentEnabled) {
    const fullBaseAfterDisc = afterDiscount;     // 折扣后整体（含加价）
    const urgentSub = fullBaseAfterDisc * urgentRate;
    r += `<div class="dc-r-section"><div class="dc-r-sub">整单加急</div>`;
    r += `<div class="dc-rr"><span>制品小计</span><span>¥${fullBaseAfterDisc.toFixed(2)}</span></div>`;
    r += `<div class="dc-rr"><span>加急倍率</span><span>×${urgentRate}</span></div>`;
    r += `<div class="dc-rr total"><span>加急小计</span><span>¥${urgentSub.toFixed(2)}</span></div></div>`;
  }
  // 总价 =（制品+加价）×加急（已含折扣与加急倍率，未含用途倍率）
  r += `<div class="dc-r-section"><div class="dc-rr grand-bar"><span>总价</span><span>¥${grandTotal.toFixed(2)}</span></div></div>`;
  // 倍率计算（稿件用途倍率）——置于原位置（总价之后）；小计采用新公式 grandTotal + afterDiscount×(uRate−1)
  r += '<div class="dc-r-section"><div class="dc-r-sub">倍率计算</div>';
  r += `<div class="dc-rr"><span>稿件用途：${uType}</span><span>×${uRate}</span></div>`;
  r += `<div class="dc-rr total"><span>倍率小计</span><span>¥${priceBeforeFan.toFixed(2)}</span></div></div>`;
  // DL轮：同担/同推优惠独立列出，置于倍率计算之后（已从 finalPrice 中扣除）
  if (fanHTML) { r += '<div class="dc-r-section">' + fanHTML + '</div>'; }
  r += '<div class="dc-r-final"><div class="dc-r-final-label">最终报价</div>';
  r += `<div class="dc-r-final-val">¥${finalPrice.toFixed(2)}</div></div>`;
  const deposit = Math.round(finalPrice * 0.5 * 100) / 100;
  const balance = Math.round(finalPrice * 0.5 * 100) / 100;
  r += '<div class="dc-r-deposit-balance">';
  r += `<div class="dc-r-deposit"><div class="dc-r-db-label">定金(50%)</div><div class="dc-r-db-val">¥${deposit.toFixed(2)}</div></div>`;
  r += `<div class="dc-r-balance"><div class="dc-r-db-label">尾款(50%)</div><div class="dc-r-db-val">¥${balance.toFixed(2)}</div></div>`;
  r += '</div>';
  // AT轮：修改加价、最终总价、需付尾款（DY轮回退 DV/DW/DX，恢复 v163 普通小计行）
  const modTotal = dcCalcModTotal();
  if (modTotal > 0) {
    const balancePayable = balance + modTotal;
    const finalTotal = finalPrice + modTotal;
    r += '<div class="dc-r-section" style="margin-top:14px">';
    r += '<div class="dc-r-sub">修改项目</div>';
    _dcModifications.forEach(function(m){
      const _mt = esc(m.modifyType || '未填写');
      const _cnt = parseInt(m.modifyCount) || 0;
      const _sub = _cnt * (parseFloat(m.modifyPrice) || 0);
      r += `<div class="dc-rr"><span>${_mt} × ${_cnt}</span><span>¥${_sub.toFixed(2)}</span></div>`;
    });
    r += `<div class="dc-rr total"><span>最终总价</span><span>¥${finalTotal.toFixed(2)}</span></div>`;
    // DY6轮：双按钮改为与「最终报价」(.dc-r-final) 同款实心蓝块（白字居中），仅并排两列
    r += '<div class="dc-r-final-balance">';
    r += `<div class="dc-r-final"><div class="dc-r-final-label">最终总价</div><div class="dc-r-final-val">¥${finalTotal.toFixed(2)}</div></div>`;
    r += `<div class="dc-r-final"><div class="dc-r-final-label">需付尾款</div><div class="dc-r-final-val">¥${balancePayable.toFixed(2)}</div></div>`;
    r += '</div>';
    r += '</div>';
  }
  r += '<div class="dc-r-footer">@筱小葵｜专属报价・仅供本次使用</div>';
  receipt.innerHTML = r;
}

function dcGetFinalPrice() {
  const el = document.querySelector('.dc-r-final-val');
  if (el) return parseFloat(el.textContent.replace(/[¥,]/g, '')) || 0;
  return 0;
}

/* ===== Export Receipt as Image ===== */
function dcExportReceipt() {
  const receipt = $('#dc-receipt');
  if (!receipt) return;
  if (typeof html2canvas === 'undefined') {
    Toast.error('图片导出库未加载，请检查网络连接后重试');
    return;
  }
  Toast.info('正在生成报价图片...');
  html2canvas(receipt, { backgroundColor: '#ffffff', scale: 2, logging: false }).then(canvas => {
    const link = document.createElement('a');
    link.download = '报价单_' + nowStamp() + '.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
    Toast.success('报价图已导出');
  }).catch(() => Toast.error('导出失败，请重试'));
}

function dcUpdateQuote() {
  if (!_dcImportId) { Toast.error('请先选择接稿记录'); return; }
  const price = dcGetFinalPrice();
  const rec = DB.getById('commissions', _dcImportId);
  if (!rec) { Toast.error('接稿记录不存在'); return; }
  const modTotal = dcCalcModTotal();
  const finalTotal = price + modTotal;
  rec.quoteAmount = price;
  rec.deposit = Math.round(price * 0.5 * 100) / 100;
  rec.balance = Math.round(price * 0.5 * 100) / 100;
  rec.modifications = _dcModifications.map(m => ({ modifyType: m.modifyType, modifyCount: m.modifyCount, modifyPrice: m.modifyPrice, note: m.note }));
  rec.isUrgent = _dcWholeOrderUrgent ? ['是'] : ['否'];
  rec.amount = finalTotal;
  DB.update('commissions', _dcImportId, rec);
  Toast.success('报价金额已更新至接稿记录');
}

function dcCreateCommission() {
  const price = dcGetFinalPrice();
  const modTotal = dcCalcModTotal();
  const finalTotal = price + modTotal;
  const uRadio = document.querySelector('input[name="dcUsage"]:checked');
  const usageType = uRadio ? [uRadio.value] : ['自用'];
  const urgentInp = document.querySelector('input[data-urgent="rate"]');
  const urgentRate = urgentInp ? (parseFloat(urgentInp.value) || 1.0) : 1.0;
  // v17: 从价目表自动识别制品的 defaultSize
  const priceList = DB.list('priceList');
  DB.add('commissions', {
    clientInfo: '', acceptTime: todayStr(), deadline: '', usageType,
    products: _dcProducts.map(p => {
      const plItem = priceList.find(pp => pp.product === p.name && PRODUCT_CATEGORIES.includes(pp.category));
      const sizeAuto = p.size || (plItem && plItem.defaultSize ? plItem.defaultSize : '');
      let sm = '无同模', smRate = undefined;
      if (p.sameModel) {
        if (p.sameModelType) { sm = p.sameModelType; smRate = p.sameModelRate; }
        else if (_dcGlobalModelType) { sm = _dcGlobalModelType; const gm = DC_MODEL.find(m => m.value === _dcGlobalModelType); smRate = gm ? gm.rate : undefined; }
      }
      return { name: p.name, patternId: p.patternId || '', size: sizeAuto, quantity: p.quantity, price: p.price, sameModel: sm, sameModelRate: smRate, urgent: !!p.urgent };
    }),
    sameDesign: [], extraItems: _dcExtras.map(e => ({ name: e.name, quantity: e.quantity, price: e.price, bindSeq: e.bindSeq || 'none' })),
    modifications: _dcModifications.map(m => ({ modifyType: m.modifyType, modifyCount: m.modifyCount, modifyPrice: m.modifyPrice, note: m.note })),
    urgentRate,
    isUrgent: _dcWholeOrderUrgent ? ['是'] : ['否'],
    quoteAmount: price, deposit: Math.round(price * 0.5 * 100) / 100, balance: Math.round(price * 0.5 * 100) / 100,
    paymentStatus: ['未付'], progress: ['待接稿'], modifyCount: 0, amount: finalTotal, notes: '由报价计算器创建',
  });
  Toast.success('已新增接稿记录，可在接稿排期中查看');
}

/* ===== Price List Custom Renderer (需求9: 菜单风格, 其他说明可折叠) ===== */
function renderPriceList() {
  const body = $('#mainBody');
  if (!pageState['design-pricelist']) pageState['design-pricelist'] = { search: '', filters: {} };
  const ps = pageState['design-pricelist'];
  let records = DB.list('priceList');
  if (ps.search) records = records.filter(r => JSON.stringify(r).toLowerCase().includes(ps.search.toLowerCase()));
  const settings = getSettings();
  const notes = settings.priceListNotes || [];

  const groups = {};
  records.forEach(r => {
    const cat = r.category || '未分类';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(r);
  });
  // v29: 类目内置 sort 字段，支持手动排序
  Object.keys(groups).forEach(cat => {
    groups[cat].forEach((r, i) => { if (typeof r.sort !== 'number') r.sort = i; });
    groups[cat].sort((a, b) => (a.sort) - (b.sort));
  });
  DB.save('priceList', records);
  const sortedCats = Object.keys(groups).sort((a, b) => {
    const order = ['纸片类', '其他材质类', '线上&应援类', '加价项目'];
    const ai = order.indexOf(a), bi = order.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b, 'zh-CN');
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  let html = '<div class="fade-in">';
  // v27: toolbar→其他说明 8px（用 inline mb 覆盖 .toolbar 默认 mb:16，避免塌陷）
  html += '<div class="toolbar" style="margin-bottom:8px">';
  html += `<div class="search-box"><input type="text" placeholder="搜索制品/分类..." value="${esc(ps.search)}" oninput="onSearch('design-pricelist', this.value)"><span class="search-icon">🔍</span></div>`;
  html += '<div class="spacer"></div>';
  html += '<button class="btn btn-outline toolbar-eq" onclick="togglePriceListNotes()">📝 其他说明</button>';
  html += '<button class="btn btn-outline toolbar-eq" onclick="openPriceListSort()">↕️ 排序编辑</button>';
  html += '<button class="btn btn-primary" onclick="openAddForm(\'design-pricelist\')">+ 新增价目</button>';
  html += '</div>';

  // Collapsible 其他说明（v26: toolbar→其他说明 12px）
  if (notes.length) {
    html += '<div style="margin-bottom:10px">';
    html += '<div class="collapsible-toggle" onclick="this.classList.toggle(\'open\');this.nextElementSibling.classList.toggle(\'open\')">';
    html += '<span>其他说明</span><span class="toggle-arrow">▼</span></div>';
    html += '<div class="collapsible-content">';
    html += '<div class="pricelist-notes-panel" style="margin-top:8px;margin-bottom:8px">';
    html += '<div class="pricelist-notes-grid">';
    notes.forEach(n => {
      html += '<div class="pricelist-note-item">';
      html += `<div class="pricelist-note-title">${esc(n.title)}</div>`;
      const contentHtml = (n.content || '').split('\n').map(line => `<div>${esc(line)}</div>`).join('');
      html += `<div class="pricelist-note-content">${contentHtml}</div>`;
      html += '</div>';
    });
    html += '</div></div>';
    html += '</div></div>';
  }

  if (!records.length) {
    html += '<div class="empty-state"><div class="empty-icon">💰</div><div class="empty-text">暂无价目，点击「新增价目」开始添加</div></div>';
  } else {
    // Menu/receipt style layout
    html += '<div class="pricelist-menu">';
    html += '<div class="pricelist-menu-header">价目表</div>';
    sortedCats.forEach(cat => {
      const items = groups[cat];
      const desc = items.find(i => i.description)?.description || '';
      html += `<div class="pricelist-menu-category">${esc(cat)}</div>`;
      items.forEach(r => {
        html += `<div class="pricelist-menu-item" onclick="openEditForm('design-pricelist','${r.id}')">`;
        html += `<span class="menu-name">${esc(r.product || '未命名')}${r.defaultSize ? `<sub class="menu-size-sub">(${esc(r.defaultSize)})</sub>` : ''}</span>`;
        const priceUnit = Array.isArray(r.priceUnit) ? (r.priceUnit[0] || '元') : (r.priceUnit || '元');
        const unitSuffix = priceUnit === '元' ? '' : priceUnit.replace('元', '');
        const priceText = `¥${esc(r.price || 0)}${esc(unitSuffix)}`;
        html += `<span class="menu-price">${priceText}</span>`;
        html += '</div>';
      });
      if (desc) {
        html += `<div style="padding:6px 0;font-size:11px;color:var(--c-text-muted);white-space:pre-wrap">${esc(desc)}</div>`;
      }
    });
    html += '</div>';
  }

  html += '</div>';
  body.innerHTML = html;
}

// v29-fix: 价目表条目上下移动排序（同类目内交换 sort，不自动刷新页面）
function priceItemMove(id, dir) {
  const list = DB.list('priceList');
  const item = list.find(r => r.id === id);
  if (!item) return;
  const cat = item.category || '未分类';
  const group = list.filter(r => (r.category || '未分类') === cat).sort((a, b) => (a.sort) - (b.sort));
  group.forEach((r, i) => { r.sort = i; });
  const idx = group.findIndex(r => r.id === id);
  const swapIdx = idx + dir;
  if (swapIdx < 0 || swapIdx >= group.length) return;
  const a = group[idx], b = group[swapIdx];
  const t = a.sort; a.sort = b.sort; b.sort = t;
  DB.save('priceList', list);
}

// v29-fix: 独立弹窗调整价目表排序
function openPriceListSort() {
  const records = DB.list('priceList');
  const groups = {};
  records.forEach(r => { const cat = r.category || '未分类'; if (!groups[cat]) groups[cat] = []; groups[cat].push(r); });
  Object.keys(groups).forEach(cat => {
    groups[cat].forEach((r, i) => { if (typeof r.sort !== 'number') r.sort = i; });
    groups[cat].sort((a, b) => (a.sort) - (b.sort));
  });
  DB.save('priceList', records);
  const sortedCats = Object.keys(groups).sort((a, b) => {
    const order = ['纸片类', '其他材质类', '线上&应援类', '加价项目'];
    const ai = order.indexOf(a), bi = order.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b, 'zh-CN');
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  let html = '<div class="pricelist-sort-panel">';
  sortedCats.forEach(cat => {
    html += `<div class="pricelist-sort-category">${esc(cat)}</div>`;
    groups[cat].forEach((r, i) => {
      const isFirst = i === 0, isLast = i === groups[cat].length - 1;
      html += '<div class="pricelist-sort-item">';
      html += `<span class="sort-name">${esc(r.product || '未命名')}${r.defaultSize ? `<sub class="menu-size-sub">(${esc(r.defaultSize)})</sub>` : ''}</span>`;
      html += `<span class="sort-price">¥${esc(r.price || 0)}</span>`;
      html += `<span class="sort-btns">`;
      html += `<button class="btn btn-ghost btn-sm" ${isFirst ? 'disabled' : ''} onclick="event.stopPropagation();priceItemMove('${r.id}',-1);openPriceListSort();">▲</button>`;
      html += `<button class="btn btn-ghost btn-sm" ${isLast ? 'disabled' : ''} onclick="event.stopPropagation();priceItemMove('${r.id}',1);openPriceListSort();">▼</button>`;
      html += `<span class="btn-icon" style="font-size:12px;width:24px;height:24px" onclick="event.stopPropagation();openEditForm('design-pricelist','${r.id}')">✏️</span>`;
      html += `<span class="btn-icon danger" style="font-size:12px;width:24px;height:24px" onclick="event.stopPropagation();onDelete('design-pricelist','${r.id}')">🗑️</span>`;
      html += '</span></div>';
    });
  });
  html += '</div>';
  openModal('调整价目排序', html, [{ label: '完成', class: 'btn-primary', action: () => { closeModal(); renderPriceList(); } }]);
}

function editPriceListNotes() {
  const settings = getSettings();
  const notes = settings.priceListNotes || [];
  const defaultText = notes.map(n => `${n.title} | ${(n.content || '').replace(/\n/g, ' / ')}`).join('\n');
  const fields = [
    { key: 'notesText', label: '规则说明', type: 'textarea', placeholder: '每行一条规则，格式：标题 | 内容\n换行用 / 分隔' },
  ];
  const bodyHTML = buildForm(fields, { notesText: defaultText });
  openModal('编辑其他说明', bodyHTML, [
    { label: '取消', class: 'btn-ghost', action: closeModal },
    {
      label: '保存', class: 'btn-primary', action: () => {
        const vals = readForm($('#modalBody'));
        const lines = (vals.notesText || '').split('\n').map(s => s.trim()).filter(Boolean);
        const newNotes = lines.map(line => {
          const idx = line.indexOf('|');
          if (idx === -1) return { title: line, content: '' };
          return { title: line.slice(0, idx).trim(), content: line.slice(idx + 1).trim().replace(/ \/ /g, '\n') };
        });
        settings.priceListNotes = newNotes;
        saveSettings(settings);
        closeModal();
        renderPriceList();
        Toast.success('已保存其他说明');
      }
    },
  ]);
}

/* ===== Settings Page (需求2: 导航栏图标自定义) ===== */
let _settingsTab = 'theme';
let _settingsModule = 'home';
function openSettings() {
  _settingsTab = 'theme';
  renderSettingsModal();
}
function openSyncPanel() {
  openSettings();
  // openSettings 会重置到 theme 标签，稍后切到数据管理（含云端同步）
  setTimeout(() => { _settingsTab = 'data'; renderSettingsModal(); }, 0);
}
async function syncTest() {
  if (!syncReadInputs()) { Toast.warning('请先填写完整的 URL、Anon Key 与同步码'); return; }
  const ok = await Sync.test();
  if (ok) Toast.success('连接成功，可点击「立即同步」');
}
function syncReadInputs() {
  const su = $('#sync_url'), sk = $('#sync_key'), sc = $('#sync_code');
  if (!su || !sk || !sc) return null;
  const url = su.value.trim(), anonKey = sk.value.trim(), syncCode = sc.value.trim();
  if (!url || !anonKey || !syncCode) return null;
  if (!Sync.cfg || Sync.cfg.url !== url || Sync.cfg.anonKey !== anonKey || Sync.cfg.syncCode !== syncCode) {
    DB.set('syncCfg', { url, anonKey, syncCode });
    Sync.load();
  }
  return true;
}
async function syncNow() {
  if (!syncReadInputs()) { Toast.warning('请先填写完整的 URL、Anon Key 与同步码'); return; }
  await Sync.fullSync();
}
function renderSettingsModal() {
  let html = '<div class="settings-tabs">';
  html += `<div class="settings-tab ${_settingsTab === 'theme' ? 'active' : ''}" onclick="switchSettingsTab('theme')">配色设置</div>`;
  html += `<div class="settings-tab ${_settingsTab === 'navicons' ? 'active' : ''}" onclick="switchSettingsTab('navicons')">导航图标</div>`;
  html += `<div class="settings-tab ${_settingsTab === 'fields' ? 'active' : ''}" onclick="switchSettingsTab('fields')">版块设置</div>`;
  html += `<div class="settings-tab ${_settingsTab === 'data' ? 'active' : ''}" onclick="switchSettingsTab('data')">数据管理</div>`;
  html += '</div>';
  if (_settingsTab === 'theme') html = renderThemeSettings(html);
  else if (_settingsTab === 'navicons') html = renderNavIconSettings(html);
  else if (_settingsTab === 'fields') html = renderFieldSettings(html);
  else if (_settingsTab === 'data') html = renderDataSettings(html);
  openModal('设置', html, [
    { label: '关闭', class: 'btn-ghost', action: closeModal },
    { label: '保存', class: 'btn-primary', action: saveSettingsAction },
  ], 'lg');
}
function switchSettingsTab(tab) { _settingsTab = tab; renderSettingsModal(); }

function renderThemeSettings(html) {
  const s = getSettings();
  const t = s.theme;
  html += '<div class="settings-section active">';
  html += '<h4 style="font-size:14px;margin-bottom:12px;color:var(--c-primary)">预设主题</h4>';
  html += '<div class="preset-themes">';
  PRESET_THEMES.forEach(p => {
    html += `<div class="preset-theme" style="background:${p.primary}" onclick="applyPresetTheme('${p.name}')" title="${p.name}">${p.name}</div>`;
  });
  html += '</div>';
  html += '<h4 style="font-size:14px;margin:20px 0 12px;color:var(--c-primary)">自定义配色</h4>';
  const colors = [
    { key: 'primary', label: '主色' }, { key: 'primaryLight', label: '浅色' },
    { key: 'primaryDark', label: '深色' }, { key: 'primaryBg', label: '背景色' },
    { key: 'sidebarStart', label: '侧边栏起始' }, { key: 'sidebarEnd', label: '侧边栏结束' },
  ];
  colors.forEach(c => {
    html += `<div class="color-picker-row"><label>${c.label}</label><input type="color" id="set_${c.key}" value="${t[c.key]}"><input type="text" id="set_${c.key}_txt" value="${t[c.key]}"></div>`;
  });
  // 保存为方案
  html += '<div style="margin-top:16px;display:flex;gap:8px;align-items:center">';
  html += '<input type="text" class="form-input" id="set_custom_name" placeholder="方案名称" style="flex:1;min-width:0">';
  html += '<button class="btn btn-primary" style="flex-shrink:0" onclick="saveCustomTheme()">保存为方案</button>';
  html += '</div>';
  // 已保存方案
  const customThemes = (s.customThemes || []);
  if (customThemes.length) {
    html += '<h4 style="font-size:14px;margin:20px 0 12px;color:var(--c-primary)">已保存方案</h4>';
    html += '<div style="display:flex;flex-direction:column;gap:8px">';
    customThemes.forEach((ct, i) => {
      html += '<div style="display:flex;align-items:center;gap:8px;padding:8px;border:1px solid var(--c-border);border-radius:8px;background:var(--c-card)">';
      html += `<div style="width:28px;height:28px;border-radius:6px;background:${ct.primary};flex-shrink:0;border:1px solid var(--c-border-light)"></div>`;
      html += `<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600;color:var(--c-text)">${ct.name}</div><div style="font-size:11px;color:var(--c-text-muted)">${ct.primary}</div></div>`;
      html += `<button class="btn btn-outline" style="padding:4px 10px;font-size:12px;flex-shrink:0" onclick="applyCustomTheme(${i})">应用</button>`;
      html += `<button class="btn btn-ghost" style="padding:4px 10px;font-size:12px;flex-shrink:0;color:#e74c3c" onclick="deleteCustomTheme(${i})">删除</button>`;
      html += '</div>';
    });
    html += '</div>';
  }
  html += '</div>';
  return html;
}
function applyPresetTheme(name) {
  const p = PRESET_THEMES.find(t => t.name === name);
  if (!p) return;
  const s = getSettings();
  s.theme = { primary: p.primary, primaryLight: p.primaryLight, primaryDark: p.primaryDark, primaryBg: p.primaryBg, sidebarStart: p.sidebarStart, sidebarEnd: p.sidebarEnd };
  saveSettings(s);
  applyTheme(s.theme);
  renderSettingsModal();
  Toast.success('已应用「' + name + '」主题');
}
function saveCustomTheme() {
  const s = getSettings();
  if (!s.customThemes) s.customThemes = [];
  const nameEl = $('#set_custom_name');
  let name = nameEl ? nameEl.value.trim() : '';
  name = name.replace(/[<>&"]/g, '');
  if (!name) name = '我的配色' + (s.customThemes.length + 1);
  const theme = {};
  ['primary', 'primaryLight', 'primaryDark', 'primaryBg', 'sidebarStart', 'sidebarEnd'].forEach(k => {
    const el = $('#set_' + k);
    theme[k] = el ? el.value : (s.theme[k] || '#9DC8FF');
  });
  const exist = s.customThemes.findIndex(c => c.name === name);
  if (exist >= 0) s.customThemes[exist] = Object.assign({ name: name }, theme);
  else s.customThemes.push(Object.assign({ name: name }, theme));
  saveSettings(s);
  renderSettingsModal();
  Toast.success('已保存方案「' + name + '」');
}
function applyCustomTheme(idx) {
  const s = getSettings();
  const ct = (s.customThemes || [])[idx];
  if (!ct) return;
  s.theme = { primary: ct.primary, primaryLight: ct.primaryLight, primaryDark: ct.primaryDark, primaryBg: ct.primaryBg, sidebarStart: ct.sidebarStart, sidebarEnd: ct.sidebarEnd };
  saveSettings(s);
  applyTheme(s.theme);
  renderSettingsModal();
  Toast.success('已应用「' + ct.name + '」');
}
function deleteCustomTheme(idx) {
  const s = getSettings();
  const ct = (s.customThemes || [])[idx];
  if (!ct) return;
  s.customThemes.splice(idx, 1);
  saveSettings(s);
  renderSettingsModal();
  Toast.success('已删除方案「' + ct.name + '」');
}

function renderNavIconSettings(html) {
  const s = getSettings();
  const icons = s.navIcons || { ...DEFAULT_NAV_ICONS };
  html += '<div class="settings-section active">';
  html += '<h4 style="font-size:14px;margin-bottom:8px;color:var(--c-primary)">导航栏图标自定义</h4>';
  html += '<p style="font-size:12px;color:var(--c-text-muted);margin-bottom:12px">可分别自定义每个导航的图标（emoji/文字，留空用默认）与显示名称（留空用默认名称）</p>';
  html += '<div class="nav-icon-edit-list">';
  // Home
  html += renderNavIconEditItem('home', '首页', icons.home);
  // Groups
  NAV.slice(1).forEach(group => {
    group.children.forEach(child => {
      html += renderNavIconEditItem(child.key, child.label, icons[child.key]);
    });
  });
  html += '</div>';
  html += '</div>';
  return html;
}
function renderNavIconEditItem(key, label, currentIcon) {
  const currentLabel = getNavLabel(key, label);
  return `<div class="nav-icon-edit-item">
    <span class="icon-preview" id="navicon_preview_${key}">${esc(currentIcon || DEFAULT_NAV_ICONS[key] || '📌')}</span>
    <label class="nav-icon-edit-name">${esc(label)}</label>
    <input type="text" class="nav-icon-input" id="navicon_${key}" value="${esc(currentIcon || '')}" placeholder="${esc(DEFAULT_NAV_ICONS[key] || '📌')}" oninput="document.getElementById('navicon_preview_${key}').textContent=this.value||'${esc(DEFAULT_NAV_ICONS[key] || '📌')}'" title="图标">
    <input type="text" class="nav-label-input" id="navlabel_${key}" value="${esc(currentLabel !== label ? currentLabel : '')}" placeholder="${esc(label)}" title="名称">
  </div>`;
}

function renderFieldSettings(html) {
  html += '<div class="settings-section active">';
  html += '<div class="module-selector"><label style="font-size:13px;margin-right:8px">选择模块:</label>';
  const modules = Object.keys(MODULES).filter(k => MODULES[k].fields);
  html += `<select onchange="_settingsModule=this.value;renderSettingsModal()"><option value="">选择模块...</option>`;
  modules.forEach(k => {
    html += `<option value="${k}" ${_settingsModule === k ? 'selected' : ''}>${PAGE_TITLES[k] || k}</option>`;
  });
  html += '</select></div>';
  if (_settingsModule && MODULES[_settingsModule]) {
    const mod = MODULES[_settingsModule];
    const s = getSettings();
    html += '<h4 style="font-size:13px;margin:16px 0 8px;color:var(--c-primary)">字段名称修改</h4>';
    mod.fields.forEach(f => {
      if (f.section || f.type === 'custom') return;
      const key = _settingsModule + '.' + f.key;
      const customLabel = (s.fieldLabels && s.fieldLabels[key]) || '';
      html += `<div class="field-edit-row"><label>${esc(f.label)}</label><input type="text" id="fld_${f.key}" value="${esc(customLabel)}" placeholder="${esc(f.label)}"></div>`;
    });
    const optFields = mod.fields.filter(f => f.type === 'combobox' || f.type === 'multiselect');
    if (optFields.length) {
      html += '<h4 style="font-size:13px;margin:20px 0 8px;color:var(--c-primary)">选项管理</h4>';
      optFields.forEach(f => {
        const key = _settingsModule + '.' + f.key;
        const customOpts = (s.fieldOptions && s.fieldOptions[key]) || [];
        const defaultOpts = (f.options || []).map(o => typeof o === 'string' ? o : o.value);
        const allOpts = customOpts.length ? customOpts : defaultOpts;
        html += `<div style="margin-bottom:12px"><div style="font-size:12px;font-weight:600;margin-bottom:4px">${esc(f.label)}</div>`;
        html += `<div class="option-edit-list" id="opts_${f.key}">`;
        allOpts.forEach((opt, i) => {
          html += `<div class="option-edit-item"><input type="text" value="${esc(opt)}" data-opt-key="${f.key}" data-idx="${i}"><button class="btn-icon danger" onclick="this.parentElement.remove()">🗑️</button></div>`;
        });
        html += `</div>`;
        html += `<button class="btn btn-outline btn-sm" onclick="addOptionItem('${f.key}')">+ 添加选项</button></div>`;
      });
    }
  }
  html += '</div>';
  return html;
}
function addOptionItem(fieldKey) {
  const container = $('#opts_' + fieldKey);
  if (!container) return;
  const item = document.createElement('div');
  item.className = 'option-edit-item';
  item.innerHTML = `<input type="text" value="" data-opt-key="${fieldKey}" data-idx="-1"><button class="btn-icon danger" onclick="this.parentElement.remove()">🗑️</button>`;
  container.appendChild(item);
}

function renderDataSettings(html) {
  html += '<div class="settings-section active">';
  // ---- 云端同步 ----
  html += '<h4 style="font-size:14px;margin:4px 0 8px;color:var(--c-primary)">🌐 云端同步（Supabase）</h4>';
  html += '<p style="font-size:13px;color:var(--c-text-light);margin-bottom:12px">配置后数据自动同步到云端，手机与电脑实时互通。两端请填写<strong>相同的同步码</strong>。未配置时 App 完全按本地模式运行。</p>';
  const sc = DB.get('syncCfg', {}) || {};
  html += '<div style="display:flex;flex-direction:column;gap:10px;max-width:440px">';
  html += '<label class="sync-label">Supabase 项目 URL<input type="text" class="sync-field" id="sync_url" value="' + esc(sc.url || '') + '" placeholder="https://xxxx.supabase.co"></label>';
  html += '<label class="sync-label">Anon Key（公开键，非 secret）<input type="password" class="sync-field" id="sync_key" value="' + esc(sc.anonKey || '') + '" placeholder="eyJ... 公开 anon key"></label>';
  html += '<label class="sync-label">同步码（两端一致）<input type="password" class="sync-field" id="sync_code" value="' + esc(sc.syncCode || '') + '" placeholder="自定义，例如 xiaoxiao2026"></label>';
  html += '</div>';
  html += '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:12px">';
  html += '<button class="btn btn-outline" onclick="syncTest()">🔌 连接测试</button>';
  html += '<button class="btn btn-primary" onclick="syncNow()">🔄 立即同步</button>';
  html += '</div>';
  const st = Sync.enabled() ? ('当前状态：' + (Sync.status === 'connected' ? '🟢 已连接' : Sync.status === 'syncing' ? '🔄 同步中' : '🔴 未连接')) : '当前：未配置';
  html += '<p style="font-size:12px;color:var(--c-text-muted);margin-top:10px">' + st + '</p>';
  html += '<p style="font-size:12px;color:var(--c-text-muted);margin-top:6px;line-height:1.6">需在 Supabase 新建表 <code>sync_store</code>（字段：group_key text、store text、data jsonb、updated_at timestamptz，主键 group_key+store），并开启 anon 访问策略（见同步说明）。</p>';
  // ---- 数据备份与导入 ----
  html += '<h4 style="font-size:14px;margin:24px 0 16px;color:var(--c-primary)">数据备份与导入</h4>';
  html += '<p style="font-size:13px;color:var(--c-text-light);margin-bottom:16px">导出所有数据为JSON文件，或从备份文件恢复数据。</p>';
  html += '<div style="display:flex;gap:12px;flex-wrap:wrap">';
  html += '<button class="btn btn-primary" onclick="exportData()">💾 导出数据</button>';
  html += '<button class="btn btn-outline" onclick="document.getElementById(\'importFile\').click()">📂 导入数据</button>';
  html += '</div>';
  html += '</div>';
  return html;
}

function saveSettingsAction() {
  const s = getSettings();
  // Theme
  ['primary', 'primaryLight', 'primaryDark', 'primaryBg', 'sidebarStart', 'sidebarEnd'].forEach(k => {
    const el = $('#set_' + k);
    if (el) s.theme[k] = el.value;
  });
  // Nav icons
  const allNavKeys = ['home', ...NAV.slice(1).flatMap(g => g.children.map(c => c.key))];
  allNavKeys.forEach(k => {
    const el = $('#navicon_' + k);
    if (el) {
      if (el.value.trim()) s.navIcons[k] = el.value.trim();
      else delete s.navIcons[k];
    }
    const lblEl = $('#navlabel_' + k);
    if (lblEl) {
      if (lblEl.value.trim()) s.navLabels[k] = lblEl.value.trim();
      else delete s.navLabels[k];
    }
  });
  // Field labels & options
  if (_settingsModule && MODULES[_settingsModule]) {
    const mod = MODULES[_settingsModule];
    mod.fields.forEach(f => {
      if (f.section || f.type === 'custom') return;
      const labelEl = $('#fld_' + f.key);
      if (labelEl) {
        const key = _settingsModule + '.' + f.key;
        if (labelEl.value && labelEl.value !== f.label) s.fieldLabels[key] = labelEl.value;
        else delete s.fieldLabels[key];
      }
    });
    const optFields = mod.fields.filter(f => f.type === 'combobox' || f.type === 'multiselect');
    optFields.forEach(f => {
      const key = _settingsModule + '.' + f.key;
      const items = [];
      $$(`#opts_${f.key} input`).forEach(input => { if (input.value.trim()) items.push(input.value.trim()); });
      if (items.length) s.fieldOptions[key] = items;
      else delete s.fieldOptions[key];
    });
  }
  // Cloud sync config (数据管理页)
  const su = $('#sync_url'), sk = $('#sync_key'), sc = $('#sync_code');
  if (su && sk && sc) {
    const url = su.value.trim(), anonKey = sk.value.trim(), syncCode = sc.value.trim();
    if (url && anonKey && syncCode) {
      DB.set('syncCfg', { url, anonKey, syncCode });
      Sync.load();
      Sync.fullSync();
    } else if (!url && !anonKey && !syncCode) {
      DB.set('syncCfg', null); Sync.load();
    } else {
      Toast.warning('云端同步需填写完整的 URL、Anon Key 与同步码，本次未改动同步设置');
    }
  }
  saveSettings(s);
  applyTheme(s.theme);
  closeModal();
  Toast.success('设置已保存');
  navigate(currentPage);
}

/* ===== Event Listeners ===== */
function initEvents() {
  $('#toggleSidebar').onclick = () => {
    const sb = $('#sidebar'); sb.classList.toggle('collapsed');
    if (window.innerWidth > 768) DB.set('ui_sidebar_collapsed', sb.classList.contains('collapsed'));
  };
  $('#mobileToggle').onclick = () => { $('#sidebar').classList.toggle('show'); $('#sidebarOverlay').classList.toggle('show'); };
  $('#sidebarOverlay').onclick = () => { $('#sidebar').classList.remove('show'); $('#sidebarOverlay').classList.remove('show'); };
  $('#modalClose').onclick = closeModal;
  $('#modalOverlay').onclick = (e) => { if (e.target === $('#modalOverlay')) closeModal(); };
  $('#lightbox').onclick = () => $('#lightbox').classList.remove('show');
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); $('#lightbox').classList.remove('show'); } });
  $('#importFile').onchange = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (await confirmDialog('导入数据将覆盖当前所有记录，确定继续吗？')) {
          Object.keys(data).forEach(key => { if (key.startsWith('xx_workbench_')) localStorage.setItem(key, JSON.stringify(data[key])); });
          Toast.success('数据导入成功'); navigate(currentPage);
        }
      } catch { Toast.error('导入失败：文件格式不正确'); }
    };
    reader.readAsText(file); e.target.value = '';
  };
}

/* ===== Data Export ===== */
function exportData() {
  const stores = SYNC_STORES;
  const data = {}; let total = 0;
  stores.forEach(s => { const arr = DB.get(s, s === 'appSettings' ? DEFAULT_SETTINGS : s === 'customCategories' ? [] : []); data[DB._prefix + s] = arr; if (Array.isArray(arr)) total += arr.length; });
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = '小筱工作台_备份_' + todayStr() + '.json'; a.click();
  URL.revokeObjectURL(url);
  Toast.success(`已导出 ${total} 条记录`);
}

/* ===== Data Migration ===== */
function migrateStringToArray(store, fields, valueMap) {
  const records = DB.list(store);
  let changed = false;
  records.forEach(r => {
    fields.forEach(f => {
      if (typeof r[f] === 'string' && r[f]) {
        let v = r[f];
        if (valueMap && valueMap[v]) v = valueMap[v];
        r[f] = [v]; changed = true;
      }
    });
  });
  if (changed) DB.set(store, records);
}
function migrateData() {
  // Group buy records: participantCount -> purchaseCount, totalRevenue -> productTotal
  const groupbuys = DB.list('groupbuys');
  let changed = false;
  groupbuys.forEach(r => {
    if (r.participantCount != null && r.purchaseCount == null) { r.purchaseCount = r.participantCount; delete r.participantCount; changed = true; }
    if (r.totalRevenue != null && r.productTotal == null) { r.productTotal = r.totalRevenue; delete r.totalRevenue; changed = true; }
  });
  if (changed) DB.set('groupbuys', groupbuys);

  // Migrate combobox→multiselect string fields to arrays
  migrateStringToArray('publishRecords', ['platform', 'contentType']);
  migrateStringToArray('groupbuys', ['status'], { '已结束': '已截团' });
  migrateStringToArray('factories', ['cooperationStatus']);
  migrateStringToArray('samples', ['evaluation']);
  migrateStringToArray('inspirations', ['tags']);
  migrateStringToArray('authorizations', ['authType']);
  migrateStringToArray('ocCharacters', ['gender']);
  migrateStringToArray('ocRelations', ['relationType', 'relationStatus'], { '亲友': '好友', '恋人': '道侣', '已结束': '变化中' });
  migrateStringToArray('ocStories', ['tags', 'isComplete']);
  migrateStringToArray('ocCommissions', ['commissionType', 'platform', 'status']);

  // Commission: migrate string to array for multiselect fields + progress value migration
  const commissions = DB.list('commissions');
  changed = false;
  commissions.forEach(r => {
    if (typeof r.usageType === 'string' && r.usageType) { r.usageType = [r.usageType]; changed = true; }
    if (typeof r.sameDesign === 'string' && r.sameDesign) { r.sameDesign = [r.sameDesign]; changed = true; }
    if (typeof r.paymentStatus === 'string' && r.paymentStatus) { r.paymentStatus = [r.paymentStatus]; changed = true; }
    // Migrate progress values then wrap in array
    const progressMap = { '待接单': '待接稿', '草稿中': '已接稿', '已完结': '已交付' };
    if (typeof r.progress === 'string' && r.progress) {
      if (progressMap[r.progress]) r.progress = progressMap[r.progress];
      r.progress = [r.progress]; changed = true;
    }
    // Migrate quoteAmount from amount if quoteAmount doesn't exist
    if (r.quoteAmount == null && r.amount != null) { r.quoteAmount = r.amount; changed = true; }
    // v9: Migrate sameDesign model values to sameModel
    const modelValues = { '改色+字': '改色+字', '改人+字色': '改人+字/色', '改人': '改人' };
    const designArr = Array.isArray(r.sameDesign) ? r.sameDesign : (r.sameDesign ? [r.sameDesign] : []);
    const modelArr = Array.isArray(r.sameModel) ? r.sameModel : [];
    designArr.forEach(v => {
      if (modelValues[v]) {
        if (!modelArr.includes(modelValues[v])) modelArr.push(modelValues[v]);
      }
    });
    const newDesign = designArr.filter(v => v === '是' || v === '否');
    if (newDesign.length !== designArr.length || modelArr.length > 0) {
      r.sameDesign = newDesign; r.sameModel = modelArr; changed = true;
    }
    // v14: Migrate record-level sameModel to per-product sameModel
    if (r.sameModel && Array.isArray(r.sameModel) && r.sameModel.length > 0) {
      const modelVal = r.sameModel[0]; // take first value
      if (Array.isArray(r.products)) {
        r.products.forEach(p => { if (!p.sameModel) p.sameModel = modelVal; });
      }
      delete r.sameModel; changed = true;
    } else if (r.sameModel) {
      delete r.sameModel; changed = true;
    }
    // v24: Migrate sameDesign from string (select) back to array (multiselect)
    if (typeof r.sameDesign === 'string' && r.sameDesign) {
      r.sameDesign = [r.sameDesign];
      changed = true;
    } else if (typeof r.sameDesign === 'string' && !r.sameDesign) {
      r.sameDesign = [];
      changed = true;
    }
  });
  if (changed) DB.set('commissions', commissions);

  // DU轮：导入接稿过滤——已交付且无交付时间的订单回填为今天（之后满7天自动从导入选项消失）
  changed = false;
  commissions.forEach(r => {
    if (valIncludes(r.progress, '已交付') && !r.deliveredTime) {
      r.deliveredTime = todayStr();
      changed = true;
    }
  });
  if (changed) DB.set('commissions', commissions);

  // Stories: migrate characterIds string to array
  const stories = DB.list('ocStories');
  changed = false;
  stories.forEach(r => {
    if (typeof r.characterIds === 'string' && r.characterIds) { r.characterIds = [r.characterIds]; changed = true; }
  });
  if (changed) DB.set('ocStories', stories);

  // OC Commission: migrate usageType string to array
  const ocComms = DB.list('ocCommissions');
  changed = false;
  ocComms.forEach(r => {
    if (typeof r.usageType === 'string' && r.usageType) { r.usageType = [r.usageType]; changed = true; }
  });
  if (changed) DB.set('ocCommissions', ocComms);

  // Price list: remove unit field, migrate description label
  const priceList = DB.list('priceList');
  changed = false;
  priceList.forEach(r => {
    if (r.productType && !r.category) { r.category = r.productType; delete r.productType; changed = true; }
    if (r.usageType && !r.unit) { delete r.usageType; changed = true; }
    if (r.discountPlan && !r.description) { r.description = r.discountPlan; delete r.discountPlan; changed = true; }
    if (r.unit !== undefined) { delete r.unit; changed = true; }
  });
  if (changed) DB.set('priceList', priceList);

  // v193: 兼容极早期生活记录（v190 曾用 fields 包裹），展平为扁平字段，避免渲染崩溃
  const oldRecs = DB.list('lifeRecords');
  if (oldRecs.some(r => r.fields)) {
    const fixed = oldRecs.map(r => {
      if (!r.fields) return r;
      const f = r.fields;
      return { ...r, sleepTime: f.sleepTime, wakeTime: f.wakeTime, wakeCount: f.wakeCount, duration: f.duration, mealType: f.mealType, note: f.note, qty: f.qty, time: f.time };
    });
    DB.set('lifeRecords', fixed);
  }

  // v245: 每日记录拆分子类型（睡眠：夜晚/午间；饮食：早餐/午餐/晚餐/宵夜/零食/奶茶）
  const lifeRecs = DB.list('lifeRecords');
  let lrChanged = false;
  const mealMap = { '早餐': 'breakfast', '午餐': 'lunch', '晚餐': 'dinner' };
  const fixedLife = lifeRecs.map(r => {
    if (r.subtype) return r;
    let nr = { ...r };
    if (nr.type === 'sleep') { nr.subtype = 'night'; }
    else if (nr.type === 'meal') { nr.type = 'diet'; nr.subtype = mealMap[nr.mealType] || 'breakfast'; delete nr.mealType; }
    else if (nr.type === 'snack') { nr.type = 'diet'; nr.subtype = 'snack'; }
    lrChanged = true;
    return nr;
  });
  fixedLife.forEach(r => {
    if (r.type === 'diet' && r.subtype === 'milktea' && !Array.isArray(r.flavors)) {
      r.flavors = r.flavors ? [String(r.flavors)] : [];
      lrChanged = true;
    }
    if (r.type === 'diet' && r.subtype === 'snack' && r.qty != null && typeof r.qty !== 'number') {
      const n = Number(String(r.qty).replace(/[^0-9.]/g, ''));
      r.qty = isNaN(n) ? null : n;
      lrChanged = true;
    }
  });
  if (lrChanged) DB.set('lifeRecords', fixedLife);
}

/* ============================================================
   生活模块 · 每日打卡 / 每日记录 (v193)
   ============================================================ */
const LIFE_CHECKIN_DEFS = {
  deepspace: { key: 'deepspace', label: '深空打卡', icon: '🌌', period: 'day', calendar: true },
  sport: { key: 'sport', label: '运动打卡', icon: '🏃', period: 'day' },
  earlysleep: { key: 'earlysleep', label: '早睡打卡', icon: '🌙', period: 'day' },
  snackcheck: { key: 'snackcheck', label: '零食打卡', icon: '🍟', period: 'day' },
  poop: { key: 'poop', label: '拉屎打卡', icon: '🚽', period: 'day' },
  massage: { key: 'massage', label: '按摩打卡', icon: '💆', period: 'week' },
  vacuum: { key: 'vacuum', label: '吸尘打卡', icon: '🧹', period: 'week' },
  mask: { key: 'mask', label: '面膜打卡', icon: '🧖', period: 'week' },
};
function renderQuickCheckin() {
  const today = todayStr();
  const allDefs = Object.values(LIFE_CHECKIN_DEFS).concat(DB.list('lifeCheckinDefs'));
  const doneCount = allDefs.filter(t => {
    if (t.period === 'day') return DB.list('lifeCheckins').some(r => r.type === t.key && r.date === today);
    const thisWeek = weekKeyOf(today);
    return DB.list('lifeCheckins').some(r => r.type === t.key && (r.week || weekKeyOf(r.date)) === thisWeek);
  }).length;
  let html = '<div class="life-quick-checkin">';
  const total = allDefs.length;
  const countCls = doneCount === 0 ? 'lqc-c0' : (doneCount === total ? 'lqc-cfull' : 'lqc-cpart');
  html += `<div class="lqc-hd"><span class="lqc-title">今日打卡</span><span class="lqc-count ${countCls}">已完成 ${doneCount}/${total}</span></div>`;
  html += '<div class="lqc-grid">';
  allDefs.forEach(t => {
    let done = false;
    if (t.period === 'day') done = DB.list('lifeCheckins').some(r => r.type === t.key && r.date === today);
    else { const thisWeek = weekKeyOf(today); done = DB.list('lifeCheckins').some(r => r.type === t.key && (r.week || weekKeyOf(r.date)) === thisWeek); }
    html += `<button class="lqc-btn ${t.period === 'week' ? 'lqc-weekly' : ''} ${done ? 'done' : ''}" onclick="lifeQuickCheckin('${t.key}',event)">`;
    const shortLabel = (t.label || '').replace(/打卡$/, '').slice(0, 4);
    html += `<span class="lqc-label">${esc(shortLabel)}</span>`;
    html += '</button>';
  });
  html += '</div></div>';
  return html;
}
function lifeQuickCheckin(typeKey, e) {
  if (e) e.stopPropagation();
  const today = todayStr();
  const def = getCheckinDef(typeKey);
  if (!def) return;
  let done = false, dateStr = today;
  if (def.period === 'day') done = DB.list('lifeCheckins').some(r => r.type === typeKey && r.date === today);
  else {
    const thisWeek = weekKeyOf(today);
    done = DB.list('lifeCheckins').some(r => r.type === typeKey && (r.week || weekKeyOf(r.date)) === thisWeek);
    dateStr = today;
  }
  if (done) {
    const rec = DB.list('lifeCheckins').find(r => r.type === typeKey && r.date === dateStr);
    if (rec) { DB.remove('lifeCheckins', rec.id); Toast.success('已取消'); }
  } else {
    DB.add('lifeCheckins', { type: typeKey, date: dateStr, week: weekKeyOf(dateStr), period: def.period, isMakeup: false, createdAt: new Date().toISOString() });
    Toast.success('打卡成功');
  }
  renderLifeCheckin();
}
const LIFE_RECORD_SUBTYPES = {
  sleep: {
    night: { key: 'night', label: '夜晚', icon: '🌙' },
    noon: { key: 'noon', label: '午间', icon: '☀️' }
  },
  diet: {
    breakfast: { key: 'breakfast', label: '早餐', icon: '🌅' },
    lunch: { key: 'lunch', label: '午餐', icon: '☀️' },
    dinner: { key: 'dinner', label: '晚餐', icon: '🌙' },
    midnight: { key: 'midnight', label: '宵夜', icon: '🌃', multi: true },
    snack: { key: 'snack', label: '零食', icon: '🍟', multi: true,
      unitOptions: ['包','个','颗','根','袋','盒','瓶','片','粒','杯','份','条','罐','枚','把'] },
    milktea: { key: 'milktea', label: '奶茶', icon: '🧋', multi: true,
      flavorOptions: ['不额外加糖','三分糖','五分糖','七分糖','全糖','热','常温','正常冰','少冰','去冰','小杯','中杯','大杯'] }
  }
};
function getLifeRecordSubtype(typeKey, subtypeKey) {
  const map = LIFE_RECORD_SUBTYPES[typeKey];
  return map ? map[subtypeKey] : null;
}
function lifeRecordSubtypes(typeKey) {
  return Object.values(LIFE_RECORD_SUBTYPES[typeKey] || {});
}
const LIFE_RECORD_DEFS = {
  sleep: { key: 'sleep', label: '睡眠记录', icon: '😴', fields: [
    { key: 'sleepTime', label: '入睡时间', type: 'time' },
    { key: 'wakeTime', label: '清醒时间', type: 'time' },
    { key: 'wakeCount', label: '清醒次数', type: 'number' },
    { key: 'duration', label: '睡眠时长(小时)', type: 'number', auto: true },
  ]},
  diet: { key: 'diet', label: '饮食记录', icon: '🍚', fields: [
    { key: 'note', label: '内容', type: 'text' },
    { key: 'time', label: '时间', type: 'time' },
    { key: 'qty', label: '数量', type: 'number', subtype: 'snack' },
    { key: 'unit', label: '单位', type: 'combobox', subtype: 'snack',
      options: LIFE_RECORD_SUBTYPES.diet.snack.unitOptions },
    { key: 'flavors', label: '口味配方', type: 'tag-multi', subtype: 'milktea',
      options: LIFE_RECORD_SUBTYPES.diet.milktea.flavorOptions },
  ]}
};
function parseDateStr(s) { const p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
function addDaysStr(s, n) { const d = parseDateStr(s); d.setDate(d.getDate() + n); return fmtDate(d); }
function mondayFromWeek(y, w) {
  const jan4 = new Date(y, 0, 4);
  const jan4Day = jan4.getDay();
  const off = (jan4Day === 0 ? -6 : 1 - jan4Day);
  const m = new Date(y, 0, 4 + off);
  m.setDate(m.getDate() + (w - 1) * 7);
  return m;
}
function weekMondayOf(d) { const day = d.getDay(); const diff = (day === 0 ? -6 : 1 - day); const m = new Date(d); m.setDate(d.getDate() + diff); m.setHours(0, 0, 0, 0); return m; }
function weekKeyOf(s) {
  const m = weekMondayOf(parseDateStr(s));
  const y = m.getFullYear();
  const w1 = mondayFromWeek(y, 1);
  const diffDays = Math.round((m - w1) / 86400000);
  const w = Math.floor(diffDays / 7) + 1;
  return y + '-W' + String(w).padStart(2, '0');
}
function prevWeekKey(wk) { const [y, w] = wk.split('-W'); const m = mondayFromWeek(Number(y), Number(w)); m.setDate(m.getDate() - 7); return weekKeyOf(fmtDate(m)); }
function sleepDurationHours(sleepTime, wakeTime) {
  if (!sleepTime || !wakeTime) return null;
  const [sh, sm] = sleepTime.split(':').map(Number);
  const [wh, wm] = wakeTime.split(':').map(Number);
  let mins = (wh * 60 + wm) - (sh * 60 + sm);
  if (mins <= 0) mins += 1440;
  return Math.round(mins / 60 * 10) / 10;
}
function lifeDailyStreak(typeKey) {
  const set = new Set(DB.list('lifeCheckins').filter(r => r.type === typeKey).map(r => r.date));
  if (!set.size) return 0;
  let cursor = todayStr();
  if (!set.has(cursor)) { const y = addDaysStr(todayStr(), -1); if (!set.has(y)) return 0; cursor = y; }
  let s = 0; while (set.has(cursor)) { s++; cursor = addDaysStr(cursor, -1); } return s;
}
function lifeDailyMonthCount(typeKey) {
  const t = todayStr().slice(0, 7);
  return DB.list('lifeCheckins').filter(r => r.type === typeKey && (r.date || '').startsWith(t)).length;
}
function lifeWeeklyCompletedWeeks(typeKey) {
  const set = new Set(DB.list('lifeCheckins').filter(r => r.type === typeKey && r.week).map(r => r.week));
  return set.size;
}
function lifeWeeklyStreak(typeKey) {
  const set = new Set(DB.list('lifeCheckins').filter(r => r.type === typeKey && r.week).map(r => r.week));
  if (!set.size) return 0;
  let cur = weekKeyOf(todayStr());
  if (!set.has(cur)) { cur = prevWeekKey(cur); if (!set.has(cur)) return 0; }
  let s = 0; while (set.has(cur)) { s++; cur = prevWeekKey(cur); } return s;
}
function lifeWeeklyMonthCount(typeKey, y, m) {
  const set = new Set();
  DB.list('lifeCheckins').filter(r => r.type === typeKey && r.week).forEach(r => {
    const [yy, ww] = r.week.split('-W');
    const mon = mondayFromWeek(Number(yy), Number(ww));
    if (mon.getFullYear() === y && mon.getMonth() === m) set.add(r.week);
  });
  return set.size;
}
function lifeMonthWeekTotal(y, m) {
  let count = 0;
  const d = new Date(y, m, 1);
  while (d.getMonth() === m) { if (d.getDay() === 1) count++; d.setDate(d.getDate() + 1); }
  return count;
}
function fmtHM(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function renderCheckinHeatmap(typeKey, year, month, isModal) {
  const checkins = DB.list('lifeCheckins').filter(r => r.type === typeKey);
  const def = getCheckinDef(typeKey);
  const period = def ? def.period : 'day';
  const doneByDate = new Set(checkins.map(r => r.date));
  const now = new Date();
  const y = year != null ? year : now.getFullYear();
  const m = month != null ? month : now.getMonth();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const firstWeekday = new Date(y, m, 1).getDay();
  const today = todayStr();
  const monthStr = `${y}-${String(m + 1).padStart(2, '0')}`;
  let html = '';
  if (isModal) {
    const wd = ['日', '一', '二', '三', '四', '五', '六'];
    html += '<div class="life-heatmap-hd">' + wd.map(w => '<span>' + w + '</span>').join('') + '</div>';
  }
  html += '<div class="life-heatmap">';
  // leading other-month squares
  for (let i = 0; i < firstWeekday; i++) html += '<div class="hm-day other-month"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${monthStr}-${String(d).padStart(2, '0')}`;
    let cls = 'hm-day';
    if (doneByDate.has(ds)) cls += period === 'day' ? ' done' : ' week done';
    if (isModal && ds === today) cls += ' today';
    if (isModal && ds === lifeCheckinSelDate) cls += ' selected';
    const click = isModal ? ` onclick="lifeCheckinCellClick('${typeKey}','${ds}')"` : '';
    html += `<div class="${cls}" title="${ds}"${click}></div>`;
  }
  // trailing other-month squares to complete the last week
  const total = firstWeekday + daysInMonth;
  const rem = total % 7 === 0 ? 0 : 7 - (total % 7);
  for (let i = 0; i < rem; i++) html += '<div class="hm-day other-month"></div>';
  html += '</div>';
  return html;
}
/* (v197: removed checkin summary cards & week matrix — keep only goal-list cards) */
function renderGoalCard(t, vy, vm) {
  const today = todayStr();
  const recs = DB.list('lifeCheckins').filter(r => r.type === t.key);
  let total, streak, rate, status, statusCls, btnTxt, btnDisabled;
  if (t.period === 'day') {
    total = recs.length;
    streak = lifeDailyStreak(t.key);
    const first = recs.length ? recs.map(r => r.date).sort()[0] : today;
    const span = Math.max(1, Math.floor((new Date(today) - new Date(first)) / 86400000) + 1);
    rate = Math.round(total / span * 100);
    const done = recs.some(r => r.date === today);
    status = done ? '今日已打卡' : '今日待打卡';
    statusCls = done ? 'done' : 'todo';
    btnTxt = done ? '已打卡' : '打卡';
    btnDisabled = done;
  } else {
    total = lifeWeeklyCompletedWeeks(t.key);
    streak = lifeWeeklyStreak(t.key);
    const thisWeek = weekKeyOf(today);
    const weeks = new Set(recs.map(r => r.week || weekKeyOf(r.date)));
    rate = weeks.size > 0 ? Math.round(total / (total + 1) * 100) : 0;
    const done = recs.some(r => (r.week || weekKeyOf(r.date)) === thisWeek);
    status = done ? '本周已打卡' : '本周待打卡';
    statusCls = done ? 'done' : 'todo';
    btnTxt = done ? '本周已打' : '打卡';
    btnDisabled = false;
  }
  const daysInMonth = new Date(vy, vm + 1, 0).getDate();
  const ms = `${vy}-${String(vm + 1).padStart(2, '0')}`;
  let mpDone, mpTotal, mpLabel;
  if (t.period === 'day') {
    mpTotal = daysInMonth;
    mpDone = DB.list('lifeCheckins').filter(r => r.type === t.key && (r.date || '').startsWith(ms)).length;
    mpLabel = '本月';
  } else {
    mpTotal = lifeMonthWeekTotal(vy, vm);
    mpDone = lifeWeeklyMonthCount(t.key, vy, vm);
    mpLabel = '本月周';
  }
  const mpPct = mpTotal ? Math.round(mpDone / mpTotal * 100) : 0;
  return `<div class="life-goal-card ${t.period === 'week' ? 'week-card' : ''}" onclick="lifeCheckinOpenCard('${t.key}')">
    <div class="lgc-head">
      <div class="lgc-title-wrap">
        <div class="lgc-name">${esc(t.label)}</div>
        <div class="lgc-desc">${t.period === 'day' ? '每日打卡' : '每周打卡'}</div>
      </div>
      <div class="lgc-arrow">›</div>
    </div>
    <div class="lgc-body">
      <div class="lgc-stats">
        <div class="lgc-stat"><div class="lgc-num">${total}</div><div class="lgc-unit">${t.period === 'day' ? '累计打卡' : '已完成周'}</div></div>
        <div class="lgc-stat"><div class="lgc-num">${streak}</div><div class="lgc-unit">${t.period === 'day' ? '最长连续' : '连续完成'}</div></div>
        <div class="lgc-stat"><div class="lgc-num">${rate}%</div><div class="lgc-unit">完成率</div></div>
      </div>
      <div class="lgc-heatmap">${renderCheckinHeatmap(t.key, vy, vm)}</div>
    </div>
    <div class="lgc-monthprog">
      <span class="lgc-mp-label">${mpLabel}进度</span>
      <span class="lgc-mp-num ${t.period === 'week' ? 'week' : ''}">${mpDone}/${mpTotal}</span>
      <div class="lgc-mp-bar"><div class="lgc-mp-fill ${t.period === 'week' ? 'week' : ''}" style="width:${mpPct}%"></div></div>
    </div>
    <div class="lgc-foot">
      <span class="lgc-status ${statusCls}"><span class="lgc-dot"></span>${status}</span>
      <button class="btn btn-sm btn-primary" ${btnDisabled ? 'disabled' : ''} onclick="event.stopPropagation();lifeCheckinDo('${t.key}','${today}')">${btnTxt}</button>
    </div>
  </div>`;
}
let lifeCheckinView = null;
function getCheckinDef(typeKey) {
  if (LIFE_CHECKIN_DEFS[typeKey]) return LIFE_CHECKIN_DEFS[typeKey];
  return DB.list('lifeCheckinDefs').find(d => d.key === typeKey) || null;
}
let lifeCheckinPickerOpen = false;
let lifeCheckinPickerY = null;
let lifeCheckinModalView = null;
let lifeCheckinModalKey = null;
let lifeCheckinSelDate = null;
let lifeWeekOffset = 0;
let lifeCheckinBlock = 'day';
function lifeCheckinTogglePicker() {
  lifeCheckinPickerOpen = !lifeCheckinPickerOpen;
  if (lifeCheckinPickerOpen) { const vv = lifeCheckinInitView(); lifeCheckinPickerY = vv.y; }
  renderLifeCheckin();
}
function lifeCheckinPickerYear(d) {
  lifeCheckinPickerY = (lifeCheckinPickerY != null ? lifeCheckinPickerY : new Date().getFullYear()) + d;
  renderLifeCheckin();
}
function lifeCheckinJumpMonth(y, m) {
  lifeCheckinView = { y: y, m: m };
  lifeCheckinPickerOpen = false;
  renderLifeCheckin();
}
function lifeCheckinModalPrevMonth() {
  let { y, m } = lifeCheckinModalView; m--; if (m < 0) { m = 11; y--; }
  lifeCheckinModalView = { y, m }; lifeCheckinSelDate = null;
  lifeCheckinRenderModal(lifeCheckinModalKey);
}
function lifeCheckinModalNextMonth() {
  const n = new Date(); const cur = { y: n.getFullYear(), m: n.getMonth() };
  if (lifeCheckinModalView.y === cur.y && lifeCheckinModalView.m === cur.m) return;
  let { y, m } = lifeCheckinModalView; m++; if (m > 11) { m = 0; y++; }
  lifeCheckinModalView = { y, m }; lifeCheckinSelDate = null;
  lifeCheckinRenderModal(lifeCheckinModalKey);
}
function lifeCheckinModalMakeup(typeKey) {
  const d = lifeCheckinSelDate;
  if (!d) { Toast.warning('请先点选一个日期'); return; }
  if (d > todayStr()) { Toast.warning('不能给未来的日期打卡'); return; }
  if (DB.list('lifeCheckins').some(r => r.type === typeKey && r.date === d)) { Toast.info('该日期已打卡'); return; }
  const def = getCheckinDef(typeKey);
  DB.add('lifeCheckins', { type: typeKey, date: d, week: weekKeyOf(d), period: def.period, isMakeup: d < todayStr(), createdAt: new Date().toISOString() });
  Toast.success('补卡成功');
  lifeCheckinRenderModal(typeKey);
  renderLifeCheckin();
}
function lifeCheckinModalUndo(typeKey) {
  const d = lifeCheckinSelDate;
  if (!d) { Toast.warning('请先点选一个日期'); return; }
  const rec = DB.list('lifeCheckins').find(r => r.type === typeKey && r.date === d);
  if (!rec) { Toast.info('该日期无打卡记录'); return; }
  DB.remove('lifeCheckins', rec.id);
  Toast.success('已撤销');
  lifeCheckinRenderModal(typeKey);
  renderLifeCheckin();
}
function lifeCheckinDeleteModule(typeKey) {
  if (!window.confirm('确定删除该打卡模块？已产生的打卡记录会保留。')) return;
  DB.set('lifeCheckinDefs', DB.list('lifeCheckinDefs').filter(d => d.key !== typeKey));
  closeModal();
  renderLifeCheckin();
  Toast.success('已删除模块');
}
function lifeCheckinAdd() {
  openModal('添加打卡', `
    <div class="lc-add-form">
    <div class="form-row">
      <label class="form-label">名称</label>
      <input class="form-input" id="lc-add-name" maxlength="12">
    </div>
    <div class="form-row">
      <label class="form-label">类型</label>
      <div class="combobox-wrapper">
        <input type="text" class="form-input combobox-input" id="lc-add-period" value="每日打卡" readonly placeholder="请选择" onfocus="showComboboxDropdown('lc-add-period-cb')" onclick="showComboboxDropdown('lc-add-period-cb')">
        <button type="button" class="combobox-toggle" onclick="toggleComboboxDropdown('lc-add-period-cb')">▼</button>
        <div class="combobox-dropdown" id="lc-add-period-cb">
          <div class="combobox-option" data-value="day" onclick="lifeCheckinSelPeriod('day',this)">每日打卡</div>
          <div class="combobox-option" data-value="week" onclick="lifeCheckinSelPeriod('week',this)">每周打卡</div>
        </div>
      </div>
    </div>
    </div>`, [
    { label: '取消', class: 'btn-ghost', action: closeModal },
    { label: '添加', class: 'btn-primary', action: lifeCheckinAddSubmit }
  ]);
}
function lifeCheckinSelPeriod(val, el) {
  const input = document.getElementById('lc-add-period');
  if (!input) return;
  input.value = el.textContent;
  input.dataset.val = val;
  const dd = document.getElementById('lc-add-period-cb');
  if (dd) dd.classList.remove('show');
}
function lifeCheckinAddSubmit() {
  const name = ($('#lc-add-name').value || '').trim();
  const period = $('#lc-add-period').dataset.val || 'day';
  if (!name) { Toast.warning('请输入名称'); return; }
  DB.add('lifeCheckinDefs', { key: 'custom_' + uid(), label: name, period: period });
  closeModal();
  renderLifeCheckin();
  Toast.success('已添加「' + name + '」');
}
function lifeCheckinInitView() {
  if (!lifeCheckinView) { const n = new Date(); lifeCheckinView = { y: n.getFullYear(), m: n.getMonth() }; }
  return lifeCheckinView;
}
function lifeCheckinPrevMonth() {
  lifeCheckinInitView();
  let { y, m } = lifeCheckinView;
  m--; if (m < 0) { m = 11; y--; }
  lifeCheckinView = { y, m };
  renderLifeCheckin();
}
function lifeCheckinNextMonth() {
  const n = new Date();
  const cur = { y: n.getFullYear(), m: n.getMonth() };
  lifeCheckinInitView();
  if (lifeCheckinView.y === cur.y && lifeCheckinView.m === cur.m) return;
  let { y, m } = lifeCheckinView;
  m++; if (m > 11) { m = 0; y++; }
  lifeCheckinView = { y, m };
  renderLifeCheckin();
}
function lifeCheckinPrevWeek() {
  lifeWeekOffset--;
  renderLifeCheckin();
}
function lifeCheckinNextWeek() {
  if (lifeWeekOffset >= 0) return;
  lifeWeekOffset++;
  renderLifeCheckin();
}
function renderLifeCheckin() {
  const body = $('#mainBody');
  const v = lifeCheckinInitView();
  const now = new Date();
  const isCur = v.y === now.getFullYear() && v.m === now.getMonth();
  const pickerY = lifeCheckinPickerY != null ? lifeCheckinPickerY : v.y;
  let html = '<div class="fade-in">';
  html += renderQuickCheckin();
  html += `<div class="life-monthbar ${lifeCheckinBlock === 'week' ? 'week-mode' : ''}">`;
  html += '<div class="life-monthbar-center">';
  if (lifeCheckinBlock === 'week') {
    const base = weekMondayOf(parseDateStr(todayStr()));
    base.setDate(base.getDate() + lifeWeekOffset * 7);
    const sun = new Date(base); sun.setDate(base.getDate() + 6);
    const weekTxt = `${base.getMonth() + 1}/${base.getDate()} - ${sun.getMonth() + 1}/${sun.getDate()}`;
    html += `<button class="btn btn-ghost btn-sm" onclick="lifeCheckinPrevWeek()">‹ 上一周</button>`;
    html += `<span class="life-monthbar-txt">${weekTxt}</span>`;
    html += `<button class="btn btn-ghost btn-sm" onclick="lifeCheckinNextWeek()" ${lifeWeekOffset === 0 ? 'disabled' : ''}>下一周 ›</button>`;
  } else {
    html += `<button class="btn btn-ghost btn-sm" onclick="lifeCheckinPrevMonth()">‹ 上月</button>`;
    html += `<span class="life-monthbar-txt" onclick="lifeCheckinTogglePicker()">${v.y}年${v.m + 1}月 ▾</span>`;
    html += `<button class="btn btn-ghost btn-sm" onclick="lifeCheckinNextMonth()" ${isCur ? 'disabled' : ''}>下月 ›</button>`;
  }
  html += '</div>';
  html += '<div class="life-block-toggle">';
  html += `<button class="lbt-btn ${lifeCheckinBlock === 'day' ? 'active' : ''}" onclick="lifeCheckinToggleBlock('day')">日</button>`;
  html += `<button class="lbt-btn ${lifeCheckinBlock === 'week' ? 'active' : ''}" onclick="lifeCheckinToggleBlock('week')">周</button>`;
  html += '</div>';
  html += `<div class="life-month-picker ${lifeCheckinPickerOpen ? 'show' : ''}">`;
  html += `<div class="lmp-yearbar"><button class="btn btn-ghost btn-xs" onclick="lifeCheckinPickerYear(-1)">‹</button><span>${pickerY}年</span><button class="btn btn-ghost btn-xs" onclick="lifeCheckinPickerYear(1)">›</button></div>`;
  html += '<div class="lmp-months">';
  for (let mo = 0; mo < 12; mo++) {
    const sel = (pickerY === v.y && mo === v.m) ? 'sel' : '';
    html += `<button class="lmp-month ${sel}" onclick="lifeCheckinJumpMonth(${pickerY},${mo})">${mo + 1}月</button>`;
  }
  html += '</div></div>';
  html += '</div>';
  if (lifeCheckinPickerOpen) html += '<div class="life-picker-backdrop" onclick="lifeCheckinTogglePicker()"></div>';
  if (lifeCheckinBlock === 'week') {
    html += renderLifeWeekOverview();
  } else {
    html += `<div class="life-goal-grid compact">`;
    const allDefs = Object.values(LIFE_CHECKIN_DEFS).concat(DB.list('lifeCheckinDefs'));
    allDefs.forEach(t => { html += renderGoalCard(t, v.y, v.m); });
    html += '</div>';
  }
  html += '<div class="life-goal-add" onclick="lifeCheckinAdd()"><div class="lga-plus">＋</div><div class="lga-txt">添加打卡</div></div>';
  html += '</div>';
  body.innerHTML = html;
}
function lifeCheckinOpenCard(typeKey) {
  lifeCheckinModalKey = typeKey;
  const vv = lifeCheckinInitView();
  lifeCheckinModalView = { y: vv.y, m: vv.m };
  lifeCheckinSelDate = null;
  lifeCheckinRenderModal(typeKey);
}
function lifeCheckinRenderModal(typeKey) {
  const t = getCheckinDef(typeKey);
  if (!t) return;
  const v = lifeCheckinModalView;
  const now = new Date();
  const isCur = v.y === now.getFullYear() && v.m === now.getMonth();
  const monthStr = `${v.y}-${String(v.m + 1).padStart(2, '0')}`;
  const firstDay = monthStr + '-01';
  const t2 = todayStr();
  if (!lifeCheckinSelDate || !lifeCheckinSelDate.startsWith(monthStr)) lifeCheckinSelDate = t2.startsWith(monthStr) ? t2 : firstDay;
  const recs = DB.list('lifeCheckins').filter(r => r.type === typeKey);
  // monthly progress
  const daysInMonth = new Date(v.y, v.m + 1, 0).getDate();
  let mpDone, mpTotal;
  if (t.period === 'day') {
    mpTotal = daysInMonth;
    mpDone = DB.list('lifeCheckins').filter(r => r.type === typeKey && (r.date || '').startsWith(monthStr)).length;
  } else {
    mpTotal = lifeMonthWeekTotal(v.y, v.m);
    mpDone = lifeWeeklyMonthCount(typeKey, v.y, v.m);
  }
  let html = `<div class="life-modal-body">`;
  html += `<div class="life-modal-hd"><div><div class="lm-name">${esc(t.label)}<span class="lm-tag">${t.period === 'day' ? '每日打卡' : '每周打卡'}</span></div></div></div>`;
  // month nav (replaces date input)
  html += `<div class="life-modal-monthbar">`;
  html += `<button class="btn btn-ghost btn-sm" onclick="lifeCheckinModalPrevMonth()">‹ 上月</button>`;
  html += `<span class="lmm-txt">${v.y}年${v.m + 1}月</span>`;
  html += `<button class="btn btn-ghost btn-sm" onclick="lifeCheckinModalNextMonth()" ${isCur ? 'disabled' : ''}>下月 ›</button>`;
  html += `</div>`;
  // heatmap (with weekday header) + right-side progress + buttons
  html += `<div class="life-modal-hmwrap">`;
  html += `<div class="life-modal-heatmap ${t.period === 'week' ? 'week' : ''}">${renderCheckinHeatmap(typeKey, v.y, v.m, true)}</div>`;
  html += `<div class="life-modal-right">`;
  html += `<div class="life-modal-prog"><div class="lmp-num ${t.period === 'week' ? 'week' : ''}">${mpDone}/${mpTotal}</div></div>`;
  html += `<div class="life-modal-btns">`;
  html += `<button class="btn btn-primary" onclick="lifeCheckinModalMakeup('${typeKey}')">补卡</button>`;
  html += `<button class="btn life-modal-undo" onclick="lifeCheckinModalUndo('${typeKey}')">撤销</button>`;
  html += `</div></div></div>`;
  html += `<div class="life-modal-sel">已选日期：${lifeCheckinSelDate}</div>`;
  // selected-date records (with precise check-in time)
  html += `<div class="life-modal-list">`;
  const selRecs = recs.filter(r => r.date === lifeCheckinSelDate).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  if (!selRecs.length) html += '<div class="life-empty">该日期暂无打卡记录</div>';
  else selRecs.forEach(r => { const tm = fmtHM(r.createdAt); html += `<div class="life-modal-item"><span>${lifeCheckinSelDate}${tm ? ' ' + tm : ''}</span><span>${r.isMakeup ? '补卡' : '已打卡'}</span></div>`; });
  html += `</div>`;
  // foot: delete (custom only)
  if (typeKey.indexOf('custom_') === 0) {
    html += `<div class="life-modal-foot">`;
    html += `<button class="btn btn-ghost btn-sm life-modal-del" onclick="lifeCheckinDeleteModule('${typeKey}')">删除模块</button>`;
    html += `</div>`;
  }
  html += `</div>`;
  openModal(esc(t.label) + ' 打卡详情', html, '');
}
function renderLifeWeekOverview() {
  const today = todayStr();
  const base = weekMondayOf(parseDateStr(today));
  base.setDate(base.getDate() + lifeWeekOffset * 7);
  const days = [];
  for (let j = 0; j < 7; j++) { const d = new Date(base); d.setDate(base.getDate() + j); days.push(fmtDate(d)); }
  return renderLifeSingleWeek('本周概览', days, today, true);
}
function renderLifeSingleWeek(label, days, today, withSummary) {
  const wd = ['一', '二', '三', '四', '五', '六', '日'];
  const allDefs = Object.values(LIFE_CHECKIN_DEFS).concat(DB.list('lifeCheckinDefs'));
  const checkins = DB.list('lifeCheckins');
  const dayDefs = allDefs.filter(t => t.period === 'day');
  const weekDefs = allDefs.filter(t => t.period === 'week');
  const weekRecords = checkins.filter(r => days.includes(r.date));
  const target = dayDefs.length * 7 + weekDefs.length;
  const totalCount = weekRecords.length;
  const rate = target ? Math.round(totalCount / target * 100) : 0;
  const times = weekRecords.map(r => r.createdAt ? new Date(r.createdAt) : null).filter(d => d && !isNaN(d.getTime()));
  let timeRange = '--';
  if (times.length) {
    const hourCounts = {};
    times.forEach(d => { const h = d.getHours(); hourCounts[h] = (hourCounts[h] || 0) + 1; });
    let maxHour = -1, maxCount = 0;
    Object.entries(hourCounts).forEach(([h, c]) => { if (c > maxCount) { maxCount = c; maxHour = +h; } });
    if (maxHour >= 0) {
      const pad = n => String(n).padStart(2, '0');
      const next = (maxHour + 1) % 24;
      timeRange = pad(maxHour) + ':00-' + pad(next) + ':00';
    }
  }
  let html = '';
  if (withSummary) {
    html += '<div class="lwm-summary">';
    html += '<div class="lwm-sum-item"><span class="lwm-sum-label">打卡次数</span><span class="lwm-sum-val">' + totalCount + '次</span></div>';
    html += '<div class="lwm-sum-item"><span class="lwm-sum-label">完成率</span><span class="lwm-sum-val">' + rate + '%</span></div>';
    html += '<div class="lwm-sum-item"><span class="lwm-sum-label">日常打卡时间段</span><span class="lwm-sum-val">' + timeRange + '</span></div>';
    html += '</div>';
  }
  html += '<div class="life-week-module">';
  html += '<div class="lwm-head"><div class="lwm-title">' + label + '</div>';
  html += '<span class="lwm-range">' + days[0].slice(5) + ' - ' + days[6].slice(5) + '</span></div>';
  html += '<div class="lwm-grid">';
  html += '<div class="lwm-row lwm-row-hd"><div class="lwm-habit"></div>';
  for (let i = 0; i < 7; i++) html += '<div class="lwm-day">' + wd[i] + '</div>';
  html += '</div>';
  allDefs.forEach(t => {
    html += '<div class="lwm-row"><div class="lwm-habit"><span class="lwm-habit-name">' + esc(t.label) + '</span><span class="lwm-tag">' + (t.period === 'day' ? '每日打卡' : '每周打卡') + '</span></div>';
    for (let i = 0; i < 7; i++) {
      const ds = days[i];
      const done = checkins.some(r => r.type === t.key && r.date === ds);
      const isToday = ds === today;
      const cls = 'lwm-cell' + (done ? ' done' : '') + (isToday ? ' today' : '') + (t.period === 'week' ? ' week' : '');
      html += '<div class="' + cls + '" title="' + ds + '" onclick="lifeWeekCellClick(\'' + t.key + '\',\'' + ds + '\')">' + (done ? '✔' : '') + '</div>';
    }
    html += '</div>';
  });
  html += '</div></div>';
  return html;
}
function lifeCheckinToggleBlock(mode) { lifeCheckinBlock = mode; renderLifeCheckin(); }
function lifeWeekCellClick(typeKey, dateStr) {
  if (dateStr > todayStr()) { Toast.warning('不能给未来的日期打卡'); return; }
  const rec = DB.list('lifeCheckins').find(r => r.type === typeKey && r.date === dateStr);
  if (rec) { DB.remove('lifeCheckins', rec.id); Toast.success('已撤销'); }
  else {
    const def = getCheckinDef(typeKey);
    DB.add('lifeCheckins', { type: typeKey, date: dateStr, week: weekKeyOf(dateStr), period: def.period, isMakeup: dateStr < todayStr(), createdAt: new Date().toISOString() });
    Toast.success('打卡成功');
  }
  renderLifeCheckin();
}
function lifeCheckinCellClick(typeKey, dateStr) {
  if (dateStr > todayStr()) { Toast.warning('不能选择未来日期'); return; }
  lifeCheckinSelDate = dateStr;
  lifeCheckinRenderModal(typeKey);
}
function lifeCheckinDo(typeKey, dateStr) {
  dateStr = dateStr || todayStr();
  if (dateStr > todayStr()) { Toast.warning('不能给未来的日期打卡'); return; }
  const def = getCheckinDef(typeKey);
  if (DB.list('lifeCheckins').some(r => r.type === typeKey && r.date === dateStr)) { Toast.info('该日期已打卡'); return; }
  DB.add('lifeCheckins', { type: typeKey, date: dateStr, week: weekKeyOf(dateStr), period: def.period, isMakeup: dateStr < todayStr(), createdAt: new Date().toISOString() });
  Toast.success('打卡成功');
  renderLifeCheckin();
}
function lifeCheckinRemove(typeKey, dateStr) {
  const rec = DB.list('lifeCheckins').find(r => r.type === typeKey && r.date === dateStr);
  if (!rec) { Toast.info('该日期无打卡记录'); return; }
  DB.remove('lifeCheckins', rec.id);
  Toast.success('已撤销');
  renderLifeCheckin();
}
function formatSleepDuration(hours) {
  if (hours == null || isNaN(hours)) return '—';
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0 && m === 0) return '0m';
  return (h ? h + 'h' : '') + (m ? m + 'm' : '');
}
function formatSleepDurationHTML(hours) {
  const txt = formatSleepDuration(hours);
  if (!txt || txt === '—') return txt;
  return txt.replace(/([hm])/g, '<span class="dur-unit">$1</span>');
}
function renderSleepRing(totalHours) {
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.min(totalHours / 8, 1);
  const offset = circumference * (1 - pct);
  const reached = totalHours >= 8;
  const color = '#620712';
  const statusText = reached ? '睡眠达到8小时' : '睡眠未达到8小时';
  const timeText = totalHours > 0 ? formatSleepDurationHTML(totalHours) : '—';
  return `<div class="sleep-ring-col">
    <div class="sleep-ring-wrap">
      <svg class="sleep-ring" viewBox="0 0 90 90">
        <circle class="sleep-ring-bg" cx="45" cy="45" r="${radius}"/>
        <circle class="sleep-ring-fill" cx="45" cy="45" r="${radius}" stroke="${color}" stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"/>
      </svg>
      <div class="sleep-ring-text">${timeText}</div>
    </div>
    <div class="sleep-ring-status">${statusText}</div>
  </div>`;
}
function renderLifeRecordTopCard(all, date) {
  const sleepRecs = all.filter(r => r.type === 'sleep' && r.date === date);
  const night = sleepRecs.find(r => r.subtype === 'night');
  const noon = sleepRecs.find(r => r.subtype === 'noon');
  const nightDur = night ? Number(night.duration) || 0 : 0;
  const noonDur = noon ? Number(noon.duration) || 0 : 0;
  const total = nightDur + noonDur;
  const dietSubs = lifeRecordSubtypes('diet');
  return `<div class="lr-top-card">
    <div class="lr-top-left">
      <div class="lr-ring-col">
        ${renderSleepRing(total)}
      </div>
      <div class="lr-top-stats">
        <div class="lr-top-stat"><span class="lts-label">入睡时间</span><span class="lts-val">${night && night.sleepTime ? night.sleepTime : '—'}</span></div>
        <div class="lr-top-stat"><span class="lts-label">清醒时间</span><span class="lts-val">${night && night.wakeTime ? night.wakeTime : '—'}</span></div>
        <div class="lr-top-stat"><span class="lts-label">清醒次数</span><span class="lts-val">${night && night.wakeCount != null ? night.wakeCount + '<span class="lts-unit">次</span>' : '—'}</span></div>
        <div class="lr-top-stat"><span class="lts-label">午休时长</span><span class="lts-val">${noonDur > 0 ? formatSleepDurationHTML(noonDur) : '—'}</span></div>
      </div>
    </div>
    <div class="lr-diet-btns">
      ${dietSubs.map(st => {
        const filled = all.some(r => r.type === 'diet' && r.subtype === st.key && r.date === date);
        return `<button class="lr-diet-qbtn ${filled ? 'filled' : ''}" onclick="lifeRecOpenForm('diet','${st.key}')">${st.label}</button>`;
      }).join('')}
    </div>
  </div>`;
}
function renderDietRecordRow(r, st) {
  let info = '';
  if (st.key === 'snack') {
    info = `<span><b>零食记录:</b> ${r.note || '—'}</span>${r.qty != null ? `<span><b>数量:</b> ${r.qty}${r.unit || '包'}</span>` : ''}`;
  } else if (st.key === 'milktea') {
    const flavors = Array.isArray(r.flavors) ? r.flavors : (r.flavors ? [r.flavors] : []);
    info = `<span><b>奶茶记录:</b> ${r.note || '—'}</span>${flavors.length ? `<span><b>口味:</b> ${flavors.join('、')}</span>` : ''}`;
  } else {
    info = `<span><b>餐食记录:</b> ${r.note || '—'}</span>`;
  }
  if (r.time) info += `<span><b>${st.key === 'snack' || st.key === 'milktea' || st.key === 'midnight' ? '享用时间' : '吃饭时间'}:</b> ${r.time}</span>`;
  return `<div class="lr-record-row">
    <div class="lr-record-info">${info}</div>
    <div class="lr-record-ops">
      <button class="btn btn-sm btn-ghost" onclick="lifeRecEdit('diet','${r.id}')">编辑</button>
      <button class="btn btn-sm btn-ghost" onclick="lifeRecDelete('${r.id}')">删除</button>
    </div>
  </div>`;
}
function renderUnitSingleSelect(selected) {
  const opts = LIFE_RECORD_SUBTYPES.diet.snack.unitOptions;
  const customOpts = DB.get('customOpts_lifeRecord_snack_unit', []);
  const allOpts = opts.concat(customOpts.filter(c => !opts.includes(c)));
  const sel = selected || '包';
  const groupId = 'lrf-unit-group';
  let html = `<div class="lf-field lf-field-full"><label>单位</label>`;
  html += `<div class="checkbox-group pill-group single-pill" id="${groupId}" data-key="unit" data-single="true">`;
  allOpts.forEach(o => {
    const checked = sel === o ? 'checked' : '';
    html += `<label class="checkbox-item ${checked ? 'selected' : ''}"><input type="checkbox" value="${esc(o)}" ${checked} onclick="limitSingleCheckbox(this)"> ${esc(o)}</label>`;
  });
  html += `</div>`;
  html += `<div style="display:flex;gap:6px;margin-top:6px"><input type="text" class="form-input" id="lrf-unit-custom" placeholder="输入自定义单位后按添加" style="flex:1;font-size:13px"><button type="button" class="btn btn-outline btn-sm" onclick="addLifeRecordUnit(this)">添加</button><button type="button" class="btn btn-danger btn-sm" onclick="removeCheckedLifeRecordUnits('${groupId}')">删除</button></div>`;
  html += `</div>`;
  return html;
}
function renderFlavorMultiselect(selected) {
  const opts = LIFE_RECORD_SUBTYPES.diet.milktea.flavorOptions;
  const customOpts = DB.get('customOpts_lifeRecord_milktea_flavors', []);
  const allOpts = opts.concat(customOpts.filter(c => !opts.includes(c)));
  const selArr = Array.isArray(selected) ? selected : (selected ? [selected] : []);
  const groupId = 'lrf-flavors-group';
  let html = `<div class="lf-field lf-field-full"><label>口味配方</label>`;
  html += `<div class="checkbox-group tag-group" id="${groupId}" data-key="flavors">`;
  allOpts.forEach(o => {
    const checked = selArr.includes(o) ? 'checked' : '';
    html += `<label class="checkbox-item ${checked ? 'selected' : ''}"><input type="checkbox" value="${esc(o)}" ${checked} onclick="toggleCheckboxItem(this)"> ${esc(o)}</label>`;
  });
  html += `</div>`;
  html += `<div style="display:flex;gap:6px;margin-top:6px"><input type="text" class="form-input" id="lrf-flavors-custom" placeholder="输入自定义口味后按添加" style="flex:1;font-size:13px"><button type="button" class="btn btn-outline btn-sm" onclick="addLifeRecordFlavor(this)">添加</button><button type="button" class="btn btn-danger btn-sm" onclick="removeCheckedLifeRecordFlavors('${groupId}')">删除</button></div>`;
  html += `</div>`;
  return html;
}
function renderLifeRecordInlineForm(typeKey, subtypeKey) {
  const ps = pageState['life-record'];
  const st = getLifeRecordSubtype(typeKey, subtypeKey);
  const values = ps.values || {};
  let html = `<div class="life-rec-form" id="lifeRecForm">`;
  if (typeKey === 'sleep') {
    html += `<div class="lf-field"><label>入睡时间</label><input type="time" id="lrf-sleepTime" value="${esc(values.sleepTime || '')}"></div>`;
    html += `<div class="lf-field"><label>清醒时间</label><input type="time" id="lrf-wakeTime" value="${esc(values.wakeTime || '')}"></div>`;
    html += `<div class="lf-field"><label>清醒次数</label><input type="number" id="lrf-wakeCount" value="${esc(values.wakeCount != null ? values.wakeCount : '')}"></div>`;
    html += `<div class="lf-field"><label>睡眠时长（自动）</label><input type="text" id="lrf-duration" value="${values.duration != null ? formatSleepDuration(Number(values.duration)) : ''}" readonly style="background:var(--c-primary-bg)"></div>`;
  } else {
    const placeholder = st.key === 'snack' ? '零食内容' : st.key === 'milktea' ? '奶茶名称' : '吃了什么';
    html += `<div class="lf-field ${st.key === 'snack' || st.key === 'milktea' ? 'lf-field-full' : ''}"><label>内容</label><input type="text" id="lrf-note" value="${esc(values.note || '')}" placeholder="${placeholder}"></div>`;
    if (st.key === 'snack') {
      html += `<div class="lf-field"><label>数量</label><input type="number" step="0.1" id="lrf-qty" value="${esc(values.qty != null ? values.qty : '')}"></div>`;
      html += renderUnitSingleSelect(values.unit);
    }
    if (st.key === 'milktea') html += renderFlavorMultiselect(values.flavors || []);
    html += `<div class="lf-field"><label>时间</label><input type="time" id="lrf-time" value="${esc(values.time || '')}"></div>`;
  }
  html += `<div class="lf-field" style="flex-direction:row;gap:6px"><button class="btn btn-primary" onclick="lifeRecSave('${typeKey}','${subtypeKey}')">${ps.editId ? '保存修改' : '保存'}</button><button class="btn btn-ghost" onclick="lifeRecCancel()">取消</button></div>`;
  html += `</div>`;
  return html;
}
function renderSleepRecordRows(recs) {
  return recs.map(r => {
    const dur = r.duration != null ? formatSleepDuration(Number(r.duration)) : '—';
    return `<div class="lr-record-row">
      <div class="lr-record-info lr-record-info-2col">
        <div class="lr-info-line"><span class="lr-info-label">入睡时间:</span><span class="lr-info-val">${r.sleepTime || '—'}</span></div>
        <div class="lr-info-line"><span class="lr-info-label">清醒时间:</span><span class="lr-info-val">${r.wakeTime || '—'}</span></div>
        <div class="lr-info-line"><span class="lr-info-label">睡眠时长:</span><span class="lr-info-val">${dur}</span></div>
        <div class="lr-info-line"><span class="lr-info-label">清醒次数:</span><span class="lr-info-val">${r.wakeCount != null ? r.wakeCount + '次' : '—'}</span></div>
      </div>
      <div class="lr-record-ops">
        <button class="btn btn-sm btn-ghost" onclick="lifeRecEdit('sleep','${r.id}')">编辑</button>
        <button class="btn btn-sm btn-ghost" onclick="lifeRecDelete('${r.id}')">删除</button>
      </div>
    </div>`;
  }).join('');
}
function renderDietRecordRows(recs, st) {
  return recs.map(r => {
    let lines = '';
    if (st.key === 'snack') {
      const qtyLine = r.qty != null ? `<div class="lr-info-line"><span class="lr-info-label">数量:</span><span class="lr-info-val">${r.qty}${r.unit || '包'}</span></div>` : '';
      lines = `<div class="lr-info-line"><span class="lr-info-label">享用时间:</span><span class="lr-info-val">${r.time || '—'}</span></div>${qtyLine}<div class="lr-info-line lr-info-full"><span class="lr-info-label">零食记录:</span><span class="lr-info-val">${r.note || '—'}</span></div>`;
    } else if (st.key === 'milktea') {
      const flavors = Array.isArray(r.flavors) ? r.flavors : (r.flavors ? [r.flavors] : []);
      const flavorTxt = flavors.length ? `（${flavors.join('、')}）` : '';
      lines = `<div class="lr-info-line"><span class="lr-info-label">享用时间:</span><span class="lr-info-val">${r.time || '—'}</span></div><div class="lr-info-line lr-info-full"><span class="lr-info-label">奶茶记录:</span><span class="lr-info-val">${r.note || '—'}${flavorTxt}</span></div>`;
    } else {
      lines = `<div class="lr-info-line"><span class="lr-info-label">${st.key === 'midnight' ? '享用时间' : '吃饭时间'}:</span><span class="lr-info-val">${r.time || '—'}</span></div><div class="lr-info-line lr-info-full"><span class="lr-info-label">餐食记录:</span><span class="lr-info-val">${r.note || '—'}</span></div>`;
    }
    return `<div class="lr-record-row">
      <div class="lr-record-info lr-record-info-2col">${lines}</div>
      <div class="lr-record-ops">
        <button class="btn btn-sm btn-ghost" onclick="lifeRecEdit('diet','${r.id}')">编辑</button>
        <button class="btn btn-sm btn-ghost" onclick="lifeRecDelete('${r.id}')">删除</button>
      </div>
    </div>`;
  }).join('');
}
function renderSleepRecordCard(date) {
  const all = DB.list('lifeRecords');
  const ps = pageState['life-record'];
  const sleepSubs = lifeRecordSubtypes('sleep');
  let html = `<div class="lr-card">
    <div class="lr-card-head"><span class="lr-card-title">😴 睡眠记录</span></div>
    <div class="lr-card-body">`;
  sleepSubs.forEach(st => {
    const recs = all.filter(r => r.type === 'sleep' && r.subtype === st.key && r.date === date).sort((a, b) => (a._ct || 0) - (b._ct || 0));
    html += `<div class="lr-subtype-box">
      <div class="lr-subtype-label">${st.label}</div>
      <div class="lr-subtype-content">
        ${recs.length ? renderSleepRecordRows(recs) : `<div class="lr-empty-row" onclick="lifeRecOpenForm('sleep','${st.key}')">点击添加${st.label}睡眠记录</div>`}
        ${ps.formType === 'sleep' && ps.subtype === st.key ? renderLifeRecordInlineForm('sleep', st.key) : ''}
      </div>
      <button class="lr-subtype-add" onclick="lifeRecOpenForm('sleep','${st.key}')" title="新增${st.label}记录">+</button>
    </div>`;
  });
  html += `</div></div>`;
  return html;
}
function renderDietRecordCard(date) {
  const all = DB.list('lifeRecords');
  const ps = pageState['life-record'];
  const dietSubs = lifeRecordSubtypes('diet');
  let html = `<div class="lr-card">
    <div class="lr-card-head"><span class="lr-card-title">🍚 饮食记录</span></div>
    <div class="lr-card-body">`;
  dietSubs.forEach(st => {
    const recs = all.filter(r => r.type === 'diet' && r.subtype === st.key && r.date === date).sort((a, b) => (a._ct || 0) - (b._ct || 0));
    html += `<div class="lr-subtype-box">
      <div class="lr-subtype-label">${st.label}</div>
      <div class="lr-subtype-content">
        ${recs.length ? renderDietRecordRows(recs, st) : `<div class="lr-empty-row" onclick="lifeRecOpenForm('diet','${st.key}')">点击添加${st.label}记录</div>`}
        ${ps.formType === 'diet' && ps.subtype === st.key ? renderLifeRecordInlineForm('diet', st.key) : ''}
      </div>
      <button class="lr-subtype-add" onclick="lifeRecOpenForm('diet','${st.key}')" title="新增${st.label}记录">+</button>
    </div>`;
  });
  html += `</div></div>`;
  return html;
}
function renderSleepWeekLineChart(days) {
  const all = DB.list('lifeRecords');
  const vals = days.map(d => all.filter(r => r.type === 'sleep' && r.date === d).reduce((s, r) => s + (Number(r.duration) || 0), 0));
  const maxV = Math.max(8, ...vals);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const pts = vals.map((v, i) => {
    const x = i === 0 ? 5 : (i === 6 ? 95 : (i / 6 * 90 + 5));
    const y = 100 - v / maxV * 80 - 10;
    return `${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ');
  const circles = vals.map((v, i) => {
    const x = i === 0 ? 5 : (i === 6 ? 95 : (i / 6 * 90 + 5));
    const y = 100 - v / maxV * 80 - 10;
    return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="2.5" fill="var(--c-primary)"/>`;
  }).join('');
  const refY = 100 - 8 / maxV * 80 - 10;
  return `<div class="lr-history-stat-card">
    <div class="lr-hsc-row"><span class="lr-hsc-title">一周睡眠折线统计</span><span class="lr-hsc-sub">日均 ${formatSleepDuration(avg)}</span></div>
    <div class="lr-hsc-chart-body">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <polyline fill="none" stroke="var(--c-primary)" stroke-width="2" points="${pts}"/>
        ${circles}
        <line x1="0" y1="${refY.toFixed(2)}" x2="100" y2="${refY.toFixed(2)}" stroke="var(--c-warning)" stroke-dasharray="2,2" stroke-width="0.5"/>
      </svg>
    </div>
    <div class="lr-hsc-x">${days.map(d => `<span>${d.slice(5)}</span>`).join('')}</div>
  </div>`;
}
function renderDietWeekStats(days) {
  const all = DB.list('lifeRecords');
  const counts = {};
  Object.keys(LIFE_RECORD_SUBTYPES.diet).forEach(sk => counts[sk] = 0);
  days.forEach(d => all.filter(r => r.type === 'diet' && r.date === d).forEach(r => { if (counts[r.subtype] != null) counts[r.subtype]++; }));
  const maxCount = Math.max(1, ...Object.values(counts));
  return `<div class="lr-history-stat-card">
    <div class="lr-hsc-row"><span class="lr-hsc-title">一周饮食统计</span><span class="lr-hsc-sub">各餐食用次数</span></div>
    <div class="lr-hsc-bar-body">
      ${Object.entries(LIFE_RECORD_SUBTYPES.diet).map(([sk, st]) => {
        const count = counts[sk];
        const h = Math.max(4, count / maxCount * 70);
        return `<div class="lr-hsc-bar-item"><div class="lr-hsc-bar" style="height:${h}px"></div><div class="lr-hsc-bar-num">${count}</div><div class="lr-hsc-bar-label">${st.label}</div></div>`;
      }).join('')}
    </div>
  </div>`;
}
function renderLifeRecordHistoryDayCard(typeKey, dateStr, wdLabel) {
  const all = DB.list('lifeRecords');
  const subKeys = typeKey === 'sleep' ? ['night', 'noon'] : Object.keys(LIFE_RECORD_SUBTYPES.diet);
  const headExtra = typeKey === 'sleep'
    ? (() => { const total = all.filter(r => r.type === 'sleep' && r.date === dateStr).reduce((s, r) => s + (Number(r.duration) || 0), 0); return total > 0 ? `睡眠 ${formatSleepDuration(total)}` : ''; })()
    : '';
  let body = '';
  subKeys.forEach(sk => {
    const st = LIFE_RECORD_SUBTYPES[typeKey][sk];
    const recs = all.filter(r => r.type === typeKey && r.subtype === sk && r.date === dateStr).sort((a, b) => (a._ct || 0) - (b._ct || 0));
    body += `<div class="lr-subtype-box">
      <div class="lr-subtype-label">${st.label}</div>
      <div class="lr-subtype-content">
        ${recs.length
          ? (typeKey === 'sleep' ? renderSleepRecordRows(recs) : renderDietRecordRows(recs, st))
          : `<div class="lr-empty-row" onclick="lifeRecordHistoryCellClick('${typeKey}','${sk}','${dateStr}')">点击添加${st.label}记录</div>`}
      </div>
      <button class="lr-subtype-add" onclick="lifeRecordHistoryCellClick('${typeKey}','${sk}','${dateStr}')" title="新增${st.label}记录">+</button>
    </div>`;
  });
  return `<div class="lr-history-day-card">
    <div class="lr-history-day-head"><span class="lr-history-day-date">${dateStr}</span><span class="lr-history-day-wd">${wdLabel}</span>${headExtra ? `<span class="lr-history-day-extra">${headExtra}</span>` : ''}</div>
    <div class="lr-history-day-body">${body}</div>
  </div>`;
}
function renderLifeRecordHistory(typeKey) {
  const ps = pageState['life-record'];
  const today = todayStr();
  const base = weekMondayOf(parseDateStr(today));
  base.setDate(base.getDate() + (ps.weekOffset || 0) * 7);
  const days = [];
  for (let j = 0; j < 7; j++) { const d = new Date(base); d.setDate(base.getDate() + j); days.push(fmtDate(d)); }
  const wd = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const def = LIFE_RECORD_DEFS[typeKey];
  let html = `<div class="lr-history-hd"><button class="btn btn-ghost btn-sm" onclick="lifeRecordToggleView('home')">‹ 返回</button><span class="lr-history-title">${def.icon} ${def.label}历史查询</span></div>`;
  if (typeKey === 'sleep') html += renderSleepWeekLineChart(days);
  else html += renderDietWeekStats(days);
  days.forEach((d, i) => { html += renderLifeRecordHistoryDayCard(typeKey, d, wd[i]); });
  html += `<div class="lr-week-nav">
    <button class="btn btn-ghost" onclick="lifeRecordHistoryPrevWeek()">‹ 上一周</button>
    <span>${days[0].slice(5)} - ${days[6].slice(5)}</span>
    <button class="btn btn-ghost" onclick="lifeRecordHistoryNextWeek()" ${ps.weekOffset >= 0 ? 'disabled' : ''}>下一周 ›</button>
  </div>`;
  return html;
}
function renderLifeRecord() {
  const body = $('#mainBody');
  if (!pageState['life-record']) pageState['life-record'] = { date: todayStr(), formType: null, editId: null, values: {}, view: 'home', weekOffset: 0, subtype: null };
  const ps = pageState['life-record'];
  const date = ps.date;
  const all = DB.list('lifeRecords');
  let html = '<div class="fade-in life-record-page">';
  html += renderLifeRecordTopCard(all, date);
  html += `<div class="lr-toggle-row">
    <button class="lr-toggle-btn ${ps.view === 'sleep-history' ? 'active' : ''}" onclick="lifeRecordToggleView('sleep-history')"><span>😴</span>睡眠记录</button>
    <button class="lr-toggle-btn ${ps.view === 'diet-history' ? 'active' : ''}" onclick="lifeRecordToggleView('diet-history')"><span>🍚</span>饮食记录</button>
  </div>`;
  if (ps.view === 'sleep-history' || ps.view === 'diet-history') {
    html += renderLifeRecordHistory(ps.view === 'sleep-history' ? 'sleep' : 'diet');
  } else {
    html += renderSleepRecordCard(date);
    html += renderDietRecordCard(date);
  }
  html += '</div>';
  body.innerHTML = html;
}
function lifeRecordSetDate(v) { const ps = pageState['life-record']; ps.date = v; ps.formType = null; ps.editId = null; ps.values = {}; ps.subtype = null; renderLifeRecord(); }
function lifeRecordGoDate(n) { const ps = pageState['life-record']; ps.date = addDaysStr(ps.date, n); if (ps.date > todayStr()) ps.date = todayStr(); ps.formType = null; ps.editId = null; ps.values = {}; ps.subtype = null; renderLifeRecord(); }
function lifeRecordToggleView(view) {
  const ps = pageState['life-record'];
  if (ps.view === view) view = 'home';
  ps.view = view;
  ps.formType = null; ps.editId = null; ps.values = {}; ps.subtype = null;
  if (view === 'home') ps.weekOffset = 0;
  renderLifeRecord();
}
function lifeRecordHistoryPrevWeek() { pageState['life-record'].weekOffset--; renderLifeRecord(); }
function lifeRecordHistoryNextWeek() { if (pageState['life-record'].weekOffset >= 0) return; pageState['life-record'].weekOffset++; renderLifeRecord(); }
function lifeRecordHistoryCellClick(typeKey, subtypeKey, dateStr) {
  lifeRecordSetDate(dateStr);
  lifeRecordToggleView('home');
  setTimeout(() => lifeRecOpenForm(typeKey, subtypeKey), 50);
}
function lifeRecOpenForm(typeKey, subtypeKey) {
  const ps = pageState['life-record'];
  ps.formType = typeKey; ps.subtype = subtypeKey; ps.editId = null; ps.values = {};
  renderLifeRecord();
  setTimeout(() => { const f = document.getElementById('lifeRecForm'); if (f) f.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 50);
}
function lifeRecCancel() { const ps = pageState['life-record']; ps.formType = null; ps.editId = null; ps.values = {}; ps.subtype = null; renderLifeRecord(); }
function lifeRecEdit(typeKey, id) { const ps = pageState['life-record']; const rec = DB.getById('lifeRecords', id); ps.formType = rec ? rec.type : typeKey; ps.subtype = rec ? rec.subtype : null; ps.editId = id; ps.values = rec ? { ...rec } : {}; renderLifeRecord(); }
function lifeRecSave(typeKey, subtypeKey) {
  const ps = pageState['life-record'];
  const values = { subtype: subtypeKey };
  if (typeKey === 'sleep') {
    values.sleepTime = $('#lrf-sleepTime').value;
    values.wakeTime = $('#lrf-wakeTime').value;
    const wc = $('#lrf-wakeCount').value;
    values.wakeCount = wc === '' ? null : Number(wc);
    const dur = sleepDurationHours(values.sleepTime, values.wakeTime);
    if (dur != null) values.duration = dur;
  } else {
    values.note = $('#lrf-note').value;
    values.time = $('#lrf-time').value;
    if (subtypeKey === 'snack') {
      const q = $('#lrf-qty').value;
      values.qty = q === '' ? null : Number(q);
      const unitGroup = document.getElementById('lrf-unit-group');
      values.unit = unitGroup ? (unitGroup.querySelector('input[type="checkbox"]:checked') || {}).value || '包' : '包';
    }
    if (subtypeKey === 'milktea') {
      const flavorGroup = document.getElementById('lrf-flavors-group');
      values.flavors = flavorGroup ? Array.from(flavorGroup.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value) : [];
    }
  }
  const rec = { type: typeKey, date: ps.date, week: weekKeyOf(ps.date), createdAt: new Date().toISOString(), ...values };
  if (ps.editId) { DB.update('lifeRecords', ps.editId, rec); Toast.success('已保存修改'); }
  else { DB.add('lifeRecords', rec); Toast.success('已添加记录'); }
  if (typeKey === 'diet' && subtypeKey === 'snack') syncSnackCheckin(ps.date);
  ps.formType = null; ps.editId = null; ps.values = {}; ps.subtype = null;
  renderLifeRecord();
}
function syncSnackCheckin(date) {
  const def = getCheckinDef('snackcheck');
  if (!def) return;
  const hasSnack = DB.list('lifeRecords').some(r => r.type === 'diet' && r.subtype === 'snack' && r.date === date);
  const rec = DB.list('lifeCheckins').find(r => r.type === 'snackcheck' && r.date === date);
  if (hasSnack && !rec) {
    DB.add('lifeCheckins', { type: 'snackcheck', date: date, week: weekKeyOf(date), period: 'day', isMakeup: false, createdAt: new Date().toISOString() });
  } else if (!hasSnack && rec) {
    DB.remove('lifeCheckins', rec.id);
  }
}
function lifeRecDelete(id) {
  const rec = DB.getById('lifeRecords', id);
  const date = rec ? rec.date : null;
  DB.remove('lifeRecords', id); Toast.success('已删除');
  if (date) syncSnackCheckin(date);
  renderLifeRecord();
}
function addLifeRecordUnit(btn) {
  const input = document.getElementById('lrf-unit-custom');
  const val = (input.value || '').trim();
  if (!val) return;
  const dbKey = 'customOpts_lifeRecord_snack_unit';
  const customOpts = DB.get(dbKey, []);
  if (!customOpts.includes(val)) { customOpts.push(val); DB.set(dbKey, customOpts); }
  const group = document.getElementById('lrf-unit-group');
  if (group && !group.querySelector(`input[value="${esc(val)}"]`)) {
    const label = document.createElement('label');
    label.className = 'checkbox-item';
    label.innerHTML = `<input type="checkbox" value="${esc(val)}" onclick="limitSingleCheckbox(this)"> ${esc(val)}`;
    group.appendChild(label);
  }
  input.value = '';
}
function removeCheckedLifeRecordUnits(groupId) {
  const group = document.getElementById(groupId);
  if (!group) return;
  const checked = Array.from(group.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
  if (!checked.length) { Toast.warning('请勾选要删除的单位'); return; }
  const dbKey = 'customOpts_lifeRecord_snack_unit';
  let customOpts = DB.get(dbKey, []);
  customOpts = customOpts.filter(v => !checked.includes(v));
  DB.set(dbKey, customOpts);
  group.querySelectorAll('.checkbox-item').forEach(item => {
    const cb = item.querySelector('input[type="checkbox"]');
    if (cb && checked.includes(cb.value)) item.remove();
  });
  Toast.success('已删除 ' + checked.length + ' 项');
}
function addLifeRecordFlavor(btn) {
  const input = document.getElementById('lrf-flavors-custom');
  const val = (input.value || '').trim();
  if (!val) return;
  const dbKey = 'customOpts_lifeRecord_milktea_flavors';
  const customOpts = DB.get(dbKey, []);
  if (!customOpts.includes(val)) { customOpts.push(val); DB.set(dbKey, customOpts); }
  const group = document.getElementById('lrf-flavors-group');
  if (group && !group.querySelector(`input[value="${esc(val)}"]`)) {
    const label = document.createElement('label');
    label.className = 'checkbox-item selected';
    label.innerHTML = `<input type="checkbox" value="${esc(val)}" checked onclick="toggleCheckboxItem(this)"> ${esc(val)}`;
    group.appendChild(label);
  }
  input.value = '';
}
function removeCheckedLifeRecordFlavors(groupId) {
  const group = document.getElementById(groupId);
  if (!group) return;
  const checked = Array.from(group.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
  if (!checked.length) { Toast.warning('请勾选要删除的口味配方'); return; }
  const dbKey = 'customOpts_lifeRecord_milktea_flavors';
  let customOpts = DB.get(dbKey, []);
  customOpts = customOpts.filter(v => !checked.includes(v));
  DB.set(dbKey, customOpts);
  group.querySelectorAll('.checkbox-item').forEach(item => {
    const cb = item.querySelector('input[type="checkbox"]');
    if (cb && checked.includes(cb.value)) item.remove();
  });
  Toast.success('已删除 ' + checked.length + ' 项');
}

/* ===== Init ===== */
function init() {
  const s = getSettings();
  applyTheme(s.theme);
  if (DB.get('ui_sidebar_collapsed', false)) $('#sidebar').classList.add('collapsed');
  migrateData();
  Sync.load();
  initEvents();
  const lastState = DB.get('ui_state', {});
  navigate(lastState.lastPage || 'home');
  Sync.startAuto();
}
document.addEventListener('DOMContentLoaded', init);