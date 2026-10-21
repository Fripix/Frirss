import { useEffect } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useAiStore } from '../../stores/aiStore';
import SummariesBlock from './ai/SummariesBlock';
import TranslationBlock from './ai/TranslationBlock';
import RoutingBlock from './ai/RoutingBlock';
import KeysBlock from './ai/KeysBlock';
import AdminProviders from './ai/AdminProviders';

/**
 * Section « IA » (spec §10, §17.2). Pour l'admin seul, le bloc « Fournisseurs »
 * ouvre la section : sans fournisseur configuré, rien d'autre ne fonctionne, et
 * c'est ce qu'il vient chercher ici. Suivent, pour tous, « Résumés » et
 * « Traduction » (réglages de chacun), « Par flux et catégorie » et « Mes clés ».
 * Les routes admin ne sont jamais appelées pour un non-admin : elles lui sont fermées.
 */
export default function AiTab({ active = true }: { active?: boolean }) {
  const isAdmin = useAuthStore((s) => s.backendUser?.role === 'admin');
  // La configuration IA n'est chargée qu'à la connexion : sans ce rechargement,
  // « Appels IA payés par l'instance aujourd'hui » resterait figé à la valeur du
  // démarrage. À chaque affichage de la section, jamais pendant qu'elle est masquée.
  useEffect(() => {
    if (active) void useAiStore.getState().load();
  }, [active]);
  return (
    <div className="space-y-8 max-w-2xl">
      {isAdmin && <AdminProviders active={active} />}
      <SummariesBlock showIntro={!isAdmin} />
      <TranslationBlock />
      <RoutingBlock />
      <KeysBlock />
    </div>
  );
}
