---
name: session-history
description: 查看 Claude Code 的会话历史记录。用于：(1) 用户要求查看会话历史或会话记录时触发，(2) 列出所有历史会话，(3) 搜索特定会话内容，(4) 按时间筛选会话。当用户说"查看会话"、"查看历史"、"查看会话记录"、"列出所有会话"、"搜索xxx的会话"时使用此 skill。
---

# Session History

查看 Claude Code 本地会话历史的 skill。会话数据来自 `~/.claude/projects/` 目录下的会话文件。

## 使用方法

当用户触发此 skill 时，需要：

1. **启动服务器** - 在后台运行 Python 服务器：
   ```bash
   python3 /Users/yw/development/claudesk/session-history/scripts/session_server.py &
   ```

2. **打开浏览器** - 自动打开浏览器访问：
   ```
   http://localhost:8765
   ```

3. **等待服务器启动** - 等待 1-2 秒确保服务器启动完成

4. **通知用户** - 告诉用户浏览器已打开，可以在页面中查看会话历史

## 功能特性

- **会话列表**: 左侧边栏展示所有会话，每个会话显示第一条用户消息作为标题
- **会话详情**: 点击会话后在右侧查看完整会话内容
- **消息类型区分**: 不同类型的消息有不同样式（用户消息、助手消息、工具调用、Bash 命令等）
- **时间筛选**: 按日期范围筛选会话
- **关键词搜索**: 搜索会话内容

## 触发方式

当用户说以下内容时自动触发：
- "查看会话"
- "查看历史"
- "查看会话记录"
- "列出所有会话"
- "搜索xxx的会话"
- "查看最近的会话"

## 目录结构

```
session-history/
├── SKILL.md
├── scripts/
│   └── session_server.py      # 主服务器脚本
└── assets/
    ├── index.html            # 前端页面
    ├── styles.css            # 样式文件
    └── app.js                # 前端逻辑
```

## 注意事项

- 会话数据来自 `~/.claude/projects/` 目录
- 每个项目文件夹下包含多个 `.jsonl` 文件，每个文件对应一个会话
- 服务器默认运行在 `http://localhost:8765`
