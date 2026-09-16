import os
import subprocess

env = os.environ.copy()
for k in ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0']:
    env.pop(k, None)

def run(cmd):
    p = subprocess.run(cmd, env=env, capture_output=True, text=True)
    cmd_str = ' '.join(cmd)
    print(f"[CMD] {cmd_str} -> code {p.returncode}")
    if p.stdout.strip():
        print(f"  STDOUT: {p.stdout.strip()}")
    if p.stderr.strip():
        print(f"  STDERR: {p.stderr.strip()}")
    return p

run(['git', 'remote', 'remove', 'origin'])
run(['git', 'remote', 'add', 'origin', 'https://github.com/kos991/Netcatty-Cmdb.git'])
run(['git', 'remote', '-v'])
