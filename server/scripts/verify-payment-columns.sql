WITH expected(column_name) AS (
  VALUES
    ('applicantRole'),
    ('paymentMethod'),
    ('transactionReference'),
    ('receiptStorageKey'),
    ('receiptOriginalName'),
    ('reportedPaid')
)
SELECT
  current_database() AS database_name,
  expected.column_name,
  actual.column_name IS NOT NULL AS present
FROM expected
LEFT JOIN information_schema.columns AS actual
  ON actual.table_schema = 'public'
  AND actual.table_name = 'RegistrationPayment'
  AND actual.column_name = expected.column_name
ORDER BY expected.column_name;

SELECT
  current_database() AS database_name,
  migration_name,
  checksum,
  finished_at,
  rolled_back_at,
  finished_at IS NOT NULL AND rolled_back_at IS NULL AS applied,
  applied_steps_count
FROM public."_prisma_migrations"
WHERE migration_name = '20261118120000_registration_payment_details';
