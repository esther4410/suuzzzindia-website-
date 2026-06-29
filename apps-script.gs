// ============================================================
// Safar Lee — Google Apps Script Backend
// Deploy: Extensions > Apps Script > Deploy > Web App
//         Execute as: Me | Access: Anyone
// ============================================================

const SPREADSHEET_ID = '1nO9sgSkP2JxA9hdRs3SpqLAxkpWKP_oMchXt1AlxUvo';
const INVENTORY_GID  = 896187980;

const PRODUCT_FOLDER_ID = '1DFOqdi4UxWgbWD4KZRzJaULbyK5XpWq2'; // Drive: 제품사진 폴더 (flat)

const UPI_ID   = 'supplier@gpay';
const UPI_NAME = 'Safar Lee';
vscode-webview://1njmj48uur7t7ls494leq0eu0ujto368q32t8cdegep05ttaonit/Safar%20Lee/Marketing/C4%20-%20Odd%20Nature%20Reveal%20Film.md
const SHIPPING_FREE_THRESHOLD = 2300;
const SHIPPING_FEE = 80;

const WEBSITE_URL = 'https://safarlee-website.vercel.app';

// ─── Router ──────────────────────────────────────────────────

function doGet(e) {
  const action = e && e.parameter && e.parameter.action;
  try {
    if (action === 'products') return ok(getProducts());
    if (action === 'track')    return ok(trackOrder(e.parameter.email, e.parameter.code));
    if (action === 'catalog')  return getCatalogFeed();
  } catch(err) {
    return fail(err.message);
  }
  return ok({ status: 'ok' });
}

function doPost(e) {
  // PhonePe webhook: URL에 ?phonePeWebhook=1 파라미터로 구분
  if (e.parameter && e.parameter.phonePeWebhook) {
    return handlePhonePeWebhook(e);
  }
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.action === 'order')         return ok(createOrder(data));
    if (data.action === 'verifyPayment') return ok(handlePaymentVerification(data));
    if (data.action === 'waitlist')      return ok(addToWaitlist(data));
    if (data.action === 'preLaunchLead') return ok(addPreLaunchLead(data));
  } catch(err) {
    return fail(err.message);
  }
  return fail('Unknown action');
}

// ─── Products ────────────────────────────────────────────────

function getProducts() {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheets().find(s => s.getSheetId() === INVENTORY_GID);
  const rows  = sheet.getDataRange().getValues();
  const keys  = rows[0];

  const imageMap = getImageMapFromDrive();

  const products = rows.slice(1)
    .filter(r => r[0])
    .map(r => {
      const p = {};
      keys.forEach((k, i) => p[k] = r[i]);

      const sku  = String(p.sku || p.SKU || r[0]).trim();
      const imgs = imageMap[sku] || [];
      p.images = imgs;
      imgs.forEach((url, idx) => {
        p['image' + (idx + 1)] = url;
      });
      // 프론트엔드 호환: 시트 Image URL 필드 덮어쓰기
      if (imgs[0]) p['Image URL']   = imgs[0];
      if (imgs[1]) p['Image URL 2'] = imgs[1];
      if (imgs[2]) p['Image URL 3'] = imgs[2];
      if (imgs[3]) p['Image URL 4'] = imgs[3];
      if (imgs[4]) p['Image URL 5'] = imgs[4];

      return p;
    })
    // status 컬럼: 'active' 만 노출. 'draft' / 'archived' / 빈칸 = 숨김.
    // 헤더 대소문자 무관 (Status / status 둘 다 지원)
    .filter(p => String(p.status || p.Status || '').toLowerCase() === 'active');

  return { products };
}

// ─── Drive 자동 스캔 (flat 폴더: <SKU>.<ext> / <SKU>-2.<ext>) ──

function getImageMapFromDrive() {
  const cache  = CacheService.getScriptCache();
  const cached = cache.get('product_images');
  if (cached) return JSON.parse(cached);

  const folder = DriveApp.getFolderById(PRODUCT_FOLDER_ID);
  const files  = folder.getFiles();
  const groups = {};

  while (files.hasNext()) {
    const f    = files.next();
    const mime = f.getMimeType();
    if (mime.indexOf('image/') !== 0) continue;

    const fullName = f.getName();
    const lastDot  = fullName.lastIndexOf('.');
    const base     = (lastDot === -1 ? fullName : fullName.substring(0, lastDot)).trim();

    let sku, idx;
    const m = base.match(/^(.+?)-(\d+)$/);
    if (m) { sku = m[1]; idx = parseInt(m[2], 10); }
    else   { sku = base; idx = 1; }

    if (!groups[sku]) groups[sku] = [];
    groups[sku].push({
      idx: idx,
      url: 'https://drive.google.com/thumbnail?id=' + f.getId() + '&sz=w1200'
    });
  }

  const map = {};
  Object.keys(groups).forEach(function(sku) {
    groups[sku].sort(function(a, b) { return a.idx - b.idx; });
    map[sku] = groups[sku].map(function(i) { return i.url; });
  });

  cache.put('product_images', JSON.stringify(map), 300); // 5분
  return map;
}

