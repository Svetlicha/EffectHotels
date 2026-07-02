// Google Apps Script за "Дневник проверки"
// Версия v24 — Login credentials set + Google Drive JSON + ResCheck + Auto Save + Backup до 5 копия
//
// ВАЖНО:
// 1) Постави този код в Google Apps Script проекта, който дава /exec линка.
// 2) Задай потребител и парола без да ги показваш в HTML:
//    Project Settings > Script properties:
//    RESCHECK_USERNAME = твоето потребителско име
//    RESCHECK_PASSWORD = твоята парола
//    Алтернатива: попълни AUTH_USERNAME и AUTH_PASSWORD по-долу, преди Deploy.
// 3) След поставяне: Deploy > Manage deployments > Edit > New version > Deploy.
// 4) Web app настройките трябва да са:
//    Execute as: Me
//    Who has access: Anyone

// Ако не искаш Script Properties, можеш да попълниш стойности тук.
// Не ги показвай в HTML файла.
const AUTH_USERNAME = 'Svetlicha';
const AUTH_PASSWORD = 'svetliN88';

// Ако имаш повече от една папка ResCheck или папката е в Shared Drive,
// можеш да поставиш ID на точната папка тук между кавичките:
const FOLDER_ID = '';

const FOLDER_NAME = 'ResCheck';
const FILE_NAME = 'reservation_checks_drive_data.json';
const BACKUP_PREFIX = 'reservation_checks_drive_data_Backup_';
const BACKUP_LIMIT = 5;
const FOLDER_ID_PROPERTY = 'RESCHECK_FOLDER_ID';
const USERNAME_PROPERTY = 'RESCHECK_USERNAME';
const PASSWORD_PROPERTY = 'RESCHECK_PASSWORD';
const SESSION_PREFIX = 'RESCHECK_SESSION_';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || 'load';

    if (action === 'ping') {
      return json_({ ok: true, message: 'pong', time: new Date().toISOString() });
    }

    if (action === 'info') {
      requireAuth_((e.parameter && e.parameter.token) || '');
      return json_({ ok: true, storage: getStorageInfo_(), time: new Date().toISOString() });
    }

    requireAuth_((e.parameter && e.parameter.token) || '');
    return json_({ ok: true, data: readData_(), storage: getStorageInfo_(), time: new Date().toISOString() });
  } catch (err) {
    return json_({ ok: false, error: errorMessage_(err) });
  }
}

function doPost(e) {
  try {
    const raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    const payload = JSON.parse(raw);
    const action = payload.action || 'save';

    if (action === 'login') {
      return json_(login_(payload.username || '', payload.password || ''));
    }

    if (action === 'logout') {
      logout_(payload.token || '');
      return json_({ ok: true });
    }

    if (action === 'load') {
      requireAuth_(payload.token || '');
      return json_({ ok: true, data: readData_(), storage: getStorageInfo_(), time: new Date().toISOString() });
    }

    if (action === 'save') {
      requireAuth_(payload.token || '');
      const data = normalizeData_(payload.data || {});
      const result = writeData_(data);
      return json_({
        ok: true,
        savedAt: new Date().toISOString(),
        storage: result,
        folderName: result.folderName,
        fileName: result.fileName,
        backupName: result.backupName,
        backupCount: result.backupCount
      });
    }

    return json_({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return json_({ ok: false, error: errorMessage_(err) });
  }
}

function login_(username, password) {
  const expected = getExpectedCredentials_();
  const inputUser = String(username || '').trim();
  const inputPass = String(password || '');

  if (!expected.username || !expected.password) {
    throw new Error('Не са зададени Username и Password в Apps Script. Задай RESCHECK_USERNAME и RESCHECK_PASSWORD в Script properties.');
  }

  if (inputUser !== expected.username || inputPass !== expected.password) {
    throw new Error('Грешен Username или Password.');
  }

  cleanupSessions_();
  const token = Utilities.getUuid() + '-' + Utilities.getUuid();
  const expiresAt = Date.now() + SESSION_TTL_MS;
  PropertiesService.getScriptProperties().setProperty(SESSION_PREFIX + token, String(expiresAt));

  return {
    ok: true,
    token: token,
    expiresAt: new Date(expiresAt).toISOString(),
    data: readData_(),
    storage: getStorageInfo_()
  };
}

function logout_(token) {
  if (!token) return;
  PropertiesService.getScriptProperties().deleteProperty(SESSION_PREFIX + String(token));
}

function requireAuth_(token) {
  cleanupSessions_();
  if (!token) throw new Error('Не сте влезли.');
  const props = PropertiesService.getScriptProperties();
  const expiry = Number(props.getProperty(SESSION_PREFIX + String(token)) || 0);
  if (!expiry || expiry < Date.now()) {
    props.deleteProperty(SESSION_PREFIX + String(token));
    throw new Error('Сесията е изтекла. Влез отново.');
  }
  props.setProperty(SESSION_PREFIX + String(token), String(Date.now() + SESSION_TTL_MS));
  return true;
}

function getExpectedCredentials_() {
  const props = PropertiesService.getScriptProperties();
  return {
    username: String(props.getProperty(USERNAME_PROPERTY) || AUTH_USERNAME || '').trim(),
    password: String(props.getProperty(PASSWORD_PROPERTY) || AUTH_PASSWORD || '')
  };
}

function cleanupSessions_() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  const now = Date.now();
  Object.keys(all).forEach(function(key) {
    if (key.indexOf(SESSION_PREFIX) === 0 && Number(all[key] || 0) < now) {
      props.deleteProperty(key);
    }
  });
}

function readData_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const folder = getDataFolder_();
    migrateExistingMainFilesToFolder_(folder);
    const file = getOrCreateMainFile_(folder);
    const text = file.getBlob().getDataAsString('UTF-8') || '{}';

    try {
      return normalizeData_(JSON.parse(text));
    } catch (err) {
      const brokenBackupName = makeBackupName_('broken_json');
      folder.createFile(brokenBackupName, text, MimeType.PLAIN_TEXT);
      file.setContent(JSON.stringify(defaultData_(), null, 2));
      cleanupBackups_(folder, BACKUP_LIMIT);
      return defaultData_();
    }
  } finally {
    lock.releaseLock();
  }
}

