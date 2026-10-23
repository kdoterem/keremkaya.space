import json, re, html, collections
exec(open('threads.py').read())
idx={p['n']:p for p in json.load(open('index.json'))}
first={}
for m in re.finditer(r'^#(\d+) \[[^\]]*\] .*?\n(.*)$', open('corpus.txt').read(), re.M):
    first[int(m.group(1))]=m.group(2).split(' / ')[0][:90]
cov=collections.Counter(n for _,_,ns in THREADS for n in ns)
loose=[n for n in idx if n not in cov]
def when(p):
    d=p['date']; return d[:10]+(' · '+d[11:16] if 'T' in d else '')
def poem(n):
    p=idx[n]
    return (f'<li><a href="https://keremkaya.space/writing/{p["slug"]}" target="_blank">{html.escape(p["title"])}</a>'
            f'<span class="d">{when(p)}</span><div class="f">{html.escape(first.get(n,""))}</div></li>')
secs=[]
for name,why,ns in THREADS:
    ns_sorted=sorted(set(ns))
    pair=PAIRS.get(name)
    ptxt=f'<span class="c" style="color:var(--lime)">clue: {pair[0]} → answer: {pair[1]}</span>' if pair else ''
    secs.append(f'<section id="{name}"><h2>{name}{ptxt}<span class="c">{len(ns_sorted)} poems · {when(idx[ns_sorted[0]])[:7]} → {when(idx[ns_sorted[-1]])[:7]}</span></h2>'
                f'<p class="why">{html.escape(why)}</p><ol>'+''.join(poem(n) for n in ns_sorted)+'</ol></section>')
cont=''.join(f'<li><a href="https://keremkaya.space/writing/{idx[a]["slug"]}" target="_blank">{html.escape(idx[a]["title"])}</a> → '
             f'<a href="https://keremkaya.space/writing/{idx[b]["slug"]}" target="_blank">{html.escape(idx[b]["title"])}</a>'
             f'<div class="f">{html.escape(note)}</div></li>' for a,b,note in CONTINUATIONS)
dups=''.join(f'<li><b>{html.escape(idx[a]["title"])}</b> ({when(idx[a])}) and <b>{html.escape(idx[b]["title"])}</b> ({when(idx[b])}) have the same text</li>' for a,b in DUPLICATES)
nav=' '.join(f'<a href="#{n}">{n}</a>' for n,_,_ in THREADS)
page=f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Threads draft</title><style>
:root{{--bg:#2a0a4a;--fg:#ffa31a;--dim:rgba(255,163,26,.6);--lime:#aaff00}}
body{{background:var(--bg);color:var(--fg);font:16px/1.5 "Helvetica Neue",Helvetica,Arial,sans-serif;margin:0;padding:48px 16px 120px}}
main{{max-width:760px;margin:0 auto}} a{{color:var(--fg)}} h1{{font-size:2.4rem;letter-spacing:-.02em;margin:0 0 .3rem;color:var(--lime)}}
.lead{{color:var(--dim);max-width:62ch}} nav{{margin:28px 0 40px;line-height:2}} nav a{{margin-right:.9rem;font-weight:700;text-decoration:none;letter-spacing:.06em}}
section{{margin:0 0 56px}} h2{{font-size:1.6rem;letter-spacing:.08em;margin:0;color:var(--lime)}} .c{{font-size:.75rem;letter-spacing:.04em;color:var(--dim);margin-left:12px;font-weight:400}}
.why{{color:var(--fg);opacity:.85;margin:.4rem 0 .8rem;max-width:64ch}} ol{{padding-left:1.4rem}} li{{margin:.55rem 0}}
li a{{font-weight:600;text-decoration:none}} .d{{color:var(--dim);font-size:.75rem;margin-left:.6rem}} .f{{color:var(--dim);font-size:.82rem;font-style:italic}}
h3{{color:var(--lime);letter-spacing:.06em;margin-top:64px}}
</style></head><body><main>
<h1>threads — draft</h1>
<p class="lead">{len(THREADS)} draft threads from reading all {len(idx)} poems in order. Each is a journey: poems in the order they were written, linked to the live site. Names marked [name chosen] are decided; the rest are working names. A poem can sit in more than one thread. {len(cov)} poems are in at least one thread; {len(loose)} aren't yet (listed at the bottom). Nothing on the site has changed.</p>
<nav>{nav} <a href="#continuations">CONTINUATIONS</a> <a href="#loose">LOOSE</a></nav>
{''.join(secs)}
<h3 id="continuations">CONTINUATIONS — the pen picked back up</h3><p class="lead">Direct links: a line, title or image carried from one poem straight into another.</p><ul>{cont}</ul>
<h3>EXACT REPEATS</h3><ul>{dups}</ul>
<h3 id="loose">NOT IN A THREAD YET ({len(loose)})</h3><ol>{''.join(poem(n) for n in loose)}</ol>
</main></body></html>'''
open('threads-draft.html','w').write(page)
print("threads",len(THREADS),"| covered",len(cov),"| loose",len(loose))