// 모든 제품사진 "Anyone with link" 공개 설정. 새 이미지 추가 후 1회 실행.
function makeProductImagesPublic() {
  const folder = DriveApp.getFolderById(PRODUCT_FOLDER_ID);
  Logger.log('Folder name: ' + folder.getName());
  const files = folder.getFiles();
  let total   = 0;
  let updated = 0;
  while (files.hasNext()) {
    const f = files.next();
    total++;
    try {
      f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      updated++;
    } catch(e) {
      Logger.log('Failed: ' + f.getName() + ' — ' + e.message);
    }
  }
  Logger.log('Total files: ' + total + ', Made public: ' + updated);
  return { total: total, updated: updated };
}

// 5분 캐시 강제 갱신
function refreshImageCache() {
  CacheService.getScriptCache().remove('product_images');
  const map = getImageMapFromDrive();
  Logger.log('Cache refreshed. SKUs: ' + Object.keys(map).length);
  return { skus: Object.keys(map).length };
}

// ─── Create Order ─────────────────────────────────────────────

// 시트 수식 인젝션 방지: 유저 입력이 =, +, -, @ 로 시작하면 작은따옴표 prefix
function safe(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /^[=+\-@]/.test(s.trim()) ? "'" + s : s;
}

function createOrder(data) {
  // 봇 차단: honeypot 필드 채워진 요청은 fake success 후 무처리
  if (data.website || data.url || data.honeypot) {
    return { success: true, orderCode: 'BOT-REJECTED', total: 0, shipping: 0, upiLink: '' };
  }

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  let orderSheet = ss.getSheetByName('OrderLog');
  if (!orderSheet) {
    orderSheet = ss.insertSheet('OrderLog');
    orderSheet.appendRow([
      'OrderCode','Date','Name','Email','Phone',
      'Address','City','Pincode','Items',
      'Subtotal','Discount','Shipping','Total','Status','TrackingNumber','StockDeducted'
    ]);
    orderSheet.setFrozenRows(1);
  }

  const code     = 'SAFAR-' + Math.random().toString(36).substr(2, 6).toUpperCase();
  const date     = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss');
  const itemsStr = data.items.map(i => `${i.sku} x${i.qty}`).join(', ');
  const shipping = data.subtotal >= SHIPPING_FREE_THRESHOLD ? 0 : SHIPPING_FEE;
  const discount = data.discount || 0;
  const total    = data.subtotal - discount + shipping;

  orderSheet.appendRow([
    code, date,
    safe(data.name), safe(data.email), safe(data.phone),
    safe(data.address), safe(data.city), safe(data.pincode),
    itemsStr,
    data.subtotal, discount, shipping, total,
    'PENDING_PAYMENT', ''
  ]);

  const outOfStock = checkStock(data.items);
  if (outOfStock) throw new Error(outOfStock + ' is out of stock. Please remove it from your cart.');

  upsertCustomer(data);

  const totalPaise = total * 100; // PhonePe expects amount in paise (₹1 = 100 paise)
  const phonepeUrl = createPhonePePayment(code, totalPaise, safe(data.phone));

  return { success: true, orderCode: code, total, shipping, phonepeUrl };
}

// ─── Order Confirmation Email ─────────────────────────────────

