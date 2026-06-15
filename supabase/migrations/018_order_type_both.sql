-- Cornell Craves: third pickup order type (Tranche 4 #5).
-- 'both' = a spot where buyers can pre-order ahead OR walk up and buy same-day.

alter table public.listing_pickup_spots
  drop constraint if exists listing_pickup_spots_order_type_check;

alter table public.listing_pickup_spots
  add constraint listing_pickup_spots_order_type_check
  check (order_type in ('same_day', 'preorder', 'both'));
