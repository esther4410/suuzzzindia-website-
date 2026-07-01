# CS Q&A Board — Design Spec
Date: 2026-07-01

## Overview
Private 1:1 CS Q&A board for Safar Lee customers. FAQ accordion + inquiry form on the website; admin responds in admin.html; customer gets email notification and can view reply by entering their email.

---

## Data Model

**Google Sheet tab: `QnA`**

| Column | Type | Notes |
|---|---|---|
| ID | String | `QNA-` + 6-char random |
| Date | String | `yyyy-MM-dd HH:mm` (IST) |
| Name | String | Customer name |
| Email | String | Customer email |
| OrderCode | String | e.g. `SAFAR-AB1234` (optional) |
| Category | String | `배송문의 / 교환·반품 / 제품문의 / 기타` |
| Question | String | Up to ~2000 chars |
| Answer | String | Admin reply |
| AnsweredAt | String | `yyyy-MM-dd HH:mm` (IST), empty until answered |
| Status | String | `PENDING` → `ANSWERED` |

---

## Pages & Components

### qna.html (new page, website)

**Section 1 — FAQ Accordion**
- Hardcoded questions/answers
- Categories: 배송, 교환·반품, 제품, 결제
- Expand/collapse per item

**Section 2 — Inquiry Form**
- Fields: Name, Email, OrderCode (optional), Category dropdown, Question textarea
- Note: "사진이 있으면 Instagram DM 또는 WhatsApp으로 연락해 주세요"
- Submit → `action: submitQnA` → Apps Script

**Section 3 — My Inquiries**
- Email input → fetch threads for that email
- Shows: category, question preview, status badge (답변 대기 / 답변 완료), answer
- No password — email acts as the access key

---

### admin.html (existing, new Q&A section)

- New tab/section: "Q&A"
- List: ID, Date, Name, Category, Question preview, Status badge
- Sorted: PENDING first, then ANSWERED by date desc
- Click row → detail modal: full question + answer textarea + "Send Answer" button
- Filter: All / PENDING / ANSWERED

---

## Apps Script Functions

### `submitQnA(data)`
- Validates: name, email, category, question required; OrderCode optional
- Generates ID: `QNA-` + 6-char alphanum
- Appends row to QnA sheet, Status = `PENDING`
- Sends Telegram: `📬 New Q&A: [Category] from [Name]`
- Returns: `{ success: true, id }`

### `getQnA(data)`
- Auth: password → admin only
- Returns all QnA rows

### `getMyQnA(data)`
- Input: email (no password)
- Returns rows matching email (case-insensitive)

### `answerQnA(data)`
- Auth: password → admin only
- Finds row by ID, writes Answer + AnsweredAt + Status = `ANSWERED`
- Sends answer email to customer
- Returns: `{ success: true }`

---

## Email — Answer Notification

Subject: `Safar Lee — Your question has been answered ✉️`
- Shows original question + admin answer
- Link: `qna.html?email=[email]`
- "사진 있으면 Instagram DM 또는 WhatsApp" reminder

---

## Security
- Customer access: email only (sufficient for CS context)
- Admin actions: existing `_getRole()` password system
- OrderCode optional — customers without orders can inquire

---

## Out of Scope
- Photo upload → redirect to DM/WhatsApp
- Public board
- Pagination (add later if needed)
