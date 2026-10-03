# Bot autonome TaskPilot : état de livraison

Le code serveur de consultation, de sélection et d’envoi est intégré à Cloudflare. Il est **désactivé en production**, sans demande réelle envoyée pendant les tests.

## Condition d’activation

La [politique d’utilisation Taskrabbit](https://support.taskrabbit.com/hc/en-us/articles/46260475390107-Taskrabbit-Platform-Acceptable-Use-Policy) interdit les processus automatiques de collecte ou gestion de la plateforme. Obtenir un accord écrit de Taskrabbit pour le portail TaskPortal et ce service commercial avant toute activation. Leur API de création de projets clients ne remplace pas un accès aux demandes des Taskeurs.

Une fois cet accord obtenu, le propriétaire configure le secret `TASKRABBIT_AUTOMATION_APPROVED` à `true` avec Wrangler. Les utilisateurs doivent ensuite vérifier leur adresse Taskrabbit, enregistrer leurs critères et horaires, et autoriser explicitement les demandes depuis l’onglet Taskrabbit. Changer d’adresse désactive le bot et impose une nouvelle vérification.

L’adresse de test fournie pendant le développement est protégée contre tout envoi. Ne pas la retirer de cette protection pour un test.

## Fonctionnement gratuit

- Cron Cloudflare toutes les minutes, sélection équitable des utilisateurs dont le créneau est actif ; au plus un contrôle par utilisateur toutes les cinq minutes.
- Budget propre à TaskPilot : 450 secondes de navigateur par jour UTC pour **tout le compte**, sous le plafond Cloudflare gratuit actuel de 600 secondes. Les autres usages Browser Run du compte ne sont pas inclus dans notre compteur ; Cloudflare impose son plafond global.
- Avant chaque session, réservation prudente de 90 secondes. Fermeture explicite et restitution du temps inutilisé uniquement si la fermeture est confirmée. Aucun passage automatique à une offre payante.
- Ne pas passer le compte Workers à une offre payante sans réévaluer la facturation de Browser Run. Les quotas Workers, stockage, fournisseurs de transport et e-mails s’appliquent également.
- Capture du portail puis fermeture du navigateur. Géocodage et calculs hors navigateur via alarmes persistantes, en respectant le budget partagé du calculateur. Nouvelle session courte avant l’envoi.
- Demain uniquement ; jours off exclus ; jusqu’à 20 offres admissibles, comparaison de six nouvelles candidates avec les missions déjà suivies. Routes voiture/marche IGN avec dix minutes supplémentaires par trajet, ou horaires PRIM/SNCF. Vélo bloqué en l’absence de calculateur routier adapté.
- Un identifiant de mission peut faire l’objet d’une seule tentative sur la plateforme. Les demandes incertaines bloquent un créneau et ne sont jamais renvoyées automatiquement. Les claims sont conservés ; toute correction nécessite une vérification manuelle sur Taskrabbit.
- Demande envoyée ≠ attribution. L’utilisateur confirme ou annule le **suivi** dans TaskPilot ; aucun message ou annulation n’est envoyé au client.

## Validation et limites

Les tests automatisés utilisent un portail simulé et des e-mails simulés. Aucun test de demande réelle avec attribution n’a été effectué. Les sélecteurs de la page de détail ont été relevés en lecture seule sur le portail réel. Le retour après envoi n’a pas été observé : si son texte ne correspond pas au signal attendu, la demande reste incertaine.

Avant d’ouvrir cette fonction après autorisation, réaliser un test pilote avec un Taskeur volontaire et une mission qu’il accepte réellement de demander. Vérifier l’accès au portail depuis Browser Run, le retour après demande, l’invitation Taskrabbit et la compatibilité avec les limites de CPU gratuites. Arrêter en présence d’un CAPTCHA ou d’un refus d’accès ; aucun contournement n’est prévu.

Cette version gratuite n’est pas une surveillance continue et ne garantit pas une réaction à la seconde. Elle n’est pas adaptée à de nombreux abonnés recherchant simultanément sans budget supplémentaire.
