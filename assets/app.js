const API_BASE = '';

// State
let currentProjectId = null;
let currentMessages = null;
let filterToolCalls = true;
let currentSearchTerm = '';
let searchResults = [];
let currentSearchIndex = -1;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadProjects();

    // Filter tool calls toggle
    document.getElementById('filterToolCalls').addEventListener('change', (e) => {
        filterToolCalls = e.target.checked;
        if (currentMessages) {
            renderMessages(currentMessages);
        }
    });

    // Search input handlers
    document.getElementById('searchInput').addEventListener('input', () => {
        const searchTerm = document.getElementById('searchInput').value;
        performSearch(searchTerm);
    });

    document.getElementById('searchInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const searchTerm = document.getElementById('searchInput').value;
            performSearch(searchTerm);
        }
    });

    // Close search panel
    document.getElementById('searchCloseBtn').addEventListener('click', () => {
        document.getElementById('searchResultsPanel').style.display = 'none';
        document.getElementById('searchInput').value = '';
        currentSearchTerm = '';
        searchResults = [];
        clearHighlights();
    });
});

async function loadProjects() {
    try {
        const response = await fetch(`${API_BASE}/api/projects`);
        const projects = await response.json();
        renderProjectList(projects);
    } catch (error) {
        console.error('Failed to load projects:', error);
        document.getElementById('projectList').innerHTML =
            '<div class="no-results">加载失败，请确保服务器正在运行</div>';
    }
}

function renderProjectList(projects) {
    const container = document.getElementById('projectList');

    if (!projects || projects.length === 0) {
        container.innerHTML = '<div class="no-results">没有找到项目</div>';
        return;
    }

    container.innerHTML = projects.map(project => `
        <div class="project-item ${project.id === currentProjectId ? 'active' : ''}"
             data-id="${project.id}">
            <div class="project-item-name">${escapeHtml(project.name)}</div>
            <div class="project-item-meta">
                <span>${project.session_count} 个会话</span>
            </div>
        </div>
    `).join('');

    // Add click handlers
    container.querySelectorAll('.project-item').forEach(item => {
        item.addEventListener('click', () => {
            const projectId = item.dataset.id;
            loadProjectMessages(projectId);
        });
    });
}

async function loadProjectMessages(projectId) {
    currentProjectId = projectId;

    // Update active state in list
    document.querySelectorAll('.project-item').forEach(item => {
        item.classList.toggle('active', item.dataset.id === projectId);
    });

    // Clear search state
    document.getElementById('searchInput').value = '';
    currentSearchTerm = '';
    searchResults = [];
    currentSearchIndex = -1;
    document.getElementById('searchResultsPanel').style.display = 'none';

    // Show messages container
    document.getElementById('welcome').style.display = 'none';
    document.getElementById('messagesContainer').style.display = 'flex';
    document.getElementById('messages').innerHTML = '<div class="loading">加载中...</div>';

    try {
        const response = await fetch(`${API_BASE}/api/project/${projectId}/messages`);
        const data = await response.json();

        // Update header
        document.getElementById('projectTitle').textContent = data.project_name;
        document.getElementById('sessionCount').textContent = `${data.session_count} 个会话`;
        document.getElementById('messageCount').textContent = `${data.message_count} 条消息`;

        currentMessages = data.messages;
        renderMessages(currentMessages);
    } catch (error) {
        console.error('Failed to load project messages:', error);
        document.getElementById('messages').innerHTML =
            '<div class="no-results">加载失败</div>';
    }
}

function renderMessages(messages) {
    const container = document.getElementById('messages');

    // Filter empty messages
    let filteredMessages = messages.filter(msg => {
        const content = msg.content || '';
        if (msg.role === 'assistant' && !content.trim()) {
            return false;
        }
        return true;
    });

    // Filter tool calls
    if (filterToolCalls) {
        filteredMessages = filteredMessages.filter(msg => {
            const content = msg.content || '';
            const isToolCall = content.includes('[Tool Call:') || content.includes('[Tool:');
            const isToolResult = content.includes('[Tool Result:') || content.includes('[Tool Result]');
            return !(isToolCall || isToolResult);
        });
    }

    if (filteredMessages.length === 0) {
        container.innerHTML = '<div class="no-results">没有消息</div>';
        return;
    }

    // Group tool calls with results
    const groupedMessages = groupToolCallsWithResults(filteredMessages);
    container.innerHTML = groupedMessages.map((item, idx) =>
        renderGroupedMessage(item)
    ).join('');
    container.scrollTop = container.scrollHeight;
}

