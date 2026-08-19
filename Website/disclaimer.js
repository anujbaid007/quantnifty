/* Site-wide regulatory disclaimer.
 *
 * Injected rather than written into each page's HTML so that: the markup stays
 * in one place, crawlers still receive a clean document, and visitors with
 * JavaScript disabled are not left staring at an overlay they cannot dismiss.
 * The footer disclosures carry the same statements for that case.
 *
 * Acknowledgement is remembered in localStorage under the key below. That is
 * the only thing this site stores on your device, and /privacy documents it.
 * Bump the version suffix to force every visitor to acknowledge again.
 */
(function () {
  'use strict';

  var KEY = 'qn-disclaimer-ack-v1';

  // Private-mode Safari and hardened browser settings can throw on access.
  // Failing open (showing the notice again) is the safe direction for a
  // regulatory disclaimer, so swallow the error rather than skipping it.
  function acknowledged() {
    try { return window.localStorage.getItem(KEY) === '1'; }
    catch (e) { return false; }
  }
  function remember() {
    try { window.localStorage.setItem(KEY, '1'); } catch (e) { /* no-op */ }
  }

  if (acknowledged()) return;

  var CSS = [
    '.qn-dsc-scrim{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;',
      'justify-content:center;padding:24px;background:rgba(4,9,26,.72);',
      'backdrop-filter:blur(8px) saturate(1.2);-webkit-backdrop-filter:blur(8px) saturate(1.2);',
      'opacity:0;transition:opacity .22s ease}',
    '.qn-dsc-scrim.qn-in{opacity:1}',
    '.qn-dsc{position:relative;width:100%;max-width:540px;max-height:calc(100vh - 48px);overflow-y:auto;',
      'background:#070E24;border:1px solid rgba(147,186,255,.22);border-radius:18px;',
      'padding:30px 30px 26px;box-shadow:0 30px 80px -20px rgba(0,0,0,.7);',
      'transform:translateY(10px) scale(.985);transition:transform .22s ease;',
      'font-family:"Inter Tight",system-ui,-apple-system,sans-serif}',
    '.qn-dsc-scrim.qn-in .qn-dsc{transform:none}',
    '.qn-dsc-kick{display:block;font-family:"JetBrains Mono",ui-monospace,monospace;font-size:10.5px;',
      'letter-spacing:.15em;text-transform:uppercase;color:#5A93FF;font-weight:500;margin-bottom:13px}',
    '.qn-dsc h2{font-family:"Manrope",system-ui,sans-serif;font-size:1.5rem;font-weight:800;',
      'letter-spacing:-.03em;line-height:1.15;color:#fff;margin:0 0 14px;text-wrap:balance}',
    '.qn-dsc p{font-size:14.6px;line-height:1.62;color:#C6D6F5;margin:0 0 12px}',
    '.qn-dsc p strong{color:#fff;font-weight:650}',
    '.qn-dsc-fine{font-size:13.2px !important;color:#8FA0C2 !important}',
    '.qn-dsc-fine a{color:#93BAFF;text-decoration:underline;text-underline-offset:2px}',
    '.qn-dsc-act{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:20px}',
    '.qn-dsc-btn{appearance:none;border:0;cursor:pointer;font:inherit;font-size:14px;font-weight:600;',
      'color:#fff;background:#1B4FD8;padding:12px 24px;border-radius:999px;',
      'box-shadow:0 6px 22px -8px rgba(27,79,216,.9);transition:background .2s,transform .2s}',
    '.qn-dsc-btn:hover{background:#2E6BFF;transform:translateY(-1px)}',
    '.qn-dsc-btn:focus-visible{outline:2px solid #93BAFF;outline-offset:3px}',
    '.qn-dsc-scrim :focus-visible{outline:2px solid #93BAFF;outline-offset:3px;border-radius:4px}',
    'html.qn-dsc-lock,body.qn-dsc-lock{overflow:hidden}',
    '@media(max-width:560px){.qn-dsc{padding:24px 22px 22px}.qn-dsc h2{font-size:1.3rem}}',
    '@media(prefers-reduced-motion:reduce){.qn-dsc-scrim,.qn-dsc{transition:none}}'
  ].join('');

  function build() {
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    var scrim = document.createElement('div');
    scrim.className = 'qn-dsc-scrim';
    scrim.setAttribute('role', 'dialog');
    scrim.setAttribute('aria-modal', 'true');
    scrim.setAttribute('aria-labelledby', 'qn-dsc-title');
    scrim.setAttribute('aria-describedby', 'qn-dsc-body');

    scrim.innerHTML =
      '<div class="qn-dsc">' +
        '<span class="qn-dsc-kick">Please read</span>' +
        '<h2 id="qn-dsc-title">We are not SEBI registered.</h2>' +
        '<div id="qn-dsc-body">' +
          '<p>QuantNifty is <strong>not</strong> a SEBI-registered Portfolio Manager, Research ' +
            'Analyst or Investment Adviser. We do not manage client money, and we do not sell ' +
            'tips, signals or recommendations.</p>' +
          '<p>We are a technology-first firm. We help market participants build and test their ' +
            'own algo-tech stack. <strong>Nothing on this site is investment advice.</strong></p>' +
          '<p class="qn-dsc-fine">Performance figures shown anywhere on this site are ' +
            '<strong>backtested</strong>, not a live track record, and do not predict future ' +
            'results. Derivatives carry substantial risk: options trading can lose more than your ' +
            'initial capital, and pledging equity as collateral places those holdings at risk. ' +
            'Full terms and risk disclosure: <a href="/terms">Terms &amp; Conditions</a>.</p>' +
        '</div>' +
        '<div class="qn-dsc-act">' +
          '<button type="button" class="qn-dsc-btn" id="qn-dsc-ok">I understand</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(scrim);

    var opener = document.activeElement;
    var btn = scrim.querySelector('#qn-dsc-ok');
    var focusables = scrim.querySelectorAll('a[href],button');

    document.documentElement.classList.add('qn-dsc-lock');
    document.body.classList.add('qn-dsc-lock');

    requestAnimationFrame(function () { scrim.classList.add('qn-in'); });
    btn.focus();

    // Keep focus inside the dialog. There is deliberately no Escape or
    // backdrop dismissal: acknowledgement should be a positive action.
    function onKey(e) {
      if (e.key !== 'Tab' || focusables.length === 0) return;
      var first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    scrim.addEventListener('keydown', onKey);

    btn.addEventListener('click', function () {
      remember();
      scrim.classList.remove('qn-in');
      document.documentElement.classList.remove('qn-dsc-lock');
      document.body.classList.remove('qn-dsc-lock');
      window.setTimeout(function () {
        scrim.remove();
        if (opener && typeof opener.focus === 'function') opener.focus();
      }, 220);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
