import { deflateRawSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';

// The dev build exposes the running session and the map projection for tests.
type Hook = {
  session: { current: { item: { x: number; y: number } } | null; phase: string };
  screenPoint: (ll: [number, number]) => [number, number];
};

async function clickTarget(page: Page) {
  const [x, y] = await page.evaluate(() => {
    const t = (window as unknown as { __topochamp: Hook }).__topochamp;
    const item = t.session.current!.item;
    return t.screenPoint([item.x, item.y]);
  });
  await page.mouse.click(x, y);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() =>
    localStorage.setItem(
      'topochamp.settings',
      JSON.stringify({ packId: 'NLD', level: 'easy', kinds: ['where'], sessionType: 'practice', length: 10, feedback: 'manual', sound: false }),
    ),
  );
  await page.reload();
});

test('plays a full round of "Where is it?" and shows the results', async ({ page }) => {
  await expect(page.getByText('25 plaatsen', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start!' }).click();

  for (let i = 1; i <= 10; i++) {
    await expect(page.getByText(`Vraag ${i} van 10`)).toBeVisible();
    await clickTarget(page);
    await expect(page.getByRole('status')).toBeVisible();
    await expect(page.locator('.fb-headline')).not.toHaveText(/Helaas/);
    await page.getByRole('button', { name: /Volgende/ }).click();
  }

  await expect(page.getByRole('heading', { name: 'Uitslag' })).toBeVisible();
  await expect(page.getByText('10 van 10 goed')).toBeVisible();
  await expect(page.getByText('Alles goed!')).toBeVisible();
});

test('a wrong click shows the answer and the distance', async ({ page }) => {
  await page.getByRole('button', { name: 'Start!' }).click();
  const box = (await page.locator('svg[role=img]').boundingBox())!;
  await page.mouse.click(box.x + 20, box.y + 20); // in the sea, far from anything
  await expect(page.locator('.fb-headline')).toHaveText(/Helaas/);
  await expect(page.getByText(/km ernaast/)).toBeVisible();
});

test('switches the interface to English', async ({ page }) => {
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start!' })).toBeVisible();
  await expect(page.getByText('Practise your topography!')).toBeVisible();
});

test('opening a shared link adds the list', async ({ page }) => {
  const payload = { n: 'Klas 6 – noorden', p: 'NLD', e: [{ id: 't:2743477' }, { id: 't:2759633' }, { id: 't:2751792', name: 'Ljouwert' }], c: [] };
  const code = 'z' + deflateRawSync(Buffer.from(JSON.stringify(payload))).toString('base64url');
  page.on('dialog', (d) => d.accept());
  await page.goto(`/#list=${code}`);
  await expect(page.getByRole('button', { name: 'Klas 6 – noorden' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('3 plaatsen', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/$/); // the list code is removed from the address
});