function writeData_(data) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const folder = getDataFolder_();
    migrateExistingMainFilesToFolder_(folder);
    const file = getOrCreateMainFile_(folder);

    const normalized = normalizeData_(data);
    const newBody = JSON.stringify(normalized, null, 2);
    const currentBody = file.getBlob().getDataAsString('UTF-8') || '';
    let backupName = '';

    if (currentBody.trim() !== newBody.trim()) {
      backupName = makeBackupName_();
      folder.createFile(backupName, currentBody || JSON.stringify(defaultData_(), null, 2), MimeType.PLAIN_TEXT);
      file.setContent(newBody);
    } else {
      file.setContent(newBody);
    }

    const backupCount = cleanupBackups_(folder, BACKUP_LIMIT);
    return buildStorageInfo_(folder, file, backupName, backupCount);
  } finally {
    lock.releaseLock();
  }
}

function getDataFolder_() {
  if (FOLDER_ID && String(FOLDER_ID).trim()) {
    const folderById = DriveApp.getFolderById(String(FOLDER_ID).trim());
    PropertiesService.getScriptProperties().setProperty(FOLDER_ID_PROPERTY, folderById.getId());
    return folderById;
  }

  const props = PropertiesService.getScriptProperties();
  const savedFolderId = props.getProperty(FOLDER_ID_PROPERTY);

  if (savedFolderId) {
    try {
      const folder = DriveApp.getFolderById(savedFolderId);
      if (folder && !folder.isTrashed()) return folder;
    } catch (err) {
      props.deleteProperty(FOLDER_ID_PROPERTY);
    }
  }

  const folders = DriveApp.getFoldersByName(FOLDER_NAME);
  if (folders.hasNext()) {
    const folder = folders.next();
    props.setProperty(FOLDER_ID_PROPERTY, folder.getId());
    return folder;
  }

  const created = DriveApp.createFolder(FOLDER_NAME);
  props.setProperty(FOLDER_ID_PROPERTY, created.getId());
  return created;
}

function getOrCreateMainFile_(folder) {
  const file = findMainFileInFolder_(folder);
  if (file) return file;
  return folder.createFile(FILE_NAME, JSON.stringify(defaultData_(), null, 2), MimeType.PLAIN_TEXT);
}