function sendOrderConfirmation(data, code, total, shipping, upiLink) {
  const itemRows = (data.items || []).map(i =>
    `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #DCD0BA;">${i.sku}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #DCD0BA;text-align:center;">x${i.qty}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #DCD0BA;text-align:right;">₹${(i.price || 0) * i.qty}</td>
    </tr>`
  ).join('');

  const shipText = shipping === 0
    ? '<span style="color:#644678;font-weight:600;">Free</span>'
    : `₹${shipping}`;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:'Helvetica Neue',Arial,sans-serif;">
<div style="max-width:520px;margin:48px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 8px 48px rgba(74,66,72,0.13);">
  <div style="background:#644678;padding:32px 32px 24px;text-align:center;">
    <p style="margin:0 0 6px;color:#D2A54C;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Safar Lee</p>
    <h1 style="margin:0;color:#fff;font-size:24px;font-weight:700;">Order Confirmed! 🎉</h1>
  </div>
  <div style="padding:28px 32px;">
    <p style="margin:0 0 4px;color:#6B5F66;font-size:14px;">Hi <strong>${data.name}</strong>,</p>
    <p style="margin:0 0 24px;color:#9A8E94;font-size:13px;">Thank you for your order! Please save your order code — you'll need it to track your delivery.</p>
    <div style="background:#ECE3D2;border-radius:14px;padding:20px;text-align:center;margin-bottom:24px;">
      <p style="margin:0 0 6px;color:#9A8E94;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">Your Order Code</p>
      <p style="margin:0;color:#644678;font-size:28px;font-weight:800;letter-spacing:3px;">${code}</p>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
      <thead>
        <tr style="background:#ECE3D2;">
          <th style="padding:8px 12px;text-align:left;font-size:12px;color:#9A8E94;font-weight:600;">Item</th>
          <th style="padding:8px 12px;text-align:center;font-size:12px;color:#9A8E94;font-weight:600;">Qty</th>
          <th style="padding:8px 12px;text-align:right;font-size:12px;color:#9A8E94;font-weight:600;">Price</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>
    <div style="border-top:2px solid #DCD0BA;padding-top:16px;">
      <p style="margin:4px 0;font-size:13px;color:#6B5F66;">Shipping: ${shipText}</p>
      <p style="margin:8px 0 0;font-size:16px;font-weight:700;color:#4A4248;">Total: ₹${total}</p>
    </div>
    <div style="margin:24px 0;background:#F5EFE0;border-radius:12px;padding:16px;">
      <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#4A4248;">💳 How to Pay</p>
      <p style="margin:0 0 14px;font-size:13px;color:#6B5F66;">Your order ships once payment is confirmed.<br>Send <strong>₹${total}</strong> via GPay / PhonePe / Paytm to <strong>${UPI_ID}</strong></p>
      <div style="text-align:center;">
        <a href="${upiLink}" style="display:inline-block;background:#D2A54C;color:#4A4248;text-decoration:none;padding:16px 36px;border-radius:12px;font-size:15px;font-weight:800;letter-spacing:0.3px;">💳 Pay Now — ₹${total}</a>
      </div>
    </div>
  </div>
  <div style="padding:20px 32px;border-top:1px solid #DCD0BA;text-align:center;">
    <p style="margin:0 0 6px;font-size:12px;color:#9A8E94;">Follow us for restocks, new drops & behind the scenes</p>
    <a href="https://instagram.com/safar.lee" style="color:#644678;font-size:18px;font-weight:800;text-decoration:underline;">→ @safar.lee</a>
  </div>
</div>
</body>
</html>`;

  try {
    MailApp.sendEmail({ to: data.email, subject: `Safar Lee — Order Confirmed ${code}`, htmlBody: html });
  } catch(e) {
    Logger.log('Order email failed: ' + e.message);
  }
}

// ─── Payment Confirmed Email ──────────────────────────────────
// Trigger: onOrderSheetEdit — Status column → CONFIRMED

function sendPaymentConfirmedEmail(order) {
  const trackUrl = `https://safarlee-website.vercel.app/track.html?email=${encodeURIComponent(order['Email'])}&code=${encodeURIComponent(order['OrderCode'])}`;
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:'Helvetica Neue',Arial,sans-serif;">
<div style="max-width:520px;margin:48px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 8px 48px rgba(74,66,72,0.13);">
  <div style="background:#644678;padding:32px 32px 24px;text-align:center;">
    <p style="margin:0 0 6px;color:#D2A54C;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Safar Lee</p>
    <h1 style="margin:0;color:#fff;font-size:24px;font-weight:700;">Payment Confirmed! ✅</h1>
  </div>
  <div style="padding:28px 32px;">
    <p style="margin:0 0 4px;color:#6B5F66;font-size:14px;">Hi <strong>${order['Name']}</strong>,</p>
    <p style="margin:0 0 20px;color:#9A8E94;font-size:13px;">Order <strong>${order['OrderCode']}</strong></p>
    <div style="background:#F0FBF0;border-radius:14px;padding:20px;margin-bottom:24px;">
      <p style="margin:0 0 8px;font-size:15px;font-weight:700;color:#4A4248;">Thank you for your purchase! 🎁</p>
      <p style="margin:0;font-size:13px;color:#6B5F66;line-height:1.7;">We're so happy to have your order confirmed.<br>We'll pack it with love and care — shipping update coming soon!</p>
    </div>
    <div style="text-align:center;">
      <a href="${trackUrl}" style="display:inline-block;background:#644678;color:#fff;text-decoration:none;padding:14px 28px;border-radius:12px;font-size:14px;font-weight:600;">Track My Order →</a>
    </div>
  </div>
  <div style="padding:20px 32px;border-top:1px solid #DCD0BA;text-align:center;">
    <p style="margin:0 0 6px;font-size:12px;color:#9A8E94;">Follow us for restocks, new drops & behind the scenes</p>
    <a href="https://instagram.com/safar.lee" style="color:#644678;font-size:18px;font-weight:800;text-decoration:underline;">→ @safar.lee</a>
  </div>
</div>
</body>
</html>`;

  try {
    MailApp.sendEmail({ to: order['Email'], subject: `Safar Lee — Payment Confirmed ✅`, htmlBody: html });
  } catch(e) {
    Logger.log('Payment email failed: ' + e.message);
  }
}

// ─── Shipped Email ────────────────────────────────────────────
// Trigger: onOrderSheetEdit — TrackingNumber column filled

function sendShippedEmail(order, trackingNum) {
  const trackUrl = `https://www.aftership.com/track/${trackingNum}`;
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:'Helvetica Neue',Arial,sans-serif;">
<div style="max-width:520px;margin:48px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 8px 48px rgba(74,66,72,0.13);">
  <div style="background:#644678;padding:32px 32px 24px;text-align:center;">
    <p style="margin:0 0 6px;color:#D2A54C;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Safar Lee</p>
    <h1 style="margin:0;color:#fff;font-size:24px;font-weight:700;">Your order is on its way! 📦</h1>
  </div>
  <div style="padding:28px 32px;">
    <p style="margin:0 0 4px;color:#6B5F66;font-size:14px;">Hi <strong>${order['Name']}</strong>,</p>
    <p style="margin:0 0 24px;color:#9A8E94;font-size:13px;">Order <strong>${order['OrderCode']}</strong> has been shipped!</p>
    <div style="background:#ECE3D2;border-radius:14px;padding:20px;text-align:center;margin-bottom:24px;">
      <p style="margin:0 0 6px;color:#9A8E94;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">Tracking Number</p>
      <p style="margin:0;color:#644678;font-size:22px;font-weight:800;letter-spacing:2px;">${trackingNum}</p>
    </div>
    <div style="text-align:center;margin-bottom:12px;">
      <a href="${trackUrl}" style="display:inline-block;background:#644678;color:#fff;text-decoration:none;padding:14px 28px;border-radius:12px;font-size:14px;font-weight:600;">Track My Package →</a>
    </div>
    <p style="text-align:center;font-size:12px;color:#9A8E94;margin:0;">Supports all major Indian couriers</p>
  </div>
  <div style="padding:20px 32px;border-top:1px solid #DCD0BA;text-align:center;">
    <p style="margin:0 0 6px;font-size:12px;color:#9A8E94;">Follow us for restocks, new drops & behind the scenes</p>
    <a href="https://instagram.com/safar.lee" style="color:#644678;font-size:18px;font-weight:800;text-decoration:underline;">→ @safar.lee</a>
  </div>
</div>
</body>
</html>`;

  try {
    MailApp.sendEmail({ to: order['Email'], subject: `Safar Lee — Your order is on its way! 📦`, htmlBody: html });
  } catch(e) {
    Logger.log('Shipping email failed: ' + e.message);
  }
}

// ─── Sheet Edit Trigger ───────────────────────────────────────
//   함수: onOrderSheetEdit / 이벤트: 스프레드시트 수정 시

function onOrderSheetEdit(e) {
  const sheet = e.source.getActiveSheet();
  if (sheet.getName() !== 'OrderLog') return;
  const row = e.range.getRow();
  if (row < 2) return;

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const rowData = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
  const order   = {};
  headers.forEach((h, i) => order[h] = rowData[i]);

  const col = e.range.getColumn();
  const statusCol   = headers.indexOf('Status') + 1;
  const trackingCol = headers.indexOf('TrackingNumber') + 1;

  if (col === statusCol && e.value === 'CONFIRMED') {
    sendPaymentConfirmedEmail(order);
  }
  if (col === statusCol && e.value === 'CANCELLED') {
    if (order['StockDeducted'] === 'YES') restoreStock(order['Items']);
  }
  if (col === trackingCol && e.value) {
    sendShippedEmail(order, e.value);
  }
}

// ─── Waitlist ─────────────────────────────────────────────────

function addToWaitlist(data) {
  if (data.website || data.url || data.honeypot) return { success: true };
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName('Waitlist');
  if (!sheet) {
    sheet = ss.insertSheet('Waitlist');
    sheet.appendRow(['Date','Name','Email']);
    sheet.setFrozenRows(1);
  }
  const date = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss');
  sheet.appendRow([date, safe(data.name), safe(data.email)]);
  return { success: true };
}

// ─── Pre-Launch Lead ──────────────────────────────────────────

function addPreLaunchLead(data) {
  if (data.website || data.url || data.honeypot) return { success: true };
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName('PreLaunchLeads');
  if (!sheet) {
    sheet = ss.insertSheet('PreLaunchLeads');
    sheet.appendRow(['Date','Name','Email','Phone','Address','City','Pincode','Items','Subtotal']);
    sheet.setFrozenRows(1);
  }
  const date     = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss');
  const itemsStr = (data.items || []).map(i => `${i.sku} x${i.qty}`).join(', ');
  sheet.appendRow([
    date,
    safe(data.name),
    safe(data.email),
    safe(data.phone),
    safe(data.address),
    safe(data.city),
    safe(data.pincode),
    itemsStr,
    data.subtotal || 0,
  ]);
  return { success: true };
}

// ─── Stock ───────────────────────────────────────────────────

function checkStock(items) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheets().find(s => s.getSheetId() === INVENTORY_GID);
  const rows  = sheet.getDataRange().getValues();

  for (const item of items) {
    const baseSku = item.sku.split('|')[0];
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]).trim() !== baseSku) continue;
      const stock = Number(rows[i][4] || 0);
      if (item.qty > stock) return String(rows[i][1] || baseSku);
      break;
    }
  }
  return null;
}

function decrementStock(items) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheets().find(s => s.getSheetId() === INVENTORY_GID);
  const rows  = sheet.getDataRange().getValues();

  items.forEach(item => {
    const baseSku = item.sku.split('|')[0]; // variant SKU 처리
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === baseSku) {
        const cell = sheet.getRange(i + 1, 5);
        cell.setValue(Math.max(0, (cell.getValue() || 0) - item.qty));
        break;
      }
    }
  });
}

// ─── Restore Stock (취소 시 재고 복구) ───────────────────────────

function restoreStock(itemsStr) {
  if (!itemsStr) return;
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheets().find(s => s.getSheetId() === INVENTORY_GID);
  const rows  = sheet.getDataRange().getValues();

  // Items 형식: "SKU1 x2, SKU2 x1"
  itemsStr.toString().split(',').forEach(function(part) {
    const m = part.trim().match(/^(.+?)\s+x(\d+)$/i);
    if (!m) return;
    const baseSku = m[1].trim().split('|')[0]; // variant SKU 처리
    const qty     = parseInt(m[2], 10);
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]).trim() === baseSku) {
        const cell = sheet.getRange(i + 1, 5);
        cell.setValue((cell.getValue() || 0) + qty);
        break;
      }
    }
  });
}

// ─── Customers ───────────────────────────────────────────────

function upsertCustomer(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName('Customers');
  if (!sheet) {
    sheet = ss.insertSheet('Customers');
    sheet.appendRow(['Email','Name','Phone','Address','City','Pincode','FirstOrder','OrderCount']);
    sheet.setFrozenRows(1);
  }

  const rows = sheet.getDataRange().getValues();
  const idx  = rows.findIndex((r, i) => i > 0 && r[0] === data.email);

  if (idx === -1) {
    sheet.appendRow([
      safe(data.email), safe(data.name), safe(data.phone),
      safe(data.address), safe(data.city), safe(data.pincode),
      Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd'), 1
    ]);
  } else {
    sheet.getRange(idx + 1, 8).setValue((rows[idx][7] || 0) + 1);
  }
}

// ─── Track Order ─────────────────────────────────────────────

function trackOrder(email, code) {
  if (!email || !code) return { found: false, error: 'Missing email or code' };

  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('OrderLog');
  if (!sheet) return { found: false, error: 'No orders yet' };

  const rows    = sheet.getDataRange().getValues();
  const headers = rows[0];

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][3] === email && rows[i][0] === code) {
      const order = {};
      headers.forEach((h, j) => order[h] = rows[i][j]);
      return { found: true, order };
    }
  }
  return { found: false, error: 'Order not found' };
}

// ─── UPI ─────────────────────────────────────────────────────

function makeUPILink(amount, code) {
  return `upi://pay?pa=${UPI_ID}&pn=${encodeURIComponent(UPI_NAME)}&am=${amount}&tn=${encodeURIComponent('Order ' + code)}&cu=INR`;
}

