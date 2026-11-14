import CryptoJS from 'crypto-js';
import { gzip } from 'pako';
import { matches_sync_domain, parse_sync_domains } from './domains';

interface CookieData {
  [domain: string]: any[];
}

interface LocalStorageData {
  [key: string]: any;
}

interface LocalStorageSyncConfig {
  type?: string;
  domains?: string;
  with_storage?: number;
}

interface UploadPayload extends LocalStorageSyncConfig {
  uuid: string;
  password: string;
  endpoint: string;
  headers?: string;
  no_cache?: number;
  expire_minutes?: number;
  crypto_type?: string;
}

interface DownloadPayload extends LocalStorageSyncConfig {
  uuid: string;
  password: string;
  endpoint: string;
  expire_minutes?: number;
  crypto_type?: string;
}

function is_firefox(): boolean {
  return navigator.userAgent.toLowerCase().indexOf('firefox') > -1;
}


export async function browser_set(key: string, value: any): Promise<void> {
  return await browser.storage.local.set({ [key]: value });
}

export async function browser_get(key: string): Promise<any> {
  const result = await browser.storage.local.get(key);
  if (result[key] === undefined) return null;
  else return result[key];
}

export async function browser_remove(key: string): Promise<void> {
  return await browser.storage.local.remove(key);
}

export async function storage_set(key: string, value: any): Promise<boolean> {
  try {
    await browser.storage.local.set({ [key]: value });
    return true;
  } catch (error) {
    return false;
  }
}

export async function storage_get(key: string): Promise<any> {
  try {
    const result = await browser.storage.local.get([key]);
    return result[key] === undefined ? null : result[key];
  } catch (error) {
    return null;
  }
}

export async function storage_remove(key: string): Promise<any> {
  try {
    await browser.storage.local.remove([key]);
    return true;
  } catch (error) {
    return false;
  }
}

export async function browser_load_all(prefix: string | null = null): Promise<any> {
  const result = await browser.storage.local.get(null);
  let ret = result;
  // Only return properties with keys starting with prefix
  if (prefix) {
    ret = {};
    for (let key in result) {
      if (key.startsWith(prefix)) {
        // remove prefix from key
        ret[key.substring(prefix.length)] = JSON.parse(result[key] as string) ?? result[key];
      }
    }
  }
  return ret;
}

export async function load_all(prefix: string | null = null): Promise<any> {
  try {
    const result = await browser.storage.local.get(null);
    let ret = result;
    // Only return properties with keys starting with prefix
    if (prefix) {
      ret = {};
      for (let key in result) {
        if (key.startsWith(prefix)) {
           // remove prefix from key
           const value = result[key];
           ret[key.substring(prefix.length)] = typeof value === 'string' ? (JSON.parse(value) ?? value) : value;
         }
      }
    }
    return ret;
  } catch (error) {
    return {};
  }
}

export async function load_data(key: string): Promise<any> {
  const data = browser?.storage ? await browser_get(key) : window.localStorage.getItem(key);
  // console.log("load",key,data);
  try {
    return JSON.parse(data as string);
  } catch (error) {
    return data || [];
  }
}

export async function remove_data(key: string): Promise<any> {
  const ret = browser?.storage ? await browser_remove(key) : window.localStorage.removeItem(key);
  return ret;
}

export async function save_data(key: string, data: any): Promise<any> {
  // chrome.storage.local.set({key:JSON.stringify(data)});
  const ret = browser?.storage ? await browser_set(key, JSON.stringify(data)) : window.localStorage.setItem(key, JSON.stringify(data));
  return ret;
}

