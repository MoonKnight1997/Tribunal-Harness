// OPTIONAL developer check — not part of `cargo test` and not a runtime dependency.
// Drives the six interactive pages of the Rust UI in headless Chromium against a
// running th-server started with LLM_PROVIDER=agent, exercising the inline page
// scripts end to end (consent gate → analysis → results, adversarial debate,
// schema explorer, case-law search, schema builder, request access, nav).
//
//   LLM_PROVIDER=agent PORT=3123 cargo run --bin th-server &
//   npm i playwright-core@1.55.0        # in any directory on NODE_PATH
//   BASE=http://127.0.0.1:3123 CHROME=/path/to/chrome OUT=/tmp node scripts/browser-check.js
//
const { chromium } = require('playwright-core');
const BASE = process.env.BASE || 'http://127.0.0.1:3123';
const OUT = process.env.OUT || '.';
const NARRATIVE = "Warehouse employee with ~4 years' service, summarily dismissed on 3 March 2026 for alleged 'gross misconduct' shortly after raising written health and safety concerns. No investigation meeting was held.";

const results = [];
function record(name, pass, detail) { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); }

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) pageErrors.push('console: ' + m.text()); });
  page.on('requestfailed', (r) => pageErrors.push('requestfailed: ' + r.url()));
  const badResponses = [];
  page.on('response', (r) => { if (r.status() >= 400) badResponses.push(r.status() + ' ' + r.url()); });

  // 1. Home: consent gate → analysis → results (agent stand-in) → New Analysis
  await page.goto(BASE + '/');
  record('home loads', (await page.title()) === 'Tribunal Harness | Structured Legal Analysis');
  record('run button disabled before consent', await page.isDisabled('#run-analysis'));
  await page.check('#consent');
  record('run button enabled after consent', !(await page.isDisabled('#run-analysis')));
  await page.fill('#date-of-act', '2026-03-03');
  await page.fill('#facts-narrative', NARRATIVE);
  await page.click('#run-analysis');
  await page.waitForSelector('#results-panel h2:has-text("Analysis Results")', { timeout: 20000 });
  const resultsText = await page.textContent('#results-panel');
  record('analysis results render claims + authorities', resultsText.includes('Identified Claims') && resultsText.includes('Legal Authorities & Epistemic Quarantine'));
  record('procedural roadmap rendered with formatted deadline', resultsText.includes('Procedural Roadmap') && /\d{1,2} \w+ 2026/.test(resultsText));
  record('trust signals hidden on results', await page.isHidden('#trust-signals'));
  await page.screenshot({ path: `${OUT}/home-results.png`, fullPage: true });
  // Timeline accordion toggles
  await page.click('[data-timeline-toggle]');
  record('timeline collapses on click', await page.isHidden('[data-timeline-steps]'));
  await page.click('#new-analysis');
  record('New Analysis resets form', await page.isVisible('#stage-input') && (await page.inputValue('#facts-narrative')) === '' && await page.isDisabled('#run-analysis'));

  // 2. Home: API error surfaces as the error card (consent server-side check bypassed by narrative too short)
  await page.check('#consent');
  await page.fill('#facts-narrative', 'too short');
  await page.click('#run-analysis');
  await page.waitForSelector('#results-panel h3:has-text("Analysis couldn\'t finish")', { timeout: 10000 });
  record('short narrative error card shows API message', (await page.textContent('#results-panel')).includes('minimum 50 characters'));

  // 3. Adversarial debate: single pass then adversarial
  await page.goto(BASE + '/adversarial-debate');
  record('debate button disabled initially', await page.isDisabled('#run-debate'));
  await page.check('#debate-consent');
  record('debate button still disabled with empty facts', await page.isDisabled('#run-debate'));
  await page.fill('#debate-facts', NARRATIVE);
  record('debate button enabled', !(await page.isDisabled('#run-debate')) && (await page.textContent('#run-debate')).trim() === 'Run Single-Pass Debate');
  await page.check('input[name="debate-mode"][value="adversarial"]');
  record('mode switch relabels button', (await page.textContent('#run-debate')).trim() === 'Run Adversarial Debate');
  await page.click('#run-debate');
  await page.waitForSelector('#debate-results h2:has-text("Debate Result")', { timeout: 30000 });
  const debateText = await page.textContent('#debate-results');
  record('adversarial debate renders rounds + final', debateText.includes('ADVERSARIAL') && debateText.includes('Round 1') && debateText.includes('Final, revised argument'));
  await page.screenshot({ path: `${OUT}/debate-results.png`, fullPage: true });
  await page.click('#new-debate');
  record('New Debate returns to input keeping facts', await page.isVisible('#debate-idle') && (await page.inputValue('#debate-facts')) === NARRATIVE);

  // 4. Analysis engine: schema explorer
  await page.goto(BASE + '/analysis-engine');
  await page.click('.ct-button[data-ct="harassment"]');
  await page.waitForSelector('#schema-display h2:has-text("Harassment")', { timeout: 10000 });
  const schemaText = await page.textContent('#schema-display');
  record('schema explorer loads harassment schema', schemaText.includes('EA 2010 s26') && schemaText.includes('Legal Test') && schemaText.includes('Schema Fields ('));

  // 5. Case law DB search
  await page.goto(BASE + '/case-law-db');
  await page.fill('#case-law-query', 'Polkey');
  await page.click('#case-law-submit');
  await page.waitForSelector('#case-law-results h3:has-text("Polkey")', { timeout: 10000 });
  record('case law search renders results', (await page.textContent('#case-law-results')).includes('seed data v1'));
  await page.fill('#case-law-query', '');
  await page.selectOption('#case-law-claim-type', 'redundancy');
  await page.click('#case-law-submit');
  await page.waitForSelector('#case-law-results h3:has-text("Williams v Compair Maxam")', { timeout: 10000 });
  record('claim type filter works', true);

  // 6. Schema builder
  await page.goto(BASE + '/schema-builder');
  await page.fill('#sb-label', 'Date of Notice');
  await page.selectOption('#sb-type', 'date');
  await page.click('#sb-add');
  const sb = await page.textContent('#sb-preview');
  record('schema builder adds a field and shows JSON', (await page.textContent('#sb-title')).trim() === 'Schema Preview (1 fields)' && sb.includes('"label": "Date of Notice"') && sb.includes('"type": "date"'));

  // 7. Request access
  await page.goto(BASE + '/request-access');
  await page.fill('#form-name', 'Ada Lovelace');
  await page.fill('#form-email', 'ada@example.com');
  await page.selectOption('#form-user-type', 'researcher');
  await page.check('#privacy_consent');
  await page.click('#request-access-form button[type="submit"]');
  await page.waitForSelector('#request-access-thanks h1:has-text("Thank you.")', { timeout: 10000 });
  record('request access shows thank-you', await page.isHidden('#request-access-main'));

  // 8. Nav: trust dropdown + mobile hamburger
  await page.goto(BASE + '/about');
  await page.hover('#trust-toggle');
  record('trust dropdown opens on hover', (await page.getAttribute('#trust-toggle', 'aria-expanded')) === 'true');
  await page.setViewportSize({ width: 390, height: 800 });
  await page.click('#mobile-menu-toggle');
  record('mobile menu opens', await page.isVisible('#mobile-menu') && (await page.getAttribute('#mobile-menu-toggle', 'aria-label')) === 'Close menu');
  await page.screenshot({ path: `${OUT}/mobile-menu.png` });

  record('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
  console.log('4xx/5xx responses seen: ' + badResponses.join(' | '));
  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} browser checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