// ─── PhonePe Payment Gateway v1 ──────────────────────────────
//
// SETUP (one-time):
//   1. GCP Console → Secret Manager API 활성화
//   2. Secret Manager에 비밀 1개 생성:
//        phonepe-salt-key  →  PhonePe Business > Developer Settings > API Key 값
//   3. IAM → Apps Script 서비스 계정(프로젝트번호@appspot.gserviceaccount.com)
//        → 역할: "Secret Manager 보안 비밀 접근자" 추가
//   4. Script Properties 등록:
//        PHONEPE_GCP_PROJECT  →  safar-lee-stats
//        PHONEPE_TEST_MODE    →  true  (실서비스 오픈 시 false)
//
// Webhook URL (PhonePe Business Dashboard > Developer Settings에 등록):
//   <Apps Script Web App URL>?phonePeWebhook=1

const PHONEPE_MERCHANT_ID = 'FABNATURAONLINE';
const PHONEPE_SALT_IDX    = '1';
const PHONEPE_BASE_TEST   = 'https://api-preprod.phonepe.com/apis/pg-sandbox';
const PHONEPE_BASE_PROD   = 'https://api.phonepe.com/apis/hermes';

function _isTest() {
  return PropertiesService.getScriptProperties().getProperty('PHONEPE_TEST_MODE') !== 'false';
}

