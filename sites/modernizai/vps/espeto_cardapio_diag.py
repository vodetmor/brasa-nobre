#!/usr/bin/env python3
# SOMENTE LEITURA: mostra como o n8n do Espeto envia o cardápio (nós com "cardapio"), sem alterar nada.
import glob, json, re, sqlite3, sys
dbs = glob.glob('/var/lib/docker/volumes/*/_data/database.sqlite') + glob.glob('/root/**/database.sqlite', recursive=True) + glob.glob('/home/*/.n8n/database.sqlite')
for db in dbs:
    c = sqlite3.connect('file:%s?mode=ro' % db, uri=True)
    try: rows = c.execute("select id,name,nodes from workflow_entity").fetchall()
    except Exception: continue
    for wid, name, nodes in rows:
        for n in json.loads(nodes):
            t = json.dumps(n, ensure_ascii=False)
            if 'cardapio' in t.lower() or 'cardápio' in t.lower():
                print('DB', db, '| WF', wid, name, '| NÓ', n.get('name'), n.get('type'))
                t = re.sub(r'(x-bot-token[^}]{0,60}?value"\s*:\s*")[^"]+', r'\1***', t, flags=re.I)
                print(t[:700], '\n')
