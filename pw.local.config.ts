import base from '/home/user/ledgerflow/playwright.config';
export default { ...base, use: { ...(base as any).use, launchOptions: { executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' } } };