export async function upload_cookie(payload: UploadPayload): Promise<any> {
  const { uuid, password } = payload;
  // console.log( payload );
  // none of the fields can be empty
  if (!password || !uuid) {
    alert("Invalid parameters");
    showBadge("err");
    return false;
  }
  const domains = parse_sync_domains(payload.domains);
  if (domains.length === 0) {
    return { action: 'done', note: 'No sync domains configured, nothing to upload' };
  }

  const cookies = await get_cookie_by_domains(domains);
  const with_storage = payload['with_storage'] || 0;
  if (with_storage) {
    await sync_local_storage_tabs({ ...payload, type: 'up' });
  }
  const local_storages = with_storage ? await get_local_storage_by_domains(domains) : {};

  let headers: any = { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }
  // Add authentication header
  try {
    if (payload.headers?.trim().length) {
      let extraHeaderPairs = payload.headers.trim().split("\n");
      extraHeaderPairs.forEach((extraHeaderPair, index) => {
        let extraHeaderPairKV = String(extraHeaderPair).split(":");
        if (extraHeaderPairKV?.length > 1) {
          headers[extraHeaderPairKV[0]] = extraHeaderPairKV[1];
        } else {
          console.log("error", "Header parsing error: ", extraHeaderPair);
          showBadge("fail", "orange");
        }
      })
    }
  } catch (error) {
    console.log("error", error);
    showBadge("err");
    return false;
  }
  // Encrypt cookie with AES
  const data_to_encrypt = JSON.stringify({ "cookie_data": cookies, "local_storage_data": local_storages, "update_time": new Date() });
  const crypto_type = payload.crypto_type || 'legacy';
  const encrypted = cookie_encrypt(payload.uuid, data_to_encrypt, payload.password, crypto_type);
  const endpoint = payload.endpoint.trim().replace(/\/+$/, '') + '/update';

  // get sha256 of the encrypted data
  const sha256 = CryptoJS.SHA256(uuid + "-" + password + "-" + endpoint + "-" + data_to_encrypt).toString();
  console.log("sha256", sha256);
  const last_uploaded_info = await load_data('LAST_UPLOADED_COOKIE');
  // If same content has been uploaded within 24 hours, don't upload again
  if ((!payload.no_cache || parseInt(payload.no_cache.toString()) < 1) && last_uploaded_info && last_uploaded_info.sha256 === sha256 && new Date().getTime() - last_uploaded_info.timestamp < 1000 * 60 * 60 * 24) {
    console.log("same data in 24 hours, skip1");
    return { action: 'done', note: 'Local Cookie data unchanged, not uploading' };
  }

  const payload2 = {
    uuid: payload.uuid,
    encrypted: encrypted,
    crypto_type: crypto_type
  };
  // console.log( endpoint, payload2 );
  try {
    showBadge("↑", "green");
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: headers,
      body: gzip(JSON.stringify(payload2)) as any
    });
    const result = await response.json();

    if (result && result.action === 'done')
      await save_data('LAST_UPLOADED_COOKIE', { "timestamp": new Date().getTime(), "sha256": sha256 });

    return result;
  } catch (error) {
    console.log("error", error);
    showBadge("err");
    return false;
  }
}

export async function download_cookie(payload: DownloadPayload): Promise<any> {
  const { uuid, password, expire_minutes, crypto_type } = payload;
  let endpoint = payload.endpoint.trim().replace(/\/+$/, '') + '/get/' + uuid;
  // 如果指定了加密算法，添加查询参数
  if (crypto_type) {
    endpoint += `?crypto_type=${crypto_type}`;
  }
  try {
    showBadge("↓", "blue");
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    const result = await response.json();
    if (result && result.encrypted) {
      const useCryptoType = crypto_type || result.crypto_type || 'legacy';
      const { cookie_data, local_storage_data } = cookie_decrypt(uuid, result.encrypted, password, useCryptoType);
      let action = 'done';
      if (cookie_data) {
        for (let domain in cookie_data) {
          // console.log( "domain" , cookies[domain] );
          if (Array.isArray(cookie_data[domain])) {
            for (let cookie of cookie_data[domain]) {
              let new_cookie: any = {};
              ['name', 'value', 'domain', 'path', 'secure', 'httpOnly', 'sameSite'].forEach(key => {
                if (key == 'sameSite' && cookie[key].toLowerCase() == 'unspecified' && is_firefox()) {
                  // In Firefox, unspecified will cause cookie setting to fail
                  // https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/cookies/SameSiteStatus
                  new_cookie['sameSite'] = 'no_restriction';
                } else {
                  new_cookie[key] = cookie[key];
                }
              });
              if (expire_minutes) {
                // Current timestamp (seconds)
                const now = parseInt((new Date().getTime() / 1000).toString());
                console.log("now", now);
                new_cookie.expirationDate = now + parseInt(expire_minutes.toString()) * 60;
                console.log("new_cookie.expirationDate", new_cookie.expirationDate);

              }
              new_cookie.url = buildUrl(cookie.secure, cookie.domain, cookie.path);
              console.log("new cookie", new_cookie);
              try {
                const set_ret = await browser.cookies.set(new_cookie);
                console.log("set cookie", set_ret);
              } catch (error) {
                showBadge("err");
                console.log("set cookie error", error);
              }


            }
          }
        }
      } else {
        action = 'false';
      }

      console.log("local_storage_data", local_storage_data);
      if (local_storage_data) {
        for (let domain in local_storage_data) {
          if (!matches_sync_domain(domain, parse_sync_domains(payload.domains))) continue;
          const key = 'LS-' + domain;
          await save_data(key, local_storage_data[domain]);
          console.log("save local storage", key, local_storage_data[domain]);
        }
        await sync_local_storage_tabs({ ...payload, type: 'down' });
      }

      return { action };
    }
  } catch (error) {
    console.log("error", error);
    showBadge("err");
    return false;
  }
}

