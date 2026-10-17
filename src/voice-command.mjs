/**
 * Shuvi Voice Command Parser
 *
 * Normalizes English, Hindi Devanagari, and Roman-Hindi phrases into bounded intents.
 * Results include locale, intent, risk level, and approval requirement.
 *
 * Unknown or action-like commands fail closed as approval-required proposals.
 */

/** @typedef {{ locale: string, intent: string, risk: 'low'|'medium'|'high', requiresApproval: boolean }} ParseResult */

const ENGLISH_INTENTS = {
  hello: { intent: 'greeting', risk: 'low', requiresApproval: false }, hi: { intent: 'greeting', risk: 'low', requiresApproval: false }, hey: { intent: 'greeting', risk: 'low', requiresApproval: false },
  goodbye: { intent: 'farewell', risk: 'low', requiresApproval: false }, bye: { intent: 'farewell', risk: 'low', requiresApproval: false }, 'see you': { intent: 'farewell', risk: 'low', requiresApproval: false },
  yes: { intent: 'affirm', risk: 'low', requiresApproval: false }, yeah: { intent: 'affirm', risk: 'low', requiresApproval: false }, yep: { intent: 'affirm', risk: 'low', requiresApproval: false }, okay: { intent: 'affirm', risk: 'low', requiresApproval: false }, ok: { intent: 'affirm', risk: 'low', requiresApproval: false }, sure: { intent: 'affirm', risk: 'low', requiresApproval: false },
  no: { intent: 'negate', risk: 'low', requiresApproval: false }, nope: { intent: 'negate', risk: 'low', requiresApproval: false }, nah: { intent: 'negate', risk: 'low', requiresApproval: false }, never: { intent: 'negate', risk: 'low', requiresApproval: false },
  'thank you': { intent: 'thanks', risk: 'low', requiresApproval: false }, thanks: { intent: 'thanks', risk: 'low', requiresApproval: false }, thank: { intent: 'thanks', risk: 'low', requiresApproval: false }, appreciate: { intent: 'thanks', risk: 'low', requiresApproval: false },
  help: { intent: 'help', risk: 'low', requiresApproval: false }, support: { intent: 'help', risk: 'low', requiresApproval: false }, 'what can you do': { intent: 'help', risk: 'low', requiresApproval: false },
  stop: { intent: 'stop', risk: 'low', requiresApproval: false }, cancel: { intent: 'stop', risk: 'low', requiresApproval: false }, abort: { intent: 'stop', risk: 'medium', requiresApproval: false }, quit: { intent: 'stop', risk: 'medium', requiresApproval: true },
  'what time': { intent: 'query_time', risk: 'low', requiresApproval: false }, 'current time': { intent: 'query_time', risk: 'low', requiresApproval: false }, 'what is the time': { intent: 'query_time', risk: 'low', requiresApproval: false }, 'time please': { intent: 'query_time', risk: 'low', requiresApproval: false },
  'what date': { intent: 'query_date', risk: 'low', requiresApproval: false }, 'current date': { intent: 'query_date', risk: 'low', requiresApproval: false }, 'what is the date': { intent: 'query_date', risk: 'low', requiresApproval: false }, 'date please': { intent: 'query_date', risk: 'low', requiresApproval: false },
  weather: { intent: 'query_weather', risk: 'medium', requiresApproval: true }, 'what is the weather': { intent: 'query_weather', risk: 'medium', requiresApproval: true }, 'how is the weather': { intent: 'query_weather', risk: 'medium', requiresApproval: true },
  open: { intent: 'action_open', risk: 'high', requiresApproval: true }, launch: { intent: 'action_open', risk: 'high', requiresApproval: true }, start: { intent: 'action_open', risk: 'high', requiresApproval: true }, run: { intent: 'action_open', risk: 'high', requiresApproval: true }, execute: { intent: 'action_open', risk: 'high', requiresApproval: true },
  close: { intent: 'action_close', risk: 'high', requiresApproval: true }, 'shut down': { intent: 'action_close', risk: 'high', requiresApproval: true }, shutdown: { intent: 'action_close', risk: 'high', requiresApproval: true },
  delete: { intent: 'action_delete', risk: 'high', requiresApproval: true }, remove: { intent: 'action_delete', risk: 'high', requiresApproval: true }, erase: { intent: 'action_delete', risk: 'high', requiresApproval: true }, install: { intent: 'action_install', risk: 'high', requiresApproval: true }, download: { intent: 'action_download', risk: 'high', requiresApproval: true }, update: { intent: 'action_update', risk: 'high', requiresApproval: true }, send: { intent: 'action_send', risk: 'high', requiresApproval: true }, upload: { intent: 'action_upload', risk: 'high', requiresApproval: true }, share: { intent: 'action_share', risk: 'high', requiresApproval: true },
  'create file': { intent: 'action_create_file', risk: 'high', requiresApproval: true }, 'write file': { intent: 'action_create_file', risk: 'high', requiresApproval: true }, 'read file': { intent: 'action_read_file', risk: 'medium', requiresApproval: true }, copy: { intent: 'action_copy', risk: 'medium', requiresApproval: true }, paste: { intent: 'action_paste', risk: 'medium', requiresApproval: true }, move: { intent: 'action_move', risk: 'high', requiresApproval: true },
  reboot: { intent: 'action_reboot', risk: 'high', requiresApproval: true }, restart: { intent: 'action_reboot', risk: 'high', requiresApproval: true }, sleep: { intent: 'action_sleep', risk: 'high', requiresApproval: true }, hibernate: { intent: 'action_sleep', risk: 'high', requiresApproval: true }, connect: { intent: 'action_connect', risk: 'high', requiresApproval: true }, disconnect: { intent: 'action_disconnect', risk: 'high', requiresApproval: true },
};

