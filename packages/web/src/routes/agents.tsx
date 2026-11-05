import type { Metadata } from 'next';
import { AgentConnections } from '../components/agent-connections.tsx';
import { apiOrigin } from '../lib/site.ts';

export const metadata: Metadata = { title: 'Agents · Clutchbox' };
export default function AgentsPage() {
  return <AgentConnections mcpUrl={`${apiOrigin}/api/mcp`} />;
}
