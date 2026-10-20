import { useEffect } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useAiStore } from '../../stores/aiStore';
import SummariesBlock from './ai/SummariesBlock';
import TranslationBlock from './ai/TranslationBlock';
import RoutingBlock from './ai/RoutingBlock';
import KeysBlock from './ai/KeysBlock';
import AdminProviders from './ai/AdminProviders';

/**
 * Section « IA » (spec §10, §17.2). Les blocs « Résumés » et « Traduction »
 * (réglages de chacun) et le bloc « Par flux et catégorie » pour tous, puis, pour l'admin seul, le bloc « Fournisseurs ». Les routes admin
 * ne sont jamais appelées pour un non-admin : elles lui sont fermées.
 */
export default function AiTab({ active = true }: { active?: boolean }) {
  const isAdmin = useAuthStore((s) => s.backendUser?.role === 'admin');
  // La configuration IA n'est chargée qu'à la connexion : sans ce rechargement,
  // « Résumés payés par l'instance aujourd'hui » resterait figé à la valeur du
  // démarrage. À chaque affichage de la section, jamais pendant qu'elle est masquée.
  useEffect(() => {
    if (active) void useAiStore.getState().load();
  }, [active]);
  return (
    <div className="space-y-8 max-w-2xl">
      <SummariesBlock showIntro={!isAdmin} />
      <TranslationBlock />
      <RoutingBlock />
      <KeysBlock />
      {isAdmin && <AdminProviders active={active} />}
    </div>
  );
}
