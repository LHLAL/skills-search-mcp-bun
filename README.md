# skills-search-mcp

MCP Server for Skills Search - 从 CC-Switch 数据库检索 Skills。

## 特性

- **单接口**：只有一个 `search_skills` 接口
- **数据源**：直接读取 CC-Switch SQLite 数据库
- **轻量**：使用 Bun + SQLite，无需额外依赖

## 安装

```bash
cd skills-search-mcp-bun
bun install
```

## 配置

编辑 `~/.claude.json`:

```json
{
  "mcpServers": {
    "skills-search": {
      "type": "stdio",
      "command": "bun",
      "args": ["run", "/path/to/skills-search-mcp-bun/src/index.ts"]
    }
  }
}
```

或通过 CC-Switch UI 配置 MCP Server。

## 使用

在 Claude Code 中调用：

```
search_skills with query: "browser"
```

```json
{
  "query": "browser",
  "limit": 8
}
```

### 参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| query | string | - | 搜索关键词 |
| limit | number | 8 | 返回结果数量 |

### 返回

```json
{
  "query": "browser",
  "count": 2,
  "results": [
    {
      "id": "agent-browser",
      "name": "agent-browser",
      "description": "Browser automation CLI...",
      "directory": "agent-browser",
      "source": "skillssh",
      "installs": 1234
    }
  ]
}
```

## 架构

```
Claude Code (MCP Client)
        │
        │ stdio
        ▼
skills-search-mcp-bun
        │
        │ read
        ▼
~/.cc-switch/cc-switch.db
```

## 搜索方式

当前使用 LIKE 模糊匹配（BM25 降级方案）。

如需向量搜索，需确保：
1. Homebrew SQLite 已安装：`brew install sqlite3`
2. sqlite-vec 扩展已加载

## License

MIT
