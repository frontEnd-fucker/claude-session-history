const API_BASE = '';

// State
let currentProjectId = null;
let currentMessages = null;
let filterToolCalls = localStorage.getItem('filterToolCalls') !== 'false';
let currentSearchTerm = '';
let searchResults = [];
let currentSearchIndex = -1;
let shareImageDataUrl = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Set initial checkbox state from localStorage
    document.getElementById('filterToolCalls').checked = filterToolCalls;

    loadCurrentProject();

    // Filter tool calls toggle
    document.getElementById('filterToolCalls').addEventListener('change', (e) => {
        filterToolCalls = e.target.checked;
        localStorage.setItem('filterToolCalls', filterToolCalls);
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

    // Share button handlers
    document.getElementById('shareBtn').addEventListener('click', handleShare);
    document.getElementById('closeShareModal').addEventListener('click', closeShareModal);
    document.getElementById('cancelShare').addEventListener('click', closeShareModal);
    document.getElementById('downloadShare').addEventListener('click', downloadImage);
    document.getElementById('shareModal').addEventListener('click', (e) => {
        if (e.target.id === 'shareModal') {
            closeShareModal();
        }
    });
});

async function loadCurrentProject() {
    try {
        // Get current project first
        const response = await fetch(`${API_BASE}/api/current-project`);
        const currentProject = await response.json();

        // Then load all projects
        const projectsResponse = await fetch(`${API_BASE}/api/projects`);
        const projects = await projectsResponse.json();

        // If current project found, set it as current
        if (currentProject && currentProject.id) {
            currentProjectId = currentProject.id;
        }

        renderProjectList(projects);
    } catch (error) {
        console.error('Failed to load projects:', error);
        // Fallback to just loading projects
        loadProjects();
    }
}

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
            <div class="project-item-name">${escapeHtml(project.title || project.name)}</div>
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

    // Auto-select project: current project if available, otherwise first project
    if (projects.length > 0) {
        const projectToLoad = currentProjectId || projects[0].id;
        loadProjectMessages(projectToLoad);
    }
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

