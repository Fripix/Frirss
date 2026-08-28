import { useTranslation } from 'react-i18next';
import BackupExport from '../../backup/BackupExport';
import RestoreFlow from '../../backup/RestoreFlow';
import { useAuthStore } from '../../../stores/authStore';

/**
 * Sauvegarde et restauration, dans Administration : l'opération porte sur
 * l'instance entière, pas sur un compte. Elle vit dans son propre fichier —
 * AdminTab.tsx fait déjà 706 lignes.
 */
export default function BackupBlock() {
  const { t } = useTranslation();
  const logout = useAuthStore((s) => s.logout);

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-[11px] font-bold uppercase tracking-widest mb-3 pb-1.5 border-b" style={{ color: 'var(--list-title)', borderColor: 'var(--panel-border)' }}>
          {t('backup.title')}
        </h3>
        <BackupExport />
      </div>

      <div>
        <h3 className="text-[11px] font-bold uppercase tracking-widest mb-3 pb-1.5 border-b" style={{ color: 'var(--list-title)', borderColor: 'var(--panel-border)' }}>
          {t('backup.restoreTitle')}
        </h3>
        {/* La restauration remplace les comptes : la session courante ne vaut
            plus rien ensuite, on déconnecte plutôt que de laisser l'utilisateur
            devant une interface qui ne répond plus. Le délai lui laisse le
            temps de lire « Restauration terminée ».
            Ce différé ne peut PAS être un `setTimeout` nu. La restauration
            supprime les sessions, donc la première requête de fond reçoit un
            401 et l'intercepteur déconnecte AVANT la fin du délai : l'écran de
            connexion s'affiche, l'utilisateur se reconnecte, et le minuteur
            périmé — que le démontage du composant n'annule pas — détruisait sa
            session toute neuve. Il fallait s'y reprendre à plusieurs fois pour
            rester connecté.
            On retient donc le jeton du moment, et on ne déconnecte que s'il
            n'a pas changé : quelqu'un d'autre s'en est chargé, ou l'utilisateur
            est déjà revenu avec une nouvelle session. */}
        <RestoreFlow
          setup={false}
          onRestored={() => {
            const jetonAvant = useAuthStore.getState().backendToken;
            setTimeout(() => {
              if (useAuthStore.getState().backendToken === jetonAvant) logout();
            }, 1500);
          }}
        />
      </div>
    </div>
  );
}
