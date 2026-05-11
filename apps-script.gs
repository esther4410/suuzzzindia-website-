// ============================================================
// SUUZZZ India — Google Apps Script Backend
// Deploy: Extensions > Apps Script > Deploy > Web App
//         Execute as: Me | Access: Anyone
// ============================================================

const SPREADSHEET_ID = '1nO9sgSkP2JxA9hdRs3SpqLAxkpWKP_oMchXt1AlxUvo';
const INVENTORY_GID  = 896187980;

const UPI_ID   = 'supplier@gpay';
const UPI_NAME = 'SUUZZZ India';

const SHIPPING_FREE_THRESHOLD = 2000;
const SHIPPING_FEE = 80;

// ─── Router ──────────────────────────────────────────────────

function doGet(e) {
  const action = e && e.parameter && e.parameter.action;
  try {
    if (action === 'products') return ok(getProducts());
    if (action === 'track')    return ok(trackOrder(e.parameter.email, e.parameter.code));
  } catch(err) {
    return fail(err.message);
  }
  return ok({ status: 'ok' });
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.action === 'order')         return ok(createOrder(data));
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

  const products = rows.slice(1)
    .filter(r => r[0])
    .map(r => {
      const p = {};
      keys.forEach((k, i) => p[k] = r[i]);
      return p;
    });

  return { products };
}

// ─── Create Order ─────────────────────────────────────────────

function createOrder(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  let orderSheet = ss.getSheetByName('OrderLog');
  if (!orderSheet) {
    orderSheet = ss.insertSheet('OrderLog');
    orderSheet.appendRow([
      'OrderCode','Date','Name','Email','Phone',
      'Address','City','Pincode','Items',
      'Subtotal','Discount','Shipping','Total','Status','TrackingNumber'
    ]);
    orderSheet.setFrozenRows(1);
  }

  const code     = 'SUZ-' + Math.random().toString(36).substr(2, 6).toUpperCase();
  const date     = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss');
  const itemsStr = data.items.map(i => `${i.sku} x${i.qty}`).join(', ');
  const shipping = data.subtotal >= SHIPPING_FREE_THRESHOLD ? 0 : SHIPPING_FEE;
  const discount = data.discount || 0;
  const total    = data.subtotal - discount + shipping;

  orderSheet.appendRow([
    code, date,
    data.name, data.email, data.phone,
    data.address, data.city, data.pincode,
    itemsStr,
    data.subtotal, discount, shipping, total,
    'PENDING_PAYMENT', ''
  ]);

  decrementStock(data.items);
  upsertCustomer(data);
  sendOrderConfirmation(data, code, total, shipping, makeUPILink(total, code));

  return { success: true, orderCode: code, total, shipping, upiLink: makeUPILink(total, code) };
}

// ─── Order Confirmation Email ─────────────────────────────────

