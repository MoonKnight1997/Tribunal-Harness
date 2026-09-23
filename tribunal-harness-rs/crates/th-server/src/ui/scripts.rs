//! Inline scripts for the interactive pages. Each calls the same `/api/*`
//! routes the React pages called, with the same request bodies, and swaps
//! in server-rendered fragments for the results.

/// NavBar state (hamburger + Trust dropdown) and the Timeline accordion.
pub const GLOBAL: &str = r##"
(function () {
  var trust = document.getElementById('trust-menu');
  var trustBtn = document.getElementById('trust-toggle');
  function setTrust(open) {
    if (!trust) return;
    trust.classList.toggle('trust-open', open);
    if (trustBtn) trustBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  if (trust) {
    trust.addEventListener('mouseenter', function () { setTrust(true); });
    trust.addEventListener('mouseleave', function () { setTrust(false); });
    trust.addEventListener('focusin', function () { setTrust(true); });
    trust.addEventListener('focusout', function (e) { if (!trust.contains(e.relatedTarget)) setTrust(false); });
    trust.addEventListener('keydown', function (e) { if (e.key === 'Escape') setTrust(false); });
    trustBtn.addEventListener('click', function () { setTrust(!trust.classList.contains('trust-open')); });
  }
  var menuBtn = document.getElementById('mobile-menu-toggle');
  var menu = document.getElementById('mobile-menu');
  if (menuBtn && menu) {
    var iconOpen = document.getElementById('menu-icon-open');
    var iconClose = document.getElementById('menu-icon-close');
    function setMenu(open) {
      menu.classList.toggle('open', open);
      menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      menuBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      iconOpen.hidden = open;
      iconClose.hidden = !open;
    }
    menuBtn.addEventListener('click', function () { setMenu(!menu.classList.contains('open')); });
    menu.querySelectorAll('a').forEach(function (a) { a.addEventListener('click', function () { setMenu(false); }); });
  }
  // Timeline accordion (one stage expanded at a time).
  document.addEventListener('click', function (e) {
    var toggle = e.target.closest && e.target.closest('[data-timeline-toggle]');
    if (!toggle) return;
    var stage = toggle.closest('[data-timeline-stage]');
    var wasOpen = stage.classList.contains('expanded');
    var all = stage.parentElement.querySelectorAll('[data-timeline-stage]');
    all.forEach(function (c) { setStage(c, false); });
    if (!wasOpen) setStage(stage, true);
    function setStage(c, open) {
      c.classList.toggle('expanded', open);
      c.classList.toggle('border-opacity-100', open);
      c.classList.toggle('bg-[rgba(255,255,255,0.02)]', open);
      c.classList.toggle('border-opacity-40', !open);
      c.classList.toggle('hover:border-opacity-60', !open);
      c.style.borderColor = open ? c.getAttribute('data-color') : '';
      c.querySelector('[data-timeline-steps]').hidden = !open;
      c.querySelector('[data-chev="down"]').hidden = !open;
      c.querySelector('[data-chev="right"]').hidden = open;
    }
  });
})();
"##;

/// Home page (`src/app/page.tsx` + `ClaimInputPanel`).
pub const HOME: &str = r##"
(function () {
  var ANALYSIS_ERROR_MESSAGE = "We couldn't complete your analysis just now. This is usually a temporary connection problem, not a problem with your case or anything you did. Please check your internet connection and try again in a moment. Your details have not been lost.";
  var $ = function (id) { return document.getElementById(id); };
  var stages = { input: $('stage-input'), analyzing: $('stage-analyzing'), results: $('stage-results') };
  var trust = $('trust-signals');
  function show(stage) {
    Object.keys(stages).forEach(function (k) { stages[k].hidden = (k !== stage); });
    trust.hidden = stage !== 'input';
    if (stage !== 'analyzing') window.scrollTo({ top: 0 });
  }
  function postJson(url, body) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  async function renderResults(results, timeline) {
    var res = await postJson('/_ui/fragments/analysis-results', { results: results, timeline: timeline });
    $('results-panel').innerHTML = await res.text();
    show('results');
  }
  $('consent').addEventListener('change', function (e) { $('run-analysis').disabled = !e.target.checked; });
  $('run-analysis').addEventListener('click', async function () {
    var payload = { claimType: $('claim-type').value, dateOfLastAct: $('date-of-act').value, narrative: $('facts-narrative').value, hasConsented: $('consent').checked };
    show('analyzing');
    try {
      var res = await postJson('/api/analyse', {
        claim_type: payload.claimType,
        schema_fields: {},
        narrative_text: payload.narrative,
        key_dates: { date_of_last_act: payload.dateOfLastAct },
        mode: 'narrative',
        consent: payload.hasConsented
      });
      var data = await res.json();
      var roadmapRes = await postJson('/api/roadmap', { claimType: payload.claimType, dateOfLastAct: payload.dateOfLastAct });
      var roadmapData = await roadmapRes.json();
      await renderResults(data, roadmapData);
    } catch (err) {
      console.error('Analysis request failed:', err);
      await renderResults({ error: ANALYSIS_ERROR_MESSAGE }, []);
    }
  });
  var drop = $('drop-zone');
  drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('dragging'); drop.textContent = 'Drop File'; });
  drop.addEventListener('dragleave', function () { drop.classList.remove('dragging'); drop.textContent = 'Upload Document (PDF/DOCX)'; });
  drop.addEventListener('drop', async function (e) {
    e.preventDefault();
    drop.classList.remove('dragging');
    drop.textContent = 'Upload Document (PDF/DOCX)';
    var file = e.dataTransfer.files[0];
    if (!file) return;
    show('analyzing');
    var formData = new FormData();
    formData.append('document', file);
    try {
      var res = await fetch('/api/triage', { method: 'POST', body: formData });
      var data = await res.json();
      var roadmapRes = await postJson('/api/roadmap', { dateOfLastAct: new Date().toISOString() });
      var roadmapData = await roadmapRes.json();
      await renderResults(data, roadmapData);
    } catch (err) {
      console.error('Document triage request failed:', err);
      await renderResults({ error: ANALYSIS_ERROR_MESSAGE }, []);
    }
  });
  $('new-analysis').addEventListener('click', function () {
    // The React input panel re-mounted with fresh state.
    $('claim-type').value = 'unfair_dismissal';
    $('date-of-act').value = '';
    $('facts-narrative').value = '';
    $('consent').checked = false;
    $('run-analysis').disabled = true;
    $('results-panel').innerHTML = '';
    show('input');
  });
})();
"##;

