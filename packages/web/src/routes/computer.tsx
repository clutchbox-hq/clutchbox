import type { Metadata } from 'next';
import { YourComputer } from '../components/your-computer.tsx';

export const metadata: Metadata = { title: 'Your computer · Clutchbox' };
export default function ComputerPage() {
  return <YourComputer />;
}