function sendOrderConfirmation(data, code, total, shipping, upiLink) {
  const itemRows = (data.items || []).map(i =>
    `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #ECE5EE;">${i.sku}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #ECE5EE;text-align:center;">x${i.qty}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #ECE5EE;text-align:right;">₹${(i.price || 0) * i.qty}</td>
    </tr>`
  ).join('');

  const shipText = shipping === 0
    ? '<span style="color:#553D69;font-weight:600;">Free</span>'
    : `₹${shipping}`;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#FBF8F3;font-family:'Helvetica Neue',Arial,sans-serif;">
<div style="max-width:520px;margin:32px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(31,20,40,0.08);">
  <div style="background:#553D69;padding:32px 32px 24px;text-align:center;">
    <p style="margin:0 0 6px;color:#F9D200;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">SUUZZZ India</p>
    <h1 style="margin:0;color:#fff;font-size:24px;font-weight:700;">Order Confirmed! 🎉</h1>
  </div>
  <div style="padding:28px 32px;">
    <p style="margin:0 0 4px;color:#4A3C58;font-size:14px;">Hi <strong>${data.name}</strong>,</p>
    <p style="margin:0 0 24px;color:#8B7E96;font-size:13px;">Thank you for your order! Please save your order code — you'll need it to track your delivery.</p>
    <div style="background:#FBF8F3;border-radius:14px;padding:20px;text-align:center;margin-bottom:24px;">
      <p style="margin:0 0 6px;color:#8B7E96;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">Your Order Code</p>
      <p style="margin:0;color:#553D69;font-size:28px;font-weight:800;letter-spacing:3px;">${code}</p>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
      <thead>
        <tr style="background:#FBF8F3;">
          <th style="padding:8px 12px;text-align:left;font-size:12px;color:#8B7E96;font-weight:600;">Item</th>
          <th style="padding:8px 12px;text-align:center;font-size:12px;color:#8B7E96;font-weight:600;">Qty</th>
          <th style="padding:8px 12px;text-align:right;font-size:12px;color:#8B7E96;font-weight:600;">Price</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>
    <div style="border-top:2px solid #ECE5EE;padding-top:16px;">
      <p style="margin:4px 0;font-size:13px;color:#4A3C58;">Shipping: ${shipText}</p>
      <p style="margin:8px 0 0;font-size:16px;font-weight:700;color:#1F1428;">Total: ₹${total}</p>
    </div>
    <div style="margin:24px 0;background:#FFF8DC;border-radius:12px;padding:16px;">
      <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#1F1428;">💳 How to Pay</p>
      <p style="margin:0 0 14px;font-size:13px;color:#4A3C58;">Your order ships once payment is confirmed.<br>Send <strong>₹${total}</strong> via GPay / PhonePe / Paytm to <strong>${UPI_ID}</strong></p>
      <div style="text-align:center;">
        <a href="${upiLink}" style="display:inline-block;background:#F9D200;color:#1F1428;text-decoration:none;padding:16px 36px;border-radius:12px;font-size:15px;font-weight:800;letter-spacing:0.3px;">💳 Pay Now — ₹${total}</a>
      </div>
    </div>
  </div>
  <div style="padding:20px 32px;border-top:1px solid #ECE5EE;text-align:center;">
    <p style="margin:0 0 6px;font-size:12px;color:#8B7E96;">Follow us for restocks, new drops & behind the scenes</p>
    <a href="https://instagram.com/suuzzz.india" style="color:#553D69;font-size:18px;font-weight:800;text-decoration:underline;">→ @suuzzz.india</a>
  </div>
</div>
</body>
</html>`;

  try {
    MailApp.sendEmail({ to: data.email, subject: `SUUZZZ India — Order Confirmed ${code}`, htmlBody: html });
  } catch(e) {
    Logger.log('Order email failed: ' + e.message);
  }
}

// ─── Payment Confirmed Email ──────────────────────────────────
// Trigger: onOrderSheetEdit — Status column → CONFIRMED

function sendPaymentConfirmedEmail(order) {
  const trackUrl = `https://suuzzzindia-website.vercel.app/track.html?email=${encodeURIComponent(order['Email'])}&code=${encodeURIComponent(order['OrderCode'])}`;
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#FBF8F3;font-family:'Helvetica Neue',Arial,sans-serif;">
<div style="max-width:520px;margin:32px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(31,20,40,0.08);">
  <div style="background:#553D69;padding:32px 32px 24px;text-align:center;">
    <p style="margin:0 0 6px;color:#F9D200;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">SUUZZZ India</p>
    <h1 style="margin:0;color:#fff;font-size:24px;font-weight:700;">Payment Confirmed! ✅</h1>
  </div>
  <div style="padding:28px 32px;">
    <p style="margin:0 0 4px;color:#4A3C58;font-size:14px;">Hi <strong>${order['Name']}</strong>,</p>
    <p style="margin:0 0 20px;color:#8B7E96;font-size:13px;">Order <strong>${order['OrderCode']}</strong></p>
    <div style="background:#F0FBF0;border-radius:14px;padding:20px;margin-bottom:24px;">
      <p style="margin:0 0 8px;font-size:15px;font-weight:700;color:#1F1428;">Thank you for your purchase! 🎁</p>
      <p style="margin:0;font-size:13px;color:#4A3C58;line-height:1.7;">We're so happy to have your order confirmed.<br>We'll pack it with love and care — shipping update coming soon!</p>
    </div>
    <div style="text-align:center;">
      <a href="${trackUrl}" style="display:inline-block;background:#553D69;color:#fff;text-decoration:none;padding:14px 28px;border-radius:12px;font-size:14px;font-weight:600;">Track My Order →</a>
    </div>
  </div>
  <div style="padding:20px 32px;border-top:1px solid #ECE5EE;text-align:center;">
    <p style="margin:0 0 6px;font-size:12px;color:#8B7E96;">Follow us for restocks, new drops & behind the scenes</p>
    <a href="https://instagram.com/suuzzz.india" style="color:#553D69;font-size:18px;font-weight:800;text-decoration:underline;">→ @suuzzz.india</a>
  </div>
</div>
</body>
</html>`;

  try {
    MailApp.sendEmail({ to: order['Email'], subject: `SUUZZZ India — Payment Confirmed ✅`, htmlBody: html });
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
<body style="margin:0;padding:0;background:#FBF8F3;font-family:'Helvetica Neue',Arial,sans-serif;">
<div style="max-width:520px;margin:32px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(31,20,40,0.08);">
  <div style="background:#553D69;padding:32px 32px 24px;text-align:center;">
    <p style="margin:0 0 6px;color:#F9D200;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">SUUZZZ India</p>
    <h1 style="margin:0;color:#fff;font-size:24px;font-weight:700;">Your order is on its way! 📦</h1>
  </div>
  <div style="padding:28px 32px;">
    <p style="margin:0 0 4px;color:#4A3C58;font-size:14px;">Hi <strong>${order['Name']}</strong>,</p>
    <p style="margin:0 0 24px;color:#8B7E96;font-size:13px;">Order <strong>${order['OrderCode']}</strong> has been shipped!</p>
    <div style="background:#FBF8F3;border-radius:14px;padding:20px;text-align:center;margin-bottom:24px;">
      <p style="margin:0 0 6px;color:#8B7E96;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">Tracking Number</p>
      <p style="margin:0;color:#553D69;font-size:22px;font-weight:800;letter-spacing:2px;">${trackingNum}</p>
    </div>
    <div style="text-align:center;margin-bottom:12px;">
      <a href="${trackUrl}" style="display:inline-block;background:#553D69;color:#fff;text-decoration:none;padding:14px 28px;border-radius:12px;font-size:14px;font-weight:600;">Track My Package →</a>
    </div>
    <p style="text-align:center;font-size:12px;color:#8B7E96;margin:0;">Supports all major Indian couriers</p>
  </div>
  <div style="padding:20px 32px;border-top:1px solid #ECE5EE;text-align:center;">
    <p style="margin:0 0 6px;font-size:12px;color:#8B7E96;">Follow us for restocks, new drops & behind the scenes</p>
    <a href="https://instagram.com/suuzzz.india" style="color:#553D69;font-size:18px;font-weight:800;text-decoration:underline;">→ @suuzzz.india</a>
  </div>
</div>
</body>
</html>`;

  try {
    MailApp.sendEmail({ to: order['Email'], subject: `SUUZZZ India — Your order is on its way! 📦`, htmlBody: html });
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
  if (col === trackingCol && e.value) {
    sendShippedEmail(order, e.value);
  }
}

// ─── Waitlist ─────────────────────────────────────────────────

function addToWaitlist(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName('Waitlist');
  if (!sheet) {
    sheet = ss.insertSheet('Waitlist');
    sheet.appendRow(['Date','Name','Email']);
    sheet.setFrozenRows(1);
  }
  const date = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss');
  sheet.appendRow([date, data.name || '', data.email || '']);
  return { success: true };
}

// ─── Pre-Launch Lead ──────────────────────────────────────────

function addPreLaunchLead(data) {
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
    data.name    || '',
    data.email   || '',
    data.phone   || '',
    data.address || '',
    data.city    || '',
    data.pincode || '',
    itemsStr,
    data.subtotal || 0,
  ]);
  return { success: true };
}

// ─── Stock ───────────────────────────────────────────────────

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
      data.email, data.name, data.phone,
      data.address, data.city, data.pincode,
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

// ─── Helpers ─────────────────────────────────────────────────

function ok(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function fail(msg) {
  return ContentService.createTextOutput(JSON.stringify({ error: msg })).setMimeType(ContentService.MimeType.JSON);
}
