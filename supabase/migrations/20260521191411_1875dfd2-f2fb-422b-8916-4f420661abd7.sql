
-- Enums
CREATE TYPE public.payment_method AS ENUM ('telebirr', 'cbe');
CREATE TYPE public.order_status AS ENUM ('pending', 'paid', 'delivered', 'failed', 'expired', 'refunded');

-- updated_at helper
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- bot_users
CREATE TABLE public.bot_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id BIGINT NOT NULL UNIQUE,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  language_code TEXT,
  is_banned BOOLEAN NOT NULL DEFAULT false,
  banned_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_bot_users_updated BEFORE UPDATE ON public.bot_users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- products
CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '📦',
  description TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  warranty_text TEXT NOT NULL DEFAULT '',
  quantity_presets JSONB NOT NULL DEFAULT '[1,2,5,10]'::jsonb,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_products_updated BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- product_codes
CREATE TABLE public.product_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  is_used BOOLEAN NOT NULL DEFAULT false,
  used_at TIMESTAMPTZ,
  used_by_order_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_product_codes_avail ON public.product_codes (product_id) WHERE is_used = false;
CREATE UNIQUE INDEX uniq_code_per_order ON public.product_codes (used_by_order_id) WHERE used_by_order_id IS NOT NULL;

-- orders
CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  short_id TEXT NOT NULL UNIQUE DEFAULT upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  user_telegram_id BIGINT NOT NULL,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  payment_method public.payment_method,
  status public.order_status NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '1 hour'),
  delivered_at TIMESTAMPTZ,
  delivered_code TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_orders_user ON public.orders (user_telegram_id, created_at DESC);
CREATE INDEX idx_orders_status ON public.orders (status, created_at DESC);
CREATE TRIGGER trg_orders_updated BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- payments
CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  reference TEXT NOT NULL UNIQUE,
  provider public.payment_method NOT NULL,
  amount_cents INTEGER NOT NULL,
  raw_response JSONB,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_payments_order ON public.payments (order_id);

-- payment_attempts (audit + rate-limit source)
CREATE TABLE public.payment_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  user_telegram_id BIGINT NOT NULL,
  reference TEXT,
  status TEXT NOT NULL,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_attempts_user_time ON public.payment_attempts (user_telegram_id, created_at DESC);

-- receipt_hashes
CREATE TABLE public.receipt_hashes (
  sha256 TEXT PRIMARY KEY,
  uploaded_by_telegram_id BIGINT NOT NULL,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- message_templates
CREATE TABLE public.message_templates (
  key TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_templates_updated BEFORE UPDATE ON public.message_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- admin_sessions
CREATE TABLE public.admin_sessions (
  telegram_id BIGINT PRIMARY KEY,
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_admin_sessions_updated BEFORE UPDATE ON public.admin_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- audit_logs
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_telegram_id BIGINT NOT NULL,
  action TEXT NOT NULL,
  target JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_admin ON public.audit_logs (admin_telegram_id, created_at DESC);

-- RLS: enable on every table, NO public policies. Only the service-role admin client (bot backend) talks to these.
ALTER TABLE public.bot_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_hashes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Atomic payment processing function.
-- Caller MUST have already successfully called the external Leul Verify API and is passing in the verified amount/provider/reference.
-- This function: locks the order, asserts state, inserts payment (unique reference is final race guard),
-- claims one unused code under SKIP LOCKED, marks order delivered, returns the code.
CREATE OR REPLACE FUNCTION public.process_payment(
  p_order_id UUID,
  p_reference TEXT,
  p_provider public.payment_method,
  p_amount_cents INTEGER,
  p_raw JSONB
)
RETURNS TABLE(delivered_code TEXT, short_id TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_code_id UUID;
  v_code TEXT;
BEGIN
  -- Lock the order row
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found'; END IF;
  IF v_order.status <> 'pending' THEN RAISE EXCEPTION 'order_not_pending: %', v_order.status; END IF;
  IF v_order.expires_at < now() THEN
    UPDATE public.orders SET status='expired' WHERE id = p_order_id;
    RAISE EXCEPTION 'order_expired';
  END IF;
  IF v_order.payment_method IS DISTINCT FROM p_provider THEN
    RAISE EXCEPTION 'provider_mismatch: order=% verified=%', v_order.payment_method, p_provider;
  END IF;
  IF v_order.total_cents <> p_amount_cents THEN
    RAISE EXCEPTION 'amount_mismatch: expected=% got=%', v_order.total_cents, p_amount_cents;
  END IF;

  -- Insert payment (UNIQUE on reference is the final race guard against double-spend across orders)
  INSERT INTO public.payments (order_id, reference, provider, amount_cents, raw_response)
  VALUES (p_order_id, p_reference, p_provider, p_amount_cents, p_raw);

  -- Mark paid
  UPDATE public.orders SET status='paid' WHERE id = p_order_id;

  -- Claim one unused code for this product
  SELECT id, code INTO v_code_id, v_code
  FROM public.product_codes
  WHERE product_id = v_order.product_id AND is_used = false
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_code_id IS NULL THEN
    -- Out of stock at the very last second: leave order in 'paid' (admin must resolve), surface error
    RAISE EXCEPTION 'out_of_stock';
  END IF;

  UPDATE public.product_codes
  SET is_used=true, used_at=now(), used_by_order_id=p_order_id
  WHERE id = v_code_id;

  UPDATE public.orders
  SET status='delivered', delivered_at=now(), delivered_code=v_code
  WHERE id = p_order_id;

  delivered_code := v_code;
  short_id := v_order.short_id;
  RETURN NEXT;
END;
$$;

-- Seed default templates
INSERT INTO public.message_templates (key, body) VALUES
  ('welcome', 'Welcome {first_name}! 👋' || E'\n\nThis bot sells digital codes. Tap 🛒 Shop to browse products.'),
  ('main_menu', '🏠 Main menu — choose an option below.'),
  ('payment_instruction_telebirr', '💳 *Order {short_id}*' || E'\n\nProduct: {product_name}\nQty: {quantity}\nTotal: *{total} ETB*\n\nPay via Telebirr to: `0900000000`\n\nAfter paying, send the *transaction reference* (the SMS confirmation number) here as a message. ⚠️ Reference is required.'),
  ('payment_instruction_cbe', '💳 *Order {short_id}*' || E'\n\nProduct: {product_name}\nQty: {quantity}\nTotal: *{total} ETB*\n\nPay via CBE to account: `1000000000000`\n\nAfter paying, send the *transaction reference (FT...)* here as a message, then upload your receipt as a photo. ⚠️ Both reference and receipt are required.'),
  ('payment_success', '✅ Payment verified for order {short_id}.'),
  ('payment_failed', '❌ Payment verification failed for order {short_id}.' || E'\n\nReason: {reason}\n\nDouble-check the reference and try again, or contact support.'),
  ('delivery', '🎉 *Order {short_id} delivered!*' || E'\n\nProduct: {product_name}\nYour code:\n\n`{code}`\n\nWarranty: {warranty}\n\nThanks for buying! Need help? Use 💬 Support.'),
  ('support', '💬 Need help? Message @your_support_username — please include your order ID.');
