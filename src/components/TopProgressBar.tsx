import { useTranslation } from 'react-i18next';
import { useFeedStore } from '../stores/feedStore';

/**
 * Thin indeterminate progress bar pinned to the very top of the viewport,
 * shown while the initial subscriptions/counts load is revalidating. Most
 * visible on a cold start right after a service-worker update, when every
 * in-memory cache is empty and the sidebar is being repopulated. Purely
 * informational — it never blocks the UI beneath it.
 *
 * ⚠️ Son libellé n'a rien de décoratif : la barre n'a aucun texte, donc
 * `aria-label` est la SEULE chose qu'un lecteur d'écran annonce ici. Il était
 * écrit « Loading » en dur — de l'anglais servi aux neuf langues, dans le seul
 * mot que ces utilisateurs entendaient.
 */
export default function TopProgressBar() {
  const { t } = useTranslation();
  const syncing = useFeedStore((s) => s.syncing);
  // Les écritures de masse (« tout marquer comme lu », son annulation) durent
  // plusieurs secondes et n'avaient AUCUN signe à l'écran : un clic semblait
  // perdu, et enchaîner les actions ne donnait aucune vision de ce qui
  // tournait (retour du 2026-09-30). La barre existait déjà pour dire « ça
  // travaille » — elle sert aux deux, et chiffre l'avancement quand il est
  // connu.
  const bulk = useFeedStore((s) => s.bulkWork);
  if (!syncing && !bulk) return null;

  if (bulk && bulk.total) {
    const part = Math.min(100, Math.round((bulk.done / bulk.total) * 100));
    return (
      <div
        className="top-progress top-progress--determinate"
        role="progressbar"
        aria-label={t('app.loading')}
        aria-valuenow={bulk.done}
        aria-valuemin={0}
        aria-valuemax={bulk.total}
        style={{ width: `${part}%` }}
      />
    );
  }

  return <div className="top-progress" role="progressbar" aria-label={t('app.loading')} aria-busy="true" />;
}
