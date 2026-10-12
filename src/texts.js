// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the "Test the connection" report, scene action
// errors. Four languages, the four of the Gladys interface; German says "du",
// Spanish "usted". test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './pihole/client.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noServer: {
    en: 'Enter the address of your Pi-hole in the configuration.',
    fr: "Saisissez l'adresse de votre Pi-hole dans la configuration.",
    de: 'Gib die Adresse deines Pi-hole in der Konfiguration ein.',
    es: 'Introduzca la dirección de su Pi-hole en la configuración.',
  },
  invalidUrl: {
    en: 'Address not understood, e.g. http://192.168.1.2',
    fr: 'Adresse incomprise, ex. http://192.168.1.2',
    de: 'Adresse nicht verstanden, z. B. http://192.168.1.2',
    es: 'Dirección no válida, p. ej. http://192.168.1.2',
  },
};

// One short explanation per error kind (src/pihole/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'does not answer',
    fr: 'ne répond pas',
    de: 'antwortet nicht',
    es: 'no responde',
  },
  [ERROR_KINDS.TLS]: {
    en: 'certificate refused: tick "Accept self-signed certificates"',
    fr: 'certificat refusé : cochez « Accepter les certificats auto-signés »',
    de: 'Zertifikat abgelehnt: Aktiviere „Selbstsignierte Zertifikate akzeptieren“',
    es: 'certificado rechazado: marque «Aceptar certificados autofirmados»',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'password refused',
    fr: 'mot de passe refusé',
    de: 'Passwort abgelehnt',
    es: 'contraseña rechazada',
  },
  [ERROR_KINDS.TOTP]: {
    en: 'two-factor authentication is on: use an app password',
    fr: "double authentification active : utilisez un mot de passe d'application",
    de: 'Zwei-Faktor-Authentifizierung aktiv: Verwende ein App-Passwort',
    es: 'la autenticación de dos factores está activa: use una contraseña de aplicación',
  },
  [ERROR_KINDS.SEATS]: {
    en: 'no free API session on the Pi-hole',
    fr: "plus de session d'API libre sur le Pi-hole",
    de: 'keine freie API-Sitzung auf dem Pi-hole',
    es: 'no queda ninguna sesión de API libre en el Pi-hole',
  },
  [ERROR_KINDS.RATE_LIMIT]: {
    en: 'too many login attempts, retrying later',
    fr: 'trop de tentatives de connexion, nouvel essai plus tard',
    de: 'zu viele Anmeldeversuche, neuer Versuch später',
    es: 'demasiados intentos de inicio de sesión, se reintentará más tarde',
  },
  [ERROR_KINDS.V5]: {
    en: 'Pi-hole v5 is not supported: update to Pi-hole v6',
    fr: "Pi-hole v5 n'est pas pris en charge : passez à Pi-hole v6",
    de: 'Pi-hole v5 wird nicht unterstützt: Aktualisiere auf Pi-hole v6',
    es: 'Pi-hole v5 no es compatible: actualice a Pi-hole v6',
  },
  [ERROR_KINDS.NOT_PIHOLE]: {
    en: 'no Pi-hole v6 at this address',
    fr: 'aucun Pi-hole v6 à cette adresse',
    de: 'kein Pi-hole v6 unter dieser Adresse',
    es: 'no hay ningún Pi-hole v6 en esta dirección',
  },
  [ERROR_KINDS.REDIRECT]: {
    en: 'the address redirects: enter the https:// address',
    fr: "l'adresse redirige : saisissez l'adresse en https://",
    de: 'die Adresse leitet um: Gib die https://-Adresse ein',
    es: 'la dirección redirige: introduzca la dirección https://',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer, see the logs',
    fr: 'réponse inattendue, voir les logs',
    de: 'unerwartete Antwort, sieh in den Protokollen nach',
    es: 'respuesta inesperada, consulte los registros',
  },
};

// The "Test the connection" report, one line per server.
export const REPORT_TEXT = {
  en: {
    ok: 'OK',
    on: 'blocking on',
    off: 'blocking off',
    paused: (minutes) => `paused, ${minutes} min left`,
    updates: (count) => `${count} update(s) available`,
  },
  fr: {
    ok: 'OK',
    on: 'blocage actif',
    off: 'blocage désactivé',
    paused: (minutes) => `en pause, encore ${minutes} min`,
    updates: (count) => `${count} mise(s) à jour disponible(s)`,
  },
  de: {
    ok: 'OK',
    on: 'Blockierung aktiv',
    off: 'Blockierung aus',
    paused: (minutes) => `pausiert, noch ${minutes} min`,
    updates: (count) => `${count} Update(s) verfügbar`,
  },
  es: {
    ok: 'OK',
    on: 'bloqueo activo',
    off: 'bloqueo desactivado',
    paused: (minutes) => `en pausa, quedan ${minutes} min`,
    updates: (count) => `${count} actualización(es) disponible(s)`,
  },
};

// Errors of the scene actions and widget buttons (shown in Gladys).
export const ACTION_TEXT = {
  noServer: {
    en: 'No Pi-hole is configured.',
    fr: "Aucun Pi-hole n'est configuré.",
    de: 'Kein Pi-hole ist konfiguriert.',
    es: 'No hay ningún Pi-hole configurado.',
  },
  unknownServer: {
    en: 'This Pi-hole is no longer in the configuration.',
    fr: "Ce Pi-hole n'est plus dans la configuration.",
    de: 'Dieses Pi-hole ist nicht mehr in der Konfiguration.',
    es: 'Este Pi-hole ya no está en la configuración.',
  },
  failed: {
    en: 'No Pi-hole accepted the command.',
    fr: "Aucun Pi-hole n'a accepté la commande.",
    de: 'Kein Pi-hole hat den Befehl angenommen.',
    es: 'Ningún Pi-hole ha aceptado la orden.',
  },
};

export const LANGUAGE_FALLBACK = 'en';

/** "Name: text", with the space French puts before a colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;
export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];
