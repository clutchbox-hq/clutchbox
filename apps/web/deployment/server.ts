import 'server-only';
import { defaultServerHooks } from '@clutchbox/server/hooks';
import { readSiteRules } from '@clutchbox/server/site-rules';
import { createServices } from '@clutchbox/web/services';

// This app's services: the product's defaults, with no credit and no operator admin, computers from the organization's
// own E2B_API_KEY, and any site rules in SITE_RULES_PATH. A deployment that adds its own layers passes its hooks and API
// routes here instead.
export const getServices = createServices({
  ...defaultServerHooks,
  siteRules: readSiteRules(process.env.SITE_RULES_PATH || undefined),
});
