#!/usr/bin/env python3
"""Relatório da VPS para o painel admin da Modernizai (https://modernizai-df.vercel.app/admin).

SÓ LEITURA: não reinicia, não desconecta e não muda nada. Única escrita para
fora: quando o painel pede, manda um aviso de texto (ex.: saldo da IA acabando)
para o número em config.json ("whatsapp_destino"), pelo WhatsApp que estiver conectado. Junta o estado dos
WhatsApps (WAHA), dos containers, disco/memória/swap e erros recentes do n8n e
manda por HTTPS (saída) para /api/admin/ingest. Nenhuma porta nova é aberta.

Instalação (como claudenuvem):
  mkdir -p ~/painel && cp painel_status.py ~/painel/
  echo '{"url":"https://modernizai-df.vercel.app/api/admin/ingest","chave":"COLE_A_CHAVE","whatsapp_destino":"55DDNUMERO"}' > ~/painel/config.json
  chmod 600 ~/painel/config.json
  sudo -n /usr/bin/python3 ~/painel/painel_status.py --mostrar   # só mostra, não envia
  (crontab -l; echo '* * * * * sudo -n /usr/bin/python3 /home/claudenuvem/painel/painel_status.py >/dev/null 2>&1') | crontab -

Roda como root (sudo -n) pelo mesmo motivo do alertas.py: docker exec e leitura
só-leitura do SQLite do n8n dentro do volume do Docker.
"""
import datetime
import fcntl
import json
import time
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
IA_ESTADO = os.path.join(BASE, "zai_uso.json")
IA_GUARDAR_DIAS = 35
IA_MAX_POR_VEZ = 400
BRT = datetime.timezone(datetime.timedelta(hours=-3))
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


# ---------------------------------------------------------------------------
# Uso da IA z.ai (GLM). A z.ai não tem API pública de saldo pela chave, então
# contamos os tokens que cada chamada devolve e o painel converte em dólar.
# Lê o mesmo SQLite do n8n (só leitura). Cada execução é contada uma vez só
# (guardamos o último id lido em zai_uso.json).
#  - nó lmChatOpenAi (agente "Modelo z.ai"): json.tokenUsage de cada item;
#    o modelo vem do parâmetro do nó.
#  - nó httpRequest (visão, memória): json.usage quando json.model começa com
#    "glm". Nós IF que repetem o mesmo json ficam de fora (não são httpRequest).
# ---------------------------------------------------------------------------
def flatted(txt):
    arr = json.loads(txt)
    if not isinstance(arr, list) or not arr:
        return arr
    vistos = {}

    def reviver(v):
        if isinstance(v, str):
            try:
                i = int(v)
            except ValueError:
                return v
            if i in vistos:
                return vistos[i]
            bruto = arr[i]
            if isinstance(bruto, dict):
                out = {}
                vistos[i] = out
                for k, x in bruto.items():
                    out[k] = reviver(x)
                return out
            if isinstance(bruto, list):
                out = []
                vistos[i] = out
                out.extend(reviver(x) for x in bruto)
                return out
            vistos[i] = bruto
            return bruto
        return v

    return reviver("0")


def _modelo_param(p):
    m = (p or {}).get("model")
    if isinstance(m, dict):
        m = m.get("value") or m.get("cachedResultName")
    return str(m or "").strip().lower()


def _itens(run, canal):
    out = []
    for lista in ((run or {}).get("data") or {}).get(canal) or []:
        for it in lista or []:
            if isinstance(it, dict) and isinstance(it.get("json"), dict):
                out.append(it["json"])
    return out


def _n(v):
    try:
        return int(v or 0)
    except (TypeError, ValueError):
        return 0


def _parte_glm(wf_nome, no_nome, chat):
    """Qual parte do robô chamou a z.ai (para o "onde gasta" do painel)."""
    wf = str(wf_nome or "").lower()
    no = str(no_nome or "").lower()
    if "tempor" in wf or "temp" in wf or wf.startswith("sim ") or "simula" in wf:
        return "simulacao"
    if chat:
        return "atendente"
    if "vis" in no or "video" in no or "vídeo" in no or "foto" in no:
        return "visao"
    if "memoria" in no or "memória" in no:
        return "memoria"
    return no[:30] or "outro"


