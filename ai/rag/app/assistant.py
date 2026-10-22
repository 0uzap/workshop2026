"""
Assistant d'exploitation (RAG) : recherche documentaire + LLM local.

Construit avec LangChain. Les embeddings et le LLM sont injectes : en
production ce sont des modeles Ollama locaux ; en test, des doubles.

L'assistant AIDE les operateurs (comprendre un incident, consulter une
procedure). Il n'execute aucune action et n'a aucun acces privilegie : il ne
voit que la base documentaire.
"""

import glob
import os

from langchain_core.documents import Document
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.vectorstores import InMemoryVectorStore
from langchain_text_splitters import RecursiveCharacterTextSplitter

SYSTEM_PROMPT = (
    "Tu es un assistant d'exploitation pour une plateforme de paiement. "
    "Reponds en francais, de maniere concise et operationnelle, en t'appuyant "
    "UNIQUEMENT sur le contexte fourni. Si l'information ne s'y trouve pas, "
    "dis-le clairement et n'invente rien. Rappelle, si c'est pertinent, que tu "
    "n'executes aucune action toi-meme. Cite les procedures utilisees."
)


class Assistant:
    def __init__(self, embeddings, llm, knowledge_dir="/knowledge",
                 chunk_size=800, chunk_overlap=120, top_k=4):
        self.embeddings = embeddings
        self.llm = llm
        self.knowledge_dir = knowledge_dir
        self.top_k = top_k
        self.splitter = RecursiveCharacterTextSplitter(
            chunk_size=chunk_size, chunk_overlap=chunk_overlap
        )
        self.prompt = ChatPromptTemplate.from_messages([
            ("system", SYSTEM_PROMPT),
            ("human", "Contexte :\n{context}\n\nQuestion : {question}"),
        ])
        self.store = None
        self.doc_count = 0

    def index(self):
        """Charge et indexe la base documentaire (idempotent)."""
        store = InMemoryVectorStore(self.embeddings)
        documents = []
        for path in sorted(glob.glob(os.path.join(self.knowledge_dir, "**", "*.md"), recursive=True)):
            with open(path, encoding="utf-8") as handle:
                text = handle.read()
            for chunk in self.splitter.split_text(text):
                documents.append(Document(
                    page_content=chunk, metadata={"source": os.path.basename(path)}
                ))
        if documents:
            store.add_documents(documents)
        self.store = store
        self.doc_count = len(documents)
        return self.doc_count

    @property
    def ready(self):
        return self.store is not None and self.doc_count > 0

    def retrieve(self, question):
        return self.store.similarity_search(question, k=self.top_k)

    def answer(self, question):
        if not self.ready:
            self.index()

        hits = self.retrieve(question)
        context = "\n\n".join(
            f"[{d.metadata.get('source', '?')}] {d.page_content}" for d in hits
        )
        messages = self.prompt.format_messages(context=context, question=question)
        response = self.llm.invoke(messages)
        text = getattr(response, "content", None) or str(response)

        return {
            "answer": text.strip(),
            "sources": sorted({d.metadata.get("source", "?") for d in hits}),
        }
