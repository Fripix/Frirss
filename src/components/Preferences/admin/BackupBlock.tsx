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
    <div className="space-y-5">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--list-summary)' }}>
          {t('backup.title')}
        </h3>
        <BackupExport />
      </div>

      <div style={{ borderTop: '1px solid var(--panel-border)' }} className="pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--list-summary)' }}>
          {t('backup.restoreTitle')}
        </h3>
        {/* La restauration remplace les comptes : la session courante ne vaut
            plus rien ensuite, on déconnecte plutôt que de laisser l'utilisateur
            devant une interface qui ne répond plus. */}
        <RestoreFlow setup={false} onRestored={() => setTimeout(logout, 1500)} />
      </div>
    </div>
  );
}