def _groq_categoria(no_nome, url):
    no = str(no_nome or "").lower()
    if "reserva" in no:
        return "reserva"
    if "whisper" in no or "audio/transcriptions" in url:
        return "audio_video" if "video" in no or "vídeo" in no else "audio"
    if "video" in no or "vídeo" in no:
        return "video"
    return "foto"


def _groq_motivo(erro):
    m = json.dumps(erro, ensure_ascii=False).lower() if not isinstance(erro, str) else erro.lower()
    if "spacing your requests" in m or "rate limit" in m or "rate_limit" in m or "429" in m or "too many" in m:
        return "limite"
    if "timeout" in m or "timed out" in m or "etimedout" in m or "econnaborted" in m:
        return "demora"
    if "model" in m and ("404" in m or "not exist" in m or "decommission" in m or "not found" in m):
        return "modelo"
    if "no audio" in m or "sem áudio" in m or "sem audio" in m:
        return "sem_audio"
    return "outro"


def chamadas_ia(dados, nos, wf_nome=""):
    """Lista (modelo, entrada, saída, cache, parte) de uma execução, sem duplicar.
    Chamadas ao Groq (grátis) vêm como modelo "groq:<tipo>" e parte = "ok" ou o motivo da falha."""
    run_data = (((dados or {}).get("resultData") or {}).get("runData")) or {}
    achadas = []
    for nome, runs in run_data.items():
        no = nos.get(nome) or {}
        tipo = no.get("type", "")
        url = str((no.get("parameters") or {}).get("url") or "").lower()
        for run in runs or []:
            if tipo.endswith("httpRequest") and "groq.com" in url:
                cat = "groq:" + _groq_categoria(nome, url)
                itens = _itens(run, "main")
                if not itens:
                    if (run or {}).get("error"):
                        achadas.append((cat, 0, 0, 0, _groq_motivo((run or {}).get("error"))))
                    continue
                for j in itens:
                    if j.get("error"):
                        achadas.append((cat, 0, 0, 0, _groq_motivo(j.get("error"))))
                        continue
                    u = j.get("usage") or ((j.get("x_groq") or {}).get("usage")) or {}
                    if not isinstance(u, dict):
                        u = {}
                    achadas.append((cat, _n(u.get("prompt_tokens")), _n(u.get("completion_tokens")), 0, "ok"))
            elif tipo.endswith("lmChatOpenAi") or tipo.endswith("lmChatOpenAI"):
                modelo = _modelo_param(no.get("parameters"))
                if modelo.startswith("="):
                    # modelo escolhido por expressão (ex.: nó "Vez"); a credencial é a da z.ai
                    modelo = "glm-auto"
                if not modelo.startswith("glm"):
                    continue
                for j in _itens(run, "ai_languageModel"):
                    tu = j.get("tokenUsage") or {}
                    if tu:
                        achadas.append((modelo, _n(tu.get("promptTokens")), _n(tu.get("completionTokens")), 0,
                                        _parte_glm(wf_nome, nome, True)))
            elif tipo.endswith("httpRequest"):
                for j in _itens(run, "main"):
                    u = j.get("usage")
                    modelo = str(j.get("model") or "").lower()
                    if isinstance(u, dict) and modelo.startswith("glm"):
                        cache = _n(((u.get("prompt_tokens_details") or {}).get("cached_tokens")))
                        achadas.append((modelo, _n(u.get("prompt_tokens")), _n(u.get("completion_tokens")), cache,
                                        _parte_glm(wf_nome, nome, False)))
    return achadas


IA_VERSAO = 3
# O atendente do Espeto usava o glm-4.6 (modelo escolhido por expressão) até esta hora (UTC);
# o fluxo atual está fixo no glm-4.5-air, então o histórico anterior é corrigido na leitura.
ESPETO_GLM46_ATE = datetime.datetime(2026, 11, 6, 19, 19, tzinfo=datetime.timezone.utc).timestamp()


