#!/usr/bin/env python3
"""
Session History Viewer Server

Parses Claude Code session files and provides a web interface for viewing them.
Session files are stored in ~/.claude/projects/<project-path>/<session-id>.jsonl
"""

import json
import os
import re
from pathlib import Path
from datetime import datetime
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import socketserver

CLAUDE_PROJECTS_DIR = Path.home() / ".claude" / "projects"
PORT = 8765

# Get user's home directory for path decoding
HOME_PATH = str(Path.home())


def get_projects():
    """Get list of all projects with session files."""
    projects = []
    if not CLAUDE_PROJECTS_DIR.exists():
        return projects

    for project_dir in CLAUDE_PROJECTS_DIR.iterdir():
        if project_dir.is_dir():
            session_files = list(project_dir.glob("*.jsonl"))
            if session_files:
                # Decode project path from directory name
                project_name = project_dir.name.replace(f"-{HOME_PATH.replace('/', '-')}", HOME_PATH)
                project_name = project_name.replace("-", "/")

                # Create short title (remove first 2 parts of path)
                parts = project_name.strip("/").split("/")
                if len(parts) > 2:
                    title = "/".join(parts[2:])
                else:
                    title = project_name

                projects.append({
                    "id": project_dir.name,
                    "name": project_name,
                    "title": title,
                    "session_count": len(session_files)
                })

    # Sort by session count descending
    projects.sort(key=lambda x: x["session_count"], reverse=True)
    return projects


def get_current_project():
    """Get the current project based on current working directory."""
    current_cwd = os.getcwd()

    # Find matching project
    for project_dir in CLAUDE_PROJECTS_DIR.iterdir():
        if project_dir.is_dir():
            project_name = project_dir.name.replace(f"-{HOME_PATH.replace('/', '-')}", HOME_PATH)
            project_name = project_name.replace("-", "/")

            # Check if current cwd matches or is inside the project
            if current_cwd == project_name or current_cwd.startswith(project_name + "/"):
                session_files = list(project_dir.glob("*.jsonl"))
                return {
                    "id": project_dir.name,
                    "name": project_name,
                    "session_count": len(session_files)
                }

    return None


def clean_string(s):
    """Clean a string to ensure it's valid JSON."""
    if not s:
        return ""
    if not isinstance(s, str):
        s = str(s)
    # Remove control characters and problematic chars
    s = s.replace("\x00", "")
    # Truncate very long strings
    if len(s) > 5000:
        s = s[:5000]
    return s


def parse_session_file(session_path):
    """Parse a single session file and return structured messages."""
    messages = []

    with open(session_path, 'r', encoding='utf-8', errors='ignore') as f:
        for line in f:
            if not line.strip():
                continue
            try:
                data = json.loads(line)

                # Skip non-message types (system messages have no content)
                if data.get("type") not in ("user", "assistant", "result"):
                    continue

                msg_type = data.get("type", "unknown")
                msg_data = data.get("message", {})

                # Extract content based on message type
                content = ""
                role = msg_data.get("role", "")

                if msg_type == "user":
                    # User message
                    content_parts = msg_data.get("content", [])
                    if isinstance(content_parts, list):
                        for part in content_parts:
                            if part.get("type") == "text":
                                content += part.get("text", "")
                            elif part.get("type") == "tool_use":
                                content += f"[Tool: {part.get('name', 'unknown')}]"
                                if part.get("input"):
                                    content += f" {json.dumps(part.get('input', {}))}"
                            elif part.get("type") == "tool_result":
                                content += f"[Tool Result: {part.get('content', '')}]"
                    else:
                        content = str(content_parts)

                elif msg_type == "result" or role == "assistant":
                    # Assistant message
                    content_parts = msg_data.get("content", [])
                    if isinstance(content_parts, list):
                        for part in content_parts:
                            if part.get("type") == "text":
                                content += part.get("text", "")
                            elif part.get("type") == "tool_use":
                                tool_name = part.get("name", "unknown")
                                tool_input = part.get("input", {})
                                content += f"[Tool Call: {tool_name}]\n"
                                if tool_input:
                                    content += f"Input: {json.dumps(tool_input, ensure_ascii=False)[:500]}"
                            elif part.get("type") == "tool_result":
                                content += f"[Tool Result]\n{part.get('content', '')[:500]}"
                            elif part.get("type") == "image":
                                content += "[Image]"
                            elif part.get("type") == "resource":
                                content += f"[Resource: {part.get('identifier', '')}]"
                    else:
                        content = str(content_parts)

                # Get timestamp
                timestamp = data.get("timestamp", "")
                if timestamp:
                    try:
                        dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
                        timestamp = dt.strftime("%Y-%m-%d %H:%M:%S")
                    except:
                        pass

                # Get session ID
                session_id = data.get("sessionId", session_path.stem)

                messages.append({
                    "id": data.get("uuid", ""),
                    "type": msg_type,
                    "role": role,
                    "content": content.strip()[:2000],  # Limit content length
                    "timestamp": timestamp,
                    "session_id": session_id,
                    "cwd": data.get("cwd", "")
                })

            except (json.JSONDecodeError, ValueError):
                continue

    return messages


