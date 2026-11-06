import { test, expect, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function rows(page: Page, store: string): Promise<Record<string, unknown>[]> {
  return page.evaluate((name) => new Promise<Record<string, unknown>[]>((resolve, reject) => {
    const request = indexedDB.open('OweMe');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(name, 'readonly');
      const all = transaction.objectStore(name).getAll();
      all.onsuccess = () => resolve(all.result as Record<string, unknown>[]);
      all.onerror = () => reject(all.error);
      transaction.oncomplete = () => database.close();
    };
  }), store);
}

async function noHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth, viewport: window.innerWidth,
  }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport + 1);
}

async function focusedInputIsUnobscured(input: Locator) {
  await expect(input).toBeFocused();
  // Permit subpixel intersection rounding, then check actual visibility and hit targets.
  await expect(input).toBeInViewport({ ratio: .98 });
  await expect.poll(() => input.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const failures: string[] = [];
    if (rect.top < -1 || rect.left < -1 || rect.bottom > window.innerHeight + 1 || rect.right > window.innerWidth + 1) failures.push('input extends beyond viewport');
    const inset = Math.min(8, rect.width / 4, rect.height / 4);
    const points = [
      { name: 'centre', x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      { name: 'top left', x: rect.left + inset, y: rect.top + inset },
      { name: 'top right', x: rect.right - inset, y: rect.top + inset },
      { name: 'bottom left', x: rect.left + inset, y: rect.bottom - inset },
      { name: 'bottom right', x: rect.right - inset, y: rect.bottom - inset },
    ];
    for (const point of points) {
      const hit = document.elementsFromPoint(point.x, point.y)[0];
      if (!hit || !element.contains(hit)) failures.push(`${point.name} is covered`);
    }
    return failures;
  }), { message: 'The focused amount must remain clear of summaries and fixed action bars' }).toEqual([]);
}

