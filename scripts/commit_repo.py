import os
import subprocess

env = os.environ.copy()
for k in ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0']:
    env.pop(k, None)

def run(cmd):
    p = subprocess.run(cmd, env=env, capture_output=True, text=True, encoding='utf-8', errors='replace')
    cmd_str = ' '.join(cmd)
    print(f"[CMD] {cmd_str} -> code {p.returncode}")
    if p.stdout and p.stdout.strip():
        print(f"  STDOUT: {p.stdout.strip()[:200]}")
    if p.stderr and p.stderr.strip():
        print(f"  STDERR: {p.stderr.strip()[:200]}")
    return p

run(['git', 'branch', '-M', 'main'])
run(['git', 'add', '-A'])
commit_msg = "feat: initial commit of Netcatty-CMDB platform and patch integration"
run(['git', 'commit', '-m', commit_msg])
run(['git', 'status', '--short'])
run(['git', 'log', '-n', '1', '--oneline'])
