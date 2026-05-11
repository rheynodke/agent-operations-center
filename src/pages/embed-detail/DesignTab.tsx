import EmbedDesigner from './components/EmbedDesigner';
import type { Embed } from '@/types/embed';

export default function DesignTab({ embed, onUpdate }: { embed: Embed, onUpdate: (e: Embed) => void }) {
  return <EmbedDesigner embed={embed} onUpdate={onUpdate} />;
}