function groupToolCallsWithResults(messages) {
    const result = [];
    let i = 0;

    while (i < messages.length) {
        const msg = messages[i];
        const content = msg.content || '';

        if (content.includes('[Tool Call:') || content.includes('[Tool:')) {
            let toolCallGroup = {
                type: 'tool-group',
                toolCall: msg,
                toolResult: null
            };

            let j = i + 1;
            while (j < messages.length) {
                const nextMsg = messages[j];
                const nextContent = nextMsg.content || '';

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
            result.push({ type: 'single', message: msg });
            i++;
        }
    }

    return result;
}

function renderGroupedMessage(item) {
    if (item.type === 'tool-group') {
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

    // Tool result
    if (content.includes('[Tool Result:')) {
        const resultMatch = content.match(/\[Tool Result:[^\]]*\]\s*(.*)/s);
        if (resultMatch && resultMatch[1]) {
            const resultContent = resultMatch[1].trim();
            if (isDiffContent(resultContent)) {
                return renderDiff(resultContent);
            }
            return `<pre class="terminal-output">${escapeHtml(resultContent)}</pre>`;
        }
        return `<pre class="terminal-output">${escapeHtml(content)}</pre>`;
    }

    // Tool call
    if (content.includes('[Tool Call:') || content.includes('[Tool:')) {
        return `<pre class="terminal-command">${escapeHtml(content)}</pre>`;
    }

    // Plain text
    return escapeHtml(content).replace(/\n/g, '<br>');
}

function isDiffContent(content) {
    const hasDiffHeader = /^@@ |^diff --git|^---|^^\+\+\+/m.test(content);
    const hasPlusMinus = /^[\+\-]/m.test(content);
    const hasBothPlusMinus = content.includes('+') && content.includes('-');
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
        return `<pre class="terminal-output">${escapeHtml(content)}</pre>`;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function performSearch(searchTerm) {
    currentSearchTerm = searchTerm;

    if (!searchTerm || !currentMessages) {
        searchResults = [];
        document.getElementById('searchResultsPanel').style.display = 'none';
        clearHighlights();
        return;
    }

    // Filter messages first (same as renderMessages)
    let filteredMessages = currentMessages.filter(msg => {
        const content = msg.content || '';
        if (msg.role === 'assistant' && !content.trim()) {
            return false;
        }
        return true;
    });

    if (filterToolCalls) {
        filteredMessages = filteredMessages.filter(msg => {
            const content = msg.content || '';
            const isToolCall = content.includes('[Tool Call:') || content.includes('[Tool:');
            const isToolResult = content.includes('[Tool Result:') || content.includes('[Tool Result]');
            return !(isToolCall || isToolResult);
        });
    }

    searchResults = searchInMessages(filteredMessages, searchTerm);
    showSearchResults();
}

function searchInMessages(messages, term) {
    if (!term) return [];

    const results = [];
    const lowerTerm = term.toLowerCase();

    messages.forEach((msg, index) => {
        const content = msg.content || '';
        if (content.toLowerCase().includes(lowerTerm)) {
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

function showSearchResults() {
    const panel = document.getElementById('searchResultsPanel');
    const countEl = document.getElementById('searchResultsCount');
    const listEl = document.getElementById('searchResultsList');

    if (!currentSearchTerm || searchResults.length === 0) {
        panel.style.display = 'none';
        return;
    }

    countEl.textContent = `找到 ${searchResults.length} 条匹配`;

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

    container.querySelectorAll('.message-highlight').forEach(el => {
        el.classList.remove('message-highlight');
    });

    clearHighlights();

    const result = searchResults[idx];
    if (!result) return;

    const messageElements = container.querySelectorAll('.message, .tool-group');
    const targetElement = messageElements[result.messageIndex];

    if (targetElement) {
        targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        targetElement.classList.add('message-highlight');

        const contentEl = targetElement.querySelector('.message-content');
        if (contentEl) {
            const escaped = currentSearchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`(${escaped})`, 'gi');
            contentEl.innerHTML = contentEl.innerHTML.replace(regex, '<mark class="search-highlight current">$1</mark>');

            setTimeout(() => {
                contentEl.querySelectorAll('.search-highlight').forEach(el => {
                    el.classList.remove('current');
                });
            }, 1500);
        }

        setTimeout(() => {
            targetElement.classList.remove('message-highlight');
        }, 2000);
    }

    const listEl = document.getElementById('searchResultsList');
    listEl.querySelectorAll('.search-result-item').forEach((item, i) => {
        item.classList.toggle('active', i === idx);
    });
}

function clearHighlights() {
    const container = document.getElementById('messages');
    container.querySelectorAll('.search-highlight').forEach(el => {
        el.replaceWith(el.textContent);
    });
}
