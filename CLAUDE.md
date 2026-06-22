# Safar Lee — Critical Rules

## Project
- Repo: `/Users/BOPEEP/GitHub/suuzzzindia-website-/`
- Live: `https://safarlee-website.vercel.app`
- Backend: Google Apps Script — paste `apps-script.gs` into editor, deploy as Web App
- Deploy: git push → Vercel auto-deploys. Apps Script needs manual paste + new version.

---

## 🔴 NEVER BREAK — PhonePe Signature

```
Pay:    X-VERIFY = SHA256(base64Body + "/pg/v1/pay" + saltKey) + "###" + saltIndex
Status: X-VERIFY = SHA256(path + saltKey) + "###" + saltIndex
```
- `/pg/v1/pay` MUST be in pay hash — omitting it = 401
- Status path: NO slash between path and saltKey
- Salt index = `"1"` (string)
- Merchant ID = `FABNATURAONLINE`
- Production base: `https://api.phonepe.com/apis/hermes`
- Test base: `https://api-preprod.phonepe.com/apis/pg-sandbox`

---

## 🔴 NEVER BREAK — Apps Script Setup

**Script Properties** (Project Settings → Script Properties):
| Key | Value |
|-----|-------|
| `PHONEPE_GCP_PROJECT` | `safar-lee-stats` |
| `PHONEPE_TEST_MODE` | `false` (lowercase — NOT `False`) |

**appsscript.json oauthScopes** — all 5 required:
- `spreadsheets`, `drive`, `script.send_mail`, `script.external_request`, `cloud-platform`

**GCP project `safar-lee-stats` APIs** — must be enabled:
- Google Sheets API, Google Drive API, Secret Manager API, Gmail API

**Secret Manager:**
- Secret name: `phonepe-salt-key` → value: PhonePe API Key (36-char UUID)
- IAM: `813020448763@appspot.gserviceaccount.com` → `Secret Manager Secret Accessor`

**Deploy settings:**
- Execute as: Me
- Access: Anyone

---

## 🔴 NEVER BREAK — Stock Logic

- `createOrder()` → `checkStock()` first, throw if insufficient. **NO decrement here.**
- `_markOrderPaid()` → decrement stock + set `StockDeducted=YES`
- `onOrderSheetEdit` cancel → restore stock ONLY if `StockDeducted === 'YES'`
- `autoCancelOrders` → cancels PENDING_PAYMENT only (never deducted → no restore)

---

## 🟠 NEVER BREAK — Order Flow

```
checkout-payment.html
  → placeOrder() → Apps Script createOrder()
  → redirect to PhonePe
  → user pays → PhonePe redirects back with ?orderCode=
  → _verifyPayment() → Apps Script verifyPayment
  → _markOrderPaid() → stock deducted, StockDeducted=YES, email sent
```

- Cart (`suuzzz_cart` localStorage) cleared ONLY after `data.paid === true`
- Retry button → `checkout-payment.html` (fresh start, cart still intact)
- PhonePe webhook URL to register in dashboard: `<Apps Script URL>?phonePeWebhook=1`

---

## 🟡 Apps Script Deployment Checklist

After any `apps-script.gs` change:
1. Copy full file → paste into Apps Script editor
2. Deploy → Manage deployments → **New version** (not edit existing)
3. Run `getProducts` in editor to confirm no auth errors

---

## 🟡 Frontend Checklist

| Feature | File | Notes |
|---------|------|-------|
| Products load | `index.html` | `?action=products` from Apps Script |
| Sold out | `index.html:1376` | `stock === 0` → badge, no cart btn |
| Checkout entry | `checkout.html` | Redirects to `checkout-payment.html` |
| Payment verify | `checkout-payment.html` | `?orderCode=` triggers verify on load |
| GA4 | Both pages | `G-T81CT97P1P` |
| Meta Pixel | Both pages | `2510037666102813` |
| Fail event | `checkout-payment.html` | `gtag payment_failed` + `fbq PaymentFailed` |

---

## 🟡 Spreadsheet Structure

ID: `1nO9sgSkP2JxA9hdRs3SpqLAxkpWKP_oMchXt1AlxUvo`

Inventory sheet GID `896187980`:
- Col 1 = SKU, Col 5 = Current Stock

OrderLog headers (auto-created on first order):
`OrderCode, Date, Name, Email, Phone, Address, City, Pincode, Items, Subtotal, Discount, Shipping, Total, Status, TrackingNumber, StockDeducted`

---

## Skill routing

- Payment/security issues → `/cso`
- Bugs → `/investigate`
- Before deploy → `/review`