const HINDI_DEVANAGARI_INTENTS = {
  नमस्ते: { intent: 'greeting', risk: 'low', requiresApproval: false }, नमस्कार: { intent: 'greeting', risk: 'low', requiresApproval: false }, हेलो: { intent: 'greeting', risk: 'low', requiresApproval: false }, हाय: { intent: 'greeting', risk: 'low', requiresApproval: false },
  अलविदा: { intent: 'farewell', risk: 'low', requiresApproval: false }, बाय: { intent: 'farewell', risk: 'low', requiresApproval: false }, 'फिर मिलेंगे': { intent: 'farewell', risk: 'low', requiresApproval: false },
  हाँ: { intent: 'affirm', risk: 'low', requiresApproval: false }, जी: { intent: 'affirm', risk: 'low', requiresApproval: false }, 'ठीक है': { intent: 'affirm', risk: 'low', requiresApproval: false }, 'हाँ जी': { intent: 'affirm', risk: 'low', requiresApproval: false }, नहीं: { intent: 'negate', risk: 'low', requiresApproval: false }, नहੀਂ: { intent: 'negate', risk: 'low', requiresApproval: false }, धन्यवाद: { intent: 'thanks', risk: 'low', requiresApproval: false }, शुक्रिया: { intent: 'thanks', risk: 'low', requiresApproval: false }, मदद: { intent: 'help', risk: 'low', requiresApproval: false }, सहायता: { intent: 'help', risk: 'low', requiresApproval: false },
  'समय क्या है': { intent: 'query_time', risk: 'low', requiresApproval: false }, 'अब क्या समय है': { intent: 'query_time', risk: 'low', requiresApproval: false }, 'तारीख क्या है': { intent: 'query_date', risk: 'low', requiresApproval: false }, 'आज की तारीख': { intent: 'query_date', risk: 'low', requiresApproval: false },
  खोलो: { intent: 'action_open', risk: 'high', requiresApproval: true }, चलाओ: { intent: 'action_open', risk: 'high', requiresApproval: true }, 'शुरू करो': { intent: 'action_open', risk: 'high', requiresApproval: true }, 'बंद करो': { intent: 'action_close', risk: 'high', requiresApproval: true }, बंद: { intent: 'action_close', risk: 'high', requiresApproval: true }, 'डिलीट करो': { intent: 'action_delete', risk: 'high', requiresApproval: true }, मिटाओ: { intent: 'action_delete', risk: 'high', requiresApproval: true }, हटाओ: { intent: 'action_delete', risk: 'high', requiresApproval: true }, डाउनलोड: { intent: 'action_download', risk: 'high', requiresApproval: true }, इंस्टॉल: { intent: 'action_install', risk: 'high', requiresApproval: true },
};

