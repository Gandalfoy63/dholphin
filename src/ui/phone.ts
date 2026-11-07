// Docs: docs/03 - Features/Phone Entry.md
// Purpose: typing on a phone: a QR code beside the fields. What the phone sends fills them and goes on by itself.
import type { PhoneField } from '@/sdk/types';
import { app } from './app';
import { $, esc, ico } from './dom';
import { t } from './i18n';

/** The QR panel, where the device can serve the phone form. Nothing otherwise: the remote's keyboard stays. */
export const phoneHtml = () =>
  app.host.phoneForm
    ? `<div class="phone"><div class="qrbox">${ico('loader-circle', 's spin')}</div><div class="pi"><b>${t('Or type on your phone')}</b><span class="muted">${t("Scan with your phone's camera. It needs the same Wi-Fi as this TV.")}</span><span class="purl"></span></div></div>`
    : '';

/**
 * Starts the phone form for these fields. What the phone sends fills the matching inputs, then `received` runs.
 * Returns a stop function; starting another form also stops this one.
 */
export async function bindPhone(root: HTMLElement, title: string, fields: PhoneField[], received: () => void): Promise<() => void> {
  const pf = app.host.phoneForm;
  const box = root.querySelector<HTMLElement>('.phone');
  if (!pf || !box) return () => undefined;
  try {
    const { url, qr } = await pf.start(title, fields, (values) => {
      if (!box.isConnected) return;
      for (const [k, v] of Object.entries(values)) {
        const input = root.querySelector<HTMLInputElement>(`.field input[data-key="${CSS.escape(k)}"]`);
        if (input && v) input.value = v.trim();
      }
      $('.pi b', box).textContent = t('Received from your phone');
      received();
    });
    if (!box.isConnected) {
      pf.stop();
      return () => undefined;
    }
    $('.qrbox', box).innerHTML = `<img src="${esc(qr)}" alt="${esc(t('QR code that opens the form on your phone'))}">`;
    $('.purl', box).textContent = url;
  } catch (e) {
    $('.qrbox', box).remove();
    $('.pi .muted', box).textContent = t((e as Error).message);
  }
  return () => pf.stop();
}
