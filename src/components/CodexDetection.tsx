import { useEffect, useState } from 'react';
import { api } from '../api';

export function CodexDetection({ manualPath, useAutomatic }: { manualPath: string; useAutomatic: () => void }) {
  const [path, setPath] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(true), [search, setSearch] = useState(0);
  useEffect(() => {
    let active = true;
    setBusy(true); setError('');
    api('openai/detect', {}).then(result => { if (active) setPath(result.path); }).catch(e => { if (active) { setPath(''); setError(e.message); } }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [search]);
  return <div>
    <p role="status">{busy ? 'Поиск Codex CLI…' : path ? <>{manualPath ? 'Автоопределение доступно: ' : 'Автоматически найден: '}<code>{path}</code></> : error}</p>
    <button disabled={busy} onClick={() => { useAutomatic(); setSearch(value => value + 1); }}>{manualPath ? 'Использовать автоопределение' : 'Повторить поиск Codex'}</button>
    {!manualPath && path && <p className="muted">Поле пути можно оставить пустым: найденный Codex будет использован автоматически.</p>}
  </div>;
}
