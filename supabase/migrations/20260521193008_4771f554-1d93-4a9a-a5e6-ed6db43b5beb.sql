
-- ============ Column additions ============
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS delivery_mode public.delivery_mode NOT NULL DEFAULT 'automatic';

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivered_by_admin_id bigint,
  ADD COLUMN IF NOT EXISTS delivery_content_type text,
  ADD COLUMN IF NOT EXISTS delivery_timestamp timestamptz,
  ADD COLUMN IF NOT EXISTS manual_delivery_status public.manual_delivery_status NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS paid_from_wallet boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS referrer_telegram_id bigint;

ALTER TABLE public.bot_users
  ADD COLUMN IF NOT EXISTS referred_by_telegram_id bigint,
  ADD COLUMN IF NOT EXISTS abuse_score integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auto_banned_until timestamptz;

ALTER TABLE public.payments ALTER COLUMN order_id DROP NOT NULL;

-- ============ Tables ============
CREATE TABLE IF NOT EXISTS public.wallets (
  user_telegram_id bigint PRIMARY KEY,
  balance_cents integer NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_telegram_id bigint NOT NULL,
  kind public.wallet_tx_kind NOT NULL,
  amount_cents integer NOT NULL,
  balance_after_cents integer NOT NULL,
  ref_order_id uuid,
  ref_payment_id uuid,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_wallet_tx_user ON public.wallet_transactions(user_telegram_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_telegram_id bigint NOT NULL,
  referee_telegram_id bigint NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (referrer_telegram_id <> referee_telegram_id)
);
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.referral_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_telegram_id bigint NOT NULL,
  referee_telegram_id bigint NOT NULL,
  order_id uuid NOT NULL UNIQUE,
  amount_cents integer NOT NULL,
  paid_to_wallet boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.referral_rewards ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_referral_rewards_ref ON public.referral_rewards(referrer_telegram_id);

CREATE TABLE IF NOT EXISTS public.settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

INSERT INTO public.settings (key, value) VALUES
  ('referral_pct', '5'::jsonb),
  ('referral_max_cents', '50000'::jsonb),
  ('broadcast_rate_per_sec', '25'::jsonb),
  ('abuse_threshold', '20'::jsonb),
  ('abuse_ban_hours', '24'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.button_templates (
  key text PRIMARY KEY,
  label text NOT NULL,
  emoji text NOT NULL DEFAULT '',
  is_visible boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.button_templates ENABLE ROW LEVEL SECURITY;

INSERT INTO public.button_templates (key, label, emoji, sort_order) VALUES
  ('menu.shop','Shop','🛒',10),
  ('menu.orders','My Orders','📦',20),
  ('menu.pending','Pending Payments','⏳',30),
  ('menu.wallet','Wallet','💼',40),
  ('menu.referrals','Referrals','🎁',50),
  ('menu.profile','My Profile','👤',60),
  ('menu.support','Support','💬',70),
  ('menu.admin','Admin Panel','🛠️',100)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_telegram_id bigint NOT NULL,
  kind text NOT NULL CHECK (kind IN ('text','photo')),
  text text,
  photo_file_id text,
  buttons jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','cancelled','done')),
  total integer NOT NULL DEFAULT 0,
  sent integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  progress_chat_id bigint,
  progress_message_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.broadcasts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.broadcast_targets (
  broadcast_id uuid NOT NULL REFERENCES public.broadcasts(id) ON DELETE CASCADE,
  telegram_id bigint NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  error text,
  sent_at timestamptz,
  PRIMARY KEY (broadcast_id, telegram_id)
);
ALTER TABLE public.broadcast_targets ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_broadcast_targets_pending ON public.broadcast_targets(broadcast_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.abuse_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_telegram_id bigint NOT NULL,
  kind text NOT NULL,
  weight integer NOT NULL DEFAULT 1,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.abuse_logs ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_abuse_logs_user_time ON public.abuse_logs(user_telegram_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_telegram_id bigint,
  event text NOT NULL,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;

-- ============ Functions ============
CREATE OR REPLACE FUNCTION public._ensure_wallet(p_user bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO public.wallets (user_telegram_id) VALUES (p_user)
  ON CONFLICT (user_telegram_id) DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION public.wallet_credit(
  p_user bigint, p_amount integer, p_kind public.wallet_tx_kind,
  p_note text DEFAULT NULL, p_order uuid DEFAULT NULL, p_payment uuid DEFAULT NULL
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_new integer;
BEGIN
  IF p_amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  PERFORM public._ensure_wallet(p_user);
  UPDATE public.wallets SET balance_cents = balance_cents + p_amount, updated_at = now()
    WHERE user_telegram_id = p_user RETURNING balance_cents INTO v_new;
  INSERT INTO public.wallet_transactions(user_telegram_id, kind, amount_cents, balance_after_cents, ref_order_id, ref_payment_id, note)
    VALUES (p_user, p_kind, p_amount, v_new, p_order, p_payment, p_note);
  RETURN v_new;
END $$;

CREATE OR REPLACE FUNCTION public.wallet_debit(
  p_user bigint, p_amount integer, p_kind public.wallet_tx_kind,
  p_note text DEFAULT NULL, p_order uuid DEFAULT NULL
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_new integer;
BEGIN
  IF p_amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  PERFORM public._ensure_wallet(p_user);
  PERFORM 1 FROM public.wallets WHERE user_telegram_id = p_user FOR UPDATE;
  UPDATE public.wallets SET balance_cents = balance_cents - p_amount, updated_at = now()
    WHERE user_telegram_id = p_user AND balance_cents >= p_amount
    RETURNING balance_cents INTO v_new;
  IF v_new IS NULL THEN RAISE EXCEPTION 'insufficient_funds'; END IF;
  INSERT INTO public.wallet_transactions(user_telegram_id, kind, amount_cents, balance_after_cents, ref_order_id, note)
    VALUES (p_user, p_kind, -p_amount, v_new, p_order, p_note);
  RETURN v_new;
END $$;

CREATE OR REPLACE FUNCTION public.admin_wallet_adjust(
  p_admin bigint, p_user bigint, p_amount integer, p_note text DEFAULT NULL
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_new integer;
BEGIN
  PERFORM public._ensure_wallet(p_user);
  PERFORM 1 FROM public.wallets WHERE user_telegram_id = p_user FOR UPDATE;
  UPDATE public.wallets SET balance_cents = GREATEST(0, balance_cents + p_amount), updated_at=now()
    WHERE user_telegram_id = p_user RETURNING balance_cents INTO v_new;
  INSERT INTO public.wallet_transactions(user_telegram_id, kind, amount_cents, balance_after_cents, note)
    VALUES (p_user, 'admin_adjust', p_amount, v_new, COALESCE(p_note,'') || ' [by '||p_admin||']');
  INSERT INTO public.audit_logs(admin_telegram_id, action, target)
    VALUES (p_admin, 'wallet_adjust', jsonb_build_object('user',p_user,'amount',p_amount,'note',p_note));
  RETURN v_new;
END $$;

CREATE OR REPLACE FUNCTION public.deposit_to_wallet(
  p_user bigint, p_reference text, p_provider public.payment_method,
  p_amount integer, p_raw jsonb
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_payment_id uuid;
BEGIN
  IF p_amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  INSERT INTO public.payments(order_id, reference, provider, amount_cents, raw_response)
    VALUES (NULL, p_reference, p_provider, p_amount, p_raw)
    RETURNING id INTO v_payment_id;
  RETURN public.wallet_credit(p_user, p_amount, 'deposit', 'Telebirr/CBE deposit', NULL, v_payment_id);
END $$;

CREATE OR REPLACE FUNCTION public.process_payment(
  p_order_id uuid, p_reference text, p_provider public.payment_method,
  p_amount_cents integer, p_raw jsonb
) RETURNS TABLE(delivered_code text, short_id text, delivery_mode public.delivery_mode, status public.order_status)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_code_id uuid; v_code text; v_mode public.delivery_mode;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found'; END IF;
  IF v_order.status <> 'pending' THEN RAISE EXCEPTION 'order_not_pending: %', v_order.status; END IF;
  IF v_order.expires_at < now() THEN
    UPDATE public.orders SET status='expired' WHERE id = p_order_id;
    RAISE EXCEPTION 'order_expired';
  END IF;
  IF v_order.payment_method IS DISTINCT FROM p_provider THEN
    RAISE EXCEPTION 'provider_mismatch';
  END IF;
  IF v_order.total_cents <> p_amount_cents THEN
    RAISE EXCEPTION 'amount_mismatch';
  END IF;

  INSERT INTO public.payments(order_id, reference, provider, amount_cents, raw_response)
    VALUES (p_order_id, p_reference, p_provider, p_amount_cents, p_raw);
  UPDATE public.orders SET status='paid' WHERE id = p_order_id;

  SELECT p.delivery_mode INTO v_mode FROM public.products p WHERE p.id = v_order.product_id;
  IF v_mode = 'manual' THEN
    UPDATE public.orders SET status='paid_waiting_delivery', manual_delivery_status='pending'
      WHERE id = p_order_id;
    delivered_code := NULL; short_id := v_order.short_id; delivery_mode := 'manual'; status := 'paid_waiting_delivery';
    RETURN NEXT; RETURN;
  END IF;

  SELECT id, code INTO v_code_id, v_code FROM public.product_codes
    WHERE product_id = v_order.product_id AND is_used=false
    ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF v_code_id IS NULL THEN RAISE EXCEPTION 'out_of_stock'; END IF;
  UPDATE public.product_codes SET is_used=true, used_at=now(), used_by_order_id=p_order_id WHERE id=v_code_id;
  UPDATE public.orders SET status='delivered', delivered_at=now(), delivered_code=v_code,
    delivery_content_type='text', delivery_timestamp=now() WHERE id = p_order_id;

  delivered_code := v_code; short_id := v_order.short_id; delivery_mode := 'automatic'; status := 'delivered';
  RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION public.pay_order_from_wallet(p_order_id uuid, p_user bigint)
RETURNS TABLE(delivered_code text, short_id text, delivery_mode public.delivery_mode, status public.order_status)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_order public.orders%ROWTYPE; v_code_id uuid; v_code text; v_mode public.delivery_mode;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found'; END IF;
  IF v_order.user_telegram_id <> p_user THEN RAISE EXCEPTION 'not_owner'; END IF;
  IF v_order.status <> 'pending' THEN RAISE EXCEPTION 'order_not_pending'; END IF;
  IF v_order.expires_at < now() THEN
    UPDATE public.orders SET status='expired' WHERE id=p_order_id;
    RAISE EXCEPTION 'order_expired';
  END IF;

  PERFORM public.wallet_debit(p_user, v_order.total_cents, 'order_payment', 'Order '||v_order.short_id, p_order_id);
  UPDATE public.orders SET status='paid', paid_from_wallet=true WHERE id=p_order_id;

  SELECT p.delivery_mode INTO v_mode FROM public.products p WHERE p.id=v_order.product_id;
  IF v_mode = 'manual' THEN
    UPDATE public.orders SET status='paid_waiting_delivery', manual_delivery_status='pending' WHERE id=p_order_id;
    delivered_code := NULL; short_id := v_order.short_id; delivery_mode := 'manual'; status := 'paid_waiting_delivery';
    RETURN NEXT; RETURN;
  END IF;

  SELECT id, code INTO v_code_id, v_code FROM public.product_codes
    WHERE product_id = v_order.product_id AND is_used=false
    ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF v_code_id IS NULL THEN RAISE EXCEPTION 'out_of_stock'; END IF;
  UPDATE public.product_codes SET is_used=true, used_at=now(), used_by_order_id=p_order_id WHERE id=v_code_id;
  UPDATE public.orders SET status='delivered', delivered_at=now(), delivered_code=v_code,
    delivery_content_type='text', delivery_timestamp=now() WHERE id=p_order_id;
  delivered_code := v_code; short_id := v_order.short_id; delivery_mode := 'automatic'; status := 'delivered';
  RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION public.manual_deliver(
  p_order_id uuid, p_admin bigint, p_content_type text, p_code text DEFAULT NULL
) RETURNS TABLE(short_id text, user_telegram_id bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_order public.orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found'; END IF;
  IF v_order.status NOT IN ('paid_waiting_delivery','paid') THEN RAISE EXCEPTION 'invalid_status'; END IF;
  IF v_order.manual_delivery_status = 'delivered' THEN RAISE EXCEPTION 'already_delivered'; END IF;

  UPDATE public.orders SET
    status='delivered', manual_delivery_status='delivered',
    delivered_by_admin_id = p_admin, delivery_content_type = p_content_type,
    delivery_timestamp = now(), delivered_at = now(),
    delivered_code = COALESCE(p_code, delivered_code)
  WHERE id = p_order_id;

  INSERT INTO public.audit_logs(admin_telegram_id, action, target)
    VALUES (p_admin, 'manual_deliver', jsonb_build_object('order_id',p_order_id,'content_type',p_content_type));

  short_id := v_order.short_id; user_telegram_id := v_order.user_telegram_id;
  RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION public.reject_order(p_order_id uuid, p_admin bigint, p_reason text)
RETURNS TABLE(short_id text, user_telegram_id bigint, refunded_cents integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_order public.orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found'; END IF;
  IF v_order.status NOT IN ('paid','paid_waiting_delivery') THEN RAISE EXCEPTION 'invalid_status'; END IF;
  PERFORM public.wallet_credit(v_order.user_telegram_id, v_order.total_cents, 'refund',
    'Refund for rejected '||v_order.short_id||': '||COALESCE(p_reason,''), p_order_id, NULL);
  UPDATE public.orders SET status='rejected', manual_delivery_status='rejected',
    notes=COALESCE(notes,'')||E'\nRejected: '||p_reason WHERE id=p_order_id;
  INSERT INTO public.audit_logs(admin_telegram_id, action, target)
    VALUES (p_admin, 'reject_order', jsonb_build_object('order_id',p_order_id,'reason',p_reason));
  short_id := v_order.short_id; user_telegram_id := v_order.user_telegram_id; refunded_cents := v_order.total_cents;
  RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION public.refund_order(p_order_id uuid, p_admin bigint, p_reason text)
RETURNS TABLE(short_id text, user_telegram_id bigint, refunded_cents integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_order public.orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found'; END IF;
  IF v_order.status IN ('refunded','rejected') THEN RAISE EXCEPTION 'already_refunded'; END IF;
  PERFORM public.wallet_credit(v_order.user_telegram_id, v_order.total_cents, 'refund',
    'Refund for '||v_order.short_id||': '||COALESCE(p_reason,''), p_order_id, NULL);
  UPDATE public.orders SET status='refunded' WHERE id=p_order_id;
  INSERT INTO public.audit_logs(admin_telegram_id, action, target)
    VALUES (p_admin, 'refund_order', jsonb_build_object('order_id',p_order_id,'reason',p_reason));
  short_id := v_order.short_id; user_telegram_id := v_order.user_telegram_id; refunded_cents := v_order.total_cents;
  RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION public.grant_referral_reward(p_order_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_order public.orders%ROWTYPE; v_pct numeric; v_max integer; v_amount integer; v_ref bigint;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  IF v_order.status NOT IN ('paid','delivered','paid_waiting_delivery') THEN RETURN 0; END IF;
  v_ref := v_order.referrer_telegram_id;
  IF v_ref IS NULL OR v_ref = v_order.user_telegram_id THEN RETURN 0; END IF;
  IF EXISTS (SELECT 1 FROM public.referral_rewards WHERE order_id = p_order_id) THEN RETURN 0; END IF;

  SELECT (value)::numeric INTO v_pct FROM public.settings WHERE key='referral_pct';
  SELECT (value)::integer INTO v_max FROM public.settings WHERE key='referral_max_cents';
  v_amount := LEAST(COALESCE(v_max, 50000), FLOOR(v_order.total_cents * COALESCE(v_pct,5) / 100.0)::integer);
  IF v_amount <= 0 THEN RETURN 0; END IF;

  INSERT INTO public.referral_rewards(referrer_telegram_id, referee_telegram_id, order_id, amount_cents)
    VALUES (v_ref, v_order.user_telegram_id, p_order_id, v_amount);
  RETURN v_amount;
END $$;

CREATE OR REPLACE FUNCTION public.referral_payout(p_user bigint)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_sum integer;
BEGIN
  SELECT COALESCE(SUM(amount_cents),0) INTO v_sum
    FROM public.referral_rewards
    WHERE referrer_telegram_id = p_user AND paid_to_wallet = false;
  IF v_sum <= 0 THEN RETURN 0; END IF;
  UPDATE public.referral_rewards SET paid_to_wallet = true
    WHERE referrer_telegram_id = p_user AND paid_to_wallet = false;
  PERFORM public.wallet_credit(p_user, v_sum, 'referral_payout', 'Referral earnings payout', NULL, NULL);
  RETURN v_sum;
END $$;
