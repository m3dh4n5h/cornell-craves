-- Cornell Craves: corrected Mann and RPCC pins to user-supplied coordinates.

update public.campus_locations
set latitude = 42.4487952, longitude = -76.476316,
    description = '237 Mann Dr, Ithaca, NY 14853'
where name = 'Mann Library Atrium';

update public.campus_locations
set latitude = 42.4559245, longitude = -76.4774412,
    description = '107 Jessup Rd, Ithaca, NY 14850'
where name = 'Robert Purcell Community Center';
