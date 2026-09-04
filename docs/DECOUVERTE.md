---
probleme: Le pilotage financier de trois locations saisonnieres vit dans un Excel que SuperHote ne recoupe pas, et personne ne sait quel chiffre fait foi.
utilisateurs: [Alexandre Selly]
anti_objectif: A COMPLETER
critere_reussite: A COMPLETER
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

## Les contraintes

- Le dépôt est public, la clé publiable Supabase y est en clair par construction.
- La fidélité à l'Excel est le critère de vérité : un écart est un bug.
- Aucune écriture automatique en base : tout passe par la modale de validation.
