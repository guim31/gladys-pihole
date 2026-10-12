// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `pihole`.
//
// The use case: "the bank website does not load" → pause the ad blocking for
// five minutes from the wall tablet. So the widget shows the state of the
// blocking and the day's figures, and offers direct buttons: Pause 5 min,
// Pause 30 min, Pause… (a duration typed in a form) and Resume.
//
// Every server by default (pausing one Pi-hole of two changes nothing: the
// clients ask the other one), or the one chosen in the widget settings.
//
// Budget (8 components, 6 tiles, 1 status, 4 buttons): three tiles (queries,
// blocked, share blocked over the last 24 hours), one status list (blocking
// per server, clients, blocklist, updates) and four buttons. The figures are
// sent as values, not bound to device features, so the widget works before
// the devices are added to Gladys and sums several servers.
//
// The "Pause…" form (widget action fields, GladysAssistant/Gladys#3168)
// needs Gladys 5.2.0: an older Gladys sends the tap without the duration,
// answered by a message asking to update Gladys.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { serverName } from './devices.js';
import { DEFAULT_PAUSE_MINUTES, MAX_PAUSE_MINUTES, WIDGET_KEY, parseMinutes } from './hub.js';
import { ERROR_KINDS } from './pihole/client.js';
import { pick } from './texts.js';

// Action keys of the buttons: permanent once published (unique, the core
// drops a button whose key is taken).
export const ACTIONS = Object.freeze({
  PAUSE_SHORT: 'pause_5',
  PAUSE_LONG: 'pause_30',
  PAUSE_CUSTOM: 'pause_custom',
  RESUME: 'resume',
});
export const SHORT_PAUSE_MINUTES = 5;
export const LONG_PAUSE_MINUTES = 30;
export const CUSTOM_PAUSE_DEFAULT_MINUTES = 60;

const ACTIVE_ICON = 'check-circle';

export const TEXT = {
  pick: {
    en: 'Enter the address of your Pi-hole in the configuration of the integration.',
    fr: "Saisissez l'adresse de votre Pi-hole dans la configuration de l'intégration.",
    de: 'Gib die Adresse deines Pi-hole in der Konfiguration der Integration ein.',
    es: 'Introduzca la dirección de su Pi-hole en la configuración de la integración.',
  },
  unknown: {
    en: 'This Pi-hole is no longer in the configuration: choose another one in the widget settings.',
    fr: "Ce Pi-hole n'est plus dans la configuration : choisissez-en un autre dans les réglages du widget.",
    de: 'Dieses Pi-hole ist nicht mehr in der Konfiguration: Wähle ein anderes in den Widget-Einstellungen.',
    es: 'Este Pi-hole ya no está en la configuración: elija otro en la configuración del widget.',
  },
  noAnswer: {
    en: 'No Pi-hole answers: see the Configuration screen of the integration.',
    fr: "Aucun Pi-hole ne répond : voir l'écran Configuration de l'intégration.",
    de: 'Kein Pi-hole antwortet: Sieh dir die Konfiguration der Integration an.',
    es: 'Ningún Pi-hole responde: consulte la pantalla de configuración de la integración.',
  },
  updateGladys: {
    en: 'Update Gladys to 5.2.0 or later to choose the duration of a pause.',
    fr: 'Mettez Gladys à jour (5.2.0 ou plus) pour choisir la durée de la pause.',
    de: 'Aktualisiere Gladys auf 5.2.0 oder neuer, um die Dauer der Pause zu wählen.',
    es: 'Actualice Gladys a la versión 5.2.0 o posterior para elegir la duración de la pausa.',
  },
  queries: { en: 'Queries 24 h', fr: 'Requêtes 24 h', de: 'Anfragen 24 h', es: 'Consultas 24 h' },
  blocked: { en: 'Blocked 24 h', fr: 'Bloquées 24 h', de: 'Blockiert 24 h', es: 'Bloqueadas 24 h' },
  share: { en: 'Share blocked', fr: 'Part bloquée', de: 'Anteil blockiert', es: 'Proporción' },
  clients: {
    en: 'Active clients',
    fr: 'Clients actifs',
    de: 'Aktive Clients',
    es: 'Clientes activos',
  },
  domains: {
    en: 'Domains on blocklists',
    fr: 'Domaines bloqués',
    de: 'Domains auf Sperrlisten',
    es: 'Dominios bloqueados',
  },
  update: {
    en: 'Update available',
    fr: 'Mise à jour disponible',
    de: 'Update verfügbar',
    es: 'Actualización disponible',
  },
  enabled: { en: 'Blocking', fr: 'Blocage actif', de: 'Blockiert', es: 'Bloqueo activo' },
  disabled: { en: 'Disabled', fr: 'Désactivé', de: 'Deaktiviert', es: 'Desactivado' },
  paused: { en: 'Paused', fr: 'En pause', de: 'Pausiert', es: 'En pausa' },
  unreachable: {
    en: 'Unreachable',
    fr: 'Injoignable',
    de: 'Nicht erreichbar',
    es: 'Inaccesible',
  },
  error: { en: 'Error', fr: 'Erreur', de: 'Fehler', es: 'Error' },
  waiting: { en: 'Waiting…', fr: 'En attente…', de: 'Warte…', es: 'Esperando…' },
  pauseShort: { en: 'Pause 5 min', fr: 'Pause 5 min', de: 'Pause 5 min', es: 'Pausa 5 min' },
  pauseLong: { en: 'Pause 30 min', fr: 'Pause 30 min', de: 'Pause 30 min', es: 'Pausa 30 min' },
  pauseCustom: { en: 'Pause…', fr: 'Pause…', de: 'Pause…', es: 'Pausa…' },
  resume: { en: 'Resume', fr: 'Réactiver', de: 'Fortsetzen', es: 'Reactivar' },
  minutes: {
    en: 'Duration (minutes)',
    fr: 'Durée (minutes)',
    de: 'Dauer (Minuten)',
    es: 'Duración (minutos)',
  },
};

