---
probleme: Le pilotage financier de trois locations saisonnieres vit dans un Excel que SuperHote ne recoupe pas, et personne ne sait quel chiffre fait foi.
utilisateurs: [Alexandre Selly]
anti_objectif: >-
  bnb-pilot ne doit pas devenir un PMS ni un logiciel complet de gestion locative. Il reste un
  outil de pilotage et d aide a la decision. Il ne doit deriver ni vers la gestion complete des
  reservations, ni vers la messagerie voyageurs, ni vers la synchronisation operationnelle avec
  toutes les plateformes, ni vers la comptabilite generale, ni vers un CRM, ni vers une usine a
  gaz demandant une maintenance importante. Mieux piloter, pas remplacer les outils metier.
critere_reussite: >-
  A partir des donnees disponibles, comprendre en quelques minutes la situation reelle d un bien
  et identifier immediatement ce qui merite une action, sans retraitement manuel complexe.
donnees_sensibles: true
contraintes: [Depot public, aucune donnee nominative versionnee, fidelite a l Excel de reference, aucune ecriture en base sans validation humaine]
---

# Découverte — bnb-pilot

> Reconstruit par rétro-ingénierie le 04/09/2026, lors de l'adoption du projet dans le workflow.
> Les rubriques `A COMPLETER` ne se déduisent pas du code : elles demandent une réponse d'Alexandre.

## Le problème

Trois biens en location saisonnière — Villa Ambassador, Lodge, Villa Métis — sont suivis dans un
Excel de référence. SuperHote publie plusieurs lectures du chiffre d'affaires qui ne bouclent pas
entre elles, et l'export CSV a cassé sans préavis lors de la migration V1 vers V2 du 09/06/2026,
sans que rien ne le signale jusqu'au 31/07.

## Les utilisateurs

Alexandre Selly. Le projet porte une console d'octroi d'accès et un mode « voir en tant que »,
donc l'ouverture à d'autres personnes est prévue, mais aucun autre utilisateur n'est constaté.

## Les données et leur sensibilité

**Sensibles.** Les réservations portent des noms de voyageurs. Le dépôt est **public**. D'où la
règle du projet : aucune donnée nominative versionnée, fixtures et sauvegardes hors dépôt.

## L'anti-objectif

**bnb-pilot ne doit pas devenir un PMS ni un logiciel complet de gestion locative.** Il reste un
outil de pilotage et d'aide à la décision, centré sur la lecture claire de l'activité, des
indicateurs, des taxes et de ce qui sert le suivi d'une location saisonnière.

Il ne doit dériver ni vers la gestion complète des réservations, ni vers la messagerie voyageurs,
ni vers la synchronisation opérationnelle avec toutes les plateformes, ni vers la comptabilité
générale, ni vers un CRM complexe, ni vers une usine à gaz demandant une maintenance importante.

Le principe : **mieux piloter, pas remplacer les outils métier existants.**

## Le critère de réussite

À partir des données disponibles, **comprendre en quelques minutes la situation réelle d'un bien
et identifier immédiatement ce qui mérite une action**, sans retraitement manuel complexe.

Le produit est réussi si :

- les données affichées sont fiables et compréhensibles ;
- les principaux indicateurs sont au même endroit ;
- les calculs, notamment fiscaux et de taxe de séjour, sont **reproductibles et explicables** ;
- l'utilisateur n'a plus besoin de reconstruire ses tableaux à la main ;
- l'outil reste assez simple pour être utilisé régulièrement.

## Les contraintes

- Le dépôt est public, la clé publiable Supabase y est en clair par construction.
- La fidélité à l'Excel est le critère de vérité : un écart est un bug.
- Aucune écriture automatique en base : tout passe par la modale de validation.
