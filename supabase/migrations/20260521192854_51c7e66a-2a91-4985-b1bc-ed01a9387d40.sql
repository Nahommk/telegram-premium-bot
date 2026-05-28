
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'paid_waiting_delivery';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'rejected';

DO $$ BEGIN
  CREATE TYPE public.delivery_mode AS ENUM ('automatic','manual');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.manual_delivery_status AS ENUM ('none','pending','delivered','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.wallet_tx_kind AS ENUM ('deposit','order_payment','refund','referral_payout','admin_adjust');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP FUNCTION IF EXISTS public.process_payment(uuid, text, public.payment_method, integer, jsonb);
