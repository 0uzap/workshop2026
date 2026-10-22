"""
Teste la logique du detecteur sans Prometheus : on injecte directement des
vecteurs de caracteristiques via score().

    pip install -r requirements.txt pytest
    pytest
"""

from app.detector import Detector


def normal():
    return {"req_rate": 1.2, "err_ratio": 0.03, "p95_latency": 0.06}


def flood():
    # Attaque : debit tres eleve, presque tout en erreur, latence qui monte
    return {"req_rate": 80.0, "err_ratio": 0.95, "p95_latency": 1.4}


def test_trafic_normal_pas_d_anomalie():
    d = Detector(consecutive=2)
    for _ in range(5):
        r = d.score(normal())
    assert r["anomaly"] is False
    assert r["model_ready"] is True


def test_flood_declenche_une_anomalie_apres_debounce():
    d = Detector(consecutive=2)
    d.score(normal())
    r1 = d.score(flood())
    assert r1["anomaly"] is False, "une seule observation ne suffit pas (anti-faux-positif)"
    r2 = d.score(flood())
    assert r2["anomaly"] is True
    assert r2["target"] == "backend"
    assert r2["reason"] is not None


def test_retour_a_la_normale_leve_l_anomalie():
    d = Detector(consecutive=2)
    d.score(flood()); d.score(flood())
    assert d.last["anomaly"] is True
    for _ in range(3):
        r = d.score(normal())
    assert r["anomaly"] is False


def test_l_attaque_n_est_pas_apprise_comme_normale():
    d = Detector(consecutive=2)
    before = len(d.buffer)
    for _ in range(5):
        d.score(flood())
    # Les observations anormales ne doivent pas grossir la base d'apprentissage
    assert len(d.buffer) == before