function _ppBase() {
  return _isTest() ? PHONEPE_BASE_TEST : PHONEPE_BASE_PROD;
}

// Google Secret Manager에서 비밀 값 가져오기
function _getSecretFromGSM(secretName) {
  const props     = PropertiesService.getScriptProperties();
  const projectId = props.getProperty('PHONEPE_GCP_PROJECT');
  if (!projectId) throw new Error('PHONEPE_GCP_PROJECT not set in Script Properties');

  const url = 'https://secretmanager.googleapis.com/v1/projects/'
            + projectId + '/secrets/' + secretName + '/versions/latest:access';

  const res = UrlFetchApp.fetch(url, {
    headers:            { 'Authorization': 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  });

  if (res.getResponseCode() !== 200) {
    throw new Error('Secret Manager: ' + secretName + ' fetch failed — ' + res.getContentText());
  }

  const p = JSON.parse(res.getContentText()).payload;
  return Utilities.newBlob(Utilities.base64Decode(p.data)).getDataAsString();
}

function _getSaltKey() {
  const cache  = CacheService.getScriptCache();
  const cached = cache.get('pp_salt');
  if (cached) return cached;
  const salt = _getSecretFromGSM('phonepe-salt-key');
  cache.put('pp_salt', salt, 3600);
  return salt;
}

// SHA256 hex 계산
function _sha256Hex(input) {
  return Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    input,
    Utilities.Charset.UTF_8
  ).map(function(b) {
    return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2);
  }).join('');
}

