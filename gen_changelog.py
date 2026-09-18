# gen_changelog.py — 从 git log 生成 v626+ 的精简版本记录（追加到版本历史.md）
import re, subprocess, io, sys

log = subprocess.run(['git', 'log', '--pretty=%ad|%s', '--date=short'],
                     capture_output=True, text=True, encoding='utf-8', cwd='workstation').stdout

rows = []
seen_ver = set()
for line in log.splitlines():
    if '|' not in line:
        continue
    date, subj = line.split('|', 1)
    m = re.match(r'^v(\d+)([a-z])?:\s*', subj)
    if not m:
        continue
    ver = int(m.group(1))
    if ver < 626:
        break
    if ver in seen_ver:
        continue
    seen_ver.add(ver)
    body = subj[m.end():]
    # 去掉发版套话 / 测试记录
    body = re.sub(r'[；;]?\s*(三处|四处|两处)?版本号[升降]\d+[^；;。]*', '', body)
    body = re.sub(r'[，,]?\s*order-?form[^；;。]*', '', body)
    body = re.sub(r'[；;]?\s*CDP实测[^。]*[。]?', '', body)
    body = re.sub(r'[；;]?\s*实测[^；;。]*', '', body)
    body = body.strip(' ；;，,')
    if len(body) > 110:
        body = body[:107] + '…'
    rows.append((ver, date, body))

rows.sort()
out = io.StringIO()
for ver, date, body in rows:
    out.write('- **v%d**（%s）%s\n' % (ver, date, body))
sys.stdout.write(out.getvalue())
print('\n# generated %d versions' % len(rows), file=sys.stderr)
