/* build_order_form.js — 从 index.html 生成 order-form.html（单主独立约稿单填写页）
 * 用法: node build_order_form.js   （在 workstation/ 或 workstation_live/ 内运行）
 * 每次发版升版后必须重跑一次，保证 order-form 与 index.html 同版。
 * 生成规则：
 *   1) 标题改为「约稿单填写」
 *   2) viewport 锁定缩放（修复单主填写时界面放大）
 *   3) 早期守卫脚本替换为参数校验：无 cd_client=1&standalone=1 参数时只显示"链接无效"页，
 *      且 app.js 不加载 —— 单主改地址栏永远看不到工作台
 *   4) 其余（CSS/DOM 骨架/依赖脚本）与 index.html 完全一致
 */
const fs = require('fs');

let html = fs.readFileSync('index.html', 'utf8');

// 1) 标题
html = html.replace('<title>小筱工作台</title>', '<title>约稿单填写</title>');

// 2) viewport 锁缩放
html = html.replace(
  '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes, viewport-fit=cover">',
  '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">'
);

// 3) 早期守卫脚本替换
const oldGuard = `<script>
/* 单主独立填写页零闪屏：在 CSS/JS 主逻辑运行前就先隐藏工作台 chrome */
(function(){
  try {
    var qs = window.location.search;
    if (qs.indexOf('cd_client=1') !== -1 && qs.indexOf('standalone=1') !== -1) {
      document.documentElement.classList.add('cd-standalone');
    }
  } catch (e) {}
})();
</script>`;

const newGuard = `<script>
/* order-form.html 单主独立约稿单填写页（由 build_order_form.js 生成，勿手改）
   校验失败：立即显示"链接无效"页，且不加载 app.js —— 单主改地址栏看不到工作台任何内容 */
(function(){
  var ok = false;
  try {
    var qs = window.location.search;
    ok = qs.indexOf('cd_client=1') !== -1 && qs.indexOf('standalone=1') !== -1;
    if (ok) document.documentElement.classList.add('cd-standalone');
  } catch (e) { ok = false; }
  window.__OF_VALID = ok;
  if (!ok) {
    var show = function () {
      if (window.__OF_DONE) return; window.__OF_DONE = true;
      document.documentElement.innerHTML = '<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"></head><body style="margin:0;background:#F4FCFF;font-family:system-ui,-apple-system,sans-serif"><div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#2c3e50;padding:24px;text-align:center"><div style="font-size:44px">&#128279;</div><div style="font-size:17px;font-weight:700;margin-top:12px">链接无效</div><div style="font-size:13px;color:#7f8c9a;margin-top:8px">请通过卖家提供的完整链接打开约稿单</div></div></body>';
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', show);
    } else { show(); }
    window.addEventListener('load', show);
  }
})();
</script>`;

if (!html.includes(oldGuard)) { console.error('FAIL: 未找到早期守卫脚本，index.html 结构可能已变化'); process.exit(1); }
html = html.replace(oldGuard, newGuard);

// 4) app.js 改为条件加载（无效参数时完全不加载工作台逻辑）
const appTag = html.match(/<script src="app\.js\?v=\d+"><\/script>/);
if (!appTag) { console.error('FAIL: 未找到 app.js 引入标签'); process.exit(1); }
const version = appTag[0].match(/v=(\d+)/)[1];
html = html.replace(appTag[0],
  `<script>if (window.__OF_VALID) document.write('<script src="app.js?v=${version}"><\\/script>');</script>`);

// 4.5) 去掉「凭据保险箱内置云端入口」脚本：仅 APK 需要，order-form 是公开页不引用
html = html.replace(/[ \t]*<script src="assets\/vault-cfg\.js"><\/script>\r?\n/, '');

fs.writeFileSync('order-form.html', html);
console.log('OK: order-form.html generated (app.js?v=' + version + ', ' + html.length + ' chars)');
