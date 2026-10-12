import { useTranslation } from 'react-i18next';
import { useUiStore } from '../../stores/uiStore';
import { ROW_ACTION_ORDER } from '../../lib/rowActions';
import ToggleSwitch from '../ToggleSwitch';

/**
 * Preferences → Layout.
 *
 * Row actions are configured independently for mobile and desktop. The same
 * settings are also exposed in the article-list view-options sheet.
 */
export default function LayoutTab() {
  const { t } = useTranslation();
  const deviceDisplaySettings = useUiStore((s) => s.deviceDisplaySettings);
  const setDeviceRowAction = useUiStore((s) => s.setDeviceRowAction);
  const setDeviceDisplaySetting = useUiStore((s) => s.setDeviceDisplaySetting);

  return (
    <div className="max-w-xl">
      <h3 className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--list-summary)' }}>
        {t('preferences.layout.title')}
      </h3>
      <p className="text-[11px] opacity-70 mb-3" style={{ color: 'var(--list-summary)' }}>
        {t('preferences.layout.hint')}
      </p>

      {(['mobile', 'desktop'] as const).map((device) => (
        <section key={device} className="mt-5">
          <h4 className="text-xs font-semibold mb-3" style={{ color: 'var(--list-title)' }}>
            {t(device === 'mobile' ? 'articleList.mobileSettings' : 'articleList.desktopSettings')}
          </h4>
          {ROW_ACTION_ORDER.map((kind) => (
            <div key={kind} className="flex items-start justify-between gap-4 select-none mt-4">
              <span className="text-xs" style={{ color: 'var(--list-summary)' }}>
                {t(`preferences.layout.${kind}`)}
              </span>
              <span className="mt-0.5">
                <ToggleSwitch
                  checked={deviceDisplaySettings[device].rowActions[kind]}
                  onChange={(v: boolean) => setDeviceRowAction(device, kind, v)}
                  ariaLabel={`${t(device === 'mobile' ? 'articleList.mobileSettings' : 'articleList.desktopSettings')}: ${t(`preferences.layout.${kind}`)}`}
                />
              </span>
            </div>
          ))}
          <div className="flex items-start justify-between gap-4 select-none mt-4">
            <span className="text-xs" style={{ color: 'var(--list-summary)' }}>Upvote / Downvote</span>
            <span className="mt-0.5">
              <ToggleSwitch
                checked={deviceDisplaySettings[device].showArticleVoting}
                onChange={(v: boolean) => setDeviceDisplaySetting(device, 'showArticleVoting', v)}
                ariaLabel={`${device === 'mobile' ? 'Mobile' : 'Desktop'}: Upvote / Downvote`}
              />
            </span>
          </div>
        </section>
      ))}
    </div>
  );
}
