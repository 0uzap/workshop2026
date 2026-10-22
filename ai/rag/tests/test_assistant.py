"""
Teste la logique RAG (chargement, decoupage, recherche, assemblage du prompt)
SANS Ollama : embeddings et LLM remplaces par des doubles deterministes.

    pip install langchain-core langchain-text-splitters numpy pytest
    pytest
"""

import hashlib
import os
import re

import numpy as np
from langchain_core.embeddings import Embeddings

from app.assistant import Assistant

KNOWLEDGE = os.path.join(os.path.dirname(__file__), "..", "knowledge")
DIM = 256


class HashingEmbeddings(Embeddings):
    """Sac-de-mots hache en dimension fixe : la similarite reflete le
    recouvrement lexical (suffisant pour tester la recherche)."""

    def _vec(self, text):
        v = np.zeros(DIM)
        for w in re.findall(r"\w+", text.lower()):
            v[int(hashlib.md5(w.encode()).hexdigest(), 16) % DIM] += 1
        n = np.linalg.norm(v)
        return (v / n if n else v).tolist()

    def embed_documents(self, texts):
        return [self._vec(t) for t in texts]

    def embed_query(self, text):
        return self._vec(text)


class EchoLLM:
    """Renvoie un message dont le contenu reprend le contexte recu."""

    def invoke(self, messages):
        context = messages[-1].content

        class Msg:
            content = "Reponse d'apres le contexte.\n" + context

        return Msg()


def make():
    a = Assistant(HashingEmbeddings(), EchoLLM(), knowledge_dir=KNOWLEDGE)
    a.index()
    return a


def test_indexation_de_la_base():
    a = make()
    assert a.doc_count > 0
    assert a.ready


def test_question_flood_retrouve_le_runbook():
    a = make()
    res = a.answer("Que fait la remediation lors d'un flood de requetes ?")
    assert "runbook-incidents.md" in res["sources"]
    assert len(res["answer"]) > 0


def test_question_architecture_cite_une_source():
    a = make()
    res = a.answer("Quels services composent la plateforme et quel est le role du WAF ?")
    assert len(res["sources"]) >= 1
    assert any(s.endswith(".md") for s in res["sources"])


def test_reponse_contient_le_contexte_recupere():
    a = make()
    res = a.answer("Comment la reprise est-elle verifiee ? Parle du canari.")
    # Le double LLM renvoie le contexte : il doit mentionner le canari
    assert "canari" in res["answer"].lower()
