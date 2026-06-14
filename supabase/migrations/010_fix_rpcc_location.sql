-- Cornell Craves: correct the RPCC campus-location coordinates (Batch 2 #12).
-- The seed in 002_marketplace.sql placed "RPCC lobby" at (42.45620, -76.47780),
-- which lands north of the actual building. Robert Purcell Community Center on
-- North Campus sits at roughly (42.45499, -76.47787).

update public.campus_locations
set latitude = 42.45499, longitude = -76.47787
where name = 'RPCC lobby';

-- Sanity check of the other seeded locations (no change needed; values verified
-- plausible against campus geography):
--   Ho Plaza            42.44740, -76.48530  (central, by the Straight)        OK
--   Duffield Hall       42.44455, -76.48280  (engineering quad)               OK
--   Willard Straight    42.44660, -76.48560  (central)                        OK
--   Klarman Hall        42.44900, -76.48370  (arts quad)                      OK
--   Mann Library        42.44870, -76.47640  (ag quad, east)                  OK
--   Olin Library        42.44770, -76.48450  (arts quad)                      OK
--   Noyes Center        42.44680, -76.48870  (west campus)                    OK
--   Statler Hall        42.44560, -76.48190  (east ave)                       OK
--   Eng quad sundial    42.44440, -76.48390  (engineering quad)              OK