// Share functionality
async function handleShare() {
    const previewContainer = document.getElementById('sharePreview');

    // Show modal with loading state
    document.getElementById('shareModal').classList.add('active');
    previewContainer.innerHTML = '<div class="loading">生成图片中...</div>';
    shareImageDataUrl = null;

    try {
        // Get current messages container
        const messagesContainer = document.getElementById('messages');

        // Get only visible messages (limit to last 100 for performance)
        const allMessages = messagesContainer.querySelectorAll('.message, .tool-group');
        const maxMessages = 100;
        const visibleMessages = Array.from(allMessages).slice(-maxMessages);

        if (visibleMessages.length === 0) {
            previewContainer.innerHTML = '<div class="no-results">没有消息可分享</div>';
            return;
        }

        // Create a wrapper element for rendering
        const wrapper = document.createElement('div');
        wrapper.id = 'share-render-wrapper';
        wrapper.style.cssText = `
            position: fixed;
            left: -9999px;
            top: 0;
            width: 800px;
            background: #ffffff;
            font-family: "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            padding: 24px;
            color: #1a1a1a;
        `;

        // Add title
        const projectTitle = document.getElementById('projectTitle').textContent;
        const titleEl = document.createElement('h2');
        titleEl.style.cssText = 'font-size: 18px; font-weight: 600; margin-bottom: 8px; color: #1a1a1a;';
        titleEl.textContent = projectTitle;
        wrapper.appendChild(titleEl);

        // Add date
        const dateEl = document.createElement('div');
        dateEl.style.cssText = 'font-size: 12px; color: #6b7280; margin-bottom: 16px;';
        dateEl.textContent = new Date().toLocaleDateString('zh-CN', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        wrapper.appendChild(dateEl);

        // Create messages container
        const messagesWrapper = document.createElement('div');
        messagesWrapper.style.cssText = 'display: flex; flex-direction: column; gap: 12px;';

        // Clone only visible messages
        visibleMessages.forEach(msg => {
            const cloned = msg.cloneNode(true);
            // Reset inline styles
            cloned.style.cssText = '';

            // Apply styles based on message type
            const isUser = cloned.classList.contains('user');
            const isAssistant = cloned.classList.contains('assistant');
            const isToolCall = cloned.classList.contains('tool-call');
            const isToolResult = cloned.classList.contains('tool-result');
            const isToolGroup = cloned.classList.contains('tool-group');

            if (isUser) {
                cloned.style.cssText = 'max-width: 80%; padding: 12px 16px; border-radius: 12px; line-height: 1.6; font-size: 14px; word-wrap: break-word; align-self: flex-end; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-bottom-right-radius: 4px;';
            } else if (isAssistant) {
                cloned.style.cssText = 'max-width: 80%; padding: 12px 16px; border-radius: 12px; line-height: 1.6; font-size: 14px; word-wrap: break-word; align-self: flex-start; background: #f9fafb; border: 1px solid #e5e7eb; border-bottom-left-radius: 4px;';
            } else if (isToolGroup) {
                cloned.style.cssText = 'display: flex; flex-direction: column; margin-bottom: 8px; padding: 12px; background: #ffffff; border-radius: 12px; border: 1px solid #e5e7eb;';
            } else if (isToolCall) {
                cloned.style.cssText = 'max-width: 80%; padding: 12px 16px; border-radius: 12px; line-height: 1.6; font-size: 14px; word-wrap: break-word; align-self: stretch; background: #fef3c7; border-left: 3px solid #f59e0b; border-radius: 8px;';
            } else if (isToolResult) {
                cloned.style.cssText = 'max-width: 80%; padding: 12px 16px; border-radius: 12px; line-height: 1.6; font-size: 14px; word-wrap: break-word; align-self: stretch; background: #fef3c7; border-left: 3px solid #2563eb; border-radius: 8px;';
            }

            // Style header and content
            const header = cloned.querySelector('.message-header');
            if (header) {
                header.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-size: 11px; font-weight: 600;';
            }

            const role = cloned.querySelector('.message-role');
            if (role) {
                if (isUser) {
                    role.style.cssText = 'padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; text-transform: uppercase; background: rgba(255,255,255,0.2); color: white;';
                } else {
                    role.style.cssText = 'padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; text-transform: uppercase; background: #eff6ff; color: #2563eb;';
                }
            }

            const content = cloned.querySelector('.message-content');
            if (content) {
                content.style.cssText = 'white-space: pre-wrap; line-height: 1.6;';
                if (isUser) {
                    content.style.color = 'white';
                }
            }

            // Style code blocks
            cloned.querySelectorAll('pre').forEach(pre => {
                pre.style.cssText = 'font-family: "SF Mono", "Fira Code", Monaco, monospace; font-size: 12px; line-height: 1.5; background: #1e293b; color: #e2e8f0; padding: 12px; border-radius: 8px; overflow-x: auto; white-space: pre-wrap; word-wrap: break-word; margin-top: 8px;';
            });

            messagesWrapper.appendChild(cloned);
        });

        wrapper.appendChild(messagesWrapper);
        document.body.appendChild(wrapper);

        // Render to canvas with timeout
        const canvas = await Promise.race([
            html2canvas(wrapper, {
                backgroundColor: '#ffffff',
                scale: 2,
                useCORS: true,
                logging: false,
                windowWidth: 800,
                width: 800,
                onclone: (clonedDoc) => {
                    // Ensure the cloned element is visible
                    const el = clonedDoc.getElementById('share-render-wrapper');
                    if (el) {
                        el.style.display = 'block';
                    }
                }
            }),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Timeout')), 30000)
            )
        ]);

        // Clean up wrapper
        document.body.removeChild(wrapper);

        // Convert to data URL
        shareImageDataUrl = canvas.toDataURL('image/png');

        // Show preview
        previewContainer.innerHTML = `<img src="${shareImageDataUrl}" alt="分享预览">`;

    } catch (error) {
        console.error('Failed to generate image:', error);
        previewContainer.innerHTML = '<div class="no-results">生成图片失败: ' + error.message + '</div>';
    }
}

function downloadImage() {
    if (!shareImageDataUrl) {
        return;
    }

    const link = document.createElement('a');
    link.href = shareImageDataUrl;
    link.download = `会话消息_${new Date().toISOString().slice(0, 10)}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function closeShareModal() {
    document.getElementById('shareModal').classList.remove('active');
    shareImageDataUrl = null;
}
