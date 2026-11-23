// Ponto de entrada do cliente: primeiro o dicionário do idioma ativo (só ele vai para o navegador), depois o app
// (client/src/app.ts), porque vários módulos chamam tr() ao carregar. Se o dicionário não carregar, fica em português.
import { getLocale, registerDictionary, type Locale } from '../../shared/i18n';

const LOADERS: Partial<Record<Locale, () => Promise<Readonly<Record<string, string>>>>> = {
  'zh-CN': () => import('../../shared/locales/zh').then((m) => m.ZH_CN),
  en: () => import('../../shared/locales/en').then((m) => m.EN),
  es: () => import('../../shared/locales/es').then((m) => m.ES),
  fr: () => import('../../shared/locales/fr').then((m) => m.FR),
};

const locale = getLocale();
const loadEn = import('../../shared/locales/en').then((m) => registerDictionary('en', m.EN)).catch(() => undefined);
const load = LOADERS[locale];
const loadActive = load ? load().then((d) => registerDictionary(locale, d)).catch(() => undefined) : Promise.resolve();
void Promise.all([loadEn, loadActive]).then(() => import('./app')).then((app) => app.start());
