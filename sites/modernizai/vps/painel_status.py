#!/usr/bin/env python3
"""Relatório da VPS para o painel admin da Modernizai (https://modernizai-df.vercel.app/admin).

SÓ LEITURA: não reinicia, não desconecta e não muda nada. Junta o estado dos
WhatsApps (WAHA), dos containers, disco/memória/swap e erros recentes do n8n e
manda por HTTPS (saída) para /api/admin/ingest. Nenhuma porta nova é aberta.

Instalação (como claudenuvem):
  mkdir -p ~/painel && cp painel_status.py ~/painel/
  echo '{"url":"https://modernizai-df.vercel.app/api/admin/ingest","chave":"COLE_A_CHAVE"}' > ~/painel/config.json
  chmod 600 ~/painel/config.json
  sudo -n /usr/bin/python3 ~/painel/painel_status.py --mostrar   # só mostra, não envia
  (crontab -l; echo '* * * * * sudo -n /usr/bin/python3 /home/claudenuvem/painel/painel_status.py >/dev/null 2>&1') | crontab -

Roda como root (sudo -n) pelo mesmo motivo do alertas.py: docker exec e leitura
só-leitura do SQLite do n8n dentro do volume do Docker.
"""
import datetime
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.path.join(BASE, "config.json")
LOG = os.path.join(BASE, "painel.log")

WA = [
    {"id": "espeto", "nome": "Central do Espeto", "waha": "waha-espeto"},
    {"id": "medicmais", "nome": "MedicMais", "waha": "waha-atendente"},
]
ROBOS = [
    {"id": "espeto", "nome": "Robô Central do Espeto",
     "db": "/var/lib/docker/volumes/robos_n8n_espeto_data/_data/database.sqlite"},
    {"id": "medicmais", "nome": "Robô MedicMais",
     "db": "/var/lib/docker/volumes/robos_n8n_data/_data/database.sqlite"},
]
# Só os containers dos nossos robôs (Vixplay e outros ficam de fora).
CONTAINERS = ["waha-espeto", "waha-atendente", "n8n-espeto", "n8n-atendente",
              "qr-espeto", "qr-medicmais", "db-atendente", "frames-atendente", "caddy"]
IGNORAR = ("temporário", "temporario", "teste", "sonda", "sim ")
JANELA_MIN = 15


def log(msg):
    try:
        with open(LOG, "a") as f:
            f.write(datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S ") + msg + "\n")
    except Exception:
        pass


def waha_status(cont):
    # A chave do WAHA é expandida DENTRO do container; este script nunca a vê.
    cmd = ["docker", "exec", cont, "sh", "-c",
           'curl -s -m 15 -H "X-Api-Key: $WAHA_API_KEY" "http://localhost:3000/api/sessions/default"']
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        d = json.loads(r.stdout)
    except Exception:
        return "SEM_RESPOSTA", ""
    estado = d.get("status") or "SEM_RESPOSTA"
    me = (d.get("me") or {}).get("id") or ""
    digitos = "".join(c for c in me.split("@")[0] if c.isdigit())
    return estado, ("…" + digitos[-4:]) if digitos else ""


def containers():
    try:
        r = subprocess.run(["docker", "ps", "-a", "--format", "{{.Names}}\t{{.State}}\t{{.Status}}"],
                           capture_output=True, text=True, timeout=30)
    except Exception:
        return []
    vistos = {}
    for linha in r.stdout.splitlines():
        partes = linha.split("\t")
        if len(partes) < 3:
            continue
        nome, estado, texto = partes[0], partes[1], partes[2]
        saude = "unhealthy" if "(unhealthy)" in texto else "healthy" if "(healthy)" in texto else ""
        vistos[nome] = {"nome": nome, "estado": estado, "saude": saude}
    return [vistos.get(n, {"nome": n, "estado": "ausente", "saude": ""}) for n in CONTAINERS]


def erros_n8n(db):
    desde = (datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None) - datetime.timedelta(minutes=JANELA_MIN)).strftime("%Y-%m-%d %H:%M:%S")
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=10)
    try:
        linhas = con.execute(
            """select e.startedAt, w.name from execution_entity e
               join workflow_entity w on w.id = e.workflowId
               where e.status in ('error','crashed') and e.startedAt >= ?
               order by e.id""", (desde,)).fetchall()
    finally:
        con.close()
    validas = [(s, n) for s, n in linhas if not any(x in (n or "").lower() for x in IGNORAR)]
    ultimo = None
    if validas:
        ultimo = str(validas[-1][0]).replace(" ", "T").split(".")[0] + "Z"
    return len(validas), ultimo


def vps():
    disco = shutil.disk_usage("/")
    mem = {}
    with open("/proc/meminfo") as f:
        for linha in f:
            k, v = linha.split(":", 1)
            mem[k] = int(v.split()[0])
    total, livre = mem.get("MemTotal", 0), mem.get("MemAvailable", 0)
    stot, slivre = mem.get("SwapTotal", 0), mem.get("SwapFree", 0)
    with open("/proc/uptime") as f:
        uptime = float(f.read().split()[0])
    return {
        "disco_pct": round(disco.used * 100 / disco.total, 1),
        "mem_pct": round((total - livre) * 100 / total, 1) if total else None,
        "swap_pct": round((stot - slivre) * 100 / stot, 1) if stot else 0,
        "carga1": round(os.getloadavg()[0], 2),
        "cpus": os.cpu_count(),
        "uptime_h": round(uptime / 3600, 1),
    }


def relatorio():
    wa = []
    for w in WA:
        estado, numero = waha_status(w["waha"])
        wa.append({"id": w["id"], "nome": w["nome"], "estado": estado, "numero": numero})
    robos = []
    for r in ROBOS:
        try:
            n, ultimo = erros_n8n(r["db"])
        except Exception as e:
            log(f"erro lendo n8n {r['id']}: {e}")
            n, ultimo = 0, None
        robos.append({"id": r["id"], "nome": r["nome"], "erros_15min": n, "ultimo_erro": ultimo})
    return {
        "geradoEm": datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None).replace(microsecond=0).isoformat() + "Z",
        "vps": vps(),
        "whatsapp": wa,
        "servicos": containers(),
        "robos": robos,
    }


def main():
    dados = relatorio()
    if "--mostrar" in sys.argv:
        print(json.dumps(dados, ensure_ascii=False, indent=2))
        return
    cfg = json.load(open(CONFIG))
    req = urllib.request.Request(
        cfg["url"], data=json.dumps(dados).encode(), method="POST",
        headers={"Content-Type": "application/json", "x-painel-chave": cfg["chave"],
                 "User-Agent": "modernizai-painel-vps/1"})
    with urllib.request.urlopen(req, timeout=20) as r:
        if r.status != 200:
            log(f"resposta {r.status}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log(f"FALHA: {e!r}")