// Toasts after a tap (≤ 200 characters).
export const DONE_TEXT = {
  en: {
    paused: (minutes, count) => `Blocking paused for ${minutes} min on ${count} Pi-hole(s).`,
    resumed: (count) => `Blocking resumed on ${count} Pi-hole(s).`,
  },
  fr: {
    paused: (minutes, count) => `Blocage en pause pour ${minutes} min sur ${count} Pi-hole.`,
    resumed: (count) => `Blocage réactivé sur ${count} Pi-hole.`,
  },
  de: {
    paused: (minutes, count) => `Blockierung für ${minutes} min auf ${count} Pi-hole pausiert.`,
    resumed: (count) => `Blockierung auf ${count} Pi-hole fortgesetzt.`,
  },
  es: {
    paused: (minutes, count) => `Bloqueo en pausa durante ${minutes} min en ${count} Pi-hole.`,
    resumed: (count) => `Bloqueo reactivado en ${count} Pi-hole.`,
  },
};

const t = (text, language) => pick(text, language);
const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: t(text, language) }],
  };
}

/** The status row of one server: its blocking state. */
function serverRow(record, language) {
  const label = fit(serverName(record.server), 40);
  if (record.error) {
    const unreachable = record.error.kind === ERROR_KINDS.UNREACHABLE;
    return {
      label,
      icon: 'alert-triangle',
      value: t(unreachable ? TEXT.unreachable : TEXT.error, language),
      color: WIDGET_COLORS.DANGER,
    };
  }
  const { blocking, timer } = record.snapshot;
  if (blocking === 'enabled') {
    return {
      label,
      icon: 'shield',
      value: t(TEXT.enabled, language),
      color: WIDGET_COLORS.SUCCESS,
    };
  }
  if (blocking === 'disabled') {
    return {
      label,
      icon: 'shield-off',
      value: timer
        ? `${t(TEXT.paused, language)} · ${Math.ceil(timer / 60)} min`
        : t(TEXT.disabled, language),
      color: WIDGET_COLORS.WARNING,
    };
  }
  return { label, icon: 'clock', value: t(TEXT.waiting, language), color: WIDGET_COLORS.NEUTRAL };
}

/** Sum of the servers that answered; the share is recomputed from the sums. */
export function totals(records) {
  const summaries = records
    .filter((record) => !record.error && record.snapshot.summary)
    .map((record) => record.snapshot.summary);
  if (summaries.length === 0) {
    return null;
  }
  const sum = (key) => summaries.reduce((total, summary) => total + (summary[key] ?? 0), 0);
  const queries = sum('queries');
  const blocked = sum('blocked');
  return {
    queries,
    blocked,
    percentBlocked:
      summaries.length === 1
        ? (summaries[0].percentBlocked ?? 0)
        : queries > 0
          ? (100 * blocked) / queries
          : 0,
    activeClients: sum('activeClients'),
    // The servers of a pair usually share their lists (Nebula Sync…): the
    // largest list, not the sum.
    domainsBlocked: Math.max(...summaries.map((summary) => summary.domainsBlocked ?? 0)),
  };
}

