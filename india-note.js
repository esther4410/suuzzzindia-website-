// India-only price bar for visitors who came in from /international
// ("Continue to the India store" sets the sl_india cookie). Indian visitors never get the cookie.
// Loaded right after <body> on the store and checkout pages.
(function () {
  if (!/(?:^|;\s*)sl_india=1/.test(document.cookie)) return;
  var bar = document.createElement("div");
  bar.setAttribute("role", "note");
  bar.style.cssText = "background:#D2A54C;color:#2A1A38;text-align:center;font-size:12px;font-weight:600;letter-spacing:.02em;padding:9px 16px;line-height:1.45";
  bar.innerHTML = "<span style=\"display:inline-block;margin-right:8px;padding:2px 9px;border-radius:999px;background:#4A3060;color:#FFFFFF;font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase\">India only</span>" +
    "<b>All prices are for India only</b> (INR, delivery within India). They do not apply to international orders. " +
    "<a href=\"/international\" style=\"color:#4A3060;font-weight:800\">International pricing &rarr;</a>";
  var me = document.currentScript;
  me.parentNode.insertBefore(bar, me);
})();
