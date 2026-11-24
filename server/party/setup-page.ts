function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function renderSetupMarkdown(baseUrl: string): string {
  return `# Agent Party 虚拟办公室 — AI Agent 自动接入协议

> 这是一份给 **AI 编程助手 / Agent**（Claude Code、Codex、Antigravity、Cursor、Windsurf、Trae、WorkBuddy、豆包/MarsCode、OpenCode、Cline/Roo 等）直接阅读并自动执行的接入指南。
> **隐私原则**：本办公室仅同步「工作中 / 等待确认 / 自由活动」状态与所使用的工具名称，**严禁上报任何具体代码、文件路径、命令或提示词内容！**

---

## 【给 AI Agent 的执行指令】

请直接通过自然语言与用户交互并自动完成全部本地配置，**不要**让用户手动复制修改代码；且**必须**按照步骤 2 为用户创建专属像素小人，并主动给出“携带一只「你的昵称的xxx」专属宠物/宝可梦”的惊喜选项。

### 步骤 1：静默扫描本机环境（绝对主目录 + Codex V2 桌宠）
在提问前，先在后台静默获取：
1. **用户绝对主目录路径 \`ABS_HOME\`**（在 Windows 下把反斜杠统一替换为正斜杠 \`/\`，例如 \`C:/Users/Alice\`；macOS/Linux 如 \`/Users/alice\` 或 \`/home/alice\`）。
   > **跨平台硬性规定**：后续所有写入 Hook JSON、TOML 或全局规则中的路径，**必须使用 \`<ABS_HOME>/.agent-party/report.mjs\`，严禁写成 \`~/.agent-party/report.mjs\`**（Windows PowerShell / CMD 引号内的 \`~\` 不会展开，会直接导致状态同步静默失败！）。
2. 检查本机是否存在兼容 Codex V2 的桌面宠物目录（Windows \`%USERPROFILE%\\.codex\\pets\`，macOS/Linux \`~/.codex/pets\`），扫描所有包含 \`pet.json\` 与 \`spritesheet.webp\`（或 \`spritesheet.png\`）的子目录，记录 \`petId\` 与 \`displayName\`。

---

### 步骤 2：询问用户入职信息（名字、职位、伴随宝可梦）
请用简洁自然的方式向用户收集以下 **3 项基础信息**（优先使用你当前的交互式多问题/表单工具一次问齐，例如 \`ask_question\` / \`AskUserQuestion\` / 交互卡片；若无表单工具，使用下方模板提问；**严禁**出现「内置」「全方向」「8 方向」「SpriteCollab」「Codex V2」「本地依赖」等技术词汇！）：
1. **你的名字 / 昵称**：直接显示在小人头顶（支持任意中英文）
2. **你的职位 / 岗位**：例如：后端开发、全栈工程师、产品经理（可选，默认 \`AI 伙伴\`）
3. **想带什么宝可梦还是不带宠物？**（宠物会自动命名为 **\`<你的昵称>的<宠物名>\`**）：
   - **【推荐】选一只宝可梦**：输入任意名字或编号（如：\`皮卡丘\`、\`可达鸭\`、\`耿鬼\`、\`伊布\`、\`卡比兽\`、\`喷火龙\`、\`路卡利欧\`）
   - **带入你本机的桌面宠物**：若步骤 1 扫描到本机桌宠，直接列出其名字作为选项
   - **暂不带宠物**

*(注：若用户在对话中主动发来 \`AP1:...\` 捏脸代码字符串，也支持直接执行 \`node "<ABS_HOME>/.agent-party/report.mjs" idle --appearance "<用户粘贴的AP1:...代码>" --verify --tool "$AGENT_TOOL"\` 同步外观；否则默认先按用户名字+职位+宠物完成入职，系统在步骤 5 会自动分配专属后台代码与专属捏脸直达链接！)*

**无交互表单工具时的对话模板（如有扫描到本机桌宠，在第 3 项列出名称）：**
> 你好！我正在帮你接入 **Agent Party 虚拟办公室**（仅同步工作/摸鱼状态，绝不上传任何代码、对话或文件路径）。
>
> 请填写以下 3 项信息即可生成你的像素打工人角色与专属后台代码（入职后可随时到 \`${baseUrl}/customize\` 自由捏脸换装）：
>
> **【1. 你的名字 / 昵称】**：\`请填写（支持中英文）\`
> **【2. 你的职位 / 岗位（可选）】**：\`例如：后端开发 / 全栈（默认 AI 伙伴）\`
> **【3. 带什么宝可梦还是不带？】**（自动命名为 **\`<你的昵称>的<宠物名>\`**）：
> - **【推荐】选一只宝可梦**：直接写名字或编号（如 \`皮卡丘\`、\`可达鸭\`、\`耿鬼\`、\`伊布\`、\`卡比兽\`、\`喷火龙\`）
> - **带入本机桌面宠物**：\`<列出扫描到的桌宠或写“暂未检测到”>\`
> - **暂不带宠物**：填 \`不用\`

*(注：若用户明确表示只想单独以宠物形态出现而不建小人，再改用 \`petId\`；默认模式一律是「像素小人 + 伴随宠物 \`某某某的xxx\`」)*

---

### 步骤 3：准备宠物素材并写入全局配置
确定变量：
- \`USER_NAME\`：用户昵称
- \`USER_ID\`：直接等于 \`USER_NAME\`（或稳定代号）
- \`USER_ROLE\`：岗位/签名（默认 \`AI 伙伴\`）
- \`AGENT_TOOL\`：**自动识别你当前的工具名称**，例如 \`Codex\`、\`Antigravity\`、\`Claude Code\`、\`Cursor\`、\`WorkBuddy\`、\`豆包\`、\`Windsurf\`、\`Trae\`、\`OpenCode\`（大屏会展示对应工具徽章！）
- \`COMPANION_PET_ID\`、\`COMPANION_PET_NAME\`：若用户选择带宠物则填写，未带则留空。

#### 3.1A 若用户选了一只宝可梦：
调用服务端内置的自研宝可梦动画引擎（原生直连 \`PMDCollab/SpriteCollab\` 8 方向像素表并带系统代理自适应与本地缓存）：
\`\`\`bash
curl -s -X POST "${baseUrl}/api/pokemon/select" \\
  -H "Content-Type: application/json; charset=utf-8" \\
  -d '{"query":"<用户输入的宝可梦名字或编号>"}'
\`\`\`
- 成功（\`"ok": true\`）时：设置 \`COMPANION_PET_ID = pet.id\`（如 \`pmd:0025\`），\`COMPANION_PET_NAME = pokemon.zh_hans || pokemon.en\`（如 \`皮卡丘\`，服务端会自动结合昵称生成 \`<USER_NAME>的皮卡丘\`）。
- 若返回 \`NOT_AVAILABLE\` 或 \`NOT_FOUND\`，告知用户并推荐切换另一只常见宝可梦（皮卡丘 / 可达鸭 / 耿鬼 / 伊布 / 卡比兽 / 路卡利欧）。

#### 3.1B 若用户选择本机 Codex V2 桌宠：
立即上传桌宠文件到服务端：
\`\`\`bash
curl -s -X POST "${baseUrl}/api/pets/upload" \\
  -F "petId=<petId>" \\
  -F "petJson=@<ABS_HOME>/.codex/pets/<petId>/pet.json" \\
  -F "sprite=@<ABS_HOME>/.codex/pets/<petId>/spritesheet.webp"
\`\`\`
*(若目录下只有 \`spritesheet.png\`，将最后一行改为 \`spritesheet.png\`)*。然后设置 \`COMPANION_PET_ID = <petId>\`，\`COMPANION_PET_NAME = <该桌宠的中文短名，如“路卡利欧”>\`。

#### 3.2 写入全局配置文件与同步脚本：
创建目录 \`<ABS_HOME>/.agent-party/\`：
1. 写入 \`<ABS_HOME>/.agent-party/config.json\`：
\`\`\`json
{
  "serverUrl": "${baseUrl}",
  "id": "$USER_ID",
  "name": "$USER_NAME",
  "role": "$USER_ROLE",
  "agentTool": "$AGENT_TOOL",
  "companionPetId": "$COMPANION_PET_ID",
  "companionPetName": "$COMPANION_PET_NAME"
}
\`\`\`
*(若未选择带宠物，省略 \`companionPetId\` 和 \`companionPetName\` 字段；请勿在默认像素小人身上设置 \`petId\`，否则小人会被替换成宠物)*
2. 下载零依赖跨平台同步脚本：
\`\`\`bash
curl -sL "${baseUrl}/client-scripts/report.mjs" -o "<ABS_HOME>/.agent-party/report.mjs"
\`\`\`

---

### 步骤 4：安装【全工具覆盖 · 跨对话持久化】自动上报
> **重要警告**：绝对不能只写入当前项目目录！必须配置**用户全局 Hooks + 全局规则 +（推荐）本地轻量时间戳守护进程**，确保新开对话、切换项目或异常中断都不会掉线或卡死。

#### 轨道 A：配置原生全局 Hooks（精准无感、不依赖模型记忆）
在对应工具的**用户全局配置**中安全合并以下配置（保留用户原有键）：

1. **Claude Code**（合并写入 \`<ABS_HOME>/.claude/settings.json\`）：
\`\`\`json
{
  "hooks": {
    "UserPromptSubmit": [{ "matcher": "", "hooks": [{ "type": "command", "command": "node \\"<ABS_HOME>/.agent-party/report.mjs\\" working --tool \\"Claude Code\\"" }] }],
    "PreToolUse": [{ "matcher": "", "hooks": [{ "type": "command", "command": "node \\"<ABS_HOME>/.agent-party/report.mjs\\" working --heartbeat --tool \\"Claude Code\\"" }] }],
    "Notification": [{ "matcher": "", "hooks": [{ "type": "command", "command": "node \\"<ABS_HOME>/.agent-party/report.mjs\\" waiting --tool \\"Claude Code\\"" }] }],
    "Stop": [{ "matcher": "", "hooks": [{ "type": "command", "command": "node \\"<ABS_HOME>/.agent-party/report.mjs\\" idle --tool \\"Claude Code\\"" }] }],
    "SessionEnd": [{ "matcher": "", "hooks": [{ "type": "command", "command": "node \\"<ABS_HOME>/.agent-party/report.mjs\\" session-end --tool \\"Claude Code\\"" }] }]
  }
}
\`\`\`

2. **Cursor**（合并写入 \`<ABS_HOME>/.cursor/hooks.json\`，并同步写入轨道 B 的 \`<ABS_HOME>/.cursor/rules/agent-party.mdc\` 且设 \`alwaysApply: true\`）：
\`\`\`json
{
  "version": 1,
  "hooks": {
    "beforeSubmitPrompt": [{ "command": "node \\"<ABS_HOME>/.agent-party/report.mjs\\" working --tool \\"Cursor\\"" }],
    "stop": [{ "command": "node \\"<ABS_HOME>/.agent-party/report.mjs\\" idle --tool \\"Cursor\\"" }]
  }
}
\`\`\`

3. **Codex CLI**（写入 \`<ABS_HOME>/.codex/config.toml\`，同时必须执行轨道 B 写入 \`<ABS_HOME>/.codex/AGENTS.md\`）：
\`\`\`toml
notify = ["node", "<ABS_HOME>/.agent-party/report.mjs", "idle", "--tool", "Codex"]
\`\`\`

#### 轨道 B：写入用户全局规则 / 记忆（覆盖 Antigravity / Codex / Windsurf / Trae / WorkBuddy / 豆包工作 / 马维斯 / DeepSeek Harness 等）
按你当前及本机存在的工具，将下方规则追加到对应的**用户全局规则或全局记忆**（严禁只写进某个工作区，除非该工具本身无全局入口）：
- **Antigravity / Gemini**：\`<ABS_HOME>/.gemini/GEMINI.md\`
- **Codex**：\`<ABS_HOME>/.codex/AGENTS.md\`
- **Claude Code**：\`<ABS_HOME>/.claude/CLAUDE.md\`
- **OpenCode**：\`<ABS_HOME>/.config/opencode/AGENTS.md\`
- **Windsurf**：\`<ABS_HOME>/.codeium/windsurf/memories/global_rules.md\`
- **Cursor**：\`<ABS_HOME>/.cursor/rules/agent-party.mdc\`（顶部加 \`alwaysApply: true\`）
- **WorkBuddy / 豆包工作 / 马维斯 / Trae**：写入客户端设置中的**全局自定义指令 / 全局记忆 / 全局 Skill**；若仅有当前工作区规则入口，则写入当前工作区规则并在轨道 C 中强制配置目录监听。
- **DeepSeek Harness / 自研 Agent Harness**：优先接入 Harness 的 \`on_turn_start\` / \`on_tool_call\` / \`on_turn_end\` 生命周期钩子（调用下方 3 条命令），或将规则写入全局 System Prompt。

**需要追加的全局规则内容（必须把 \`<ABS_HOME>\` 与 \`$AGENT_TOOL\` 替换为真实值）：**
\`\`\`markdown
# Agent Party 虚拟办公室状态自动同步（全局生效）
每次收到用户消息时，必须静默同步当前状态（仅上报状态，严禁上报任务文本、代码或文件路径）：
1. 开始分析或调用工具前（长任务中每次调用工具前可顺带带 --heartbeat 保活）：
   node "<ABS_HOME>/.agent-party/report.mjs" working --tool "$AGENT_TOOL"
2. 需要向用户提问或等待确认时（waiting）：
   node "<ABS_HOME>/.agent-party/report.mjs" waiting --tool "$AGENT_TOOL"
3. 回答完成进入待命时（idle）：
   node "<ABS_HOME>/.agent-party/report.mjs" idle --tool "$AGENT_TOOL"
\`\`\`

#### 轨道 C（强烈推荐，彻底实现公司大屏级 5 秒精准保活）：全客户端轻量守护 \`watch.mjs\`
\`watch.mjs\` 仅扫描会话文件修改时间 \`mtimeMs\`（每 5 秒检查一次、单目录扫描上限 300 项、自动跳过浏览器缓存目录、内存约十余 MB、CPU 几乎为 0，**绝不读取任何文件内容**）。已默认适配 Claude Code、Codex、Antigravity、Cursor、Windsurf、OpenCode、Trae、WorkBuddy、豆包工作、马维斯、DeepSeek，并且工作期间每 25 秒自动续 \`working\` 心跳、空闲期每 30 分钟自动续 \`idle\` 保活。

1. 下载守护脚本：
\`\`\`bash
curl -sL "${baseUrl}/client-scripts/watch.mjs" -o "<ABS_HOME>/.agent-party/watch.mjs"
\`\`\`
2. **（若当前是 WorkBuddy / 豆包工作 / 马维斯 / DeepSeek Harness 等桌面/自研客户端）自动反查会话目录并写入 \`watchDirs\`**：
   运行下面命令自动扫描本机最近 5 分钟刚更新过的 AI 数据目录：
   \`\`\`bash
   node "<ABS_HOME>/.agent-party/watch.mjs" --discover
   \`\`\`
   从返回的 \`candidates\` 中认出你当前客户端自己的数据目录，补充到 \`<ABS_HOME>/.agent-party/config.json\` 的 \`"watchDirs": [{ "tool": "$AGENT_TOOL", "dir": "<发现的目录>" }]\` 中（会即时热生效，5 秒高精度追踪干活/摸鱼）。
3. **安装开机静默自启 + 立即后台启动**（内置 \`watch.pid\` 单实例锁，重复运行不会多开）：
   - 安装开机自启（支持 Windows 启动项静默脚本 / macOS LaunchAgent / Linux autostart）：
     \`\`\`bash
     node "<ABS_HOME>/.agent-party/watch.mjs" --install-startup
     \`\`\`
   - 立即在后台拉起：
     - **macOS / Linux**：\`nohup node "<ABS_HOME>/.agent-party/watch.mjs" >/dev/null 2>&1 &\`
     - **Windows PowerShell**：\`Start-Process -WindowStyle Hidden node -ArgumentList '"<ABS_HOME>/.agent-party/watch.mjs"'\`
   *(即便部分场景未能开启守护，服务端也会在 5 分钟无心跳后自动回落 \`idle\` 防卡死，并持续保留在线席位 7 天)*

---

### 步骤 5：执行连通性自检，拿到并告知用户专属后台代码与专属捏脸链接
在回复用户“接入成功”前，**必须执行以下校验命令并看到 \`✅ Agent Party 接入成功 (HTTP 200)\` 输出**（命令同时会输出 \`🔑 专属后台代码\` 与 \`🎨 专属捏脸页面\` 链接；如果失败需立即排查 \`serverUrl\`、代理或端口，不可直接假装成功）：
\`\`\`bash
node "<ABS_HOME>/.agent-party/report.mjs" idle --verify --tool "$AGENT_TOOL"
\`\`\`

校验通过后，**务必将命令输出中的 \`专属后台代码\` 与 \`专属捏脸直达链接\` 原样展示给用户**，向用户回复：
> “🎉 已为你接入 **Agent Party 虚拟办公室**！
> - 你的像素小人：**$USER_NAME** · 职位：**$USER_ROLE**（工具徽章：**$AGENT_TOOL**）
> - 你的伴随宠物：**$USER_NAME的$COMPANION_PET_NAME**（若带了宠物）
> - 🔑 **你的专属后台代码**：\`<命令输出的 ap_xxx 代码>\`
> - 🎨 **你的专属捏脸页面**：${baseUrl}/customize/<命令输出的 ap_xxx 代码>
>   - 直接打开上方专属链接，系统会自动识别你是谁并载入你的当前信息，你可以随时修改昵称、职位、伴随宝可梦以及发型/发色/穿搭并点击保存！
>   - 也可以打开通用捏脸页 ${baseUrl}/customize 并粘贴你的专属后台代码来识别身份并编辑保存。
> - 已完成跨对话持久化配置与连通性自检（\`HTTP 200 ✅\`），切换新对话、新建窗口也不会掉线！
> - 打开虚拟办公室大屏查看你和宠物吧：${baseUrl}”
`;
}

