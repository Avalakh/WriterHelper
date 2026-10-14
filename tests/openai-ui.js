import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { Store } from '../server/store.js';
import { makeServer } from '../server/index.js';

fs.mkdirSync('test-data', { recursive: true });
const directory = fs.mkdtempSync(path.resolve('test-data/openai-ui-')), store = new Store(directory);
let signedIn = false, login = null;
const openai = {
  async status() { return { signedIn, account: signedIn ? { email: 'writer@example.test', planType: 'plus' } : null, login }; },
  async login() { return login = { state: 'pending', loginId: 'ui-login', verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'TEST-1234' }; },
  async cancel() { login = null; return { cancelled: true }; },
  async logout() { signedIn = false; login = null; return { signedIn }; },
  async models() { return ['test-generation', 'test-review']; },
  close() {},
};
const server = makeServer(store, { openai, mockProvider: async () => 'Готово' });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } }); const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('button', { name: 'Разделы приложения', exact: true }).click();
  await page.getByRole('dialog', { name: 'Разделы приложения' }).getByRole('button', { name: 'Настройки ИИ', exact: true }).click();
  await page.getByLabel('Тип', { exact: true }).selectOption('openai');
  await page.getByLabel('Название подключения').fill('OpenAI');
  await expect(page.getByRole('status').filter({ hasText: 'Автоматически найден:' })).toContainText('codex.exe');
  await expect(page.getByLabel('Путь к Codex CLI (необязательно)')).toHaveValue('');
  await page.getByLabel('Путь к Codex CLI (необязательно)').fill('C:\\manual\\codex.exe');
  await page.getByRole('button', { name: 'Использовать автоопределение', exact: true }).click();
  await expect(page.getByLabel('Путь к Codex CLI (необязательно)')).toHaveValue('');
  await expect(page.getByLabel('Ключ доступа (необязательно)')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Войти по коду устройства' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Сохранить подключение', exact: true }).click();
  await page.getByRole('button', { name: 'Войти по коду устройства', exact: true }).click();
  await expect(page.getByLabel('Код устройства')).toHaveText('TEST-1234');
  await expect(page.getByRole('link', { name: 'Открыть страницу входа OpenAI' })).toHaveAttribute('href', 'https://auth.openai.com/codex/device');
  await page.getByRole('button', { name: 'Отменить вход', exact: true }).click();
  await expect(page.getByLabel('Код устройства')).toHaveCount(0);
  await page.getByRole('button', { name: 'Войти по коду устройства', exact: true }).click();
  await expect(page.getByLabel('Код устройства')).toHaveText('TEST-1234');
  login = { state: 'failed', error: 'Код истёк. Запросите новый код.' };
  await expect(page.getByRole('alert').filter({ hasText: 'Код истёк' })).toBeVisible({ timeout: 8000 });
  await page.getByRole('button', { name: 'Войти по коду устройства', exact: true }).click();
  await expect(page.getByLabel('Код устройства')).toHaveText('TEST-1234');
  signedIn = true; login = { state: 'completed' };
  await expect(page.getByRole('button', { name: 'Выйти из OpenAI' })).toBeVisible({ timeout: 8000 });
  await page.getByRole('button', { name: 'Получить модели', exact: true }).click();
  await page.getByLabel('Модель генерации',{exact:true}).selectOption('test-generation');
  await page.getByLabel('Модель проверки (пусто — та же)',{exact:true}).selectOption('test-review');
  await page.getByRole('button', { name: 'Сохранить подключение', exact: true }).click();
  await expect.poll(() => store.all('connection')[0].model).toBe('test-generation');
  await page.getByRole('button', { name: 'Проверить подключение', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Готово$/ })).toBeVisible();
  await page.getByRole('button', { name: 'Выйти из OpenAI', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Войти по коду устройства' })).toBeVisible();
  assert.ok(!JSON.stringify(store.all()).includes('TEST-1234'));
  assert.deepEqual(errors, []);
  console.log('PASS OpenAI UI: onboarding without a model, device code and link, cancel, expired code, completion polling, model selection, connection test, logout; mocked authentication and inference');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); store.close(); }
