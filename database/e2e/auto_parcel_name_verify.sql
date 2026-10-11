BEGIN;

DO $$
DECLARE
  counters bigint[];
BEGIN
  SELECT array_agg(next_auto_parcel_name_number ORDER BY id)
  INTO counters
  FROM app.users
  WHERE id IN (
    'a0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000002',
    'a0000000-0000-4000-8000-000000000003'
  );
  IF counters IS DISTINCT FROM ARRAY[4, 1, 1]::bigint[] THEN
    RAISE EXCEPTION 'Automatic parcel-name migration backfill failed';
  END IF;
  IF (SELECT COUNT(*) FROM app.parcels WHERE parcel_code LIKE 'E2E-AUTO-%') <> 6 THEN
    RAISE EXCEPTION 'Automatic parcel-name migration changed existing parcels';
  END IF;
  IF (SELECT COUNT(*) FROM app.parcels
    WHERE owner_user_id = 'a0000000-0000-4000-8000-000000000001'
      AND parcel_name = 'แปลงที่ 3') <> 2
    OR (SELECT COUNT(*) FROM app.parcels WHERE parcel_name = 'แปลงที่ 04') <> 1
    OR (SELECT COUNT(*) FROM app.parcels
      WHERE parcel_name = 'แปลงที่ 999999999999999999999999999999') <> 1 THEN
    RAISE EXCEPTION 'Automatic parcel-name migration changed historical names';
  END IF;
END;
$$;

DELETE FROM app.parcels WHERE parcel_code LIKE 'E2E-AUTO-%';
DELETE FROM app.users WHERE id IN (
  'a0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000002',
  'a0000000-0000-4000-8000-000000000003'
);

COMMIT;