export function renderSetupHtml(baseUrl: string): string {
  const md = renderSetupMarkdown(baseUrl);
  const promptText = `请阅读 ${baseUrl}/setup.md 并严格按照里面的步骤，帮我把当前 AI 助手接入 Agent Party 虚拟办公室。`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Agent Party — AI 接入指引</title>
  <link rel="icon" href="/assets/brand/favicon-32.png" type="image/png" sizes="32x32" />
  <style>
    :root {
      color-scheme: dark;
      --bg: #0f131c;
      --panel: #171d2b;
      --border: #2a3347;
      --text: #edf2ff;
      --muted: #9aa7c2;
      --accent: #52c4ff;
      --green: #4ade80;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      background: radial-gradient(circle at top, #182238 0%, var(--bg) 60%);
      color: var(--text);
      line-height: 1.6;
    }
    .wrap {
      max-width: 920px;
      margin: 0 auto;
      padding: 32px 20px 64px;
    }
    .topbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 24px;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      border-radius: 999px;
      background: rgba(82, 196, 255, 0.12);
      border: 1px solid rgba(82, 196, 255, 0.35);
      color: var(--accent);
      font-size: 13px;
      font-weight: 600;
    }
    .links {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: var(--panel);
      color: var(--text);
      text-decoration: none;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    .btn:hover { border-color: var(--accent); }
    .btn-primary {
      background: linear-gradient(135deg, #2b8cff, #47c5ff);
      color: #061322;
      border: none;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 28px;
    }
    .sub {
      margin: 0 0 24px;
      color: var(--muted);
      font-size: 15px;
    }
    .hero-card {
      background: linear-gradient(180deg, rgba(82, 196, 255, 0.08), rgba(23, 29, 43, 0.95));
      border: 1px solid rgba(82, 196, 255, 0.35);
      border-radius: 16px;
      padding: 20px;
      margin-bottom: 24px;
    }
    .hero-card h2 {
      margin: 0 0 10px;
      font-size: 16px;
      color: var(--accent);
    }
    .prompt-box {
      display: flex;
      gap: 12px;
      align-items: center;
      justify-content: space-between;
      background: #0b0f17;
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 12px 14px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 13px;
      color: #dce7ff;
    }
    .prompt-box span {
      word-break: break-all;
    }
    .doc-card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 16px;
      overflow: hidden;
    }
    .doc-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 18px;
      border-bottom: 1px solid var(--border);
      font-size: 13px;
      color: var(--muted);
    }
    pre {
      margin: 0;
      padding: 20px;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 13px;
      line-height: 1.65;
      color: #dbe4f5;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="topbar">
      <span class="badge">🤖 AI Agent 自动接入协议</span>
      <div class="links">
        <a class="btn btn-primary" href="/customize" target="_blank">🎨 像素小人捏脸工坊 (/customize)</a>
        <a class="btn" href="/">🏢 返回虚拟办公室</a>
        <a class="btn" href="/setup.md" target="_blank">📄 原始 Markdown (/setup.md)</a>
      </div>
    </div>

    <h1>Agent Party 接入指引</h1>
    <p class="sub">把下面的指令发给任意 AI 编程工具（Codex、Antigravity、Claude Code、Cursor、WorkBuddy、豆包等），它会通过自然语言和你对话并自动完成全套接入。</p>

    <div class="hero-card">
      <h2>✨ 一键发送给你的 AI 助手</h2>
      <div class="prompt-box">
        <span id="prompt-text">${escapeHtml(promptText)}</span>
        <button class="btn btn-primary" id="copy-prompt" type="button">复制指令</button>
      </div>
    </div>

    <div class="doc-card">
      <div class="doc-head">
        <span>完整接入协议内容（Agent 可直接读取 ${escapeHtml(baseUrl)}/setup.md）</span>
        <button class="btn" id="copy-md" type="button">复制全文</button>
      </div>
      <pre id="md-content">${escapeHtml(md)}</pre>
    </div>
  </div>
  <script>
    function bindCopy(btnId, textId, label) {
      const btn = document.getElementById(btnId);
      const src = document.getElementById(textId);
      btn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(src.textContent || '');
          btn.textContent = '已复制 ✓';
          setTimeout(() => (btn.textContent = label), 1600);
        } catch {
          btn.textContent = '请手动选中复制';
        }
      });
    }
    bindCopy('copy-prompt', 'prompt-text', '复制指令');
    bindCopy('copy-md', 'md-content', '复制全文');
  </script>
</body>
</html>`;
}
