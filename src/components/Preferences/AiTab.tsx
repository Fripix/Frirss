import { useAuthStore } from '../../stores/authStore';
import SummariesBlock from './ai/SummariesBlock';
import AdminProviders from './ai/AdminProviders';

/**
 * Section « IA » (spec §10). Le bloc « Résumés » (réglages de chacun) pour
 * tous, puis, pour l'admin seul, le bloc « Fournisseurs ». Rien n'est chargé
 * pour un non-admin : les routes admin lui sont fermées, inutile de les appeler.
 */
export default function AiTab({ active = true }: { active?: boolean }) {
  const isAdmin = useAuthStore((s) => s.backendUser?.role === 'admin');
  return (
    <div className="space-y-8 max-w-2xl">
      <SummariesBlock showIntro={!isAdmin} />
      {isAdmin && <AdminProviders active={active} />}
    </div>
  );
}