/// Adversarial debate page.
pub const ADVERSARIAL_DEBATE: &str = r##"
(function () {
  var ERROR_MESSAGES = {
    notConfigured: "The adversarial debate engine isn't switched on in this environment yet, so it can't run right now. This is a configuration issue on our side, not a problem with your case. Please try again later.",
    rateLimited: "You've run several debates in a short space of time and reached a temporary limit. This is a fairness cap, not a problem with your case. Please wait a little while and try again.",
    generic: "We couldn't complete the debate just now. This is usually a temporary connection problem, not a problem with your case or anything you did. Please try again in a moment — your details have not been lost."
  };
  var $ = function (id) { return document.getElementById(id); };
  var states = { idle: $('debate-idle'), running: $('debate-running'), done: $('debate-done') };
  function setStatus(s) { Object.keys(states).forEach(function (k) { states[k].hidden = (k !== s); }); }
  function mode() { var r = document.querySelector('input[name="debate-mode"]:checked'); return r ? r.value : 'single_pass'; }
  function higherCost() { return mode() === 'adversarial'; }
  function refresh() {
    var facts = $('debate-facts').value;
    $('run-debate').disabled = !$('debate-consent').checked || facts.trim().length === 0;
    $('run-debate').textContent = higherCost() ? 'Run Adversarial Debate' : 'Run Single-Pass Debate';
    $('running-title').textContent = higherCost() ? 'Running Adversarial Rounds' : 'Running the Debate';
    $('running-subtitle').textContent = higherCost() ? 'Draft → Attack → Revise → Score · this can take a while' : 'Drafter → Critic → Judge';
    document.querySelectorAll('.mode-option').forEach(function (l) { l.classList.toggle('selected', l.querySelector('input').checked); });
  }
  document.querySelectorAll('input[name="debate-mode"]').forEach(function (r) { r.addEventListener('change', refresh); });
  $('debate-consent').addEventListener('change', refresh);
  $('debate-facts').addEventListener('input', refresh);
  refresh();
  function showError(msg) {
    $('debate-error-text').textContent = msg;
    $('debate-error').hidden = false;
    $('debate-results').hidden = true;
    $('debate-results').innerHTML = '';
    setStatus('done');
  }
  $('run-debate').addEventListener('click', async function () {
    setStatus('running');
    $('debate-error').hidden = true;
    $('debate-results').innerHTML = '';
    try {
      var res = await fetch('/api/debate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facts: $('debate-facts').value, claim_type: $('debate-claim-type').value, mode: mode() })
      });
      var data = {};
      try { data = await res.json(); } catch (e) { /* non-JSON body */ }
      if (!res.ok) {
        console.error('Debate request failed:', res.status, data && data.error);
        if (res.status === 429) showError(ERROR_MESSAGES.rateLimited);
        else if (typeof (data && data.error) === 'string' && data.error.includes('ANTHROPIC_API_KEY')) showError(ERROR_MESSAGES.notConfigured);
        else showError(ERROR_MESSAGES.generic);
        return;
      }
      var frag = await fetch('/_ui/fragments/debate-results', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      $('debate-results').innerHTML = await frag.text();
      $('debate-results').hidden = false;
      setStatus('done');
    } catch (err) {
      console.error('Debate request failed:', err);
      showError(ERROR_MESSAGES.generic);
    }
  });
  $('new-debate').addEventListener('click', function () {
    $('debate-error').hidden = true;
    $('debate-results').innerHTML = '';
    setStatus('idle');
  });
})();
"##;