function findMainFileInFolder_(folder) {
  const files = folder.getFilesByName(FILE_NAME);
  const list = [];

  while (files.hasNext()) {
    const file = files.next();
    if (!file.isTrashed()) list.push(file);
  }

  if (!list.length) return null;

  list.sort(function(a, b) {
    return b.getLastUpdated().getTime() - a.getLastUpdated().getTime();
  });

  for (let i = 1; i < list.length; i++) {
    try {
      const text = list[i].getBlob().getDataAsString('UTF-8') || JSON.stringify(defaultData_(), null, 2);
      folder.createFile(makeBackupName_('duplicate_' + i), text, MimeType.PLAIN_TEXT);
      list[i].setTrashed(true);
    } catch (err) {}
  }

  cleanupBackups_(folder, BACKUP_LIMIT);
  return list[0];
}

function migrateExistingMainFilesToFolder_(folder) {
  const alreadyInFolder = findMainFileInFolder_(folder);
  const globalFiles = DriveApp.getFilesByName(FILE_NAME);
  const outside = [];

  while (globalFiles.hasNext()) {
    const file = globalFiles.next();
    if (!file.isTrashed() && !isFileInFolder_(file, folder)) outside.push(file);
  }

  if (!outside.length) return;

  outside.sort(function(a, b) {
    return b.getLastUpdated().getTime() - a.getLastUpdated().getTime();
  });

  if (!alreadyInFolder) {
    const newest = outside[0];
    const text = newest.getBlob().getDataAsString('UTF-8') || JSON.stringify(defaultData_(), null, 2);
    folder.createFile(FILE_NAME, text, MimeType.PLAIN_TEXT);

    try {
      newest.setName(makeBackupName_('migrated_from_root'));
      newest.setTrashed(true);
    } catch (err1) {}
  }

  const start = alreadyInFolder ? 0 : 1;
  for (let i = start; i < outside.length; i++) {
    try {
      const oldText = outside[i].getBlob().getDataAsString('UTF-8') || JSON.stringify(defaultData_(), null, 2);
      folder.createFile(makeBackupName_('old_outside_' + i), oldText, MimeType.PLAIN_TEXT);
      outside[i].setName(makeBackupName_('moved_to_rescheck_' + i));
      outside[i].setTrashed(true);
    } catch (err2) {}
  }

  cleanupBackups_(folder, BACKUP_LIMIT);
}

function isFileInFolder_(file, folder) {
  const parents = file.getParents();
  while (parents.hasNext()) {
    if (parents.next().getId() === folder.getId()) return true;
  }
  return false;
}

function cleanupBackups_(folder, limit) {
  const backups = [];
  const files = folder.getFiles();

  while (files.hasNext()) {
    const file = files.next();
    const name = file.getName();
    if (!file.isTrashed() && name.indexOf(BACKUP_PREFIX) === 0 && name.slice(-5).toLowerCase() === '.json') {
      backups.push(file);
    }
  }

  backups.sort(function(a, b) {
    return b.getLastUpdated().getTime() - a.getLastUpdated().getTime();
  });

  for (let i = limit; i < backups.length; i++) {
    backups[i].setTrashed(true);
  }

  return Math.min(backups.length, limit);
}

function getStorageInfo_() {
  const folder = getDataFolder_();
  migrateExistingMainFilesToFolder_(folder);
  const file = getOrCreateMainFile_(folder);
  const backupCount = cleanupBackups_(folder, BACKUP_LIMIT);
  return buildStorageInfo_(folder, file, '', backupCount);
}

function buildStorageInfo_(folder, file, backupName, backupCount) {
  return {
    folderName: folder.getName(),
    folderId: folder.getId(),
    folderUrl: folder.getUrl(),
    fileName: file.getName(),
    fileId: file.getId(),
    fileUrl: file.getUrl(),
    backupName: backupName || '',
    backupCount: backupCount,
    backupLimit: BACKUP_LIMIT
  };
}

function makeBackupName_(suffix) {
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss_SSS');
  const extra = suffix ? '_' + String(suffix).replace(/[^A-Za-z0-9_-]/g, '') : '';
  return BACKUP_PREFIX + stamp + extra + '.json';
}

function normalizeData_(data) {
  return {
    employees: Array.isArray(data.employees) ? data.employees.map(String) : [],
    channels: Array.isArray(data.channels) && data.channels.length ? data.channels.map(String) : ['Booking', 'Quendoo', 'TO'],
    records: Array.isArray(data.records) ? data.records : []
  };
}

function defaultData_() {
  return {
    employees: [],
    channels: ['Booking', 'Quendoo', 'TO'],
    records: []
  };
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function errorMessage_(err) {
  return String(err && err.message ? err.message : err);
}
