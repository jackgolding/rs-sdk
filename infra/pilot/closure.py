import json, os, re, subprocess
ROOT = os.getcwd()
ENTRY = ["server/webclient/src/lite/runner.ts"]
r = json.load(open("bots/roster.json"))
bots = r if isinstance(r, list) else r.get("bots", r)
ENTRY += [b["script"] for b in bots]
pat = re.compile(r'''(?:from\s+['"](\.[^'"]+)['"]|require\(\s*['"](\.[^'"]+)['"]\)|import\(\s*['"](\.[^'"]+)['"]\))''')
seen, missing, stack = set(), set(), list(ENTRY)
def resolve(base, rel):
    p = os.path.normpath(os.path.join(os.path.dirname(base), rel))
    cands = [p, p + ".ts", p + ".js"]
    if rel.endswith(".js"):
        cands.append(p[:-3] + ".ts")
    cands += [p + ".d.ts", os.path.join(p, "index.ts"), os.path.join(p, "index.js")]
    for c in cands:
        if os.path.isfile(os.path.join(ROOT, c)):
            return c
    pj = os.path.join(ROOT, p, "package.json")
    if os.path.isfile(pj):
        try:
            main = json.load(open(pj)).get("main", "index.js")
            c = os.path.normpath(os.path.join(p, main))
            if os.path.isfile(os.path.join(ROOT, c)):
                return c
        except Exception:
            pass
    return None
while stack:
    cur = stack.pop()
    if cur in seen:
        continue
    fp = os.path.join(ROOT, cur)
    if not os.path.isfile(fp):
        missing.add(cur)
        continue
    seen.add(cur)
    if cur.endswith(".d.ts"):
        continue
    try:
        src = open(fp, errors="ignore").read()
    except Exception:
        continue
    for m in pat.finditer(src):
        rel = m.group(1) or m.group(2) or m.group(3)
        tgt = resolve(cur, rel)
        if tgt is None:
            missing.add(f"{cur} -> {rel}")
        elif tgt not in seen:
            stack.append(tgt)
print("closure files:", len(seen))
tracked = set(subprocess.run(["git", "ls-files"], capture_output=True, text=True).stdout.split())
status = subprocess.run(["git", "status", "--porcelain"], capture_output=True, text=True).stdout
dirty = {}
for line in status.splitlines():
    if len(line) > 3:
        dirty[line[3:].strip().strip('"')] = line[:2]
need = sorted(f for f in seen if f not in tracked or f in dirty)
print("closure files needing commit:", len(need))
for f in need:
    print(("NEW " if f not in tracked else "MOD "), f)
real_missing = [m for m in missing if "->" in m and "sdk/runner.ts -> ../../sdk/runner" not in m]
print("unresolvable imports:", len(real_missing))
for m in sorted(real_missing)[:20]:
    print("  ??", m)
