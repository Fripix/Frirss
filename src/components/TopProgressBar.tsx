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
  if (!syncing) return null;
  return <div className="top-progress" role="progressbar" aria-label={t('app.loading')} aria-busy="true" />;
}
