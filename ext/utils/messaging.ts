import { upload_cookie, download_cookie } from './functions';
import browser from 'webextension-polyfill';

export interface RequestBody {
  payload: any;
}

export interface ResponseBody {
  message: string;
  note: string | null;
}

export async function sendConfigMessage(payload: any): Promise<ResponseBody> {
  return browser.runtime.sendMessage({ type: 'sync-config', payload });
}

export async function handleConfigMessage(payload: any): Promise<ResponseBody> {
  const result = (payload.type && payload.type == 'down') ? 
    await download_cookie(payload) : 
    await upload_cookie(payload);
  
  return {
    message: result?.action || 'failed',
    note: result?.note || null,
  };
}
