import type { Metadata } from 'next';
import { Overview } from '../components/overview.tsx';
import { apiOrigin } from '../lib/site.ts';

export const metadata: Metadata = { title: 'Overview · Clutchbox' };
export default function OverviewPage() {
  return <Overview mcpUrl={`${apiOrigin}/api/mcp`} />;
}
