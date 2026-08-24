import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  // Set a standard desktop viewport
  await page.setViewportSize({ width: 1280, height: 800 });
  
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await page.screenshot({ path: 'screenshot.png', fullPage: true });
  
  await browser.close();
})();
