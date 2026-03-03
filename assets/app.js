const API_BASE = '';

let currentSessionId = null;
let sessionsData = null;
let currentOffset = 0;
const PAGE_SIZE = 50;

async function loadSessions(reset = true) {
    if (reset) {
        currentOffset = 0;
        sessionsData = null;
    }

    const searchInput = document.getElementById('searchInput').value;
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;

    let url = `${API_BASE}/api/sessions?limit=${PAGE_SIZE}&offset=${currentOffset}&`;
    if (searchInput) url += `search=${encodeURIComponent(searchInput)}&`;
    if (startDate) url += `start=${encodeURIComponent(startDate)}&`;
    if (endDate) url += `end=${encodeURIComponent(endDate)}&`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (reset) {
            sessionsData = data.sessions;
        } else {
            sessionsData = sessionsData.concat(data.sessions);
        }

        const total = data.total;
        const hasMore = data.has_more;

        renderSessionList(sessionsData);
        updateLoadMoreButton(total, hasMore);
    } catch (error) {
        console.error('Failed to load sessions:', error);
        document.getElementById('sessionList').innerHTML =
            '<div class="no-results">加载失败，请确保服务器正在运行</div>';
    }
}

function renderSessionList(sessions) {
    const container = document.getElementById('sessionList');

    if (!sessions || sessions.length === 0) {
        container.innerHTML = '<div class="no-results">没有找到会话</div>';
        return;
    }

    container.innerHTML = sessions.map(session => `
        <div class="session-item ${session.id === currentSessionId ? 'active' : ''}"
             data-id="${session.id}">
            <div class="session-item-title">${escapeHtml(session.title)}</div>
            <div class="session-item-meta">
                <span>${escapeHtml(session.project)}</span>
                <span>${session.timestamp}</span>
            </div>
        </div>
    `).join('');

    // Add click handlers
    container.querySelectorAll('.session-item').forEach(item => {
        item.addEventListener('click', () => {
            const sessionId = item.dataset.id;
            loadSessionDetail(sessionId);
        });
    });
}

function updateLoadMoreButton(total, hasMore) {
    const loadMoreDiv = document.getElementById('loadMore');
    const loadMoreInfo = document.getElementById('loadMoreInfo');

    if (hasMore) {
        loadMoreDiv.style.display = 'block';
        loadMoreInfo.textContent = `已加载 ${sessionsData.length} / ${total} 条会话`;
    } else {
        if (sessionsData && sessionsData.length > 0) {
            loadMoreDiv.style.display = 'block';
            loadMoreInfo.textContent = `共 ${total} 条会话`;
        } else {
            loadMoreDiv.style.display = 'none';
        }
    }
}

async function loadSessionDetail(sessionId) {
    currentSessionId = sessionId;

    // Update active state in list
    document.querySelectorAll('.session-item').forEach(item => {
        item.classList.toggle('active', item.dataset.id === sessionId);
    });

    // Show loading
    document.getElementById('welcome').style.display = 'none';
    const detailPanel = document.getElementById('sessionDetail');
    detailPanel.style.display = 'flex';
    document.getElementById('messages').innerHTML = '<div class="loading">加载中...</div>';

    try {
        const response = await fetch(`${API_BASE}/api/session/${sessionId}`);
        const messages = await response.json();

        // Find session info
        const session = sessionsData.find(s => s.id === sessionId);
        if (session) {
            document.getElementById('sessionTitle').textContent = session.title;
            document.getElementById('sessionProject').textContent = session.project;
            document.getElementById('sessionTime').textContent = session.timestamp;
        }

        // 清除之前的搜索状态
        document.getElementById('searchInput').value = '';
        currentSearchTerm = '';
        searchResults = [];
        currentSearchIndex = -1;

        renderMessages(messages);
    } catch (error) {
        console.error('Failed to load session detail:', error);
        document.getElementById('messages').innerHTML =
            '<div class="no-results">加载失败</div>';
    }
}

// 搜索相关变量
let currentSearchTerm = '';
let filterToolCalls = true; // 默认过滤工具调用
let searchResults = [];
let currentSearchIndex = -1;

function searchInMessages(messages, term) {
    if (!term) return [];

    const results = [];
    const lowerTerm = term.toLowerCase();

    messages.forEach((msg, index) => {
        const content = msg.content || '';
        if (content.toLowerCase().includes(lowerTerm)) {
            // 找到匹配位置
            const idx = content.toLowerCase().indexOf(lowerTerm);
            const start = Math.max(0, idx - 30);
            const end = Math.min(content.length, idx + term.length + 30);
            let preview = content.substring(start, end);
            if (start > 0) preview = '...' + preview;
            if (end < content.length) preview = preview + '...';

            results.push({
                messageIndex: index,
                preview: preview,
                position: idx
            });
        }
    });

    return results;
}

