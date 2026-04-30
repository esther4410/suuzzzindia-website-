// ============================================================
// SUUZZZ India — Google Apps Script Backend
// Deploy: Extensions > Apps Script > Deploy > Web App
//         Execute as: Me | Access: Anyone
// ============================================================

const SPREADSHEET_ID = '1nO9sgSkP2JxA9hdRs3SpqLAxkpWKP_oMchXt1AlxUvo';
const INVENTORY_GID  = 896187980;

// ⚠️ Replace with actual supplier UPI ID
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
    if (data.action === 'order') return ok(createOrder(data));
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

  return { success: true, orderCode: code, total, shipping, upiLink: makeUPILink(total, code) };
}

// ─── Stock ───────────────────────────────────────────────────

function decrementStock(items) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheets().find(s => s.getSheetId() === INVENTORY_GID);
  const rows  = sheet.getDataRange().getValues();

  items.forEach(item => {
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === item.sku) {
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