function cookie_decrypt(uuid: string, encrypted: string, password: string, crypto_type: string = 'legacy'): any {
  const hash = CryptoJS.MD5(uuid + '-' + password).toString();
  const the_key = hash.substring(0, 16);
  
  if (crypto_type === 'aes-128-cbc-fixed') {
    // 新的标准 AES-128-CBC 算法，使用固定 IV
    const fixedIv = CryptoJS.enc.Hex.parse('00000000000000000000000000000000'); // 16字节的0
    const options = {
      iv: fixedIv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7
    };
    // 直接解密原始加密数据
    const decrypted = CryptoJS.AES.decrypt(encrypted, CryptoJS.enc.Utf8.parse(the_key), options).toString(CryptoJS.enc.Utf8);
    const parsed = JSON.parse(decrypted);
    return parsed;
  } else {
    // 原有的 legacy 算法
    const decrypted = CryptoJS.AES.decrypt(encrypted, the_key).toString(CryptoJS.enc.Utf8);
    const parsed = JSON.parse(decrypted);
    return parsed;
  }
}

function cookie_encrypt(uuid: string, data: string, password: string, crypto_type: string = 'legacy'): string {
  const hash = CryptoJS.MD5(uuid + '-' + password).toString();
  const the_key = hash.substring(0, 16);
  
  if (crypto_type === 'aes-128-cbc-fixed') {
    // 新的标准 AES-128-CBC 算法，使用固定 IV
    const fixedIv = CryptoJS.enc.Hex.parse('00000000000000000000000000000000'); // 16字节的0
    const options = {
      iv: fixedIv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7
    };
    // 使用原始加密数据，不包含 CryptoJS 格式包装
    const encrypted = CryptoJS.AES.encrypt(data, CryptoJS.enc.Utf8.parse(the_key), options);
    return encrypted.ciphertext.toString(CryptoJS.enc.Base64);
  } else {
    // 原有的 legacy 算法
    const encrypted = CryptoJS.AES.encrypt(data, the_key).toString();
    return encrypted;
  }
}

export async function get_local_storage_by_domains(domains: string[] = []): Promise<LocalStorageData> {
  let ret_storage: LocalStorageData = {};
  if (domains.length === 0) return ret_storage;
  const local_storages = await browser_load_all('LS-');
  for (const key in local_storages) {
    if (matches_sync_domain(key, domains)) {
      ret_storage[key] = local_storages[key];
    }
  }
  return ret_storage;
}

async function get_cookie_by_domains(domains: string[] = []): Promise<CookieData> {
  let ret_cookies: CookieData = {};
  if (browser.cookies) {
    for (const domain of domains) {
      ret_cookies[domain] = await browser.cookies.getAll({ domain, partitionKey: {} });
    }
  }
  return ret_cookies;
}

export async function sync_local_storage_tab(tab_id: number, url: string, config: LocalStorageSyncConfig): Promise<void> {
  if (config.type === 'pause' || (config.type !== 'down' && !Number(config.with_storage))) return;
  const domains = parse_sync_domains(config.domains);
  let host: string;
  try {
    const page_url = new URL(url);
    if (!['http:', 'https:'].includes(page_url.protocol)) return;
    host = page_url.hostname;
  } catch {
    return;
  }
  if (!matches_sync_domain(host, domains)) return;

  try {
    const storage_key = 'LS-' + host;
    const values = config.type === 'down' ? await load_data(storage_key) : null;
    if (config.type === 'down' && (!values || typeof values !== 'object' || Array.isArray(values))) return;
    const [injection] = await browser.scripting.executeScript({
      target: { tabId: tab_id },
      func: (expected_host: string, stored_values: Record<string, string> | null) => {
        if (window.location.hostname !== expected_host) return null;
        if (stored_values !== null) {
          for (const [key, value] of Object.entries(stored_values)) {
            window.localStorage.setItem(key, value);
          }
          return { restored: true, data: null };
        }
        const data = Object.fromEntries(Object.keys(window.localStorage).map(key => [key, window.localStorage.getItem(key)]));
        return { restored: false, data };
      },
      args: [host, values]
    });
    if (!injection?.result) return;
    if (injection.result.restored) {
      await remove_data(storage_key);
    } else {
      await save_data(storage_key, injection.result.data);
    }
  } catch (error) {
    console.error('Local Storage sync failed', tab_id, error);
  }
}

async function sync_local_storage_tabs(config: LocalStorageSyncConfig): Promise<void> {
  const domains = parse_sync_domains(config.domains);
  if (domains.length === 0) return;
  const tabs = await browser.tabs.query({ url: domains.map(domain => `*://*.${domain}/*`) });
  for (const tab of tabs) {
    if (tab.id !== undefined && tab.url && tab.status === 'complete') {
      await sync_local_storage_tab(tab.id, tab.url, config);
    }
  }
}

function buildUrl(secure: boolean, domain: string, path: string): string {
  if (domain.startsWith('.')) {
    domain = domain.substr(1);
  }
  return `http${secure ? 's' : ''}://${domain}${path}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function showBadge(text: string, color: string = "red", delay: number = 5000): void {
  (browser.action ?? browser.browserAction).setBadgeText({ text: text });
  (browser.action ?? browser.browserAction).setBadgeBackgroundColor({ color: color });
    setTimeout(() => {
      (browser.action ?? browser.browserAction).setBadgeText({ text: '' });
    }, delay);
}
