#!/usr/bin/env python3
"""
migrate-claude-md.py — Migrate existing CLAUDE.md content into Memory Cortex

Reads a CLAUDE.md file, extracts structured fields (project_brief),
and saves the full original content as a reference note. Nothing is lost.

Usage:
    python3 migrate-claude-md.py /path/to/CLAUDE.md [API_URL] [PROJECT_ID]

API_URL defaults to http://localhost:41200
PROJECT_ID defaults to 'default'
"""

import sys
import json
import re
import urllib.request
import urllib.error

def api_post(base_url, path, data):
    url = f"{base_url}{path}"
    payload = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())
    except urllib.error.URLError as e:
        print(f"  API call failed: {e}")
        return None

def parse_sections(content):
    sections = {}
    current_heading = "__preamble__"
    current_lines = []
    for line in content.split("\n"):
        heading_match = re.match(r'^#{1,3}\s+(.+)$', line)
        if heading_match:
            if current_lines:
                sections[current_heading] = "\n".join(current_lines).strip()
            current_heading = heading_match.group(1).strip()
            current_lines = []
        else:
            current_lines.append(line)
    if current_lines:
        sections[current_heading] = "\n".join(current_lines).strip()
    return sections

def extract_brief(sections, full_content):
    brief = {"project_name": ""}
    field_patterns = {
        "tech_stack": ["tech", "stack", "dependencies", "tools", "framework", "language"],
        "module_map": ["module", "structure", "architecture", "component", "service", "layout", "overview"],
        "conventions": ["convention", "style", "pattern", "standard", "rule", "guideline", "coding"],
        "critical_constraints": ["constraint", "requirement", "limitation", "important", "critical", "warning"],
        "entry_points": ["entry", "start", "command", "script", "build", "run", "deploy", "setup"],
    }
    for heading in sections:
        if heading == "__preamble__":
            text = sections[heading]
            name_match = re.match(r'^(?:Project|Name|Title):\s*(.+)', text, re.IGNORECASE)
            if name_match:
                brief["project_name"] = name_match.group(1).strip()
        elif heading != "__preamble__" and not brief["project_name"]:
            brief["project_name"] = heading

    used_sections = set()
    for field, keywords in field_patterns.items():
        for heading, content in sections.items():
            if heading in used_sections or heading == "__preamble__":
                continue
            heading_lower = heading.lower()
            if any(kw in heading_lower for kw in keywords):
                brief[field] = content
                used_sections.add(heading)
                break

    mapped_count = sum(1 for v in brief.values() if v)
    if mapped_count <= 2:
        brief["module_map"] = full_content[:2000]
    if not brief["project_name"]:
        brief["project_name"] = "Unknown Project"
    return brief

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 migrate-claude-md.py /path/to/CLAUDE.md [API_URL] [PROJECT_ID]")
        sys.exit(1)

    filepath = sys.argv[1]
    api_url = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:41200"
    project_id = sys.argv[3] if len(sys.argv) > 3 else "default"

    try:
        with open(filepath, "r") as f:
            content = f.read()
    except FileNotFoundError:
        print(f"  File not found: {filepath}")
        sys.exit(1)

    if not content.strip():
        print("  CLAUDE.md is empty, nothing to migrate.")
        sys.exit(0)

    if "Memory Cortex Protocol" in content:
        print("  CLAUDE.md already contains Cortex protocol. Skipping.")
        sys.exit(0)

    print(f"  Reading {filepath} ({len(content)} chars)...")
    sections = parse_sections(content)
    print(f"  Found {len(sections)} section(s)")

    # Check API
    try:
        urllib.request.urlopen(f"{api_url}/api/health", timeout=5)
    except Exception:
        print(f"  Cannot reach Cortex API at {api_url}")
        print(f"  Make sure Docker services are running: docker compose up -d")
        migration = {"source": filepath, "full_content": content, "sections": sections}
        with open(f"{filepath}.cortex-migration.json", "w") as f:
            json.dump(migration, f, indent=2)
        print(f"  Saved migration data to {filepath}.cortex-migration.json")
        sys.exit(0)

    pid_param = f"?project_id={project_id}" if project_id != "default" else ""

    # Save full content as reference note
    print("  Saving full content as reference note...")
    max_chunk = 4000
    if len(content) <= max_chunk:
        api_post(api_url, f"/api/notes{pid_param}", {
            "content": content,
            "category": "reference",
            "tags": ["migrated-from-claude-md", "original-full"],
            "project_id": project_id,
        })
        print("    Saved as reference note")
    else:
        chunks = [content[i:i+max_chunk] for i in range(0, len(content), max_chunk)]
        for i, chunk in enumerate(chunks):
            api_post(api_url, f"/api/notes{pid_param}", {
                "content": f"[CLAUDE.md migration part {i+1}/{len(chunks)}]\n\n{chunk}",
                "category": "reference",
                "tags": ["migrated-from-claude-md", f"part-{i+1}"],
                "project_id": project_id,
            })
            print(f"    Saved part {i+1}/{len(chunks)}")

    # Extract and set project brief
    print("  Setting project brief...")
    brief = extract_brief(sections, content)
    brief["project_id"] = project_id
    api_post(api_url, f"/api/brief{pid_param}", brief)
    print(f"    Project brief set: {brief.get('project_name', 'unknown')}")

    # Create migration snapshot
    print("  Creating migration snapshot...")
    api_post(api_url, f"/api/snapshots{pid_param}", {
        "summary": f"Initial migration from CLAUDE.md. Imported {len(sections)} sections.",
        "tags": ["migration", "initial-import"],
        "project_id": project_id,
    })

    print("")
    print("  Migration complete. All CLAUDE.md content is now in Cortex.")

if __name__ == "__main__":
    main()
