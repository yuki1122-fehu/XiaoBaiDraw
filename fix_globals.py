"""
修复子模块中可能用 const/let 声明的 ST 数据变量
（这些变量不在 globalThis 上，需要从 SillyTavern.getContext() 获取）

函数型全局（getContext / debounce 等是 function 声明，在 globalThis 上）保留不动。
"""
import re
from pathlib import Path

# 这些变量在 ST 中可能用 const/let 声明 → 不在 globalThis 上 → 需要从 getContext 获取
# 获取方法：SillyTavern.getContext().变量名
CTX_VARS = {
    'extension_settings': 'extensionSettings',
    'chat_metadata':      'chatMetadata',
    'saveSettingsDebounced': 'saveSettingsDebounced',
    'saveMetadataDebounced': 'saveMetadataDebounced',
    'default_user_avatar':   'defaultUserAvatar',
    'default_avatar':        'defaultAvatar',
    'messageFormatting':     'messageFormatting',
    'updateMessageBlock':    'updateMessageBlock',
}

# 这些函数型全局是 function 声明，肯定在 globalThis 上，不动
# getContext, debounce, saveBase64AsFile, getRequestHeaders, 
# getLocalVariable, setLocalVariable, etc.

# 余下的变量（chat, name1, name2 等）也可能在也可能不在，
# 但 chat 等不确定是否在 getContext() 里，先检查

def fix_file(filepath):
    path = Path.cwd() / filepath
    text = path.read_text()
    lines = text.splitlines(keepends=True)
    
    changed = False
    for i, line in enumerate(lines):
        m = re.match(r'^(\s*const\s+)(\w+)(\s*=\s*globalThis\.)(\w+)', line)
        if not m:
            continue
        var_name = m.group(5)  # The global variable name
        
        if var_name not in CTX_VARS:
            continue
        
        ctx_key = CTX_VARS[var_name]
        
        # Replace: const xxx = globalThis.xxx;
        # With:    const xxx = SillyTavern.getContext()?.xxx;
        old_str = f'globalThis.{var_name}'
        new_str = f'SillyTavern.getContext()?.{ctx_key}'
        
        if old_str in line:
            new_line = line.replace(old_str, new_str)
            text = text.replace(line, new_line)
            changed = True
            print(f'  🔧 {filepath}:{i+1} {var_name} ← SillyTavern.getContext().{ctx_key}')
    
    if changed:
        path.write_text(text)
    return changed

print("=== Fixing data globals that may not be on globalThis ===\n")
base = Path.cwd()
fixed = 0
for js in sorted(base.rglob('*.js')):
    if '.git' in str(js) or 'fix_globals' in str(js):
        continue
    rel = str(js.relative_to(base))
    if fix_file(rel):
        fixed += 1
print(f"\n=== Done: {fixed} files updated ===")