// 결제 시작 → PhonePe 결제 페이지 URL 반환
function createPhonePePayment(orderCode, totalPaise, phone) {
  const saltKey     = _getSaltKey();
  const redirectUrl = WEBSITE_URL + '/checkout-payment.html?orderCode=' + encodeURIComponent(orderCode);
  const webhookUrl  = ScriptApp.getService().getUrl() + '?phonePeWebhook=1';

  const body = {
    merchantId:            PHONEPE_MERCHANT_ID,
    merchantTransactionId: orderCode,
    amount:                totalPaise,
    redirectUrl:           redirectUrl,
    redirectMode:          'REDIRECT',
    callbackUrl:           webhookUrl,
    paymentInstrument:     { type: 'PAY_PAGE' },
  };
  if (phone) body.mobileNumber = String(phone).replace(/\D/g, '').slice(-10);

  const base64Body = Utilities.base64Encode(JSON.stringify(body));
  const xVerify    = _sha256Hex(base64Body + '/pg/v1/pay' + saltKey) + '###' + PHONEPE_SALT_IDX;

  const res = UrlFetchApp.fetch(_ppBase() + '/pg/v1/pay', {
    method:             'post',
    contentType:        'application/json',
    headers:            { 'X-VERIFY': xVerify },
    payload:            JSON.stringify({ request: base64Body }),
    muteHttpExceptions: true,
  });

  const result = JSON.parse(res.getContentText());
  const url    = result.data
              && result.data.instrumentResponse
              && result.data.instrumentResponse.redirectInfo
              && result.data.instrumentResponse.redirectInfo.url;

  if (!url) throw new Error('PhonePe pay init failed: ' + JSON.stringify(result));
  return url;
}