def ler_estado_ia():
    try:
        with open(IA_ESTADO) as f:
            e = json.load(f)
        if isinstance(e, dict):
            if e.get("versao") != IA_VERSAO:
                # formato novo (parte do robô + Groq): relê o que o n8n ainda guarda
                e["ultimo"], e["eventos"], e["versao"] = {}, [], IA_VERSAO
            e.setdefault("ultimo", {})
            e.setdefault("eventos", [])
            return e
    except Exception:
        pass
    return {"ultimo": {}, "eventos": [], "desde": None, "versao": IA_VERSAO}


def coletar_ia(estado):
    agora = time.time()
    for r in ROBOS:
        try:
            con = sqlite3.connect(f"file:{r['db']}?mode=ro", uri=True, timeout=10)
        except Exception as e:
            log(f"ia: não abriu n8n {r['id']}: {e}")
            continue
        try:
            ultimo = estado["ultimo"].get(r["id"])
            if ultimo is None:  # primeira vez: lê tudo que o n8n ainda guarda (7 dias)
                ultimo = 0
            linhas = con.execute(
                """select e.id, e.status, e.startedAt, e.workflowId, d.data
                   from execution_entity e left join execution_data d on d.executionId = e.id
                   where e.id > ? order by e.id limit ?""", (ultimo, IA_MAX_POR_VEZ)).fetchall()
            nos_wf = {}
            for eid, status, inicio, wf, dado in linhas:
                try:
                    ts = datetime.datetime.fromisoformat(str(inicio).replace("Z", "").split(".")[0]).replace(
                        tzinfo=datetime.timezone.utc).timestamp()
                except Exception:
                    ts = agora
                if status in ("new", "running", "waiting") and agora - ts < 3600:
                    break  # ainda rodando: volta nela no próximo minuto
                ultimo = eid
                if not dado or status not in ("success", "error", "crashed", "canceled"):
                    continue
                if wf not in nos_wf:
                    row = con.execute("select nodes, name from workflow_entity where id = ?", (wf,)).fetchone()
                    try:
                        nos_wf[wf] = ({n.get("name"): n for n in json.loads(row[0] if row else "[]")}, row[1] if row else "")
                    except Exception:
                        nos_wf[wf] = ({}, "")
                try:
                    chamadas = chamadas_ia(flatted(dado), nos_wf[wf][0], nos_wf[wf][1])
                except Exception as e:
                    log(f"ia: execução {r['id']}#{eid} ilegível: {e}")
                    continue
                for modelo, ent, sai, cache, parte in chamadas:
                    if r["id"] == "espeto" and modelo == "glm-4.5-air" and parte == "atendente" and ts < ESPETO_GLM46_ATE:
                        modelo = "glm-4.6"
                    estado["eventos"].append([int(ts), r["id"], modelo, ent, sai, cache, parte])
            estado["ultimo"][r["id"]] = ultimo
        finally:
            con.close()
    limite = agora - IA_GUARDAR_DIAS * 86400
    estado["eventos"] = [e for e in estado["eventos"] if e[0] >= limite]


def _somar(dest, chave, ev):
    d = dest.setdefault(chave, {"entrada": 0, "saida": 0, "cache": 0, "chamadas": 0})
    d["entrada"] += ev[3]
    d["saida"] += ev[4]
    d["cache"] += ev[5]
    d["chamadas"] += 1


