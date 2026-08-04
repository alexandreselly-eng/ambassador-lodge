// Surveillance de la synchronisation SuperHote.
//
// Deux pannes, deux natures :
//   l'ECHEC    la synchro tourne et rapporte une erreur. Elle s'annonce.
//   le SILENCE la synchro ne tourne plus du tout. Elle ne s'annonce PAS : last_status reste
//              figé sur son dernier « ok », ce qui ressemble à un fonctionnement normal.
//
// Le second est le vrai risque, et c'est celui qui s'est déjà produit : l'import CSV est
// resté cassé du 12 au 31/07/2026 sans que rien ne le signale. Surveiller l'erreur sans
// surveiller le silence ne servirait qu'à se rassurer.
//
// Module pur : aucun appel réseau, aucune dépendance à Deno. L'envoi est dans index.ts.

export interface EtatSync {
  last_run_at?: string | null;
  last_updated?: string | null;
  last_status?: string | null;
  last_error?: string | null;
  alerte_le?: string | null;
}

export type Niveau = 'ok' | 'echec' | 'silence' | 'jamais';

export interface Diagnostic {
  niveau: Niveau;
  /** Titre en ASCII : ntfy transporte les en-têtes, les accents y sont mal supportés. */
  titre: string;
  message: string;
  /** Vrai quand la situation justifie de déranger. */
  alerte: boolean;
}

const H = 3600 * 1000;

function heures(a: string, b: number): number {
  return Math.round((b - new Date(a).getTime()) / H);
}

/**
 * Etat de santé de la synchro.
 * @param seuilSilenceH au-delà de ce délai sans passage réussi, on considère qu'elle est morte.
 *   36 h par défaut pour une synchro quotidienne : un passage peut être manqué sans crier au feu.
 */
export function diagnostic(
  etat: EtatSync | null | undefined,
  maintenant: number,
  seuilSilenceH = 36,
): Diagnostic {
  if (!etat || !etat.last_run_at) {
    return {
      niveau: 'jamais',
      titre: 'Synchro SuperHote jamais executee',
      message: "La synchronisation n'a jamais tourné. Rien ne remonte de SuperHote.",
      alerte: false, // avant le premier passage, il n'y a rien d'anormal à signaler
    };
  }

  if (etat.last_status !== 'ok') {
    const h = heures(etat.last_run_at, maintenant);
    return {
      niveau: 'echec',
      titre: 'Synchro SuperHote en echec',
      message:
        `La synchronisation a échoué il y a ${h} h.\n` +
        `Motif : ${etat.last_error || 'non enregistré'}\n` +
        `Les données ne bougent plus. La mémoire déjà validée n'est pas affectée.`,
      alerte: true,
    };
  }

  const h = heures(etat.last_run_at, maintenant);
  if (h >= seuilSilenceH) {
    return {
      niveau: 'silence',
      titre: 'Synchro SuperHote silencieuse',
      message:
        `Aucun passage réussi depuis ${h} h, seuil ${seuilSilenceH} h.\n` +
        `Le dernier s'est bien terminé : ce n'est donc pas une erreur, c'est un arrêt. ` +
        `Vérifier le déclencheur plutôt que la fonction.`,
      alerte: true,
    };
  }

  return {
    niveau: 'ok',
    titre: 'Synchro SuperHote operationnelle',
    message: `Dernier passage réussi il y a ${h} h.`,
    alerte: false,
  };
}

/**
 * Anti-répétition. Une alerte qui se répète toutes les dix minutes finit en sourdine, et
 * c'est le meilleur moyen de rater la vraie. Une par tranche de `intervalleH` suffit.
 */
export function peutAlerter(alerteLe: string | null | undefined, maintenant: number, intervalleH = 6): boolean {
  if (!alerteLe) return true;
  const t = new Date(alerteLe).getTime();
  if (Number.isNaN(t)) return true;
  return maintenant - t >= intervalleH * H;
}

/**
 * Le sujet ntfy est un secret de fait : sur le serveur public, quiconque le connaît peut lire
 * les messages. Le corps ne doit donc porter aucune donnée nominative. Les messages produits
 * ici n'en contiennent pas, et la troncature limite ce qu'un message d'erreur inattendu
 * pourrait laisser fuir.
 */
export function corpsSur(message: string, maxi = 400): string {
  const m = String(message || '').replace(/\s+/g, ' ').trim();
  return m.length <= maxi ? m : m.slice(0, maxi - 1) + '…';
}