async function addBorrower(page: Page, name = 'QA Borrower') {
  await page.goto('/');
  await page.getByRole('button', { name: /add borrower/i }).first().click();
  const dialog = page.getByRole('dialog', { name: /add borrower/i });
  await expect(dialog.getByLabel('Full name', { exact: true })).toBeVisible();
  await expect(dialog.locator('input:visible')).toHaveCount(1);
  await dialog.getByLabel('Full name', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Save borrower', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(page.getByText('#001', { exact: false }).first()).toBeVisible();
  expect(await rows(page, 'borrowers')).toHaveLength(1);
}

async function openLoan(page: Page) {
  await page.locator('a[href^="#/loan?borrower="]:visible').first().click();
  await page.getByLabel('Total they will repay', { exact: true }).fill('3000');
  await page.getByLabel('One-time charge (%)', { exact: true }).fill('10');
  await page.getByLabel('Months', { exact: true }).fill('3');
  await page.getByLabel('Release date', { exact: true }).fill('2026-11-05');
}

async function releaseLoan(page: Page) {
  await openLoan(page);
  await page.getByRole('button', { name: 'Review & release', exact: true }).click();
  const review = page.getByRole('dialog');
  await expect(review).toContainText('QA Borrower');
  await expect(review).toContainText('₱2,700.00');
  await expect(review).toContainText('₱3,000.00');
  await review.getByRole('button', { name: /confirm cash released/i }).click();
  await expect.poll(async () => (await rows(page, 'loans')).length).toBe(1);
}

test('empty notebook, live loan, payment and persisted receipt work without duplicate posting', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(await rows(page, 'borrowers')).toEqual([]);
  await noHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('01-empty-home.png'), fullPage: true });
  await addBorrower(page);
  await openLoan(page);
  const preview = page.getByTestId('loan-summary');
  await expect(preview).toContainText('₱2,700.00');
  await expect(preview).toContainText('₱3,000.00');
  await expect(preview).toContainText('₱300.00');
  await expect(preview).toContainText('₱1,000.00');
  const amount = page.getByLabel('Total they will repay', { exact: true });
  await amount.fill('2000');
  await expect(amount).toBeFocused();
  await expect(amount).toHaveValue('2000');
  await expect(preview).toContainText('₱1,800.00');
  expect(await rows(page, 'entries')).toEqual([]);
  await amount.fill('3000');
  await expect(preview).toContainText('₱2,700.00');
  await amount.scrollIntoViewIfNeeded();
  await amount.focus();
  await focusedInputIsUnobscured(amount);
  if ((page.viewportSize()?.width ?? 1440) <= 700) {
    const visibleMoney = page.getByTestId('mobile-loan-summary');
    await expect(visibleMoney).toContainText('₱2,700.00');
    await expect(visibleMoney).toBeInViewport({ ratio: .9 });
  }
  await noHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('02-live-loan-viewport.png') });
  await page.screenshot({ path: testInfo.outputPath('02-live-loan.png'), fullPage: true });
  await page.getByRole('button', { name: 'Review & release', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: /confirm cash released/i }).click();
  await expect.poll(async () => (await rows(page, 'loans')).length).toBe(1);
  const issued = (await rows(page, 'loans'))[0];
  expect(issued).toMatchObject({ cash: 270_000, charge: 30_000, total: 300_000 });
  expect((issued.schedule as { dueDate: string }[]).map((item) => item.dueDate)).toEqual(['2026-12-05', '2027-01-05', '2027-02-05']);
  await page.getByRole('link', { name: /done/i }).click();
  await page.getByRole('link', { name: /record payment/i }).and(page.locator(':visible')).first().click();
  const payAmount = page.getByLabel('Payment received', { exact: true });
  await payAmount.fill('500');
  const paymentPreview = page.getByTestId('payment-summary');
  await expect(paymentPreview).toContainText('₱2,500.00');
  await payAmount.fill('1000');
  await expect(page.getByTestId('balance-after')).toHaveText('₱2,000.00');
  await payAmount.fill('3000');
  await expect(page.getByTestId('balance-after')).toHaveText('₱0.00');
  await expect(paymentPreview).toContainText('Paid in Full');
  await payAmount.fill('3500');
  await expect(page.getByRole('button', { name: 'Confirm payment', exact: true })).toBeDisabled();
  await payAmount.fill('500');
  await expect(page.getByTestId('balance-after')).toHaveText('₱2,500.00');
  if ((page.viewportSize()?.width ?? 1440) <= 700) {
    const visibleBalance = page.getByTestId('mobile-payment-summary');
    await expect(visibleBalance).toContainText('₱2,500.00');
    await expect(visibleBalance).toBeInViewport({ ratio: .9 });
  }
  expect((await rows(page, 'entries')).filter((entry) => entry.kind === 'payment')).toHaveLength(0);
  await expect(page.getByLabel(/reference/i)).toHaveCount(0);
  await page.getByLabel('Payment method', { exact: true }).selectOption('GCash');
  await expect(page.getByLabel(/reference/i)).toBeVisible();
  await expect(payAmount).toHaveValue(/500/);
  await page.getByLabel('Payment method', { exact: true }).selectOption('Cash');
  await expect(page.getByLabel(/reference/i)).toHaveCount(0);
  await payAmount.scrollIntoViewIfNeeded();
  await payAmount.focus();
  await focusedInputIsUnobscured(payAmount);
  await noHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('03-payment-preview-viewport.png') });
  await page.screenshot({ path: testInfo.outputPath('03-payment-preview.png'), fullPage: true });
  await page.getByRole('button', { name: 'Confirm payment', exact: true }).evaluate((button: HTMLButtonElement) => {
    button.click(); button.click();
  });
  await expect(page.getByRole('button', { name: /view receipt/i })).toBeVisible();
  const payments = (await rows(page, 'entries')).filter((entry) => entry.kind === 'payment');
  expect(payments).toHaveLength(1);
  expect(payments[0]).toMatchObject({ amount: 50_000, balanceAfter: 250_000 });
  await page.reload();
  expect((await rows(page, 'entries')).filter((entry) => entry.kind === 'payment')).toHaveLength(1);
  await page.locator('a[href="#/transactions"]:visible').first().click();
  await page.getByLabel('Search transactions', { exact: true }).fill(String(payments[0].ref));
  const oldReceiptRow = page.locator('.transaction-row').filter({ hasText: String(payments[0].ref) });
  await expect(oldReceiptRow).toHaveCount(1);
  await oldReceiptRow.click();
  const historical = page.getByRole('dialog', { name: 'Payment received', exact: true });
  await expect(historical).toContainText(String(payments[0].ref));
  await historical.getByRole('button', { name: 'View receipt', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Receipt', exact: true })).toBeVisible();
  expect((await rows(page, 'entries')).filter((entry) => entry.kind === 'payment')).toHaveLength(1);
});

test('contextual help, live cash targets and browser Back preserve editing state', async ({ page }) => {
  await addBorrower(page);
  await openLoan(page);
  const amount = page.getByLabel('Total they will repay', { exact: true });
  await amount.fill('3000');
  const info = page.getByRole('button', { name: /about .*upfront deduction/i }).first();
  await info.click();
  await expect(page.getByRole('dialog', { name: /upfront deduction/i })).toContainText(/not a 10% monthly/i);
  await page.keyboard.press('Escape');
  await expect(info).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: /upfront deduction/i })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(amount).toHaveValue(/3,?000/);
  await page.getByRole('button', { name: 'Cash they want', exact: true }).click();
  const cash = page.getByLabel('Cash they want to receive', { exact: true });
  await cash.fill('3000');
  await expect(page.getByTestId('loan-summary')).toContainText('₱3,333.33');
  await expect(page.getByTestId('loan-summary')).toContainText('₱333.33');
  expect(await rows(page, 'entries')).toEqual([]);
  await page.goBack();
  const guard = page.getByRole('dialog', { name: 'Keep your changes?', exact: true });
  await expect(guard).toBeVisible();
  await guard.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(cash).toHaveValue(/3,?000/);
  await expect(page).toHaveURL(/#\/loan/);
  await page.goBack();
  await guard.getByRole('button', { name: 'Leave form', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'QA Borrower', exact: true })).toBeVisible();
  expect(await rows(page, 'entries')).toEqual([]);
});

