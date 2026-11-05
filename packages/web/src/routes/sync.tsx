import type { Metadata } from 'next';
import { BrowserSync } from '../components/browser-sync.tsx';
import { extensionDownloadUrl, extensionDownloadVersion } from '../lib/extension-download.ts';
import { siteOrigin } from '../lib/site.ts';

export const metadata: Metadata = { title: 'Browser sync · Clutchbox' };
export default function SyncPage() {
  return (
    <BrowserSync
      accountUrl={`${siteOrigin}/app/sync`}
      extensionVersion={extensionDownloadVersion}
      extensionDownloadUrl={extensionDownloadUrl}
    />
  );
}
