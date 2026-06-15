-- Cornell Craves: replace the curated campus_locations list (build spec 5 #18).
--
-- Clears the original seed (created_by IS NULL) and inserts the eleven approved
-- places with their coordinates. Club-added custom locations (created_by NOT
-- NULL) are preserved. Coordinates below are the spec's starting points; verify
-- each pin lands on the building on the live map and adjust if any are off.

-- Remove only the curated seed; keep club-added spots.
delete from public.campus_locations where created_by is null;

insert into public.campus_locations (name, latitude, longitude, description, created_by) values
  ('Ho Plaza', 42.4474, -76.4849, 'Central campus, between the Straight and Sage Chapel', null),
  ('Duffield Hall Atrium', 42.4446, -76.4827, 'Engineering quad, indoor atrium', null),
  ('Willard Straight Hall', 42.4467, -76.4856, 'Central campus, main lobby', null),
  ('Temple of Zeus (Klarman Hall)', 42.4493, -76.4838, 'Arts quad, cafe in Klarman Hall', null),
  ('Mann Library Atrium', 42.4485, -76.4760, 'Ag quad, indoor atrium', null),
  ('Olin Library', 42.4478, -76.4841, 'Arts quad, main entrance', null),
  ('Noyes Community Center', 42.4446, -76.4889, 'West campus, main entrance', null),
  ('Statler Hall', 42.4456, -76.4815, 'East Ave, by the auditorium', null),
  ('Physical Sciences Building Atrium', 42.4499, -76.4818, 'North of the arts quad, indoor atrium', null),
  ('Sage Hall Atrium', 42.4459, -76.4828, 'Johnson School, indoor atrium', null),
  ('Robert Purcell Community Center', 42.4548, -76.4779, 'North campus community center', null);