def resumo_ia(estado):
    agora = time.time()
    desde = estado.get("desde")
    try:
        desde_ts = datetime.datetime.fromisoformat(desde.replace("Z", "+00:00")).timestamp() if desde else None
    except Exception:
        desde_ts = None
    hoje = datetime.datetime.now(BRT).strftime("%Y-%m-%d")
    janelas = {"desde": {}, "h24": {}, "d7": {}, "hoje": {}}
    dias = {}
    horas = {}
    for ev in estado["eventos"]:
        ts = ev[0]
        # robô|modelo|parte (eventos antigos, sem parte, ficam robô|modelo)
        chave = ev[1] + "|" + ev[2] + ("|" + str(ev[6]) if len(ev) > 6 and ev[6] else "")
        groq = str(ev[2]).startswith("groq:")
        dia = datetime.datetime.fromtimestamp(ts, BRT).strftime("%Y-%m-%d")
        if desde_ts is not None and ts >= desde_ts:
            _somar(janelas["desde"], chave, ev)
        if ts >= agora - 86400:
            _somar(janelas["h24"], chave, ev)
            if not groq:
                hora = datetime.datetime.fromtimestamp(ts, BRT).strftime("%Y-%m-%dT%H")
                _somar(horas.setdefault(hora, {}), ev[2], ev)
        if ts >= agora - 7 * 86400:
            _somar(janelas["d7"], chave, ev)
        if dia == hoje:
            _somar(janelas["hoje"], chave, ev)
        if not groq:
            _somar(dias.setdefault(dia, {}), ev[2], ev)
    ultimos = sorted(dias)[-14:]
    return {
        "desde": desde if desde_ts is not None else None,
        "janelas": janelas,
        "dias": [{"dia": d, "modelos": dias[d]} for d in ultimos],
        "horas": [{"hora": h, "modelos": horas[h]} for h in sorted(horas)[-24:]],
        "primeiro": min((e[0] for e in estado["eventos"]), default=None),
    }


def ia(cfg=None):
    estado = ler_estado_ia()
    try:
        coletar_ia(estado)
    except Exception as e:
        log(f"ia: falha coletando: {e!r}")
    saldo = None
    try:
        saldo = saldo_zai(estado, cfg or {})
    except Exception as e:
        log(f"ia: falha no saldo: {type(e).__name__}")
    try:
        tmp = IA_ESTADO + ".tmp"
        with open(tmp, "w") as f:
            json.dump(estado, f, separators=(",", ":"))
        os.replace(tmp, IA_ESTADO)
    except Exception as e:
        log(f"ia: não gravou estado: {e!r}")
    res = resumo_ia(estado)
    res["saldo_real"] = saldo
    return estado, res


# Saldo real da conta z.ai. Endpoint da própria z.ai que aceita a chave de API
# (testado em 06/11/2026: devolve balance, availableBalance, rechargeAmount,
# totalSpendAmount). A chave é lida do .env dos robôs só aqui dentro e só vai
# para api.z.ai; nunca entra no relatório nem no log. Consulta a cada 5 min.
ZAI_SALDO_URL = "https://api.z.ai/api/biz/account/query-customer-account-report"
ZAI_ENVS = ["/opt/robos/.env", "/srv/migracao/dados/.env", "/srv/migracao/projeto/.env"]
ZAI_INTERVALO = 300


def _chave_zai(cfg):
    import re
    padrao = re.compile(r"^[A-Z0-9_]*(ZAI|GLM|ZHIPU)[A-Z0-9_]*=(.*)$", re.I)
    for arq in cfg.get("zai_envs") or ZAI_ENVS:
        try:
            with open(arq) as f:
                for linha in f:
                    m = padrao.match(linha.strip())
                    if m:
                        v = m.group(2).strip().strip("\"'").strip()
                        if v:
                            return v
        except OSError:
            continue
    return None


def saldo_zai(estado, cfg):
    agora = time.time()
    ultimo = estado.get("saldo") or {}
    if agora - (ultimo.get("ts") or 0) < ZAI_INTERVALO:
        return ultimo.get("dados")
    estado["saldo"] = {"ts": agora, "dados": ultimo.get("dados")}
    chave = _chave_zai(cfg)
    if not chave:
        log("ia: chave da z.ai não encontrada nos .env")
        return ultimo.get("dados")
    try:
        req = urllib.request.Request(ZAI_SALDO_URL, headers={
            "Authorization": "Bearer " + chave, "Accept": "application/json",
            "User-Agent": "modernizai-painel-vps/1"})
        with urllib.request.urlopen(req, timeout=15) as r:
            d = json.loads(r.read() or b"{}")
        dd = d.get("data") or {}
        if not d.get("success") or dd.get("availableBalance") is None:
            log(f"ia: z.ai respondeu sem saldo (code {d.get('code')})")
            return ultimo.get("dados")
        dados = {
            "disponivel": float(dd.get("availableBalance") or 0),
            "saldo": float(dd.get("balance") or 0),
            "recarregado": float(dd.get("rechargeAmount") or 0),
            "bonus": float(dd.get("giveAmount") or 0),
            "gastoTotal": float(dd.get("totalSpendAmount") or 0),
            "consultadoEm": datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        }
        estado["saldo"]["dados"] = dados
        return dados
    except Exception as e:
        log(f"ia: falha consultando saldo z.ai: {type(e).__name__}")
        return ultimo.get("dados")