const ROMAN_HINDI_INTENTS = {
  namaste: { intent: 'greeting', risk: 'low', requiresApproval: false }, namaskar: { intent: 'greeting', risk: 'low', requiresApproval: false }, hello: { intent: 'greeting', risk: 'low', requiresApproval: false }, hi: { intent: 'greeting', risk: 'low', requiresApproval: false }, alvida: { intent: 'farewell', risk: 'low', requiresApproval: false }, bye: { intent: 'farewell', risk: 'low', requiresApproval: false }, 'phir milenge': { intent: 'farewell', risk: 'low', requiresApproval: false }, haan: { intent: 'affirm', risk: 'low', requiresApproval: false }, ji: { intent: 'affirm', risk: 'low', requiresApproval: false }, 'theek hai': { intent: 'affirm', risk: 'low', requiresApproval: false }, 'haan ji': { intent: 'affirm', risk: 'low', requiresApproval: false }, bilkul: { intent: 'affirm', risk: 'low', requiresApproval: false }, nahi: { intent: 'negate', risk: 'low', requiresApproval: false }, nahin: { intent: 'negate', risk: 'low', requiresApproval: false }, dhanyavaad: { intent: 'thanks', risk: 'low', requiresApproval: false }, shukriya: { intent: 'thanks', risk: 'low', requiresApproval: false }, 'thank you': { intent: 'thanks', risk: 'low', requiresApproval: false }, madad: { intent: 'help', risk: 'low', requiresApproval: false }, sahayata: { intent: 'help', risk: 'low', requiresApproval: false }, 'samay kya hai': { intent: 'query_time', risk: 'low', requiresApproval: false }, 'ab ka samay': { intent: 'query_time', risk: 'low', requiresApproval: false }, 'time kya hai': { intent: 'query_time', risk: 'low', requiresApproval: false }, 'tareekh kya hai': { intent: 'query_date', risk: 'low', requiresApproval: false }, 'aaj ki tareekh': { intent: 'query_date', risk: 'low', requiresApproval: false }, kholo: { intent: 'action_open', risk: 'high', requiresApproval: true }, chalao: { intent: 'action_open', risk: 'high', requiresApproval: true }, 'shuru karo': { intent: 'action_open', risk: 'high', requiresApproval: true }, 'open karo': { intent: 'action_open', risk: 'high', requiresApproval: true }, 'band karo': { intent: 'action_close', risk: 'high', requiresApproval: true }, band: { intent: 'action_close', risk: 'high', requiresApproval: true }, 'close karo': { intent: 'action_close', risk: 'high', requiresApproval: true }, 'delete karo': { intent: 'action_delete', risk: 'high', requiresApproval: true }, mitao: { intent: 'action_delete', risk: 'high', requiresApproval: true }, hatao: { intent: 'action_delete', risk: 'high', requiresApproval: true }, 'download karo': { intent: 'action_download', risk: 'high', requiresApproval: true }, 'install karo': { intent: 'action_install', risk: 'high', requiresApproval: true },
};

function detectLocale(text) {
  const normalized = text.toLowerCase().trim();
  if (/[ऀ-ॿ]/.test(normalized)) return 'hi';
  const keywords = ['haan', 'nahi', 'namaste', 'namaskar', 'alvida', 'dhanyavaad', 'shukriya', 'madad', 'sahayata', 'theek', 'ji', 'kya', 'hai', 'kar', 'kholo', 'chalao', 'band', 'mitao', 'hatao', 'phir', 'milenge', 'samay', 'tareekh', 'ab', 'aaj', 'maine', 'tum', 'hum'];
  return keywords.some((keyword) => normalized.includes(keyword)) ? 'hi-roman' : 'en';
}

function normalizeText(text) { return text.toLowerCase().trim().replace(/[.,?!;:]/g, '').replace(/\s+/g, ' '); }

function lookupIntent(normalizedText, locale) {
  const map = locale === 'hi' ? HINDI_DEVANAGARI_INTENTS : locale === 'hi-roman' ? ROMAN_HINDI_INTENTS : ENGLISH_INTENTS;
  if (map[normalizedText]) return map[normalizedText];
  const match = Object.entries(map).sort(([a], [b]) => b.length - a.length).find(([key]) => normalizedText === key || normalizedText.startsWith(`${key} `) || normalizedText.endsWith(` ${key}`) || normalizedText.includes(` ${key} `));
  return match?.[1] ?? null;
}

function assessRisk(intent, text) {
  const normalizedText = normalizeText(text);
  if (/(delete|remove|erase|format|wipe|clear)[\s-]*(all|everything|data|files|disk|drive)|(?:shut[\s-]*)?down|reboot|restart[\s-]*computer|install[\s-]*(malware|virus|hack|exploit)|download[\s-]*(malware|virus|hack|exploit|illegal|pirated)|execute[\s-]*(script|code|command|program)|run[\s-]*(as[\s-]*admin|administrator|sudo|root)|(open|launch)[\s-]*(cmd|command[\s-]*prompt|powershell|terminal|bash|shell)|disable[\s-]*(firewall|antivirus|security|protection)/i.test(normalizedText)) return 'high';
  if (/(open|launch|start)[\s-]*(app|application|program|software)|(close|quit|exit)[\s-]*(app|application|program)|(read|write|modify|edit|change)[\s-]*(file|document|text)|copy[\s-]*(file|data|text)|move[\s-]*(file|folder|directory)|(upload|download|share|send)[\s-]*(file|data|information)|connect[\s-]*(to|network|wifi|internet)|disconnect[\s-]*(from|network|wifi|internet)/i.test(normalizedText)) return 'medium';
  return intent.startsWith('action_') ? 'high' : 'low';
}

/** @param {string} text @returns {ParseResult} */
function parseCommand(text) {
  const normalizedText = normalizeText(text);
  const locale = detectLocale(text);
  const entry = lookupIntent(normalizedText, locale);
  const intent = entry?.intent ?? 'unknown';
  const risk = entry?.risk ?? assessRisk(intent, text);
  return { locale, intent, risk, requiresApproval: risk === 'high' || !entry || Boolean(entry.requiresApproval) };
}

export { parseCommand, detectLocale, normalizeText, lookupIntent, assessRisk, ENGLISH_INTENTS, HINDI_DEVANAGARI_INTENTS, ROMAN_HINDI_INTENTS };