def get_sessions(project_id=None, search_keyword=None, start_date=None, end_date=None, limit=100, offset=0):
    """Get all sessions with optional filtering and pagination."""
    sessions = []

    projects_dir = CLAUDE_PROJECTS_DIR
    if project_id:
        projects_dir = projects_dir / project_id

    if not projects_dir.exists():
        return {"sessions": [], "total": 0, "limit": limit, "offset": offset}

    # Find all session files
    session_files = []
    if project_id:
        session_files = list(projects_dir.glob("*.jsonl"))
    else:
        session_files = list(projects_dir.glob("**/*.jsonl"))

    for session_path in session_files:
        if session_path.suffix != ".jsonl":
            continue

        messages = parse_session_file(session_path)
        if not messages:
            continue

        # Get session info from first message
        first_msg = messages[0]
        session_id = first_msg.get("session_id", session_path.stem)
        timestamp = first_msg.get("timestamp", "")
        cwd = first_msg.get("cwd", "")

        # Get project name
        project_name = session_path.parent.name.replace(f"-{HOME_PATH.replace('/', '-')}", HOME_PATH)
        project_name = project_name.replace("-", "/")

        # Get first user message as title
        title = "New Session"
        for msg in messages:
            if msg.get("role") == "user" and msg.get("content"):
                title = msg["content"][:100]
                # Clean up special characters that might break JSON
                title = title.replace("\n", " ").replace("\r", " ").replace("\t", " ")
                title = title.replace('"', "'").replace("\\", "")
                if len(msg["content"]) > 100:
                    title += "..."
                break

        # Filter by keyword
        if search_keyword:
            keyword_lower = search_keyword.lower()
            found = False
            for msg in messages:
                if keyword_lower in msg.get("content", "").lower():
                    found = True
                    break
            if not found:
                continue

        # Filter by date
        if start_date or end_date:
            try:
                msg_date = datetime.strptime(timestamp, "%Y-%m-%d %H:%M:%S")
                if start_date:
                    start = datetime.strptime(start_date, "%Y-%m-%d")
                    if msg_date < start:
                        continue
                if end_date:
                    end = datetime.strptime(end_date, "%Y-%m-%d")
                    if msg_date > end:
                        continue
            except:
                pass

        sessions.append({
            "id": clean_string(session_id),
            "project": clean_string(project_name),
            "title": clean_string(title),
            "timestamp": clean_string(timestamp),
            "cwd": clean_string(cwd),
            "message_count": len(messages)
        })

    # Sort by timestamp descending
    sessions.sort(key=lambda x: x["timestamp"], reverse=True)

    # Return with pagination info
    total = len(sessions)
    return {
        "sessions": sessions[offset:offset+limit],
        "total": total,
        "limit": limit,
        "offset": offset,
        "has_more": offset + limit < total
    }