def guardar_desde(estado, desde):
    if not desde or desde == estado.get("desde"):
        return
    estado["desde"] = str(desde)[:40]
    try:
        tmp = IA_ESTADO + ".tmp"
        with open(tmp, "w") as f:
            json.dump(estado, f, separators=(",", ":"))
        os.replace(tmp, IA_ESTADO)
    except Exception as e:
        log(f"ia: não gravou 'desde': {e!r}")


def avisar_whatsapp(textos, destino):
    """Manda os avisos do painel (ex.: saldo da IA acabando) pelo WhatsApp que estiver conectado.
    Mesmo caminho do alertas.py: curl dentro do container do WAHA (a chave nunca sai de lá)."""
    if not textos or not destino:
        return
    chat = "".join(c for c in str(destino) if c.isdigit()) + "@c.us"
    for texto in textos[:3]:
        for w in WA:
            estado, _ = waha_status(w["waha"])
            if estado != "WORKING":
                continue
            corpo = json.dumps({"session": "default", "chatId": chat, "text": str(texto)[:1000]})
            cmd = ["docker", "exec", "-i", w["waha"], "sh", "-c",
                   'curl -s -m 30 -X POST -H "X-Api-Key: $WAHA_API_KEY" -H "content-type: application/json" '
                   '-d @- "http://localhost:3000/api/sendText"']
            try:
                r = subprocess.run(cmd, input=corpo, capture_output=True, text=True, timeout=60)
                if json.loads(r.stdout or "{}").get("id"):
                    log(f"aviso IA enviado via {w['id']}")
                    break
            except Exception as e:
                log(f"aviso IA falhou via {w['id']}: {e!r}")
        else:
            log("aviso IA: nenhum WhatsApp conectado para enviar")


def relatorio(resumo_ia_atual=None):
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
        "ia": resumo_ia_atual,
    }


def main():
    try:
        cfg = json.load(open(CONFIG))
    except Exception:
        cfg = {}
    estado_ia, res_ia = ia(cfg)
    dados = relatorio(res_ia)
    if "--mostrar" in sys.argv:
        print(json.dumps(dados, ensure_ascii=False, indent=2))
        return
    req = urllib.request.Request(
        cfg["url"], data=json.dumps(dados).encode(), method="POST",
        headers={"Content-Type": "application/json", "x-painel-chave": cfg["chave"],
                 "User-Agent": "modernizai-painel-vps/1"})
    with urllib.request.urlopen(req, timeout=20) as r:
        if r.status != 200:
            log(f"resposta {r.status}")
        try:
            resp = json.loads(r.read() or b"{}")
        except Exception:
            resp = {}
    # O painel diz desde quando contar o gasto (último saldo informado) e
    # devolve os avisos que precisam ir por WhatsApp (ex.: saldo da IA no fim).
    guardar_desde(estado_ia, resp.get("ia_desde"))
    avisar_whatsapp(resp.get("whatsapp") or [], cfg.get("whatsapp_destino"))


if __name__ == "__main__":
    try:
        # Uma execução por vez (a 1ª leitura do histórico do n8n pode passar de 1 min).
        trava = open(os.path.join(BASE, ".trava"), "w")
        try:
            fcntl.flock(trava, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            sys.exit(0)
        main()
    except Exception as e:
        log(f"FALHA: {e!r}")
