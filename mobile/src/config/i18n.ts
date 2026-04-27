import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '@shared/locales/en/common.json';
import es from '@shared/locales/es/common.json';
import fr from '@shared/locales/fr/common.json';
import sw from '@shared/locales/sw/common.json';
import ar from '@shared/locales/ar/common.json';
import pt from '@shared/locales/pt/common.json';
import zh from '@shared/locales/zh/common.json';

const resources = {
  en: { common: en },
  es: { common: es },
  fr: { common: fr },
  sw: { common: sw },
  ar: { common: ar },
  pt: { common: pt },
  zh: { common: zh },
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    defaultNS: 'common',
    interpolation: {
      escapeValue: false,
    },
    lng: 'en',
    fallbackLng: 'en',
    react: {
      useSuspense: false,
    },
  });

export default i18n;
