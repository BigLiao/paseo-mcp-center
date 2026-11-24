# Paseo MCP Center

一个面向 [Paseo](https://paseo.sh) 的多机 MCP 集中管理与手动迁移插件。

它把分散在不同客户端配置文件里的 MCP Server 收拢到 Paseo 侧边栏的统一界面中，并借助 Paseo 原生加密中继（Relay）实现**多机集中查看、远程启停、参数差异对比对齐、连通性探测与显式手动迁移**——不做后台静默同步，每台机器始终保持独立可控。

---

## 核心特性

- **7 个客户端统一管理**
  一次查看并操作本机所有常见 AI 客户端的 MCP 配置，支持单端启停和 **「全部」一键启停**：
  | 客户端 | 配置文件 / 生效方式 | 格式 |
  | :--- | :--- | :--- |
  | **Claude Code** | `~/.claude.json` | JSON |
  | **Claude Internal** | `~/.claude-internal/.claude.json` | JSON |
  | **Codex** | `~/.codex/config.toml` | TOML |
  | **Cursor** | `~/.cursor/mcp.json` | JSON |
  | **Antigravity** | `~/.gemini/config/mcp_config.json` | JSON |
  | **Agents** | `~/.agents/mcp.json` | JSON |
  | **Paseo 动态注入** | `agent.session_open` 生命周期钩子 | 运行时热注入 |

- **清晰的三态开关与无损停用**
  - **已启用**（绿色实线 `●`）：配置生效中。
  - **已关闭**（灰色实线 `◐`）：停用但保留完整定义（Codex 写入 `enabled = false`，JSON 客户端暂存至 `~/.paseo/plugin-data/paseo-mcp-center/disabled-store.json`），重新点击即可无损恢复。
  - **未安装 / 未配置**（灰色虚线 `○`）：点击后从该 MCP 的主配置克隆一份并启用。

- **参数差异对比与一键对齐**
  - 自动检测同名 MCP 在本机不同客户端之间的核心连接参数漂移（如漏填 Header、Token 过期未同步、HTTP/stdio 模式不同）。
  - 点击黄色标签打开对比弹窗：按参数指纹分组展示脱敏配置，支持对每套方案分别 **「测活」**，选定基准后自由勾选目标客户端一键对齐（可避开刻意定制的客户端）。

- **经 Paseo Relay 跨机集中管理与手动迁移**
  - 直接复用 `~/.paseo/hosts.json` 中已配对的主机和 Paseo 原生 E2EE Relay 通道，**无需新开端口、无需外部数据库、无需重复鉴权**。
  - 一屏切换管理多台在线机器（如 Linux 云开发机 + macOS 本地机），支持远程编辑、启停与测活。
  - **跨机对比与手动迁移**：自动按「仅源机存在 / 配置有差异 / 两机一致」分组；迁移前提供 Diff 预览、跨系统（Linux ↔ macOS）`stdio` 路径提醒，并支持在写入前直接微调 JSON 参数与冲突策略（覆盖 / 跳过 / 自动重命名）。
  - 同机跨客户端批量复制也复用同一套迁移流程。

- **实测连通性与工具发现**
  - 内置 HTTP（支持 Streamable HTTP / SSE）和 `stdio` 探针，执行 `initialize` + `tools/list`，直接返回耗时、服务信息和暴露的工具列表。

- **安全与容错**
  - 每次写入目标配置文件前自动生成 `.mcp-center.bak` 备份，并采用临时文件 + 原子替换写入。
  - 列表视图与差异对比视图自动对 `headers` / `env` 和 URL 敏感参数脱敏；完整配置仅在编辑或执行迁移时按需读取，且跨机传输全程走 Paseo Relay E2EE 加密。

---

## 环境要求

- Paseo `>= 0.17.1`（需在 `config.json` 或 **Settings → Plugins** 中启用插件）
- 如需跨机管理或迁移：各参与主机需已在 Paseo 中通过 Relay 完成配对，并各自安装本插件

---

## 快速安装

在每台需要纳管的机器上运行：

```bash
paseo plugin install github:BigLiao/paseo-mcp-center
```

安装完成后检查状态：

```bash
paseo plugin ls
```

看到 `paseo-mcp-center` 状态为 `running` 即可。打开 Paseo 客户端：
- 在左侧边栏点击 **MCP Center**（`Cable` 图标）；或
- 按 `⌘K`（macOS）/ `Ctrl+K`（Windows/Linux）搜索 **打开 MCP Center**。

后续更新插件：

```bash
paseo plugin update paseo-mcp-center
```

---

## 工作原理

```text
任意一台机器打开 Paseo UI (MCP Center)
        │
        ▼
  [本机插件进程] ──── node.* ────► 本机各客户端配置文件 & agent.session_open 注入
        │
        └── @getpaseo/client/node (createHostClient)
                  │
                  ▼
          [Paseo Relay (E2EE)]
                  │
                  ▼
        [远端主机插件进程] ────► 远端各客户端配置文件 & agent.session_open 注入
```

所有节点完全对等，无中心同步单点，也不会在后台悄悄改动任何配置文件。

---

## 本地开发

```bash
git clone https://github.com/BigLiao/paseo-mcp-center.git
cd paseo-mcp-center
npm install
npm run typecheck

# 以本地路径方式安装到本机 Paseo（便于热重载）
paseo plugin install "$(pwd)"

# 修改代码后热重载（不要重启 daemon）
npm run typecheck
paseo plugin reload paseo-mcp-center
paseo plugin logs paseo-mcp-center
```

### 目录结构

```text
paseo-mcp-center/
  paseo-plugin.json        # 插件清单与 Git 安装构建步骤
  OVERVIEW.md              # Paseo 插件页说明
  index.client.tsx         # 注册 Screen、侧边栏入口与 Command Center 项
  index.server.ts          # 注册 RPC 与 agent.session_open 钩子
  shared/
    contracts.ts           # Zod Schema 与前后端 / 跨机 RPC 契约
  server/
    adapters.ts            # 7 个目标客户端的扫描、备份与原子读写适配器
    redact.ts              # 敏感字段脱敏与核心配置指纹计算
    probe.ts               # HTTP / stdio MCP 连通性与 tools/list 探针
    inject.ts              # Paseo agent.session_open 动态注入
    relay.ts               # 基于 Paseo Relay 的跨机插件 RPC 客户端连接池
    node-handlers.ts       # 单机节点 RPC 实现
    fleet-handlers.ts      # 多机编排与手动迁移 RPC 实现
  client/
    McpCenterScreen.tsx    # 主界面（单机管理 & 跨机对比与迁移）
    EditorModal.tsx        # 新增 / 编辑弹窗（表单 & JSON 双模式）
    DriftModal.tsx         # 本机客户端参数差异对比与一键对齐弹窗
    MigrateModal.tsx       # 跨机 / 跨客户端手动迁移预览与执行弹窗
```