// 결제 완료 여부 확인 (고객 리다이렉트 후 호출)
function handlePaymentVerification(data) {
  const orderCode = data && data.orderCode;
  if (!orderCode) throw new Error('orderCode required');

  const saltKey = _getSaltKey();
  const path    = '/pg/v1/status/' + PHONEPE_MERCHANT_ID + '/' + encodeURIComponent(orderCode);
  const xVerify = _sha256Hex(path + saltKey) + '###' + PHONEPE_SALT_IDX;

  const res = UrlFetchApp.fetch(_ppBase() + path, {
    method:             'get',
    headers:            { 'X-VERIFY': xVerify, 'X-MERCHANT-ID': PHONEPE_MERCHANT_ID },
    muteHttpExceptions: true,
  });

  const result = JSON.parse(res.getContentText());
  const state  = result.data && result.data.state;

  if (state === 'COMPLETED') {
    _markOrderPaid(orderCode);
    return { success: true, paid: true, state };
  }

  return { success: true, paid: false, state: state || 'UNKNOWN' };
}

// 주문 상태 CONFIRMED로 업데이트 + 결제 확인 이메일 발송
function _markOrderPaid(orderCode) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('OrderLog');
  if (!sheet) return;

  const rows    = sheet.getDataRange().getValues();
  const headers = rows[0];
  const codeIdx = headers.indexOf('OrderCode');
  const statIdx = headers.indexOf('Status');

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][codeIdx] !== orderCode) continue;
    const cur = String(rows[i][statIdx]);
    if (cur === 'CONFIRMED' || cur === 'SHIPPED' || cur === 'DELIVERED') return;
    sheet.getRange(i + 1, statIdx + 1).setValue('CONFIRMED');

    // Decrement stock now that payment is confirmed
    const itemsStr = rows[i][headers.indexOf('Items')];
    if (itemsStr) {
      const parsedItems = String(itemsStr).split(',').map(function(part) {
        const m = part.trim().match(/^(.+?)\s+x(\d+)$/i);
        return m ? { sku: m[1].trim(), qty: parseInt(m[2], 10) } : null;
      }).filter(Boolean);
      if (parsedItems.length) decrementStock(parsedItems);
    }
    const sdIdx = headers.indexOf('StockDeducted');
    if (sdIdx >= 0) sheet.getRange(i + 1, sdIdx + 1).setValue('YES');

    const order = {};
    headers.forEach(function(h, idx) { order[h] = rows[i][idx]; });
    sendPaymentConfirmedEmail(order);
    return;
  }
}

// ─── PhonePe Webhook Handler (v1) ────────────────────────────
// PhonePe가 결제 완료 시 callbackUrl로 서버→서버 알림 전송
// X-VERIFY: SHA256(base64payload + "/" + saltKey) + "###" + saltIndex

function handlePhonePeWebhook(e) {
  try {
    const raw     = JSON.parse(e.postData.contents);
    const saltKey = _getSaltKey();
    const b64Data = raw.response || '';

    // 서명 검증
    const xVerify  = e.headers && (e.headers['X-VERIFY'] || e.headers['x-verify'] || '');
    const expected = _sha256Hex(b64Data + '/' + saltKey) + '###' + PHONEPE_SALT_IDX;

    if (xVerify && xVerify !== expected) {
      Logger.log('PhonePe webhook: 서명 불일치, 무시');
      return ContentService.createTextOutput('OK');
    }

    const payload   = JSON.parse(Utilities.newBlob(Utilities.base64Decode(b64Data)).getDataAsString());
    const orderCode = payload.data && payload.data.merchantTransactionId;
    const paid      = payload.code === 'PAYMENT_SUCCESS';

    Logger.log('PhonePe webhook: ' + payload.code + ' / ' + orderCode);

    if (paid && orderCode) _markOrderPaid(orderCode);

    return ContentService.createTextOutput('OK');
  } catch(err) {
    Logger.log('PhonePe webhook error: ' + err.message);
    return ContentService.createTextOutput('OK'); // PhonePe에 항상 200 반환
  }
}

// ─── Auto Cancel ─────────────────────────────────────────────
// 설정: Apps Script 편집기 → 트리거 추가 → autoCancelOrders → 시간 기반 → 매일

