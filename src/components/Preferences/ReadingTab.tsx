import { useTranslation } from 'react-i18next';
import { useUiStore } from '../../stores/uiStore';
import { useFeedStore } from '../../stores/feedStore';
import ToggleSwitch from '../ToggleSwitch';
import RandomViewSettings from './RandomViewSettings';
import { PrefCard, PrefHeading, PrefRow, Segmented } from './prefsUi';

/**
 * Préférences → Lecture : comment la liste s'ouvre et se trie, quand un
 * article devient lu, ce que montre un article, et le tirage Aléatoire.
 * Ces réglages vivaient dans « Général », un seul bloc de onze réglages sans
 * autre ordre que celui de leur arrivée.
 */
export default function ReadingTab() {
  const { t } = useTranslation();
  const confirmMarkAllRead = useUiStore((s) => s.confirmMarkAllRead);
  const setConfirmMarkAllRead = useUiStore((s) => s.setConfirmMarkAllRead);
  const markAllJumpNext = useUiStore((s) => s.markAllJumpNext);
  const setMarkAllJumpNext = useUiStore((s) => s.setMarkAllJumpNext);
  const markReadOnScroll = useUiStore((s) => s.markReadOnScroll);
  const setMarkReadOnScroll = useUiStore((s) => s.setMarkReadOnScroll);
  const showNewArticlesPill = useUiStore((s) => s.showNewArticlesPill);
  const setShowNewArticlesPill = useUiStore((s) => s.setShowNewArticlesPill);
  const unreadOnlyScope = useUiStore((s) => s.unreadOnlyScope);
  const setUnreadOnlyScope = useUiStore((s) => s.setUnreadOnlyScope);
  const startupView = useUiStore((s) => s.startupView);
  const setStartupView = useUiStore((s) => s.setStartupView);
  const articleOrder = useUiStore((s) => s.articleOrder);
  const setArticleOrder = useUiStore((s) => s.setArticleOrder);
  const inlineVideos = useUiStore((s) => s.inlineVideos);
  const setInlineVideos = useUiStore((s) => s.setInlineVideos);
  const autoExtractDefault = useUiStore((s) => s.autoExtractDefault);
  const setAutoExtractDefault = useUiStore((s) => s.setAutoExtractDefault);

  return (
    <div>
      <PrefHeading>{t('preferences.reading.list')}</PrefHeading>
      <PrefCard>
        {/* Ce qui s'ouvre au lancement : la dernière vue, ou toujours une entrée fixe */}
        <PrefRow
          stacked
          label={t('preferences.general.startupView')}
          hint={t('preferences.general.startupViewHint')}
          control={
            <Segmented
              label={t('preferences.general.startupView')}
              value={startupView}
              onChange={setStartupView}
              options={[
                { value: 'last', label: t('preferences.general.startupViewLast') },
                { value: 'all', label: t('sidebar.allFeeds') },
                { value: 'unread', label: t('sidebar.unread') },
              ]}
            />
          }
        />
        {/* L'ordre fait partie de la requête à FreshRSS : la vue ouverte se
            recharge. Un flux peut garder le sien depuis son menu. */}
        <PrefRow
          stacked
          label={t('preferences.general.articleOrder')}
          hint={t('preferences.general.articleOrderHint')}
          control={
            <Segmented
              label={t('preferences.general.articleOrder')}
              value={articleOrder}
              onChange={(order) => {
                if (order === articleOrder) return;
                setArticleOrder(order);
                // Un tirage ne dépend pas de l'ordre.
                if (!useFeedStore.getState().randomView) void useFeedStore.getState().loadArticles();
              }}
              options={[
                { value: 'newest', label: t('preferences.general.articleOrderNewest') },
                { value: 'oldest', label: t('preferences.general.articleOrderOldest') },
              ]}
            />
          }
        />
        {/* Portée du filtre Non lus : par flux, ou un seul état pour tous */}
        <PrefRow
          stacked
          label={t('preferences.general.unreadScope')}
          hint={t('preferences.general.unreadScopeHint')}
          control={
            <Segmented
              label={t('preferences.general.unreadScope')}
              value={unreadOnlyScope}
              onChange={(scope) => setUnreadOnlyScope(scope, useFeedStore.getState().selectedFeed?.id ?? '')}
              options={[
                { value: 'feed', label: t('preferences.general.unreadScopeFeed') },
                { value: 'all', label: t('preferences.general.unreadScopeAll') },
              ]}
            />
          }
        />
        {/* Les articles arrivés depuis le chargement de la liste (discussion #14) */}
        <PrefRow
          label={t('preferences.general.newArticlesPill')}
          hint={t('preferences.general.newArticlesPillHint')}
          control={
            <ToggleSwitch
              checked={showNewArticlesPill}
              onChange={setShowNewArticlesPill}
              ariaLabel={t('preferences.general.newArticlesPill')}
            />
          }
        />
      </PrefCard>

      <PrefHeading>{t('preferences.reading.markRead')}</PrefHeading>
      <PrefCard>
        <PrefRow
          label={t('preferences.general.confirmMarkAllRead')}
          hint={t('preferences.general.confirmMarkAllReadHint')}
          control={
            <ToggleSwitch
              checked={confirmMarkAllRead}
              onChange={setConfirmMarkAllRead}
              ariaLabel={t('preferences.general.confirmMarkAllRead')}
            />
          }
        />
        {/* Issue #35 : vider un flux, puis passer au suivant qui a des non-lus */}
        <PrefRow
          label={t('preferences.general.markAllJumpNext')}
          hint={t('preferences.general.markAllJumpNextHint')}
          control={
            <ToggleSwitch
              checked={markAllJumpNext}
              onChange={setMarkAllJumpNext}
              ariaLabel={t('preferences.general.markAllJumpNext')}
            />
          }
        />
        {/* Lu une seconde après être sorti par le haut de la liste */}
        <PrefRow
          label={t('preferences.general.markReadOnScroll')}
          hint={t('preferences.general.markReadOnScrollHint')}
          control={
            <ToggleSwitch
              checked={markReadOnScroll}
              onChange={setMarkReadOnScroll}
              ariaLabel={t('preferences.general.markReadOnScroll')}
            />
          }
        />
      </PrefCard>

      <PrefHeading>{t('preferences.reading.article')}</PrefHeading>
      <PrefCard>
        {/* Chaque flux peut encore dire oui ou non depuis son menu */}
        <PrefRow
          label={t('preferences.general.autoExtractDefault')}
          hint={t('preferences.general.autoExtractDefaultHint')}
          control={
            <ToggleSwitch
              checked={autoExtractDefault}
              onChange={setAutoExtractDefault}
              ariaLabel={t('preferences.general.autoExtractDefault')}
            />
          }
        />
        {/* Vidéos YouTube lues dans l'article (façade chargée au clic) */}
        <PrefRow
          label={t('preferences.general.inlineVideos')}
          hint={t('preferences.general.inlineVideosHint')}
          control={
            <ToggleSwitch
              checked={inlineVideos}
              onChange={setInlineVideos}
              ariaLabel={t('preferences.general.inlineVideos')}
            />
          }
        />
      </PrefCard>

      <PrefHeading>{t('preferences.reading.random')}</PrefHeading>
      <PrefCard>
        <RandomViewSettings />
      </PrefCard>
    </div>
  );
}