def get_session_detail(session_id):
    """Get full session details."""
    # Find the session file
    for session_path in CLAUDE_PROJECTS_DIR.glob(f"*/{session_id}.jsonl"):
        if session_path.exists():
            return parse_session_file(session_path)
    return []


def get_project_messages(project_id):
    """Get all messages from all sessions in a project."""
    project_dir = CLAUDE_PROJECTS_DIR / project_id

    if not project_dir.exists():
        return {
            "project_id": project_id,
            "project_name": "",
            "session_count": 0,
            "message_count": 0,
            "messages": []
        }

    # Decode project name
    project_name = project_id.replace(f"-{HOME_PATH.replace('/', '-')}", HOME_PATH)
    project_name = project_name.replace("-", "/")

    # Find all session files in the project
    session_files = list(project_dir.glob("*.jsonl"))

    all_messages = []

    for session_path in session_files:
        if session_path.suffix != ".jsonl":
            continue

        session_id = session_path.stem
        messages = parse_session_file(session_path)

        # Add session_id to each message
        for msg in messages:
            msg["session_id"] = session_id

        all_messages.extend(messages)

    # Sort by timestamp descending (newest first)
    all_messages.sort(key=lambda x: x["timestamp"], reverse=True)

    return {
        "project_id": project_id,
        "project_name": project_name,
        "session_count": len(session_files),
        "message_count": len(all_messages),
        "messages": all_messages
    }


class SessionHandler(SimpleHTTPRequestHandler):
    """HTTP handler for session viewer."""

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if path == "/api/projects":
            self.send_json(get_projects())

        elif path == "/api/current-project":
            self.send_json(get_current_project())

        elif path == "/api/sessions":
            project_id = query.get("project", [None])[0]
            search = query.get("search", [None])[0]
            start_date = query.get("start", [None])[0]
            end_date = query.get("end", [None])[0]
            limit = int(query.get("limit", ["50"])[0])
            offset = int(query.get("offset", ["0"])[0])
            self.send_json(get_sessions(project_id, search, start_date, end_date, limit, offset))

        elif "/api/project/" in path and "/messages" in path:
            # /api/project/{project_id}/messages
            match = re.match(r'/api/project/([^/]+)/messages', path)
            if match:
                project_id = match.group(1)
                self.send_json(get_project_messages(project_id))
            else:
                self.send_error(400)

        elif path == "/" or path == "/index.html":
            self.send_file("index.html")

        elif path.endswith(".js"):
            self.send_file(path[1:])

        elif path.endswith(".css"):
            self.send_file(path[1:])

        else:
            self.send_error(404)

    def send_json(self, data):
        try:
            response = json.dumps(data, ensure_ascii=False, default=str)
        except (TypeError, ValueError) as e:
            # Handle unserializable content
            response = json.dumps({"error": "Failed to serialize data", "detail": str(e)}, ensure_ascii=False)
        response_bytes = response.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(response_bytes))
        self.end_headers()
        self.wfile.write(response_bytes)

    def send_file(self, filename):
        """Serve files from the assets directory."""
        asset_dir = Path(__file__).parent.parent / "assets"

        # Handle root path
        if filename == "index.html":
            filepath = asset_dir / "index.html"
        else:
            filepath = asset_dir / filename

        if not filepath.exists():
            self.send_error(404)
            return

        content = filepath.read_bytes()

        if filename.endswith(".css"):
            content_type = "text/css"
        elif filename.endswith(".js"):
            content_type = "application/javascript"
        else:
            content_type = "text/html"

        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", len(content))
        self.end_headers()
        self.wfile.write(content)


def main():
    """Start the session viewer server."""
    print(f"Starting Session History Viewer on http://localhost:{PORT}")
    print(f"Press Ctrl+C to stop")

    # Change to assets directory for serving static files
    asset_dir = Path(__file__).parent.parent / "assets"
    os.chdir(asset_dir)

    HTTPServer.allow_reuse_address = True
    httpd = HTTPServer(("", PORT), SessionHandler)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
        httpd.shutdown()


if __name__ == "__main__":
    main()