function renderMessages(messages, searchTerm = '') {
    const container = document.getElementById('messages');

    // 保存原始消息用于搜索
    window.currentMessages = messages;

    // 搜索时不改变消息内容，只记录搜索结果
    currentSearchTerm = searchTerm;

    // 过滤空消息
    let filteredMessages = messages.filter(msg => {
        const content = msg.content || '';
        if (msg.role === 'assistant' && !content.trim()) {
            return false;
        }
        return true;
    });

    // 过滤工具调用消息
    if (filterToolCalls) {
        filteredMessages = filteredMessages.filter(msg => {
            const content = msg.content || '';
            // 过滤包含工具调用或工具结果的消息
            const isToolCall = content.includes('[Tool Call:') || content.includes('[Tool:');
            const isToolResult = content.includes('[Tool Result:') || content.includes('[Tool Result]');
            return !(isToolCall || isToolResult);
        });
    }

    // 搜索时只记录结果并显示面板，不改变消息显示
    if (searchTerm) {
        searchResults = searchInMessages(filteredMessages, searchTerm);
        showSearchResults();
    } else {
        searchResults = [];
        document.getElementById('searchResultsPanel').style.display = 'none';
        // 清除之前的高亮
        clearHighlights();
    }

    // 如果消息容器已经有内容，说明已经渲染过，只返回不重新渲染
    if (container.querySelector('.message, .tool-group')) {
        return;
    }

    if (filteredMessages.length === 0) {
        container.innerHTML = '<div class="no-results">会话内容为空</div>';
        return;
    }

    // 首次渲染消息列表
    const groupedMessages = groupToolCallsWithResults(filteredMessages);
    container.innerHTML = groupedMessages.map((item, idx) =>
        renderGroupedMessage(item)
    ).join('');
    container.scrollTop = 0;
}

function clearHighlights() {
    const container = document.getElementById('messages');
    container.querySelectorAll('.search-highlight').forEach(el => {
        el.replaceWith(el.textContent);
    });
}

