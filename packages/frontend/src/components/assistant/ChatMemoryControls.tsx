export function ChatMemoryControls({
  read,
  learn,
  onRead,
  onLearn,
  disabled = false,
}: {
  read: boolean;
  learn: boolean;
  onRead: (enabled: boolean) => void;
  onLearn: (enabled: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="grid gap-3" disabled={disabled}>
      <legend className="mb-2 text-sm font-medium">Gedächtnis für dieses Gespräch</legend>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={read} onChange={(event) => onRead(event.target.checked)} />
        Frühere Erinnerungen und Chats verwenden
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={learn}
          onChange={(event) => onLearn(event.target.checked)}
        />
        Aus diesem Gespräch lernen
      </label>
    </fieldset>
  );
}
