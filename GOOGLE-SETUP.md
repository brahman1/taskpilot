# Activer la connexion Google

## Site public : task-pilot.net

Le code de connexion Google est déjà implémenté côté serveur. Créer un projet Google Cloud dédié à TaskPilot, puis configurer Google Auth Platform avec le nom TaskPilot, une adresse de support et l'audience externe.

Créer un client OAuth de type **Application Web**, avec :

- Origine JavaScript autorisée : `https://task-pilot.net`
- URI de redirection autorisée : `https://task-pilot.net/api/account/google/callback`
- Permissions demandées par TaskPilot : `openid email profile` uniquement.

Enregistrer l'identifiant et le secret dans **Cloudflare → Workers & Pages → taskpilot → Settings → Runtime variables and secrets**, en production, avec l'option **Secret** cochée pour chacun :

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

Déployer ces variables, puis vérifier `/api/account/google/config` : `configured` doit devenir `true`. Tester ensuite une connexion réelle depuis Chrome ou Edge. En mode test, ajouter les utilisateurs de test dans Audience ; publier l'application pour la rendre accessible au public après avoir complété les informations requises par Google. Ne pas inventer de pages de confidentialité ou de conditions : leurs liens doivent correspondre à des pages existantes et complètes.

Ne pas transmettre le secret dans le chat, le dépôt GitHub ou le frontend. Le domaine `www.task-pilot.net` redirige vers le domaine principal ; le retour OAuth utilise le domaine principal uniquement.

## Développement local sur Windows

Le parcours est implémenté, mais Google demande des identifiants OAuth propres à votre plateforme. Les clés SNCF / PRIM ne conviennent pas. Ne publiez jamais le secret OAuth et ne le collez pas dans une conversation.

1. Ouvrez [Google Cloud Console](https://console.cloud.google.com/auth/clients), choisissez ou créez un projet pour TaskPilot.
2. Configurez Google Auth Platform : nom TaskPilot, adresse de support, audience et coordonnées du développeur. En mode test, ajoutez les comptes Google des utilisateurs de test à l’audience.
3. Créez un client OAuth de type **Application Web**.
4. Ajoutez exactement ces deux **URI de redirection autorisées** :

   ```text
   http://127.0.0.1:4173/api/account/google/callback
   http://localhost:4173/api/account/google/callback
   ```

5. Téléchargez le JSON du client OAuth dans un dossier privé hors de l’application, par exemple Téléchargements.
6. Dans un terminal ouvert dans le dossier `taskpilot`, importez-le avec :

   ```powershell
   node configure-google.mjs "C:\chemin\vers\client_secret_....json"
   ```

   Le script vérifie le type de client et les redirections, puis protège les identifiants avec le coffre Windows DPAPI. Il ne les imprime jamais. Supprimez ensuite le JSON téléchargé qui contient le secret en clair.

7. Arrêtez le serveur, relancez `start.cmd` et actualisez TaskPilot. **Continuer avec Google** devient disponible pour l’inscription et la connexion.

Alternative pour un environnement de développement : variables d’environnement `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET` dans le processus serveur. Aucun secret ne doit apparaître dans le code, un fichier public ou l’archive distribuée.

Pour un compte TaskPilot existant : connectez-vous par mot de passe, ouvrez **Mon compte**, renseignez le mot de passe pour autoriser l’association et cliquez **Associer mon compte Google**. Un même e-mail n’entraîne jamais une fusion automatique de comptes. L’adresse Taskrabbit reste indépendante et se renseigne dans le profil.

Utilisez un navigateur standard Chrome / Edge si Google refuse l’authentification dans un navigateur intégré. Le mot de passe Google est saisi exclusivement chez Google ; TaskPilot ne le reçoit jamais. Les autorisations demandées sont seulement `openid email profile`.

# Protection mise en place

- Mots de passe locaux hachés avec scrypt et sel aléatoire par compte. Aucun mot de passe enregistré en clair ni réversiblement chiffré.
- Comptes, adresses, sessions et plannings chiffrés sur disque avec AES-256-GCM. La clé est protégée par Windows DPAPI, liée à votre session Windows. La base existante est migrée automatiquement sans remise à zéro. Une altération ou une clé incorrecte bloque le chargement au lieu de réinitialiser les comptes.
- Jetons de session aléatoires ; seule leur empreinte SHA-256 est conservée côté serveur. Cookies HttpOnly / SameSite, expiration après 7 jours, déconnexion et rotation à la reconnexion.
- OAuth Google : code échangé côté serveur, PKCE S256, state lié au navigateur, nonce, expiration et utilisation unique. Vérification cryptographique RS256 du jeton avec les clés publiques Google, audience, émetteur, dates et e-mail vérifié.
- Réauthentification par mot de passe pour associer un compte Google ; refus d’association à un Google déjà utilisé ailleurs.
- Origines et hôtes locaux autorisés, limitation des tentatives, taille des requêtes limitée et données séparées entre utilisateurs.
- Politique CSP, interdiction d’intégration en iframe, absence de référent pour protéger les paramètres du retour OAuth.

# Limites du fonctionnement local

Le serveur écoute uniquement sur `127.0.0.1`. HTTP est conservé pour le développement sur la boucle locale ; les échanges avec Google utilisent HTTPS. Avant un accès public, il faudra un domaine HTTPS, des cookies Secure, de nouvelles redirections OAuth, une configuration d’hébergement et de sauvegarde adaptée, puis une revue de sécurité. La vérification des e-mails et la récupération des mots de passe locaux sont implémentées et attendent la configuration de l’expéditeur : voir EMAIL-SETUP.md.

Le coffre protège les fichiers au repos. Il ne protège pas contre un logiciel malveillant exécuté dans la même session Windows. Sauvegardez ensemble la base et sa clé DPAPI ; leur restauration sur un autre compte Windows demande une procédure dédiée.

Documentation : [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect).
