# Activer les e-mails TaskPilot

Les parcours « Vérifier mon adresse » et « Mot de passe oublié » sont implémentés. Le connecteur actuel utilise [Resend](https://resend.com/docs/api-reference/emails/send-email). Aucun vrai e-mail n’a été envoyé pendant les tests.

## Configuration

1. Créez votre compte [Resend](https://resend.com) et ajoutez un domaine d’envoi que vous possédez, par exemple `mail.votredomaine.fr`.
2. Ajoutez dans votre DNS, éventuellement Cloudflare, les enregistrements demandés par Resend pour vérifier le domaine. Suivez les valeurs exactes affichées dans votre compte ; ne modifiez pas au hasard les MX de votre messagerie existante.
3. Laissez désactivé le suivi des clics et ouvertures pour ces e-mails de sécurité. Créez une clé API avec permission d’envoi limitée au domaine concerné. Ne la collez pas dans une conversation ou le code de l’application.
4. Préparez un fichier JSON privé, hors du dossier `outputs`, avec :

   ```json
   {
     "apiKey": "VOTRE_CLE_RESEND",
     "from": "bonjour@mail.votredomaine.fr",
     "publicUrl": "http://127.0.0.1:4173"
   }
   ```

5. Depuis le dossier `taskpilot`, exécutez :

   ```powershell
   node configure-mail.mjs "C:\chemin\vers\configuration-privee.json"
   ```

   La clé et la configuration sont protégées par Windows DPAPI dans `work/private/taskpilot-mail.dpapi`. Supprimez ensuite le JSON privé contenant la clé en clair, puis redémarrez le serveur.

Alternative : variables d’environnement `RESEND_API_KEY`, `MAIL_FROM` et `MAIL_PUBLIC_URL` dans le processus serveur. Le front ne reçoit jamais la clé.

Avec l’app encore locale, les liens ouvrent cet ordinateur. Pour une publication, `MAIL_PUBLIC_URL` devra être l’origine HTTPS du site, par exemple `https://app.votredomaine.fr`, après adaptation des hôtes, origines et sessions du serveur pour Cloudflare. Cette configuration e-mail ne réalise pas à elle seule le déploiement Cloudflare.

## Comportement

- Dès que le service e-mail est configuré, les nouveaux comptes par mot de passe doivent vérifier leur adresse avant de se connecter. Les anciens comptes non vérifiés doivent aussi la confirmer ; leurs données sont conservées.
- Un compte créé par Google utilise l’e-mail vérifié fourni par Google. L’association à un compte local différent ne vérifie pas automatiquement l’adresse locale.
- Sans service configuré, le fonctionnement local reste disponible et les adresses locales ne sont jamais présentées comme vérifiées. Les envois de vérification et récupération sont explicitement indisponibles. En `NODE_ENV=production`, le démarrage sans service e-mail est refusé. Les autres adaptations d’hébergement restent nécessaires.
- « Renvoyer le lien de vérification » et « Mot de passe oublié » renvoient le même message pour les adresses concernées et inconnues, sans exposer les jetons. L’envoi est traité en arrière-plan ; l’acceptation par le fournisseur ne garantit pas la livraison en boîte de réception.
- Un renvoi est limité à une demande par minute par compte et finalité, avec limitation globale des tentatives. Un nouveau lien remplace le précédent.
- Les liens de vérification expirent après une heure ; ceux de réinitialisation après quinze minutes. Une confirmation explicite est demandée : ouvrir un lien ne le consomme pas automatiquement.
- Après réinitialisation, toutes les sessions du compte sont révoquées ; les critères, missions et adresse Taskrabbit sont conservés. La connexion nécessite le nouveau mot de passe.
- Les comptes utilisant uniquement Google se reconnectent avec Google ; le parcours de récupération n’ajoute pas de mot de passe local.

## Protection des liens

Jetons aléatoires de 256 bits, empreinte SHA-256 enregistrée dans la base chiffrée, finalité distincte, expiration, usage unique et liaison à la version du mot de passe. Les liens placent le jeton dans un fragment `#`, qui n’est pas envoyé au serveur HTTP ; l’interface le retire de la barre d’adresse et le garde uniquement en mémoire. Les opérations utilisent des POST contrôlés par origine. Le mot de passe est haché avec scrypt et n’est jamais envoyé par e-mail.

Tester une fois la configuration avec une adresse dont vous êtes propriétaire, puis vérifier aussi les courriers indésirables. L’erreur du fournisseur est masquée au visiteur et signalée sans données personnelles dans la console serveur. La configuration n’a pas encore été validée par un envoi réel faute d’identifiants d’expédition.

Sources : [Domaines Resend](https://resend.com/docs/dashboard/domains/introduction), [API d’envoi](https://resend.com/docs/api-reference/emails/send-email), [Recommandations OWASP pour la récupération](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).