export function buttons(records, language) {
  const allEnabled = records.length > 0 && records.every((r) => r.snapshot.blocking === 'enabled');
  return [
    {
      type: 'button',
      label: t(TEXT.pauseShort, language),
      icon: 'pause',
      style: 'secondary',
      action: { key: ACTIONS.PAUSE_SHORT, params: { minutes: SHORT_PAUSE_MINUTES } },
    },
    {
      type: 'button',
      label: t(TEXT.pauseLong, language),
      icon: 'pause',
      style: 'secondary',
      action: { key: ACTIONS.PAUSE_LONG, params: { minutes: LONG_PAUSE_MINUTES } },
    },
    {
      type: 'button',
      label: t(TEXT.pauseCustom, language),
      icon: 'clock',
      style: 'secondary',
      action: {
        key: ACTIONS.PAUSE_CUSTOM,
        fields: [
          {
            key: 'minutes',
            type: 'number',
            required: true,
            min: 1,
            max: MAX_PAUSE_MINUTES,
            default: CUSTOM_PAUSE_DEFAULT_MINUTES,
            label: TEXT.minutes,
          },
        ],
      },
    },
    {
      type: 'button',
      label: t(TEXT.resume, language),
      // Blocking on everywhere: the check mark says so (never the style:
      // `primary` is invisible in dark mode).
      icon: allEnabled ? ACTIVE_ICON : 'play',
      style: 'secondary',
      action: { key: ACTIONS.RESUME },
    },
  ];
}

async function get(hub, { settings, language = 'en' }) {
  if (hub.records.size === 0) {
    return message(TEXT.pick, language);
  }
  const records = hub.view(settings?.device);
  if (records.length === 0) {
    return message(TEXT.unknown, language);
  }
  const sums = totals(records);
  const paused = records.some((record) => record.snapshot.blocking === 'disabled');
  const components = [];
  if (sums) {
    components.push(
      { type: 'value', value: sums.queries, label: t(TEXT.queries, language), icon: 'activity' },
      {
        type: 'value',
        value: sums.blocked,
        label: t(TEXT.blocked, language),
        icon: 'slash',
        color: WIDGET_COLORS.PRIMARY,
      },
      {
        type: 'value',
        value: Math.round(sums.percentBlocked * 10) / 10,
        unit: '%',
        label: t(TEXT.share, language),
        icon: 'pie-chart',
      },
    );
  } else {
    components.push({ type: 'text', variant: 'body', text: t(TEXT.noAnswer, language) });
  }

  const items = records.slice(0, 3).map((record) => serverRow(record, language));
  if (sums) {
    items.push(
      {
        label: t(TEXT.clients, language),
        icon: 'users',
        value: sums.activeClients,
        color: WIDGET_COLORS.NEUTRAL,
      },
      {
        label: t(TEXT.domains, language),
        icon: 'list',
        value: sums.domainsBlocked,
        color: WIDGET_COLORS.NEUTRAL,
      },
    );
  }
  for (const record of records) {
    const updates = record.error ? [] : (record.snapshot.versions?.updates ?? []);
    if (updates.length > 0) {
      items.push({
        label: fit(
          records.length > 1
            ? `${t(TEXT.update, language)} · ${serverName(record.server)}`
            : t(TEXT.update, language),
          40,
        ),
        icon: 'download',
        value: fit(updates.map(({ name, remote }) => `${name} ${remote}`).join(', '), 40),
        color: WIDGET_COLORS.WARNING,
      });
    }
  }
  components.push({ type: 'status', items: items.slice(0, 10) });
  components.push(...buttons(records, language));
  // A pause counts down: refresh sooner.
  return { ttl_seconds: paused ? 30 : 60, components };
}

async function action(hub, { actionKey, params = {}, settings, values }) {
  const device = settings?.device || null;
  const language = hub.config?.language ?? 'en';
  const done = (render) =>
    Object.fromEntries(Object.entries(DONE_TEXT).map(([lang, text]) => [lang, render(text)]));

  if (actionKey === ACTIONS.RESUME) {
    const count = await hub.resume(device);
    return { message: done((text) => text.resumed(count)) };
  }
  let minutes;
  if (actionKey === ACTIONS.PAUSE_SHORT || actionKey === ACTIONS.PAUSE_LONG) {
    minutes = parseMinutes(params.minutes, DEFAULT_PAUSE_MINUTES);
  } else if (actionKey === ACTIONS.PAUSE_CUSTOM) {
    if (!values || values.minutes === undefined || values.minutes === null) {
      // A Gladys older than 5.2.0 relays the tap without the form.
      throw new Error(t(TEXT.updateGladys, language));
    }
    minutes = Math.max(1, parseMinutes(values.minutes, CUSTOM_PAUSE_DEFAULT_MINUTES));
  } else {
    throw new Error(`Unknown action ${actionKey}`);
  }
  const count = await hub.pause(device, minutes);
  return { message: done((text) => text.paused(minutes, count)) };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
