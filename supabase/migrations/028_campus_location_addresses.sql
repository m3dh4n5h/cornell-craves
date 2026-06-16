-- Cornell Craves: correct five campus pins to their geocoded street addresses
-- (user-provided). Coordinates from Nominatim; verify each pin on the live map.

update public.campus_locations
set latitude = 42.4567055, longitude = -76.4756475,
    description = '107 Jessup Rd, Ithaca, NY 14850'
where name = 'Robert Purcell Community Center';

update public.campus_locations
set latitude = 42.4465180, longitude = -76.4880334,
    description = '306 West Ave, Ithaca, NY 14853'
where name = 'Noyes Community Center';

update public.campus_locations
set latitude = 42.4455232, longitude = -76.4820602,
    description = '106 Statler Dr, Ithaca, NY 14853'
where name = 'Statler Hall';

update public.campus_locations
set latitude = 42.4490693, longitude = -76.4834788,
    description = '232 E Ave, Ithaca, NY 14850'
where name = 'Temple of Zeus (Klarman Hall)';

update public.campus_locations
set latitude = 42.4465706, longitude = -76.4664332,
    description = '260 Tower Rd, Ithaca, NY 14853'
where name = 'Mann Library Atrium';
