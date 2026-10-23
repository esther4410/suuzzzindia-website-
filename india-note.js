// India-only price bar for visitors who came in from /international
// ("Continue to the India store" sets the sl_india cookie). Indian visitors never get the cookie.
// Loaded right after <body> on the store and checkout pages.
(function () {
  if (!/(?:^|;\s*)sl_india=1/.test(document.cookie)) return;
  var bar = document.createElement("div");
  bar.setAttribute("role", "note");
  bar.style.cssText = "background:#D2A54C;color:#2A1A38;text-align:center;font-size:12px;font-weight:600;letter-spacing:.02em;padding:9px 16px;line-height:1.45";
  bar.innerHTML = "<b>Ships within India only.</b> All prices are India prices in INR and do not apply to international orders. " +
    "<a href=\"/international\" style=\"color:#4A3060;font-weight:800\">International pricing &rarr;</a>";
  var me = document.currentScript;
  me.parentNode.insertBefore(bar, me);
})();