function showSearchResults() {
    const panel = document.getElementById('searchResultsPanel');
    const countEl = document.getElementById('searchResultsCount');
    const listEl = document.getElementById('searchResultsList');

    if (!currentSearchTerm || searchResults.length === 0) {
        panel.style.display = 'none';
        return;
    }

    // 更新计数
    countEl.textContent = `找到 ${searchResults.length} 条匹配`;

    // 生成结果列表
    const items = searchResults.map((result, idx) => {
        const escaped = currentSearchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(${escaped})`, 'gi');
        const highlighted = result.preview.replace(regex, '<mark>$1</mark>');

        return `
            <div class="search-result-item" data-index="${idx}">
                <span class="search-item-index">${idx + 1}</span>
                <span class="search-item-preview">${highlighted}</span>
            </div>
        `;
    }).join('');

    listEl.innerHTML = items;
    panel.style.display = 'block';

    // 添加点击事件
    listEl.querySelectorAll('.search-result-item').forEach(item => {
        item.addEventListener('click', () => {
            const idx = parseInt(item.dataset.index);
            goToMatch(idx);
        });
    });
}

function goToMatch(idx) {
    currentSearchIndex = idx;
    const container = document.getElementById('messages');

    // 清除之前的消息高亮
    container.querySelectorAll('.message-highlight').forEach(el => {
        el.classList.remove('message-highlight');
    });

    // 清除之前的文本高亮
    container.querySelectorAll('.search-highlight').forEach(el => {
        const parent = el.parentNode;
        parent.replaceChild(document.createTextNode(el.textContent), el);
    });

    const result = searchResults[idx];
    if (!result) return;

    // 找到对应的消息元素（通过索引）
    const messageElements = container.querySelectorAll('.message, .tool-group');
    const targetElement = messageElements[result.messageIndex];

    if (targetElement) {
        // 滚动到该消息
        targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // 高亮整个消息
        targetElement.classList.add('message-highlight');

        // 在消息内容中高亮匹配的文本
        const contentEl = targetElement.querySelector('.message-content');
        if (contentEl) {
            const escaped = currentSearchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`(${escaped})`, 'gi');
            contentEl.innerHTML = contentEl.innerHTML.replace(regex, '<mark class="search-highlight current">$1</mark>');

            // 移除 current 类
            setTimeout(() => {
                contentEl.querySelectorAll('.search-highlight').forEach(el => {
                    el.classList.remove('current');
                });
            }, 1500);
        }

        // 移除消息高亮
        setTimeout(() => {
            targetElement.classList.remove('message-highlight');
        }, 2000);
    }

    // 高亮当前选中的搜索结果
    const listEl = document.getElementById('searchResultsList');
    listEl.querySelectorAll('.search-result-item').forEach((item, i) => {
        item.classList.toggle('active', i === idx);
    });
}

function groupToolCallsWithResults(messages) {
    const result = [];
    let i = 0;

    while (i < messages.length) {
        const msg = messages[i];
        const content = msg.content || '';

        // Check if this is a tool call message
        if (content.includes('[Tool Call:') || content.includes('[Tool:')) {
            // Look for the next message that is a tool result
            let toolCallGroup = {
                type: 'tool-group',
                toolCall: msg,
                toolResult: null
            };

            // Check next messages for tool results
            let j = i + 1;
            while (j < messages.length) {
                const nextMsg = messages[j];
                const nextContent = nextMsg.content || '';

                // If it's a tool result for this tool call
                // Check for "[Tool Result:" (with colon) which can be in user messages
                const isToolResult = nextContent.includes('[Tool Result:') ||
                    nextContent.includes('[Tool Result]') ||
                    nextMsg.type === 'tool_result' ||
                    (nextMsg.cwd && nextMsg.type === 'result');

                if (isToolResult) {
                    toolCallGroup.toolResult = nextMsg;
                    j++;
                } else {
                    break;
                }
            }

            result.push(toolCallGroup);
            i = j;
        } else {
            // Regular message
            result.push({ type: 'single', message: msg });
            i++;
        }
    }

    return result;
}

function renderGroupedMessage(item) {
    if (item.type === 'tool-group') {
        // Render tool call and result together
        const toolCall = item.toolCall;
        const toolResult = item.toolResult;

        let toolCallHtml = '';
        if (toolCall) {
            const roleClass = getRoleClass(toolCall);
            const roleName = getRoleName(toolCall);
            const content = formatContent(toolCall.content, toolCall.type);
            toolCallHtml = `
                <div class="message ${roleClass} tool-call">
                    <div class="message-header">
                        <span class="message-role">${roleName}</span>
                        <span class="message-time">${toolCall.timestamp || ''}</span>
                    </div>
                    <div class="message-content">${content}</div>
                </div>
            `;
        }

        let toolResultHtml = '';
        if (toolResult) {
            const roleClass = 'tool-result';
            const content = formatContent(toolResult.content, toolResult.type);
            toolResultHtml = `
                <div class="message ${roleClass}">
                    <div class="message-header">
                        <span class="message-role">工具结果</span>
                        <span class="message-time">${toolResult.timestamp || ''}</span>
                    </div>
                    <div class="message-content">${content}</div>
                </div>
            `;
        }

        return `
            <div class="tool-group">
                ${toolCallHtml}
                ${toolResultHtml}
            </div>
        `;
    } else {
        // Regular single message
        return renderMessage(item.message);
    }
}

function renderMessage(msg) {
    const roleClass = getRoleClass(msg);
    const roleName = getRoleName(msg);
    const content = formatContent(msg.content, msg.type);

    return `
        <div class="message ${roleClass}">
            <div class="message-header">
                <span class="message-role">${roleName}</span>
                <span class="message-time">${msg.timestamp || ''}</span>
            </div>
            <div class="message-content">${content}</div>
        </div>
    `;
}

function getRoleClass(msg) {
    if (msg.role === 'user') {
        // Check if it's a tool result
        const content = msg.content || '';
        if (content.includes('[Tool Result:') || content.includes('[Tool Result]')) {
            return 'tool-result';
        }
        return 'user';
    }
    if (msg.role === 'assistant') return 'assistant';

    const content = msg.content || '';
    if (content.includes('[Tool Call:') || content.includes('[Tool:')) return 'tool-call';
    if (msg.cwd && msg.type === 'result') return 'bash';

    return '';
}

function getRoleName(msg) {
    const content = msg.content || '';

    // Check for tool result first (can be in user messages)
    if (content.includes('[Tool Result:') || content.includes('[Tool Result]')) {
        return '工具结果';
    }

    if (msg.role === 'user') return '你';
    if (msg.role === 'assistant') return '助手';

    if (content.includes('[Tool Call:')) {
        const match = content.match(/\[Tool Call: (\w+)\]/);
        if (match) return `工具调用: ${match[1]}`;
    }
    if (content.includes('[Tool:')) {
        const match = content.match(/\[Tool: (\w+)\]/);
        if (match) return `工具: ${match[1]}`;
    }
    if (msg.cwd && msg.type === 'result') return 'Bash';

    return msg.type || '系统';
}

function formatContent(content, type) {
    if (!content) return '';

    // 1. Tool result - show as terminal output
    if (content.includes('[Tool Result:')) {
        const resultMatch = content.match(/\[Tool Result:[^\]]*\]\s*(.*)/s);
        if (resultMatch && resultMatch[1]) {
            const resultContent = resultMatch[1].trim();

            // Check if it's a diff
            if (isDiffContent(resultContent)) {
                return renderDiff(resultContent);
            }

            return `<pre class="terminal-output">${escapeHtml(resultContent)}</pre>`;
        }
        return `<pre class="terminal-output">${escapeHtml(content)}</pre>`;
    }

    // 2. Tool call - show as terminal command
    if (content.includes('[Tool Call:') || content.includes('[Tool:')) {
        return `<pre class="terminal-command">${escapeHtml(content)}</pre>`;
    }

    // 3. Plain text - convert newlines for display
    return escapeHtml(content).replace(/\n/g, '<br>');
}

function isDiffContent(content) {
    // Check if content has diff-like patterns
    // Pattern 1: Standard unified diff headers
    const hasDiffHeader = /^@@ |^diff --git|^---|^^\+\+\+/m.test(content);

    // Pattern 2: Lines starting with + or - (and both exist)
    const hasPlusMinus = /^[\+\-]/m.test(content);
    const hasBothPlusMinus = content.includes('+') && content.includes('-');

    // Pattern 3: "Skipped:" or similar git status output
    const hasGitStatus = /^(\+|-|\s)\s+\d+\.\s+(Skipped|Created|Modified|Deleted):/m.test(content);

    return hasDiffHeader || (hasPlusMinus && hasBothPlusMinus) || hasGitStatus;
}

function renderDiff(content) {
    try {
        return Diff2Html.html(content, {
            drawFileList: false,
            matching: 'lines',
            outputFormat: 'line-by-line',
            highlight: false
        });
    } catch (e) {
        // Fallback to terminal style if diff2html fails
        return `<pre class="terminal-output">${escapeHtml(content)}</pre>`;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadSessions(true);

    // Apply filters button
    document.getElementById('applyFilters').addEventListener('click', () => loadSessions(true));

    // Enter key in search
    document.getElementById('searchInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const detailPanel = document.getElementById('sessionDetail');
            if (detailPanel.style.display === 'flex' && window.currentMessages) {
                // 在详情页，搜索消息内容
                const searchTerm = document.getElementById('searchInput').value;
                renderMessages(window.currentMessages, searchTerm);
            } else {
                // 在列表页，搜索会话
                loadSessions(true);
            }
        }
    });

    // 实时搜索（输入时）
    document.getElementById('searchInput').addEventListener('input', () => {
        const detailPanel = document.getElementById('sessionDetail');
        if (detailPanel.style.display === 'flex' && window.currentMessages) {
            // 在详情页，实时搜索消息内容
            const searchTerm = document.getElementById('searchInput').value;
            renderMessages(window.currentMessages, searchTerm);
        }
    });

    // 关闭搜索面板按钮
    document.getElementById('searchCloseBtn').addEventListener('click', () => {
        document.getElementById('searchResultsPanel').style.display = 'none';
        document.getElementById('searchInput').value = '';
        currentSearchTerm = '';
        searchResults = [];
        clearHighlights();
    });

    // 过滤工具调用开关
    document.getElementById('filterToolCalls').addEventListener('change', (e) => {
        filterToolCalls = e.target.checked;
        // 清空容器，强制重新渲染
        document.getElementById('messages').innerHTML = '';
        // 重新渲染消息
        const detailPanel = document.getElementById('sessionDetail');
        if (detailPanel.style.display === 'flex' && window.currentMessages) {
            const searchTerm = document.getElementById('searchInput').value;
            renderMessages(window.currentMessages, searchTerm);
        }
    });

    // Load more button
    document.getElementById('loadMoreBtn').addEventListener('click', () => {
        currentOffset += PAGE_SIZE;
        loadSessions(false);
    });
});
