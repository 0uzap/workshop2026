"""
Service assistant RAG (FastAPI). Embeddings et generation via Ollama local.
"""

import os

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from .assistant import Assistant

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://ollama:11434")
LLM_MODEL = os.getenv("LLM_MODEL", "qwen2.5:3b")
EMBED_MODEL = os.getenv("EMBED_MODEL", "nomic-embed-text")
KNOWLEDGE_DIR = os.getenv("KNOWLEDGE_DIR", "/knowledge")


def build_assistant():
    # Import tardif : permet de tester assistant.py sans le paquet Ollama
    from langchain_ollama import ChatOllama, OllamaEmbeddings

    embeddings = OllamaEmbeddings(model=EMBED_MODEL, base_url=OLLAMA_URL)
    llm = ChatOllama(model=LLM_MODEL, base_url=OLLAMA_URL, temperature=0)
    return Assistant(embeddings, llm, knowledge_dir=KNOWLEDGE_DIR)


assistant = build_assistant()
app = FastAPI(title="rag-assistant", docs_url=None, redoc_url=None, openapi_url=None)


class Question(BaseModel):
    question: str = Field(min_length=3, max_length=500)


@app.post("/ask")
def ask(body: Question):
    try:
        return assistant.answer(body.question)
    except Exception as exc:
        # Ollama indisponible ou modele absent : message clair, pas de 500 brut
        return {
            "answer": "Assistant indisponible (modele local non pret). "
                      "Verifiez qu'Ollama tourne et que les modeles sont telecharges.",
            "sources": [],
            "error": str(exc),
        }


@app.get("/health")
def health():
    return {"status": "healthy", "service": "rag-assistant",
            "indexed_chunks": assistant.doc_count}


@app.get("/", response_class=HTMLResponse)
def ui():
    return """<!doctype html><html lang=fr><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>Assistant exploitation</title>
<style>
 :root{color-scheme:dark} body{font:15px system-ui;background:#0f172a;color:#e2e8f0;max-width:720px;margin:0 auto;padding:24px}
 h1{font-size:19px} textarea{width:100%;box-sizing:border-box;background:#0b1220;color:#e2e8f0;border:1px solid #1e293b;border-radius:8px;padding:10px}
 button{margin-top:8px;background:#059669;color:#fff;border:0;border-radius:8px;padding:8px 16px;font-weight:600;cursor:pointer}
 #a{white-space:pre-wrap;margin-top:16px;padding:14px;border:1px solid #1e293b;border-radius:8px;background:#0b1220;min-height:40px}
 .src{color:#64748b;font-size:13px;margin-top:8px}
</style></head><body>
<h1>Assistant d'exploitation</h1>
<p style="color:#94a3b8">Pose une question sur l'architecture, les incidents ou les procedures. L'assistant repond a partir de la documentation du projet.</p>
<textarea id=q rows=3 placeholder="Ex : que fait la remediation en cas de flood ?"></textarea>
<button onclick=go()>Demander</button>
<div id=a></div>
<script>
async function go(){
 const q=document.getElementById('q').value.trim(); if(!q)return;
 const a=document.getElementById('a'); a.textContent='...';
 try{
  const r=await fetch('/ask',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:q})});
  const d=await r.json();
  a.innerHTML=d.answer.replace(/</g,'&lt;')+(d.sources&&d.sources.length?`<div class=src>Sources : ${d.sources.join(', ')}</div>`:'');
 }catch(e){a.textContent='Erreur : '+e.message;}
}
</script></body></html>"""
