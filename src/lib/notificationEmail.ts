import { BRAND_NAME } from '../config/brand';
/**
 * Notices by email (S-18): each person chooses whether the bell's notices also reach them by email:
 * not at all (the default), each one as it happens, or one summary a day of what they have not read.
 * Pure: builds the emails (every piece of text escaped); the server decides who gets what and sends.
 */
export type NotificationEmailMode = 'off' | 'immediate' | 'daily';
export const EMAIL_MODES: NotificationEmailMode[] = ['off', 'immediate', 'daily'];
export const EMAIL_MODE_LABEL: Record<NotificationEmailMode, string> = {
  off: 'No emails (the bell only)',
  immediate: 'An email for each notice, as it happens',
  daily: 'One email a day with what I have not read',
};

export function emailMode(value: unknown): NotificationEmailMode {
  return EMAIL_MODES.includes(value as NotificationEmailMode) ? value as NotificationEmailMode : 'off';
}

export interface NoticeForEmail { workspaceName: string; title: string; message: string; createdAt?: string }
export interface BuiltEmail { subject: string; html: string; text: string }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
/** Text on one line: control characters (line breaks, tabs…) become spaces. */
const clip = (s: unknown, max: number) => [...String(s ?? '')].map(ch => { const code = ch.charCodeAt(0); return code < 32 || code === 127 ? ' ' : ch; }).join('').replace(/ {2,}/g, ' ').trim().slice(0, max);
const footer = (appUrl: string) => `To change which emails you get: ${BRAND_NAME} → the bell → the gear (${appUrl}).`;

export function noticeEmail(notice: NoticeForEmail, appUrl: string): BuiltEmail {
  const title = clip(notice.title, 140);
  const message = clip(notice.message, 400);
  const workspace = clip(notice.workspaceName, 80) || `${BRAND_NAME}`;
  return {
    subject: `${workspace}: ${title}`,
    html: `<p><strong>${esc(title)}</strong></p><p>${esc(message)}</p><p><a href="${esc(appUrl)}">Open ${BRAND_NAME}</a></p><p style="color:#666;font-size:12px">${esc(footer(appUrl))}</p>`,
    text: `${title}\n\n${message}\n\nOpen ${BRAND_NAME}: ${appUrl}\n\n${footer(appUrl)}`,
  };
}

export function digestEmail(notices: NoticeForEmail[], appUrl: string): BuiltEmail | null {
  if (notices.length === 0) return null;
  const shown = notices.slice(0, 50);
  const byWorkspace = new Map<string, NoticeForEmail[]>();
  for (const n of shown) {
    const key = clip(n.workspaceName, 80) || `${BRAND_NAME}`;
    byWorkspace.set(key, [...(byWorkspace.get(key) || []), n]);
  }
  const more = notices.length - shown.length;
  const htmlParts: string[] = [];
  const textParts: string[] = [];
  for (const [workspace, list] of byWorkspace) {
    htmlParts.push(`<h3>${esc(workspace)}</h3><ul>${list.map(n => `<li><strong>${esc(clip(n.title, 140))}</strong><br>${esc(clip(n.message, 400))}</li>`).join('')}</ul>`);
    textParts.push(`${workspace}\n${list.map(n => `- ${clip(n.title, 140)}: ${clip(n.message, 400)}`).join('\n')}`);
  }
  const count = `${notices.length} notice${notices.length === 1 ? '' : 's'} you have not read`;
  return {
    subject: `${BRAND_NAME}: ${count}`,
    html: `<p>${esc(count)}:</p>${htmlParts.join('')}${more > 0 ? `<p>…and ${more} more.</p>` : ''}<p><a href="${esc(appUrl)}">Open ${BRAND_NAME}</a></p><p style="color:#666;font-size:12px">${esc(footer(appUrl))}</p>`,
    text: `${count}:\n\n${textParts.join('\n\n')}${more > 0 ? `\n\n…and ${more} more.` : ''}\n\nOpen ${BRAND_NAME}: ${appUrl}\n\n${footer(appUrl)}`,
  };
}
