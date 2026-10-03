# Publier TaskPilot sur task-pilot.net

Cette version déploie le frontend et les API sur Cloudflare Workers. Deux Durable Objects SQLite conservent les comptes, associations du compagnon, e-mails en attente et calculs de transport. Le PC qui hébergeait le serveur local peut être éteint. Le navigateur qui lit le portail Taskrabbit doit toujours rester ouvert pour importer les offres ; aucune réservation automatique n'est activée.

## Vérifications avant déploiement

```powershell
npm ci
npm test
npm run test:cloud
```

Les tests cloud fonctionnent dans le moteur workerd, avec Resend et PRIM simulés. Ils ne créent pas de vrais comptes Google, ne transmettent pas de missions à Taskrabbit et n'envoient pas d'e-mails réels.

## Authentifier Cloudflare

Utiliser le compte qui possède task-pilot.net. Éviter une clé globale Cloudflare.

```powershell
npx wrangler login --scopes account:read user:read workers:write workers_routes:write workers_scripts:write zone:read ssl_certs:write
npx wrangler whoami
```

L'autorisation Wrangler permet de publier le Worker, ses secrets, les deux espaces de stockage et le domaine personnalisé. Le renouvellement de cette connexion se fait dans Cloudflare, jamais en enregistrant un jeton dans GitHub.

## Secrets de production

Renseigner les valeurs avec les invites `wrangler secret put` ou dans Workers & Pages → taskpilot → Settings → Variables and Secrets. Les clés ne doivent figurer ni dans le dépôt, ni dans le frontend, ni dans des arguments de commande.

| Secret | Utilité |
| --- | --- |
| `DATA_ENCRYPTION_KEY` | Clé AES de 32 octets, sous forme de 64 caractères hexadécimaux aléatoires. La conserver dans un gestionnaire de mots de passe. Une perte ou un changement sans migration rend les données illisibles. |
| `RESEND_API_KEY` | Envoi de vérification et récupération de compte. |
| `GOOGLE_CLIENT_ID` | Identifiant d'un client OAuth Google de type Web. |
| `GOOGLE_CLIENT_SECRET` | Secret de ce client OAuth. |
| `PRIM_API_KEY` | Horaires et itinéraires Île-de-France. |
| `SNCF_API_KEY` | Itinéraires ferroviaires SNCF. |

La clé de chiffrement est obligatoire pour accéder aux API. Sans Resend, la création de comptes et la connexion par mot de passe sont désactivées pour le site public. Google fonctionne seulement lorsque ses deux valeurs sont configurées. L'interface indique les services indisponibles.

Les variables non secrètes sont dans `wrangler.jsonc` :

- `PUBLIC_URL` : `https://task-pilot.net`.
- `MAIL_FROM` : `connexion@mail.task-pilot.net` ; vérifier ce domaine d'envoi dans Resend et ajouter les enregistrements DNS précis que Resend fournit.
- `TRANSIT_REQUESTS_PER_MINUTE` : optionnel, 30 par défaut pour les clés partagées, maximum 120. Ajuster à votre quota réel. Les calculs attendent leur tour lorsque cette limite est atteinte.

Dans Google Cloud : origine JavaScript `https://task-pilot.net`, URI de redirection autorisée `https://task-pilot.net/api/account/google/callback`. Compléter l'écran de consentement et publier le client pour les utilisateurs prévus. Les comptes locaux ne sont pas fusionnés avec Google uniquement sur la base de l'e-mail.

## Publier

```powershell
npm run deploy
```

Le fichier Wrangler associe `task-pilot.net` au Worker. `www.task-pilot.net` redirige vers le domaine principal. Le domaine doit appartenir au même compte Cloudflare et ne pas avoir un autre service déjà associé ; examiner un éventuel conflit DNS au lieu de supprimer un enregistrement existant automatiquement.

Après publication, vérifier `https://task-pilot.net/api/health` puis les parcours réels : inscription, réception du lien, connexion, mot de passe oublié, connexion Google, critères enregistrés, trajets PRIM/SNCF, accès depuis un deuxième appareil.

## Déploiements depuis GitHub

Connecter le dépôt `brahman1/taskpilot` au Worker dans Workers & Pages → taskpilot → Settings → Builds. Autoriser l'intégration GitHub pour ce dépôt uniquement.

- Branche : `main`.
- Répertoire racine : racine du dépôt.
- Commande de construction : `npm run build`.
- Commande de déploiement : `npx wrangler deploy`.
- Secrets applicatifs : secrets du Worker, pas variables publiques de construction.
- Le workflow GitHub vérifie les 91 tests existants et les tests cloud ; ne pas donner de secrets de production aux pull requests.

Le dossier `public/` est généré à partir d'une liste explicite de fichiers frontend. Les modules serveur, tests, coffres, configurations privées et `node_modules` ne sont jamais servis par le site.

## Compagnon du portail

Recharger l'extension `portal-reader` version 2.1.0 dans Chrome/Edge. Dans sa fenêtre, sélectionner **Site public · task-pilot.net**, puis coller le code créé depuis votre compte TaskPilot. Le code est privé, propre au compte et valable 90 jours. Une nouvelle association invalide le précédent. Le suivi lit les offres visibles toutes les deux minutes et ne demande aucune mission.

## Données, coûts et exploitation

- Les comptes cloud commencent séparément des comptes locaux. Aucun compte, e-mail personnel ni planning local n'est envoyé à GitHub ou Cloudflare pendant la préparation du code. Un import explicite pourra être ajouté si nécessaire.
- Chiffrement AES-GCM côté application, mots de passe scrypt avec sel individuel, cookies HTTPS HttpOnly, CSRF, liens de compte à usage unique, limitation persistante des tentatives par adresse IP.
- La base des comptes est centralisée dans un Durable Object pour sérialiser les mises à jour. Cette première version est limitée à 1 000 comptes et 32 Mo de données de compte ; prévoir une architecture répartie avant une croissance importante.
- Les calculs de transport sont séparés par utilisateur, reprennent via les alarmes persistantes et expirent après une heure. Ils sont limités à 20 missions par calcul et à un nouveau calcul par minute par utilisateur.
- Cloudflare propose des quotas gratuits, mais leur adéquation dépend du trafic et du calcul de mots de passe. Vérifier le tableau de bord et les limites avant ouverture large ; aucun abonnement payant n'est activé automatiquement.
- Conserver la clé de chiffrement et mettre en place une procédure de sauvegarde/restauration avant de stocker des données indispensables. Les secrets ne doivent pas être remplacés au hasard pour corriger une erreur de configuration.
- Avant une ouverture commerciale, renseigner l'identité de l'exploitant, les mentions légales, les informations de confidentialité, le support et la procédure de suppression de compte. Ce dépôt ne prétend pas que ces éléments sont déjà fournis.

Références : [Workers avec fichiers statiques](https://developers.cloudflare.com/workers/static-assets/), [stockage SQLite Durable Objects](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/), [domaines personnalisés](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/), [connexion des builds GitHub](https://developers.cloudflare.com/workers/ci-cd/builds/).
