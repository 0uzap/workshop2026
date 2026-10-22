# Runbook d'exploitation — incidents et remédiation

Document destiné aux opérateurs. L'assistant RAG s'appuie dessus pour répondre
pendant un incident. Il aide à comprendre et à consulter les procédures ; il
n'exécute aucune action et n'a aucun accès privilégié au système.

## Chaîne de cyber-résilience

1. **Collecte** : Prometheus récupère les métriques (débit, latence, erreurs) ;
   Alloy envoie les journaux des conteneurs à Loki.
2. **Détection** : le service `ml-detector` (Isolation Forest) score en continu
   les métriques de l'API de paiement et signale une anomalie sur `/status`.
3. **Décision + action** : le moteur de remédiation (`remediation`) lit l'état
   des conteneurs et l'anomalie ML, puis agit via un proxy Docker restreint.
4. **Vérification** : la reprise n'est validée qu'après un **canari métier**
   (transaction annulée) réussi sur l'API de paiement.

## Types d'incident et réponse automatique

### Service indisponible (conteneur arrêté ou /health en échec)
- Détection : conteneur non démarré, état Docker `unhealthy`, ou `/health` KO.
- Action : redémarrage du conteneur (`restart`), ou `start` s'il était arrêté.
- Vérification : `/health` OK **et** canari de paiement réussi.

### Surcharge / déni de service (flood de requêtes)
- Détection : le ML signale un `débit de requêtes anormal` sur l'API de paiement.
- Action : activation de la **limite de débit du WAF** (dépôt de
  `state/active.conf` puis rechargement nginx par signal HUP). Le flood est
  absorbé (réponses 429). En cas de persistance, redémarrage du conteneur.
- Vérification : disparition de l'anomalie ML + canari réussi.
- La limite de débit est automatiquement **relevée** après 30 s de stabilité.

## Garde-fous

- Au-delà de 3 actions dans une fenêtre de 10 minutes sur un même service, le
  moteur **cesse d'agir et escalade** (intervention humaine requise). Cela
  évite les boucles de redémarrage.
- Le moteur de remédiation ne dispose **que** des droits restart / start / kill
  (signal), via un proxy Docker dédié. Il ne peut ni créer de conteneur, ni
  exécuter de commande, ni supprimer de volume.

## Disponibilité vs compromission

La remédiation automatique **restaure la disponibilité** (service de nouveau
utilisable). Elle ne corrige PAS une compromission ou une fuite de données :
un redémarrage ne supprime pas une porte dérobée. En cas de suspicion
d'exfiltration ou d'élévation de privilèges, escalader à un analyste : isoler,
investiguer via les journaux Loki et le SIEM, ne pas se contenter de redémarrer.

## Où regarder

- Tableau de supervision de la remédiation : http://localhost:9095 (PC Hôte).
- Grafana (dashboards sécurité et résilience) : http://localhost:3002.
- Journaux centralisés : Grafana → Loki, filtre `service="remediation"` ou
  `event=~"terminal.*"` pour l'authentification.
- État du détecteur ML : `GET http://ml-detector:8000/status` (réseau interne).

## Vérifier manuellement qu'un paiement fonctionne

Après un incident, confirmer que le service métier est réellement rétabli en
réalisant une transaction fictive depuis l'interface, ou en observant dans le
tableau de remédiation l'incident passé à l'état **rétabli** (canari réussi).