function autoCancelOrders() {
  const ss         = SpreadsheetApp.openById(SPREADSHEET_ID);
  const orderSheet = ss.getSheetByName('OrderLog');
  if (!orderSheet) return;

  const rows      = orderSheet.getDataRange().getValues();
  const headers   = rows[0];
  const statusCol = headers.indexOf('Status');
  const dateCol   = headers.indexOf('Date');
  const emailCol  = headers.indexOf('Email');
  const nameCol   = headers.indexOf('Name');
  const codeCol   = headers.indexOf('OrderCode');
  const itemsCol  = headers.indexOf('Items');
  if (statusCol < 0 || dateCol < 0) return;

  const now    = new Date();
  const cutoff = 48 * 60 * 60 * 1000;
  let cancelled = 0;

  for (let i = 1; i < rows.length; i++) {
    const row    = rows[i];
    const status = String(row[statusCol] || '').trim();
    if (status !== 'PENDING_PAYMENT') continue;
    const orderDate = new Date(row[dateCol]);
    if (isNaN(orderDate.getTime()) || now - orderDate < cutoff) continue;

    orderSheet.getRange(i + 1, statusCol + 1).setValue('CANCELLED');
    restoreStock(row[itemsCol]);

    const email = String(row[emailCol] || '');
    const name  = String(row[nameCol] || '');
    const code  = String(row[codeCol] || '');
    if (email) sendAutoCancelEmail(email, name, code);
    cancelled++;
  }

  Logger.log('Auto cancelled: ' + cancelled + ' orders');
}

function sendAutoCancelEmail(email, name, code) {
  const subject = 'Your Safar Lee order has been cancelled — ' + code;
  const body = `
<div style="max-width:520px;margin:48px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 8px 48px rgba(74,66,72,0.13);">
  <div style="background:#553D69;padding:32px 40px;">
    <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">Order Cancelled</h1>
  </div>
  <div style="padding:32px 40px;">
    <p style="color:#4A4248;font-size:15px;">Hi ${name},</p>
    <p style="color:#9A8E94;font-size:13px;line-height:1.7;">Your order <strong>${code}</strong> was automatically cancelled because payment was not received within 48 hours.</p>
    <p style="color:#9A8E94;font-size:13px;line-height:1.7;">If you'd still like to order, please visit our website.</p>
    <a href="${WEBSITE_URL}" style="display:inline-block;margin-top:16px;padding:14px 28px;background:#553D69;color:#fff;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;">Shop Again</a>
  </div>
</div>`;
  GmailApp.sendEmail(email, subject, '', { htmlBody: body, name: 'Safar Lee' });
}

// ─── Meta Catalog Feed ────────────────────────────────────────
// URL: <Apps Script Web App URL>?action=catalog
// Meta Commerce Manager → 카탈로그 → 데이터 피드 → 이 URL 등록

function getCatalogFeed() {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheets().find(s => s.getSheetId() === INVENTORY_GID);
  const rows  = sheet.getDataRange().getValues();
  const keys  = rows[0];

  const imageMap = getImageMapFromDrive();

  const headers = ['id','title','description','availability','condition','price','sale_price','link','image_link','brand','google_product_category'];
  const lines   = [headers.join('\t')];

  rows.slice(1).forEach(function(r) {
    const p = {};
    keys.forEach(function(k, i) { p[k] = r[i]; });

    const statusVal = String(p.status || p.Status || '').toLowerCase();
    const sku       = String(p.SKU || p.sku || r[0] || '').trim();
    if (!sku || statusVal !== 'active') return;
    const title    = String(p['Product Name'] || sku);
    const desc     = String(p['Description'] || p['Product Name'] || title).replace(/\t|\n/g, ' ');
    const stock    = Number(p['Current Stock'] || 0);
    const price    = Number(p['Price (INR)'] || p['Price'] || 0);
    const disc     = Number(p['Discount price (INR)'] || 0);
    const images   = imageMap[sku] || [];
    const imageUrl = images[0] || String(p['Image URL'] || '');

    const availability = stock > 0 ? 'in stock' : 'out of stock';
    const priceStr     = price.toFixed(2) + ' INR';
    const salePriceStr = disc > 0 ? disc.toFixed(2) + ' INR' : '';
    const link         = WEBSITE_URL + '/index.html#' + encodeURIComponent(sku);

    lines.push([
      sku,
      title,
      desc,
      availability,
      'new',
      priceStr,
      salePriceStr,
      link,
      imageUrl,
      'Safar Lee',
      'Home & Garden > Decor > Decorative Accents'
    ].join('\t'));
  });

  return ContentService
    .createTextOutput(lines.join('\n'))
    .setMimeType(ContentService.MimeType.TEXT);
}

// ─── Helpers ─────────────────────────────────────────────────

function ok(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function fail(msg) {
  return ContentService.createTextOutput(JSON.stringify({ error: msg })).setMimeType(ContentService.MimeType.JSON);
}
