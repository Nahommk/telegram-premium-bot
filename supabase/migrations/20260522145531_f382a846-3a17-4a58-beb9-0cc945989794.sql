UPDATE public.message_templates
SET body = 'Amount mismatch. Expected {expected} ETB, verified reference shows {received} ETB.',
    updated_at = now()
WHERE key = 'payment_error_amount_mismatch'
  AND body = 'Amount mismatch. Expected {expected} ETB, receipt shows {received} ETB.';

UPDATE public.message_templates
SET body = 'Could not read the amount from the verified reference.',
    updated_at = now()
WHERE key = 'payment_error_no_amount'
  AND body = 'Could not read amount from receipt.';

UPDATE public.message_templates
SET body = '❌ Amount mismatch. Expected {expected} ETB, verified reference shows {received} ETB.',
    updated_at = now()
WHERE key = 'wallet_deposit_error_amount_mismatch'
  AND body = '❌ Amount mismatch. Expected {expected} ETB, receipt shows {received} ETB.';