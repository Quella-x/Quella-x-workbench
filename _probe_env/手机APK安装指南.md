# 小筱工作台 · 手机 APK 安装与云端同步指南

> 目标：把「小筱工作台」装到安卓手机，作为可离线使用的 App，数据通过云端（Supabase）在手机↔电脑间互通。

---

## 一、当前在线地址（永久，随代码更新自动生效）

```
https://quella-x.github.io/Quella-x-workbench/
```

这是 GitHub Pages 提供的**永久地址**（只要你不清空仓库就一直有效），由代码仓库 `main` 分支自动托管。
已通过 PWA 合规：`index.html`、`manifest.json`(application/json)、`sw.js`(service worker)、图标均正常返回 200。
电脑端直接用浏览器打开使用；手机端可“添加到主屏幕”当网页 App，或按下方生成原生 APK。

> 开启方式（一次性）：进仓库 **Settings → Pages → Build and deployment → Source 选 “Deploy from a branch” → Branch 选 `main` / 目录 `/root` → Save**。约 1 分钟后站点上线。

---

## 二、生成安卓 APK

### 方式 A（推荐，最简单）：用 PWABuilder 官网一键出包

1. 用电脑/手机浏览器打开：**https://www.pwabuilder.com**
2. 粘贴上面的在线地址 `https://quella-x.github.io/Quella-x-workbench/` → 点 **Start**。
3. 检测完成（Android 绿色对勾）后，**点页面顶部的 "Package For Stores"**（**注意：不是 "Download Test Package"**，那是未签名的测试包，文件名会带 `-unsigned`，约 850KB，装不上！）。
4. 弹出窗口选 **Google Play** → **Other Android**（左侧安卓机器人图标）。
5. 等待 1-2 分钟 → 点 **Download Package**。
6. 下载一个 zip 文件 → **解压** → 找到 `app-release-signed.apk`（约 5-10 MB，**没有 unsigned 字样**）→ 装这个。
7. 把 APK 传到手机，允许“安装未知来源应用”后安装。

> **快速判断是不是装对了**：APK 文件名带 `-unsigned` 或者大小 < 1 MB = 测试包，**装不上**。要 5-10 MB 才是已签名的可装包。

### 方式 B（备份方案）：一键签名工具（适合下载了 unsigned 包的用户）

如果从 PWABuilder 下到的 APK 文件名带 `-unsigned`（如 `xxx-unsigned.apk`），用本工具一键签名。工具位置：`D:\wbkey\sign-tool\`。

1. **安装 Java（一次性）**：Win+R → 输入 `powershell` → 回车 → 粘贴 `winget install Microsoft.OpenJDK.21` → 回车 → 等装完。
2. 把 `xxx-unsigned.apk` 复制到 `D:\wbkey\sign-tool\` 目录。
3. **双击 `D:\wbkey\sign-tool\sign.bat`** → 把 APK 拖入黑色窗口回车。
4. 同目录会生成 `xxx_aligned-debugSigned.apk`（已签名可装，~1-2 MB）→ 复制到手机安装。

详细文档：`D:\wbkey\sign-tool\一键APK签名-使用说明.md`

### 方式 C（自动构建）：GitHub Actions

仓库已配置 GitHub Actions，每次 push 到 `main` 会自动构建。但**当前 bubblewrap 在 CI 里 init 参数受限、PWABuilder API 在 Actions 网络下不可达，因此自动构建暂未启用**。建议改用方式 A 或方式 B 出包。

---

## 三、安装到手机的常见注意

- **安卓**：允许“未知来源”后即可安装；若提示“存在风险”，选“仍安装”。
- **鸿蒙/华为**：部分机型需在“设置→安全→更多安全设置”开启外部来源应用安装。
- **iOS**：苹果不支持侧载 APK。iOS 用户用 Safari 打开在线地址 → 分享 → **添加到主屏幕**，即为类 App 体验（需联网）。
- 上架商店时用 `.aab` 配合 `assetlinks.json`（PWABuilder 会一并给出）做数字资产关联。

---

## 四、开启云端同步（手机↔电脑互通）

APK 只是外壳，数据互通依赖 Supabase。在 App 内设置一次即可（手机/电脑两边填同样的配置）：

1. 注册 https://supabase.com ，新建项目。
2. 在 **SQL Editor** 执行建表语句：
   ```sql
   create table sync_store (
     group_key text,
     store text,
     data jsonb,
     updated_at timestamptz default now(),
     primary key (group_key, store)
   );
   alter table sync_store enable row level security;
   create policy "anon_all" on sync_store for all to anon using (true) with check (true);
   ```
3. 拿到项目 URL（形如 `https://xxxx.supabase.co`）和 **Anon Key**（公开键，非 secret）。
4. 打开 App → 设置 → **云端同步（Supabase）**，填入：
   - Supabase 项目 URL
   - Anon Key
   - 一个自定义“同步码”（手机和电脑必须填**完全一致**的同步码，用来区分你的数据空间）
5. 保存后，App 会自动把本地数据推送到云端，并在另一台设备打开时自动拉取，实现互通。

---

## 五、代码仓库与更新

- 源码仓库：**https://github.com/Quella-x/Quella-x-workbench**
- 每次修改代码后 `git push` 到 `main`：
  - GitHub Pages 站点（第一节地址）自动更新，无需重装 App（壳不变）。
  - 若改了 `manifest.json`、包名、主题色等“壳配置”，需重新走第二节生成新 APK 安装。
- 本地私钥仅用于部署，用完可在 `D:\wbkey` 删除、并在 GitHub **Settings → SSH and GPG keys** 删除对应 key。

---

## 六、离线能力说明

`sw.js` 已缓存：`index.html / app.js / manifest.json / 图标 / html2canvas`。
- 首次联网打开后，断网仍可进入 App 并查看已加载过的数据。
- 新数据先存本地，联网后由 Supabase 同步（见第四节）。
