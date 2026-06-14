-- Short, human-typeable pickup codes as an alternative to scanning the QR.
-- The QR still carries the full HMAC-signed token; this 10-char code is a
-- server-side single-use lookup (generated at payment-verify time), so a club
-- can type it quickly without weakening the signed pass.

alter table public.order_qr_codes add column if not exists pickup_code text;
alter table public.order_group_members add column if not exists pickup_code text;

create unique index if not exists order_qr_codes_pickup_code_idx
  on public.order_qr_codes (pickup_code) where pickup_code is not null;
create unique index if not exists order_group_members_pickup_code_idx
  on public.order_group_members (pickup_code) where pickup_code is not null;
