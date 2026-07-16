#!/usr/bin/env python3
"""Refactor all ST core file imports to global variable access."""
import re
from pathlib import Path

# All ST globals that were previously imported from script.js / extensions.js / etc.
ST_GLOBALS = {
    # From extensions.js / script.js
    'extension_settings':    'globalThis.extension_settings',
    'saveSettingsDebounced': 'globalThis.saveSettingsDebounced',
    'saveMetadataDebounced': 'globalThis.saveMetadataDebounced',
    'getContext':            'globalThis.getContext',
    'getRequestHeaders':     'globalThis.getRequestHeaders',
    'chat':                  'globalThis.chat',
    'name1':                 'globalThis.name1',
    'name2':                 'globalThis.name2',
    'substituteParams':      'globalThis.substituteParams',
    'eventSource':           'globalThis.eventSource',
    'event_types':           'globalThis.event_types',
    'default_user_avatar':   'globalThis.default_user_avatar',
    'default_avatar':        'globalThis.default_avatar',
    'chat_metadata':         'globalThis.chat_metadata',
    'updateMessageBlock':    'globalThis.updateMessageBlock',
    'messageFormatting':     'globalThis.messageFormatting',
    # From utils.js
    'saveBase64AsFile':      'globalThis.saveBase64AsFile',
    'debounce':              'globalThis.debounce',
    # From variables.js
    'getLocalVariable':      'globalThis.getLocalVariable',
    'setLocalVariable':      'globalThis.setLocalVariable',
    'getGlobalVariable':     'globalThis.getGlobalVariable',
    'setGlobalVariable':     'globalThis.setGlobalVariable',
    # From openai.js
    'chat_completion_sources':   'globalThis.chat_completion_sources',
    'getChatCompletionModel':    'globalThis.getChatCompletionModel',
    'getStreamingReply':         'globalThis.getStreamingReply',
    'oai_settings':              'globalThis.oai_settings',
    # From world-info.js
    'getWorldInfoPrompt':        'globalThis.getWorldInfoPrompt',
}

def parse_import_names(import_stmt):
    """Extract names from `import { a, b as c, d } from '...'`"""
    m = re.match(r"""import\s*\{\s*([^}]+)\s*\}\s*from\s*['"]([^'"]+)['"]""", import_stmt)
    if not m:
        return None, None
    body = m.group(1)
    path = m.group(2)
    names = []
    for part in body.split(','):
        part = part.strip()
        alias = re.match(r'(\w+)(?:\s+as\s+(\w+))?', part)
        if alias:
            names.append(alias.group(2) or alias.group(1))
    return path, names

def is_st_import(path):
    if not path:
        return False
    st_files = ['script.js', 'extensions.js', 'utils.js', 'variables.js', 'openai.js', 'world-info.js', 
                'scripts/script.js', 'scripts/extensions.js', 'scripts/openai.js', 'scripts/world-info.js',
                'scripts/utils.js', 'scripts/variables.js']
    return any(f in path for f in st_files)

def fix_file(relpath):
    path = Path('.') / relpath
    text = path.read_text(encoding='utf-8')
    lines = text.splitlines(keepends=True)

    changes_made = False
    new_lines = []
    i = 0
    all_needed_globals = {}  # name -> display order

    # First pass: find all ST imports, remove them, collect needed globals
    skip_line_indices = set()
    
    for i, line in enumerate(lines):
        stripped = line.strip()
        
        # Static import: import { ... } from "..."
        m = re.match(r"""import\s*\{\s*([^}]+)\s*\}\s*from\s*['"]([^'"]+)['"]""", stripped)
        if m:
            path = m.group(2)
            if is_st_import(path):
                body = m.group(1)
                for part in body.split(','):
                    name = part.strip().split(' as ')[-1].strip()
                    if name in ST_GLOBALS:
                        all_needed_globals[name] = True
                skip_line_indices.add(i)
                changes_made = True
                continue
        
        # Dynamic import: const { ... } = await import("...")
        dm = re.match(r"""^(\s*)(?:const|let|var)\s*\{\s*([^}]+)\s*\}\s*=\s*await\s+import\(['"]([^'"]+)['"]\)""", line)
        if dm:
            indent = dm.group(1)
            body = dm.group(2)
            path = dm.group(3)
            if is_st_import(path):
                names = []
                for part in body.split(','):
                    name = part.strip().split(' as ')[-1].strip()
                    if name in ST_GLOBALS:
                        names.append(name)
                        all_needed_globals[name] = True
                if names:
                    # Replace with const assignments
                    replacement = ''.join(f"{indent}const {n} = {ST_GLOBALS[n]};\n" for n in names)
                    lines[i] = replacement
                    changes_made = True
    
    if not changes_made:
        return False  # Nothing to change
    
    # Build new content, skipping removed lines
    for i, line in enumerate(lines):
        if i in skip_line_indices:
            continue
        new_lines.append(line)
    
    # Insert global declarations after the last valid import (local one)
    if all_needed_globals:
        decl_lines = []
        seen = set()
        for name in sorted(all_needed_globals.keys()):
            if name not in seen:
                decl_lines.append(f"const {name} = {ST_GLOBALS[name]};\n")
                seen.add(name)
        
        # Find insertion point: after the last remaining import line
        insert_idx = -1
        for i, line in enumerate(new_lines):
            if line.strip().startswith('import ') and 'from ' in line:
                insert_idx = i  # last import line
        
        if insert_idx >= 0:
            # Insert after the last import, with a blank line separator
            new_lines.insert(insert_idx + 1, '\n')
            for dl in reversed(decl_lines):
                new_lines.insert(insert_idx + 1, dl)
        else:
            # No local imports left; insert at top
            new_lines[0:0] = decl_lines + ['\n']
    
    path.write_text(''.join(new_lines), encoding='utf-8')
    print(f"  ✅ {relpath} — removed ST imports, added {len(all_needed_globals)} global declarations")
    return True

print("=== Refactoring ST imports to global variable access ===\n")

fixed_count = 0
for js in sorted(Path('.').rglob('*.js')):
    if '.git' in str(js):
        continue
    rel = str(js.relative_to('.'))
    if fix_file(rel):
        fixed_count += 1

print(f"\n=== Done: {fixed_count} files refactored ===")
