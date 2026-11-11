import { BUSINESS_TEMPLATES } from '../lib/businessTemplates';
import { isModuleOn, moduleOfTab, type Modules } from '../lib/modules';

/** Whether a menu tab shows for this user and these switches (registry APP_TABS); a module turned off (BB-07) hides its tabs. */
export function isTabVisible(
  tab: { id?: string; requiresOwner?: boolean; isAdvanced?: boolean; developerOnly?: boolean; businessTypes?: readonly string[] },
  opts: { isOwner: boolean; isProMode: boolean; developerMode: boolean; modules?: Modules; businessType?: string; showAll?: boolean },
): boolean {
  const module = moduleOfTab(tab.id);
  const recommended = !opts.businessType || !Object.hasOwn(BUSINESS_TEMPLATES, opts.businessType) || !tab.businessTypes || tab.businessTypes.includes('*') || tab.businessTypes.includes(opts.businessType);
  return (opts.showAll || ((!tab.isAdvanced || opts.isProMode) && recommended)) && (!tab.requiresOwner || opts.isOwner) && (!tab.developerOnly || opts.developerMode)
    && (!module || isModuleOn(opts.modules, module));
}
