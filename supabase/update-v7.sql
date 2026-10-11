-- AGRON Workspace v0.9: access for new HR sections (candidates, compensation, offboarding)
insert into public.section_access(section, role, can_write, external) values
('hr.candidates','management',false,false),
('hr.candidates','hr',true,false),
('hr.compensation','management',true,false),
('hr.compensation','hr',true,false),
('hr.compensation','finance',false,false),
('hr.offboarding','management',false,false),
('hr.offboarding','hr',true,false),
('hr.offboarding','security',true,false)
on conflict (section, role) do nothing;
