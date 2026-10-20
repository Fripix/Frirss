import { useAuthStore } from '../../stores/authStore';
import SummariesBlock from './ai/SummariesBlock';
import RoutingBlock from './ai/RoutingBlock';
import KeysBlock from './ai/KeysBlock';
import AdminProviders from './ai/AdminProviders';

/**
 * Section « IA » (spec §10). Le bloc « Résumés » (réglages de chacun) et le bloc
 * « Par flux et catégorie » pour tous, puis, pour l'admin seul, le bloc « Fournisseurs ». Rien n'est chargé
 * pour un non-admin : les routes admin lui sont fermées, inutile de les appeler.
 */
export default function AiTab({ active = true }: { active?: boolean }) {
  const isAdmin = useAuthStore((s) => s.backendUser?.role === 'admin');
  return (
    <div className="space-y-8 max-w-2xl">
      <SummariesBlock showIntro={!isAdmin} />
      <RoutingBlock />
      <KeysBlock />
      {isAdmin && <AdminProviders active={active} />}
    </div>
  );
}