/// Analysis engine page (schema explorer).
pub const ANALYSIS_ENGINE: &str = r##"
(function () {
  var display = document.getElementById('schema-display');
  document.querySelectorAll('.ct-button').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      document.querySelectorAll('.ct-button').forEach(function (b) { b.classList.toggle('active', b === btn); });
      display.innerHTML = '<p>Loading schema...</p>';
      try {
        var res = await fetch('/_ui/fragments/schema/' + encodeURIComponent(btn.getAttribute('data-ct')));
        display.innerHTML = await res.text();
      } catch (e) {
        display.innerHTML = '<p style="color:var(--color-text-secondary)">Select a claim type to explore its schema.</p>';
      }
    });
  });
})();
"##;

/// Case law database page.
pub const CASE_LAW_DB: &str = r##"
(function () {
  var form = document.getElementById('case-law-form');
  var results = document.getElementById('case-law-results');
  var submit = document.getElementById('case-law-submit');
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    var query = document.getElementById('case-law-query').value;
    var claimType = document.getElementById('case-law-claim-type').value;
    if (!query.trim() && !claimType) return;
    submit.disabled = true;
    submit.textContent = 'Searching...';
    try {
      var params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      if (claimType) params.set('claim_type', claimType);
      params.set('limit', '10');
      var res = await fetch('/_ui/fragments/case-law-results?' + params);
      results.innerHTML = await res.text();
    } catch (err) {
      var tpl = document.getElementById('case-law-error-template');
      var node = tpl.content.firstElementChild.cloneNode(true);
      node.textContent = 'Network error. Please try again.';
      results.innerHTML = '';
      results.appendChild(node);
    } finally {
      submit.disabled = false;
      submit.textContent = 'Search';
    }
  });
})();
"##;

/// Schema builder page (client-only state).
pub const SCHEMA_BUILDER: &str = r##"
(function () {
  var fields = [];
  var label = document.getElementById('sb-label');
  var type = document.getElementById('sb-type');
  var preview = document.getElementById('sb-preview');
  var title = document.getElementById('sb-title');
  function render() {
    title.textContent = 'Schema Preview (' + fields.length + ' fields)';
    preview.innerHTML = '';
    if (fields.length === 0) {
      var p = document.createElement('p');
      p.style.cssText = 'color:var(--color-text-secondary);font-size:0.85rem';
      p.textContent = 'No fields added yet.';
      preview.appendChild(p);
      return;
    }
    var list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:0.5rem';
    fields.forEach(function (f) {
      var row = document.createElement('div');
      row.style.cssText = 'padding:0.75rem;border:1px solid var(--color-border-subtle);border-radius:6px;display:flex;justify-content:space-between;align-items:center';
      var a = document.createElement('span'); a.textContent = f.label;
      var b = document.createElement('span'); b.style.cssText = 'font-family:var(--font-mono);font-size:0.75rem;color:var(--color-text-secondary)'; b.textContent = f.type;
      row.appendChild(a); row.appendChild(b); list.appendChild(row);
    });
    preview.appendChild(list);
    var pre = document.createElement('pre');
    pre.style.cssText = 'margin-top:1.5rem;padding:1rem;background:rgba(255,255,255,0.02);border-radius:6px;font-size:0.75rem;font-family:var(--font-mono);overflow:auto;max-height:300px;color:var(--color-text-secondary)';
    pre.textContent = JSON.stringify({ fields: fields }, null, 2);
    preview.appendChild(pre);
  }
  document.getElementById('sb-add').addEventListener('click', function () {
    if (!label.value) return;
    fields.push({ label: label.value, type: type.value, required: false });
    label.value = '';
    type.value = 'text';
    render();
  });
})();
"##;

/// Request access page.
pub const REQUEST_ACCESS: &str = r##"
(function () {
  var form = document.getElementById('request-access-form');
  var errorEl = document.getElementById('request-access-error');
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    errorEl.hidden = true;
    errorEl.textContent = '';
    var body = {
      name: document.getElementById('form-name').value,
      email: document.getElementById('form-email').value,
      user_type: document.getElementById('form-user-type').value,
      description: document.getElementById('form-description').value
    };
    try {
      var res = await fetch('/api/request-access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      var data = await res.json();
      if (data.success) {
        document.getElementById('request-access-main').hidden = true;
        document.getElementById('request-access-thanks').hidden = false;
        window.scrollTo({ top: 0 });
      } else {
        errorEl.textContent = data.error || 'Something went wrong.';
        errorEl.hidden = false;
      }
    } catch (err) {
      errorEl.textContent = 'Network error. Please try again.';
      errorEl.hidden = false;
    }
  });
})();
"##;
