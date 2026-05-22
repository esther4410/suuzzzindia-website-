// ============================================================
// Safar Lee — Drive Auto-Scan for Product Images (Flat 폴더 방식)
// 기존 apps-script.gs 의 getProducts() 를 이 파일 내용으로 교체.
// + 신규 함수 3개 (getImageMapFromDrive, makeProductImagesPublic, refreshImageCache).
// ============================================================
//
// 🗂️ Drive 폴더 구조 (Flat — 폴더 1개에 모든 이미지)
//
//   Safar Lee Products/             ← 루트 폴더. ID를 PRODUCT_FOLDER_ID 에 넣음
//   ├── CUSH-001.jpg                ← 메인 (SKU 그대로)
//   ├── CUSH-002.jpg
//   ├── POUCH-001.jpg               ← 메인
//   ├── POUCH-001-2.jpg             ← 두번째 이미지 (suffix -2)
//   ├── BAG-001.jpg
//   └── BAG-001-2.jpg
//
// 파일명 규칙:
//   <SKU>.<ext>        → 메인 이미지 (image1)
//   <SKU>-2.<ext>      → 두번째 이미지 (image2)
//   <SKU>-3.<ext>      → 세번째 이미지 (image3)
//
// 확장자: jpg / jpeg / png / webp 모두 가능.
// 새 제품 = 파일명 SKU로 만들고 폴더에 드롭. 폴더 만들 필요 ✗.
//
// 📋 시트 컬럼 (필수 추가): status
//     값:
//       active    → 사이트 노출
//       draft     → 숨김 (출시 예정. 데이터 보존)
//       archived  → 숨김 (단종. 데이터 보존)
//     status 빈 칸 = 자동 숨김. 노출하려면 active 입력 필수.
//
// ⚙️ 세팅 단계
//   1. 시트에 status 컬럼 추가 → 노출할 제품 row 에 'active' 입력
//   2. Drive 에 "Safar Lee Products" 폴더 만들기 (한번만)
//   3. 이미지 파일명 = SKU (또는 SKU-2, SKU-3) 로 만들기
//   4. 폴더에 전체 드래그&드롭
//   5. 폴더 URL 에서 ID 복사: https://drive.google.com/drive/folders/<ID>
//   6. 아래 PRODUCT_FOLDER_ID 에 붙여넣기
//   7. Apps Script 에디터에서 makeProductImagesPublic() 한번 실행
//      → 모든 이미지 "Anyone with link" 공유 자동 설정
//   8. 새 이미지 추가할 때마다 makeProductImagesPublic() 재실행
//
// ============================================================

const PRODUCT_FOLDER_ID = 'PASTE_DRIVE_FOLDER_ID_HERE';

// ─── Products (Drive 자동스캔 버전) ───────────────────────────

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

      // images 배열로 전체 노출
      p.images = imgs;

      // 기존 image1, image2... 컬럼 호환 (있던 값 덮어쓰기)
      imgs.forEach((url, idx) => {
        p['image' + (idx + 1)] = url;
      });

      return p;
    })
    // status 컬럼: 'active' 만 사이트 노출. 'draft' / 'archived' 는 숨김 (데이터는 시트에 보존).
    .filter(p => String(p.status || '').toLowerCase() === 'active');

  return { products };
}

// ─── Drive 스캔 (Flat 폴더) ─────────────────────────────────

function getImageMapFromDrive() {
  // 캐시 (5분)
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

    // 파일명에서 확장자 제거
    const fullName = f.getName();
    const lastDot  = fullName.lastIndexOf('.');
    const base     = (lastDot === -1 ? fullName : fullName.substring(0, lastDot)).trim();

    // 파싱: <SKU> 또는 <SKU>-<N>
    let sku, idx;
    const m = base.match(/^(.+?)-(\d+)$/);
    if (m) {
      sku = m[1];
      idx = parseInt(m[2], 10);
    } else {
      sku = base;
      idx = 1;
    }

    if (!groups[sku]) groups[sku] = [];
    groups[sku].push({
      idx: idx,
      url: 'https://lh3.googleusercontent.com/d/' + f.getId() + '=w1200'
    });
  }

  // 각 SKU 내 idx 순으로 정렬
  const map = {};
  Object.keys(groups).forEach(function(sku) {
    groups[sku].sort(function(a, b) { return a.idx - b.idx; });
    map[sku] = groups[sku].map(function(i) { return i.url; });
  });

  cache.put('product_images', JSON.stringify(map), 300); // 5분
  return map;
}

// ─── 이미지 공개 설정 (한번 실행 후 새 이미지마다 재실행) ──────

function makeProductImagesPublic() {
  const folder = DriveApp.getFolderById(PRODUCT_FOLDER_ID);
  const files  = folder.getFiles();
  let updated  = 0;

  while (files.hasNext()) {
    const f = files.next();
    try {
      f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      updated++;
    } catch(e) {
      // 무시
    }
  }

  Logger.log('Made public: ' + updated + ' files');
  return { updated: updated };
}

// ─── 캐시 강제 갱신 (이미지 즉시 반영용) ──────────────────────

function refreshImageCache() {
  CacheService.getScriptCache().remove('product_images');
  const map = getImageMapFromDrive();
  Logger.log('Cache refreshed. SKUs: ' + Object.keys(map).length);
  return { skus: Object.keys(map).length };
}
