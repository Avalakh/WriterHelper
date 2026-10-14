import { useEffect, useState } from 'react';
import { api } from '../api';

export function OpenAISignIn({ id, saved, onSignedIn }: { id?: string; saved: boolean; onSignedIn?:()=>void }) {
  const [state, setState] = useState<any>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(()=>{if(state?.signedIn)onSignedIn?.();},[state?.signedIn]);
  useEffect(() => {
    if (!id || !saved) return;
    let active = true, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const value = await api('openai/status', { id });
        if (!active) return;
        setState(value); setError('');
        if (value.login?.state === 'pending') timer = setTimeout(poll, 2000);
      } catch (e) { if (active) setError((e as Error).message); }
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [id, saved, refresh]);
  async function action(operation: string) {
    setBusy(true); setError('');
    try {
      const result = await api(`openai/${operation}`, { id });
      if (operation === 'login') setState({ signedIn: false, login: result });
      else setState(null);
      setRefresh(value => value + 1);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  if (!id || !saved) return <p>Сохраните подключение, затем войдите в OpenAI по коду устройства. Модель можно выбрать после входа.</p>;
  const login = state?.login;
  return <section aria-label="Вход в OpenAI">
    <p role="status">{state?.signedIn ? `OpenAI подключён${state.account?.email ? ': ' + state.account.email : ''}${state.account?.planType ? ' · ' + state.account.planType : ''}` : login?.state === 'pending' ? 'Ожидается подтверждение входа в браузере…' : 'Вход в OpenAI не выполнен'}</p>
    {login?.state === 'pending' && <><p>Откройте страницу OpenAI и введите одноразовый код:</p><p><strong aria-label="Код устройства">{login.userCode}</strong></p><a href={login.verificationUrl} target="_blank" rel="noreferrer">Открыть страницу входа OpenAI</a><p className="muted">В настройках безопасности ChatGPT должен быть разрешён вход по коду устройства.</p></>}
    {(error || login?.error) && <p role="alert">{error || login.error}</p>}
    <div className="toolbar">
      {state?.signedIn ? <button disabled={busy} onClick={() => void action('logout')}>Выйти из OpenAI</button> : login?.state === 'pending' ? <button disabled={busy} onClick={() => void action('cancel')}>Отменить вход</button> : <button disabled={busy} onClick={() => void action('login')}>Войти по коду устройства</button>}
      <button disabled={busy} onClick={() => setRefresh(value => value + 1)}>Обновить статус входа</button>
    </div>
  </section>;
}