test('offline search finds borrower IDs and a portable backup downloads real records', async ({ page, context }) => {
  await addBorrower(page);
  await releaseLoan(page);
  await page.getByRole('button', { name: 'Search notebook', exact: true }).click();
  const search = page.getByRole('dialog', { name: 'Find anything', exact: true });
  await search.getByRole('textbox').fill('001');
  await expect(search).toContainText('QA Borrower');
  await context.setOffline(true);
  await search.getByRole('textbox').fill('qa borrower');
  await expect(search).toContainText('QA Borrower');
  await search.getByRole('button', { name: 'Close dialog' }).click();
  await page.locator('a[href="#/more"]:visible').first().click();
  await page.getByRole('link', { name: /Backups & recovery/i }).click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: /export backup/i }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/\.json$/);
  expect(await download.failure()).toBeNull();
  const file = await download.path();
  expect(file).toBeTruthy();
  const backup = JSON.parse(await readFile(file!, 'utf8'));
  expect(backup.app).toBe('OweMe');
  expect(backup.schemaVersion).toBe(1);
  expect(backup.data.borrowers).toHaveLength(1);
  expect(backup.data.loans).toHaveLength(1);
  expect(backup.data.entries).toHaveLength(1);
  expect(backup.checksum).toMatch(/^[a-f0-9]{64}$/);
  await context.setOffline(false);
});

test('reversal, corrected payment and archive preserve financial history', async ({ page }, testInfo) => {
  await addBorrower(page);
  await releaseLoan(page);
  await page.getByRole('link', { name: /done/i }).click();
  await page.locator('main').getByRole('link', { name: 'Record payment', exact: true }).first().click();
  await page.getByLabel('Payment received', { exact: true }).fill('500');
  await page.getByRole('button', { name: 'Confirm payment', exact: true }).click();
  await page.getByRole('button', { name: 'View receipt', exact: true }).click();
  const receipt = page.getByRole('dialog', { name: 'Payment received', exact: true });
  await expect(receipt).toContainText('₱2,500.00');
  await receipt.getByRole('button', { name: 'Share', exact: true }).click();
  const privacy = page.getByRole('dialog', { name: 'Review before sharing', exact: true });
  await expect(privacy).toContainText('QA Borrower');
  await expect(privacy).toContainText(/intended person/i);
  await privacy.getByRole('button', { name: 'Cancel', exact: true }).click();
  await receipt.getByRole('button', { name: 'View receipt', exact: true }).click();
  const pdf = page.getByRole('dialog', { name: 'Receipt', exact: true });
  const pdfDownload = page.waitForEvent('download');
  await pdf.getByRole('button', { name: 'Download PDF', exact: true }).click();
  const receiptFile = await pdfDownload;
  expect(receiptFile.suggestedFilename()).toMatch(/\.pdf$/);
  const receiptPath = await receiptFile.path();
  expect((await readFile(receiptPath!)).subarray(0, 4).toString()).toBe('%PDF');
  await pdf.getByRole('button', { name: 'Close dialog', exact: true }).click();
  const correction = receipt.locator('summary').filter({ hasText: 'Correct this payment' });
  await correction.focus();
  await page.keyboard.press('Enter');
  await receipt.getByRole('button', { name: 'Reverse payment', exact: true }).click();
  const reverse = page.getByRole('dialog', { name: 'Reverse this payment?', exact: true });
  await reverse.getByLabel('Reason for reversal', { exact: true }).fill('Entered ₱500 instead of ₱200.');
  await reverse.getByRole('button', { name: 'Confirm reversal', exact: true }).click();
  await expect.poll(async () => (await rows(page, 'entries')).filter((entry) => entry.kind === 'reversal').length).toBe(1);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.profile-balance')).toHaveText('₱3,000.00');
  await page.locator('main').getByRole('link', { name: 'Record payment', exact: true }).first().click();
  await page.getByLabel('Payment received', { exact: true }).fill('200');
  await page.getByRole('button', { name: 'Confirm payment', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.profile-balance')).toHaveText('₱2,800.00');
  const beforeArchive = await rows(page, 'entries');
  expect(beforeArchive).toHaveLength(4);
  await page.getByRole('button', { name: 'Manage borrower', exact: true }).click();
  const manage = page.getByRole('dialog', { name: 'Manage borrower', exact: true });
  await manage.getByLabel('Archive confirmation phrase', { exact: true }).fill('Delete QA Borrower');
  await manage.getByRole('button', { name: 'Continue to archive', exact: true }).click();
  await manage.getByRole('button', { name: 'Confirm archive', exact: true }).click();
  await expect.poll(async () => (await rows(page, 'borrowers'))[0].archived).toBe(true);
  expect(await rows(page, 'entries')).toEqual(beforeArchive);
  await expect(page.locator('.profile-balance')).toHaveText('₱2,800.00');
  await page.getByRole('tab', { name: 'History', exact: true }).click();
  await expect(page.locator('main')).toContainText('Payment reversed');
  await page.screenshot({ path: testInfo.outputPath('04-preserved-history.png'), fullPage: true });
  await noHorizontalOverflow(page);
});
