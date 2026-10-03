# TaskPilot

## Version publique Cloudflare

La version Cloudflare Workers est déployée sur [task-pilot.net](https://task-pilot.net), avec redirection de `www`. Les secrets de chiffrement et PRIM/SNCF sont configurés côté serveur. Les inscriptions par e-mail restent fermées jusqu'à l'activation de Resend ; Google reste indisponible jusqu'à la configuration du client OAuth public. Aucun compte local n'a été transféré.

Le guide [CLOUDFLARE-DEPLOY.md](CLOUDFLARE-DEPLOY.md) décrit les secrets, domaines et étapes de publication. Les comptes cloud sont chiffrés et isolés ; les calculs de transport, associations du compagnon et e-mails en attente utilisent un stockage persistant. `npm run build` prépare uniquement le frontend public ; `npm run test:cloud` exécute huit tests d'intégration workerd, en complément des 91 tests existants. Le compagnon 2.1.0 permet de choisir le site public ou le serveur local. GitHub Actions vérifie le code ; la publication automatique depuis GitHub demande encore la connexion de l'intégration Builds Cloudflare au dépôt.

Les sections suivantes décrivent le fonctionnement du **serveur local Windows**. Pour la version hébergée, suivre le guide Cloudflare.

Application locale en français pour organiser des missions avec marges, pauses, revenus et trajets. Les exemples Paris/Lyon sont fictifs. Les propositions locales ne sont pas des attributions Taskrabbit.

## Démarrage

Node.js 22 ou plus récent. Dans ce dossier : npm ci (si les dépendances sont absentes), puis node server.mjs puis http://127.0.0.1:4173. Tests : npm test (91 tests). Le serveur écoute uniquement sur cet ordinateur.

## Compte utilisateur

À la première connexion, si aucune adresse Taskrabbit n’est enregistrée, une étape propose de la renseigner ou de choisir « Plus tard ». Le choix est conservé par compte, y compris après redémarrage ; l’adresse enregistrée se retrouve dans Mon compte et dans l’accès au portail pour les prochaines utilisations.

Créer un compte local avec un e-mail TaskPilot et un mot de passe d’au moins 10 caractères. L’e-mail Taskrabbit est facultatif et indépendant ; il se modifie dans Mon compte ou Accès au portail Taskrabbit. Il ne connecte pas automatiquement le portail officiel. À l’inscription, la case « Reprendre mes critères et missions actuels sur ce navigateur » importe les données précédentes si vous le souhaitez.

Critères, missions, statuts et file de demandes sont enregistrés par utilisateur sur le serveur local dans work/private/taskpilot-accounts.json, à côté de outputs, jamais dans le ZIP. La base est chiffrée avec AES-256-GCM, sa clé étant protégée par Windows DPAPI ; les comptes existants sont conservés lors de la migration. Les mots de passe sont hachés avec scrypt et un sel aléatoire ; les sessions utilisent un cookie HttpOnly/SameSite et durent sept jours, y compris après un redémarrage du serveur. Une déconnexion invalide la session. Le serveur demande une connexion pour ses API, sauf la capture du compagnon protégée par son code d’association. Un onglet obsolète ne peut pas écraser une sauvegarde plus récente.

Mon compte affiche l’état de sauvegarde. La vérification e-mail et la récupération par lien sont implémentées ; leur envoi nécessite un service Resend configuré. Voir [EMAIL-SETUP.md](EMAIL-SETUP.md). Les inscriptions locales sans expéditeur restent explicitement non vérifiées. Une fois l’envoi configuré, la connexion par mot de passe nécessite la vérification, y compris pour les anciens comptes ; leurs données sont conservées. Les clés de transport restent une configuration commune du serveur sur cet ordinateur. Le compagnon est associé à un seul compte à la fois et ses captures sont visibles uniquement par ce compte. Les tests automatisés utilisent une base temporaire. Le compte fictif utilisé pour vérifier la connexion dans le navigateur a été supprimé après validation. Aucun compte Taskrabbit n’a été connecté.

## Connexion Google

Inscription / connexion Google et association aux comptes existants sont implémentées. Pour activer le bouton, suivre [GOOGLE-SETUP.md](GOOGLE-SETUP.md) et importer un client OAuth Google avec configure-google.mjs. Les identifiants sont protégés par DPAPI, hors du projet et du ZIP. Le parcours est testé avec des identités signées simulées ; une connexion Google réelle nécessite votre client OAuth. Le mot de passe Google ne passe jamais par TaskPilot. Aucun compte existant n’est fusionné sur le seul e-mail ; l’association exige une connexion et une réauthentification par mot de passe.

## Planning et trajets

Mes critères → Disponibilités propose les sept jours de la semaine. Un jour non coché est un jour de repos : aucun planning, export calendrier ni nouveau calcul de trajet n’est proposé pour cette date, même si des missions sont déjà confirmées. Les réservations restent visibles et ne sont jamais annulées par ce réglage. Le moteur et l’API transport refusent également une date de repos. Les choix sont conservés par compte. Pour préserver les anciens réglages, les sept jours sont cochés initialement ; tout décocher désactive toute planification.

Les critères valides sont enregistrés automatiquement. Choisir plusieurs départements ou un lieu avec rayon. La recherche de commune définit un centre approximatif ; « Adresse de départ précise (IGN) » permet de choisir une adresse complète. La zone ne remplace pas les limites de trajet.

En transports, « Calculer avec les horaires » interroge PRIM pour l’Île-de-France ou SNCF pour les trains. Les missions sont fictives en démonstration mais les horaires viennent du fournisseur. Marche, correspondances, départ après montage, marges, arrivée anticipée et retour sont pris en compte. Les résultats expirent après 10 minutes. Les clés sont sauvegardées sous Windows avec DPAPI, liées au compte Windows, dans work/private à côté du dossier outputs ; elles ne sont jamais incluses dans ce projet, le ZIP ou le navigateur. Ailleurs, utiliser les variables PRIM_API_KEY et SNCF_API_KEY ; la configuration reste en mémoire si le stockage protégé échoue.

Voiture et marche : le bouton « Calculer les routes voiture / marche avec IGN » utilise le réseau routier, sans trafic temps réel. Les durées restent théoriques. Sans ce calcul, les trajets utilisent distance géographique, détour et vitesse. Le vélo reste estimé. Les durées manuelles vérifiées sont prioritaires. Maximum 20 missions par calcul externe ; itinéraires routiers réutilisables pendant 24 heures si les coordonnées sont identiques. Le revenu affiché déduit les frais de déplacement, sans impôts ni cotisations.

Les engagements en attente / confirmés restent obligatoires même hors préférences ; horaires et impossibilités physiques restent contrôlés. Les pauses peuvent occuper l’attente avant une mission. Le moteur demande plusieurs alternatives transport mais ne garantit pas un optimum global ; les perturbations doivent être vérifiées avant le départ.

## Import et localisation

Importer un JSON : fusion par identifiant, conservation des statuts suivis et des coordonnées si l’adresse est inchangée. La première importation retire les exemples. Une date impossible est refusée. « Localiser les adresses via IGN » transmet les adresses au géocodeur IGN : les correspondances précises et fortement discriminées sont appliquées, les autres demandent un choix. Vérifier la localisation avant un déplacement réel. Les données personnelles du compte sont enregistrées sur cet ordinateur, sans accès depuis un autre appareil tant que le serveur reste local.

## Compagnon Taskrabbit et surveillance

1. Dans Chrome ou Edge, ouvrir la gestion des extensions, activer le mode développeur et charger portal-reader comme extension non empaquetée.
2. Ouvrir le portail officiel, se connecter soi-même et afficher la liste des missions.
3. Dans TaskPilot → Missions disponibles, cliquer « Associer le compagnon Taskrabbit », copier le code et le coller dans le popup du compagnon.
4. Activer « Surveiller la liste ouverte » dans le compagnon et « Activer le suivi des offres » dans TaskPilot.

La liste ouverte est rechargée toutes les deux minutes. Le compagnon ne clique jamais sur une demande et ne récupère pas le mot de passe ou les cookies. Il lit uniquement les cartes présentes dans le DOM. Pagination et filtres peuvent limiter la capture. Une offre absente est marquée non visible ; cela ne prouve pas une annulation. Les confirmations restent suivies manuellement. La liste vide n’efface pas les offres précédentes. Le code d’association devient invalide à l’arrêt du serveur. Navigateur, portail, serveur et app doivent rester ouverts ; pas de service hébergé permanent.

Les alertes dans l’app signalent nouvelles offres et modifications. Les notifications navigateur sont optionnelles, après activation dans Missions disponibles, et fonctionnent tant que l’app reste ouverte. Sans compagnon, le téléchargement JSON manuel reste disponible. Le compagnon v2 n’a pas été installé dans un navigateur pendant cette session ; son serveur, sa fusion et son authentification ont été testés avec des captures simulées. L’extraction originale avait reconnu les cartes réelles inspectées en lecture seule. Elle dépend du DOM du portail.

## Confirmer ou annuler dans le planning

La section « Toutes vos missions réservées » affiche tous les engagements renseignés, toutes dates confondues, sans appliquer les filtres géographiques ni sélectionner une option. Pour la journée choisie, le mode par défaut attend que toutes les missions en attente soient confirmées ou annulées, puis calcule uniquement les confirmations. Une impossibilité est signalée sans retirer discrètement un engagement. Le mode « Propositions avant réservation » reste disponible séparément.

Les boutons ✓ et × sur les missions indiquent une confirmation ou une annulation déjà faite dans Taskrabbit. Ils ne changent pas le compte Taskrabbit. Une confirmation devient un engagement obligatoire ; une annulation retire la mission du planning en conservant son historique et empêche sa réintroduction par import. Le planning est recalculé immédiatement, puis les horaires PRIM/SNCF sont actualisés automatiquement en mode transports. Les conflits et erreurs du fournisseur sont affichés. Les boutons restent actifs pour corriger un choix : ✓ peut reconfirmer une mission annulée et × peut annuler une confirmation. « Annuler cette modification » permet également de revenir en arrière pendant 30 secondes.

## Demandes

« Préparer les demandes de ce planning » crée une file locale sans doublons pour des offres réelles. Ouvrir chaque fiche pour vérifier sa disponibilité et demander la mission sur Taskrabbit. Déclarer l’envoi dans l’app seulement après l’avoir fait ; le statut devient en attente. Ce n’est pas une attribution. Aucun essai de demande n’a été effectué avec le compte de test.

## Validation et limites restantes

91 tests automatisés ; appels PRIM/SNCF réels sur missions fictives ; localisation IGN et route voiture vérifiées sur des points publics ; sauvegarde et récupération des clés après redémarrage vérifiées. Le suivi installé dans Chrome/Edge reste à valider de bout en bout. Pas de soumission automatique, de lecture des confirmations personnelles, d’hébergement accessible sur téléphone, de service permanent, ni de chaînage automatique des calculateurs urbains/nationaux. Ces étapes nécessitent une session réelle et une cible d’hébergement définie ; ne pas exposer ce serveur local directement sur Internet.

## Sources et licences

Géocodage et routes : [IGN Géoplateforme](https://cartes.gouv.fr/aide/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/geocodage/). Communes : geo.api.gouv.fr. Transport : [PRIM](https://prim.iledefrance-mobilites.fr/fr/notre-offre), [SNCF](https://numerique.sncf.com/startup/api/). Contours : France GeoJSON, IGN Admin Express 2018 sous Licence ouverte. Leaflet 1.9.4 fourni sous BSD, licence dans vendor/leaflet-LICENSE.txt.
