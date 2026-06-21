# 새누리교회 일일카페 POS

모바일 우선으로 만든 새누리교회 일일카페용 실시간 POS MVP입니다. 계산 직원은 휴대폰으로 주문을 받고, 제조 담당자는 실시간 주문 티켓을 확인하며, 관리자는 노트북에서 직원 승인, 메뉴, 재고, 주문, 기록, 백업, 엑셀 내보내기를 관리합니다.

## 주요 기능

- 직원 이름/역할 요청, 관리자 승인, 기기별 세션 유지
- 역할: 관리자, 계산, 제조
- 기본 메뉴: 아이스티, 미숫가루, 루이보스, 아이스초코
- 큰 버튼 중심의 모바일 주문 화면
- 현금/계좌이체, 결제 완료/미결제, 거스름돈 계산
- 제조 화면: 접수 → 제조 → 제조 완료 → 픽업 완료
- 메뉴 추가/수정/숨김/삭제, 가격 변경, 품절 토글
- 재고 미정 허용, 재고 설정 시 주문 생성/취소에 따른 자동 차감/반환
- 활동 기록, 취소 주문 보존, 실수 복구용 취소 후 재주문 흐름
- 관리자 자동 백업 1분 주기, 수동 백업, 엑셀 내보내기

## 실행

```bash
npm install
cp .env.example .env.local
npm run dev
```

`.env.local`에 Supabase 값을 입력합니다.

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

브라우저에서 `http://localhost:3000`을 엽니다.

## Supabase 설정

1. Supabase 프로젝트를 만듭니다.
2. SQL Editor에서 `supabase/schema.sql` 전체를 실행합니다.
3. Project Settings → API에서 URL과 anon key를 `.env.local` 및 Vercel 환경 변수에 넣습니다.
4. Realtime이 켜져 있는지 확인합니다. SQL에서 필요한 테이블을 `supabase_realtime` publication에 추가합니다.

첫 접속자가 관리자 역할을 요청하면 자동 승인됩니다. 그 이후 직원은 관리자 승인 전까지 대기 화면만 볼 수 있습니다.

## 배포

Vercel에 이 폴더를 연결하고 다음 환경 변수를 설정합니다.

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

배포 전 확인:

```bash
npm run lint
npm run build
```

## 운영 메모

- 행사 전 관리자가 먼저 접속해 첫 관리자 계정을 만듭니다.
- 메뉴 가격, 품절, 재고, 계좌번호/QR 자리 표시 설정을 확인합니다.
- 직원 5명은 각자 본인 휴대폰에서 이름과 역할을 요청합니다.
- 관리자는 직원 요청을 승인하고 필요하면 역할을 변경합니다.
- 주문 취소는 영구 삭제가 아니라 기록에 남으며, 재고가 자동 반환됩니다.
- 엑셀 내보내기에는 Orders, Order items, Payments, Inventory, Staff activity log, Canceled edited orders, Summary 시트가 포함됩니다.

## 보안 참고

이 MVP는 하루 행사에서 빠르게 쓰는 운영 도구라 Supabase anon client와 앱 내부 승인 흐름을 사용합니다. 공개 인터넷에 오래 열어둘 시스템이라면 Supabase Auth, 엄격한 RLS 정책, 서버 액션/RPC 권한 검증을 더 강화하는 후속 작업을 권장합니다.
