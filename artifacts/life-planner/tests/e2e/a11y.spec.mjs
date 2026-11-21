import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Automated WCAG 2 A/AA scan of the main screens in Daylight and Midnight. This catches contrast, label,
 * name and landmark problems; it does not replace a screen-reader and keyboard pass by a person.
 */
const screens = [
  { name: 'journal', url: '/tests/e2e/journal-harness.html', ready: 'page-journal' },
  { name: 'planner overview', url: '/tests/e2e/planner-harness.html', ready: null },
  { name: 'finances (TUKLAS)', url: '/tests/e2e/tuklas-harness.html', ready: null },
  { name: 'memories (BAKAS)', url: '/tests/e2e/memory-harness.html', ready: null },
];

for (const theme of ['light', 'dark']) {
  for (const screen of screens) {
    test(`${screen.name} has no serious accessibility violations in ${theme}`, async ({ page }) => {
      await page.goto(screen.url);
      if (screen.ready) await expect(page.getByTestId(screen.ready)).toBeVisible();
      await page.waitForLoadState('networkidle');
      await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important}' });
      if (theme === 'dark') await page.evaluate(() => document.documentElement.classList.add('dark'));
      await page.waitForTimeout(200);

      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      const summary = serious.map((v) => `${v.id} (${v.nodes.length}): ${v.nodes[0]?.target.join(' ')} — ${v.help}`);
      expect(summary, summary.join('\n')).toEqual([]);
    });
  }
}
