# Gestion des secrets (SOPS + age)

Les secrets ne sont jamais commités en clair. Le dépôt contient `secrets.enc.env`,
chiffré avec SOPS pour la clé age déclarée dans `.sops.yaml`.

## Déployer (régénérer le .env)
Placer la clé privée dans `%APPDATA%\sops\age\keys.txt` (transmise hors Git), puis :

    sops --decrypt --output .env secrets.enc.env
    docker compose up -d

## Modifier un secret

    sops secrets.enc.env          # ouvre l'éditeur, rechiffre à l'enregistrement
    sops --decrypt --output .env secrets.enc.env

## Ajouter un membre de l'équipe
Il génère sa clé (`age-keygen`) et transmet sa clé PUBLIQUE. On l'ajoute à `.sops.yaml`
(séparée par une virgule), puis : `sops updatekeys secrets.enc.env`.

## Limites connues
- Le `.env` déchiffré existe en clair sur le PC Hôte, nécessaire à Docker Compose.
  Amélioration possible : `sops exec-env` pour injecter les secrets sans fichier.
- La clé age est une clé partagée de démonstration ; en production : une clé par
  personne et un coffre (HashiCorp Vault, KMS).