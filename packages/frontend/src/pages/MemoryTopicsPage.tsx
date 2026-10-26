import { Link } from 'react-router-dom';
import { MemoryTopics } from '@/components/assistant/MemoryTopics';
export function MemoryTopicsPage() {
  return (
    <main className="h-full overflow-auto p-4 sm:p-8">
      <div className="mx-auto max-w-5xl space-y-5">
        <Link className="text-sm underline" to="/chat/personalization?view=memory">
          Zurück zum Gedächtnis
        </Link>
        <MemoryTopics />
      </div>
    </main>
  );
}
