BEGIN;

ALTER TABLE app.users
ADD COLUMN next_auto_parcel_name_number bigint NOT NULL DEFAULT 1;

ALTER TABLE app.users
ADD CONSTRAINT users_next_auto_parcel_name_number_positive_chk
CHECK (next_auto_parcel_name_number >= 1);

DO $$
DECLARE
  highest_number numeric;
BEGIN
  SELECT MAX(CASE
    WHEN length(parts[1]) <= 19 AND parts[1]::numeric <= 9223372036854775807
      THEN parts[1]::numeric
    ELSE NULL
  END)
  INTO highest_number
  FROM app.parcels AS parcel
  CROSS JOIN LATERAL regexp_match(parcel.parcel_name, '^แปลงที่ ([1-9][0-9]*)$') AS matched(parts)
  WHERE parcel.owner_user_id IS NOT NULL;

  IF highest_number = 9223372036854775807 THEN
    RAISE EXCEPTION 'Existing automatic parcel name exceeds the available counter range';
  END IF;
END;
$$;

WITH owner_maximum AS (
  SELECT parcel.owner_user_id,
    MAX(CASE
      WHEN length(parts[1]) <= 19 AND parts[1]::numeric <= 9223372036854775807
        THEN parts[1]::numeric
      ELSE NULL
    END) AS highest_number
  FROM app.parcels AS parcel
  CROSS JOIN LATERAL regexp_match(parcel.parcel_name, '^แปลงที่ ([1-9][0-9]*)$') AS matched(parts)
  WHERE parcel.owner_user_id IS NOT NULL
  GROUP BY parcel.owner_user_id
)
UPDATE app.users AS user_record
SET next_auto_parcel_name_number = (owner_maximum.highest_number + 1)::bigint
FROM owner_maximum
WHERE user_record.id = owner_maximum.owner_user_id
  AND owner_maximum.highest_number IS NOT NULL;

COMMIT;
