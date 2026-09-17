-- One-time correction of the tutoring data reviewed on 2026-09-17.
-- It targets only workspace fb71d118-de05-4fe0-9001-c7a764adc0ff. On databases without that workspace all INSERTs are no-ops.
PRAGMA foreign_keys = ON;

-- Replace only tutoring schedule/package-progress state; finance data is intentionally untouched.
DELETE FROM tutoring_billing_cycle_occurrences WHERE workspace_id='fb71d118-de05-4fe0-9001-c7a764adc0ff';
DELETE FROM tutoring_occurrences WHERE workspace_id='fb71d118-de05-4fe0-9001-c7a764adc0ff';
DELETE FROM tutoring_session_students WHERE workspace_id='fb71d118-de05-4fe0-9001-c7a764adc0ff';
DELETE FROM tutoring_recurring_sessions WHERE workspace_id='fb71d118-de05-4fe0-9001-c7a764adc0ff';
DELETE FROM tutoring_billing_cycles WHERE workspace_id='fb71d118-de05-4fe0-9001-c7a764adc0ff';
DELETE FROM tutoring_billing_plans WHERE workspace_id='fb71d118-de05-4fe0-9001-c7a764adc0ff';

-- Canonical roster: 24 students, including separated siblings and center students.
WITH desired(id,name,age,guardian_name,guardian_phone,level,notes,active) AS (
  VALUES
    ('074a0fb8-e41b-5805-9a01-8c1a9c2fe1e9','ملك',NULL,NULL,NULL,NULL,'أخت جودي. عدد الحصص السابقة حسب الورقة البيضاء: 2.',1),
    ('4a8667e8-2c2d-596e-8608-f0533fe211e8','جودي',NULL,NULL,NULL,NULL,'أخت ملك. عدد الحصص السابقة حسب الورقة البيضاء: 2.',1),
    ('645945d2-8d24-58c3-8396-1bffb6727a9c','ريناد',NULL,NULL,NULL,NULL,'عدد الحصص السابقة غير مذكور في الورقة البيضاء.',1),
    ('6cff6bd5-b8ca-53d7-939e-d2be45a25af5','نور',NULL,NULL,NULL,NULL,'عدد الحصص السابقة غير مذكور في الورقة البيضاء.',1),
    ('6d8ca54f-ca52-500a-bbac-a8e1f6a86d10','سادن',NULL,NULL,NULL,NULL,'عدد الحصص السابقة غير مذكور في الورقة البيضاء.',1),
    ('76606fd7-1949-571c-9075-e05c5b8e96b7','يحيى (أخو آدم)',NULL,NULL,NULL,NULL,'أخو آدم؛ الحصة مشتركة معه. عدد الحصص السابقة حسب الورقة البيضاء: 2.',1),
    ('17c41524-df99-5ba1-8a63-47a5b3153143','آدم',NULL,NULL,NULL,NULL,'أخو يحيى؛ الحصة مشتركة معه. عدد الحصص السابقة حسب الورقة البيضاء: 2.',1),
    ('7e8da426-8129-5a81-92d1-17b4a1f35fd1','جيسي',NULL,NULL,NULL,NULL,'عدد الحصص السابقة حسب الورقة البيضاء: 5.',1),
    ('85637c32-dab4-5e45-a1cb-ded72c61dc38','أروى',NULL,NULL,NULL,NULL,'عدد الحصص السابقة غير مذكور في الورقة البيضاء.',1),
    ('93ed6a6d-fe3a-5af9-b828-18a9285a1739','أنس',NULL,NULL,NULL,NULL,'عدد الحصص السابقة حسب الورقة البيضاء: 7.',1),
    ('c7366468-d86f-594d-88fe-576c18c5a0d4','لين',NULL,NULL,NULL,NULL,'عدد الحصص السابقة حسب الورقة البيضاء: 4.',1),
    ('d74ea2a6-9792-5b00-b221-c3a30d96a76c','يحيى',NULL,NULL,NULL,NULL,'طالب خاص مختلف عن يحيى أخو آدم ويحيى السنتر. عدد الحصص السابقة حسب الورقة البيضاء: 7.',1),
    ('e3569fef-8867-5d76-a3ed-27b1d297f524','فريدة',NULL,NULL,NULL,NULL,'أخت جلال؛ الحصة مشتركة معه. عدد الحصص السابقة حسب الورقة البيضاء: 2.',1),
    ('c7a5a3cf-a855-5ea4-b722-d13071482563','جلال',NULL,NULL,NULL,NULL,'أخو فريدة؛ الحصة مشتركة معها. عدد الحصص السابقة حسب الورقة البيضاء: 2.',1),
    ('f07e8487-4e2d-5ae7-b84f-14af1dfc5c45','ياسين',NULL,NULL,NULL,NULL,'أخو حور؛ يأخذ الحصة الأولى ثم حور. عدد الحصص السابقة حسب الورقة البيضاء: 3.',1),
    ('10a567b1-646a-579a-a574-37dadfd40ddb','حور',NULL,NULL,NULL,NULL,'أخت ياسين؛ تأخذ الحصة الثانية بعد ياسين. عدد الحصص السابقة حسب الورقة البيضاء: 3.',1),
    ('be986860-cd58-5aa1-97cd-56fa41d2d804','خديجة',NULL,NULL,NULL,NULL,'طالبة خاصة حاليًا بلا جدول أسبوعي ثابت. عدد الحصص السابقة حسب الورقة البيضاء: 1.',1),
    ('066ee55b-4dfe-5e78-afbb-a02a3fab5725','حمزة',NULL,NULL,NULL,NULL,'أخو تيتو؛ طالب خاص حاليًا بلا جدول أسبوعي ثابت. عدد الحصص السابقة حسب الورقة البيضاء: 3.',1),
    ('0bd74a8f-befd-55e7-9df5-5baddf0a388f','تيتو',NULL,NULL,NULL,NULL,'أخو حمزة؛ طالب خاص حاليًا بلا جدول أسبوعي ثابت. عدد الحصص السابقة حسب الورقة البيضاء: 3.',1),
    ('c592b234-5f25-5298-8c60-09222de350aa','سارة',NULL,NULL,NULL,NULL,'طالبة سنتر. عدد الحصص السابقة حسب الورقة البيضاء: 8. أيام الحضور الفردية غير مؤكدة.',1),
    ('56818009-848a-5f82-af2a-bd775247a5bf','زين',NULL,NULL,NULL,NULL,'طالب سنتر. عدد الحصص السابقة غير مذكور في الورقة البيضاء. أيام الحضور الفردية غير مؤكدة.',1),
    ('ae978dbf-00ac-5fda-821b-3ad5ce2b0339','يحيى (السنتر)',NULL,NULL,NULL,NULL,'طالب سنتر مختلف عن باقي الطلاب باسم يحيى. عدد الحصص السابقة حسب الورقة البيضاء: 5. أيام الحضور الفردية غير مؤكدة.',1),
    ('4c39497c-b89b-5c66-acd9-aada19f2ad50','آسيا',NULL,NULL,NULL,NULL,'طالبة سنتر. عدد الحصص السابقة حسب الورقة البيضاء: 7. أيام الحضور الفردية غير مؤكدة.',1),
    ('516d8d4c-2a74-591d-a97b-aae3a7ea3a96','رؤى',NULL,NULL,NULL,NULL,'طالبة سنتر. عدد الحصص السابقة غير مذكور في الورقة البيضاء. أيام الحضور الفردية غير مؤكدة.',1)
)
INSERT INTO tutoring_students(
  id,workspace_id,name,age,guardian_name,guardian_phone,level,notes,active,deleted_at,created_at,updated_at
)
SELECT id,'fb71d118-de05-4fe0-9001-c7a764adc0ff',name,age,guardian_name,guardian_phone,level,notes,active,NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
FROM desired
WHERE EXISTS (SELECT 1 FROM core_workspaces WHERE id='fb71d118-de05-4fe0-9001-c7a764adc0ff')
ON CONFLICT(id) DO UPDATE SET
  name=excluded.name,
  age=excluded.age,
  guardian_name=excluded.guardian_name,
  guardian_phone=excluded.guardian_phone,
  level=excluded.level,
  notes=excluded.notes,
  active=excluded.active,
  deleted_at=NULL,
  updated_at=CURRENT_TIMESTAMP;

-- Keep the existing default package model; prices were not supplied in the paper source.
WITH desired(student_id,package_size,package_price_pence,cycle_anchor_date,effective_from) AS (
  VALUES
    ('074a0fb8-e41b-5805-9a01-8c1a9c2fe1e9',8,0,'2026-09-15','2026-09-15 21:27:29'),
    ('4a8667e8-2c2d-596e-8608-f0533fe211e8',8,0,'2026-09-15','2026-09-15 21:27:29'),
    ('645945d2-8d24-58c3-8396-1bffb6727a9c',8,0,'2026-09-15','2026-09-15 21:27:29'),
    ('6cff6bd5-b8ca-53d7-939e-d2be45a25af5',8,0,'2026-09-15','2026-09-15 21:27:29'),
    ('6d8ca54f-ca52-500a-bbac-a8e1f6a86d10',8,0,'2026-09-15','2026-09-15 21:27:29'),
    ('76606fd7-1949-571c-9075-e05c5b8e96b7',8,0,'2026-09-15','2026-09-15 21:27:29'),
    ('17c41524-df99-5ba1-8a63-47a5b3153143',8,0,'2026-09-15','2026-09-15 21:27:29'),
    ('7e8da426-8129-5a81-92d1-17b4a1f35fd1',8,0,'2026-09-15','2026-09-15 21:27:29'),
    ('85637c32-dab4-5e45-a1cb-ded72c61dc38',8,0,'2026-09-15','2026-09-15 21:27:29'),
    ('93ed6a6d-fe3a-5af9-b828-18a9285a1739',8,0,'2026-09-15','2026-09-15 21:27:29'),
    ('c7366468-d86f-594d-88fe-576c18c5a0d4',8,0,'2026-09-15','2026-09-15 21:27:29'),
    ('d74ea2a6-9792-5b00-b221-c3a30d96a76c',8,0,'2026-09-15','2026-09-15 21:27:29'),
    ('e3569fef-8867-5d76-a3ed-27b1d297f524',8,0,'2026-09-15','2026-09-15 21:27:29'),
    ('c7a5a3cf-a855-5ea4-b722-d13071482563',8,0,'2026-09-15','2026-09-15 21:27:29'),
    ('f07e8487-4e2d-5ae7-b84f-14af1dfc5c45',8,0,'2026-09-15','2026-09-15 21:27:29'),
    ('10a567b1-646a-579a-a574-37dadfd40ddb',8,0,'2026-09-15','2026-09-15 21:27:29'),
    ('be986860-cd58-5aa1-97cd-56fa41d2d804',8,0,'2026-09-15','2026-09-15 21:27:29'),
    ('066ee55b-4dfe-5e78-afbb-a02a3fab5725',8,0,'2026-09-15','2026-09-15 21:27:29'),
    ('0bd74a8f-befd-55e7-9df5-5baddf0a388f',8,0,'2026-09-15','2026-09-15 21:27:29'),
    ('c592b234-5f25-5298-8c60-09222de350aa',8,0,'2026-09-15','2026-09-15 21:27:29'),
    ('56818009-848a-5f82-af2a-bd775247a5bf',8,0,'2026-09-15','2026-09-15 21:27:29'),
    ('ae978dbf-00ac-5fda-821b-3ad5ce2b0339',8,0,'2026-09-15','2026-09-15 21:27:29'),
    ('4c39497c-b89b-5c66-acd9-aada19f2ad50',8,0,'2026-09-15','2026-09-15 21:27:29'),
    ('516d8d4c-2a74-591d-a97b-aae3a7ea3a96',8,0,'2026-09-15','2026-09-15 21:27:29')
)
INSERT INTO tutoring_billing_plans(
  workspace_id,student_id,billing_mode,package_size,package_price_pence,cycle_anchor_date,effective_from,created_at,updated_at
)
SELECT 'fb71d118-de05-4fe0-9001-c7a764adc0ff',d.student_id,'package',d.package_size,d.package_price_pence,d.cycle_anchor_date,d.effective_from,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
FROM desired d
JOIN tutoring_students s ON s.id=d.student_id AND s.workspace_id='fb71d118-de05-4fe0-9001-c7a764adc0ff';

-- Opening progress from the circled lesson counts on the white paper.
-- Students with no written count intentionally have no fabricated progress.
WITH desired(id,student_id,session_limit,price_pence,opening_completed_count,status,started_on,completed_on) AS (
  VALUES
    ('65214699-176c-5878-8a33-6692f12add1c','074a0fb8-e41b-5805-9a01-8c1a9c2fe1e9',8,0,2,'open','2026-09-15',NULL),
    ('fe23671f-3d54-569e-9627-860724542bc0','4a8667e8-2c2d-596e-8608-f0533fe211e8',8,0,2,'open','2026-09-15',NULL),
    ('55c8dafb-025b-58e6-a03a-43f6339acc1f','76606fd7-1949-571c-9075-e05c5b8e96b7',8,0,2,'open','2026-09-15',NULL),
    ('0d457290-762e-53e3-9c25-a021b1315f0f','17c41524-df99-5ba1-8a63-47a5b3153143',8,0,2,'open','2026-09-15',NULL),
    ('18e9cf43-159d-5c4c-a90b-53bd7cc43747','7e8da426-8129-5a81-92d1-17b4a1f35fd1',8,0,5,'open','2026-09-15',NULL),
    ('fa0fcdbc-6bd1-5367-9bc9-efeb5c6b04ed','93ed6a6d-fe3a-5af9-b828-18a9285a1739',8,0,7,'open','2026-09-15',NULL),
    ('d30252b3-fe9a-5249-a2b6-12ccf3a90c73','c7366468-d86f-594d-88fe-576c18c5a0d4',8,0,4,'open','2026-09-15',NULL),
    ('154b3d53-5123-544f-866c-369092436f52','d74ea2a6-9792-5b00-b221-c3a30d96a76c',8,0,7,'open','2026-09-15',NULL),
    ('e8a393cf-f053-54dd-8f01-31ed4ab6a166','e3569fef-8867-5d76-a3ed-27b1d297f524',8,0,2,'open','2026-09-15',NULL),
    ('7e9a54f6-99f4-5b33-8fb9-a235d8c6c748','c7a5a3cf-a855-5ea4-b722-d13071482563',8,0,2,'open','2026-09-15',NULL),
    ('3b046818-04b7-59cd-a47f-6dad2ab76a17','f07e8487-4e2d-5ae7-b84f-14af1dfc5c45',8,0,3,'open','2026-09-15',NULL),
    ('81725382-c404-527c-aac8-658661099ffe','10a567b1-646a-579a-a574-37dadfd40ddb',8,0,3,'open','2026-09-15',NULL),
    ('b24f147f-f098-5689-9b39-6678951c98ec','be986860-cd58-5aa1-97cd-56fa41d2d804',8,0,1,'open','2026-09-15',NULL),
    ('4fdc984d-451d-5522-bd55-3821a42787fa','066ee55b-4dfe-5e78-afbb-a02a3fab5725',8,0,3,'open','2026-09-15',NULL),
    ('42744e58-6a37-5f3a-997b-0553520c73c2','0bd74a8f-befd-55e7-9df5-5baddf0a388f',8,0,3,'open','2026-09-15',NULL),
    ('d2a11da3-13fa-504c-9f29-e22895291139','c592b234-5f25-5298-8c60-09222de350aa',8,0,8,'due','2026-09-15','2026-09-15'),
    ('d9a3fdb3-123c-559c-978d-603653f0738b','ae978dbf-00ac-5fda-821b-3ad5ce2b0339',8,0,5,'open','2026-09-15',NULL),
    ('38957905-6834-5957-b608-3f3b19fb3a2c','4c39497c-b89b-5c66-acd9-aada19f2ad50',8,0,7,'open','2026-09-15',NULL)
)
INSERT INTO tutoring_billing_cycles(
  id,workspace_id,student_id,sequence_no,session_limit,price_pence,opening_completed_count,
  opening_progress_locked_at,status,started_on,completed_on,paid_on,created_at,updated_at
)
SELECT d.id,'fb71d118-de05-4fe0-9001-c7a764adc0ff',d.student_id,1,d.session_limit,d.price_pence,d.opening_completed_count,
       NULL,d.status,d.started_on,d.completed_on,NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
FROM desired d
JOIN tutoring_students s ON s.id=d.student_id AND s.workspace_id='fb71d118-de05-4fe0-9001-c7a764adc0ff';

-- Correct weekly timetable. weekday: 0=Sunday ... 6=Saturday.
WITH desired(
  id,title,session_type,schedule_status,weekday,start_time,duration_minutes,travel_minutes,
  price_basis,default_price_pence,expected_student_count,center_cut_bps
) AS (
  VALUES
    ('85674975-d314-5c75-b611-3cec052ebac2','ملك','online','confirmed',1,'20:00',90,0,'total_session',0,1,0),
    ('632f365b-a130-5410-b3e1-71866117acaa','ملك','online','confirmed',3,'20:00',90,0,'total_session',0,1,0),
    ('207458f1-5f5d-5331-b82c-edaf8d9d58af','جودي','online','confirmed',1,'21:30',90,0,'total_session',0,1,0),
    ('c13b80f9-059c-5615-af03-58cc7684af74','جودي','online','confirmed',3,'21:30',90,0,'total_session',0,1,0),
    ('265e0383-6f1c-5563-8a53-220dc59a0111','ريناد','online','confirmed',2,'18:00',90,0,'total_session',0,1,0),
    ('0fa01f46-6312-5346-b375-2a4308542b84','ريناد','online','confirmed',6,'18:00',90,0,'total_session',0,1,0),
    ('c4fa6bd8-b27a-50d6-b5e7-581f4bfc230c','سادن','online','confirmed',2,'09:00',120,0,'total_session',0,1,0),
    ('8d105881-ee16-5399-b5ba-8af76796d1ab','سادن','online','confirmed',4,'09:00',120,0,'total_session',0,1,0),
    ('a6539efb-9551-5f6d-a5f1-9ce6b71a7661','نور','private_student_home','confirmed',1,'16:00',90,30,'total_session',0,1,0),
    ('557f93fc-37e8-54b8-b056-724f247404f4','نور','private_student_home','confirmed',4,'16:00',90,30,'total_session',0,1,0),
    ('30712011-dc07-5b11-9672-dc4ac0022a25','يحيى وآدم','private_student_home','confirmed',0,'17:00',90,30,'total_session',0,2,0),
    ('774845d8-bf1f-5488-93d6-8ff8053a281a','يحيى وآدم','private_student_home','confirmed',3,'17:00',90,30,'total_session',0,2,0),
    ('9f8e6d58-7fff-51f0-bd9f-86e30bcb8467','يحيى وآدم','private_student_home','confirmed',4,'17:00',90,30,'total_session',0,2,0),
    ('aaf6a1b3-b192-5566-83cc-43324c7560e4','جيسي','private_student_home','confirmed',2,'16:00',90,30,'total_session',0,1,0),
    ('6dfee1fb-7e5c-5758-a7b0-88505bc05fa0','جيسي','private_student_home','confirmed',6,'16:00',90,30,'total_session',0,1,0),
    ('40369cb8-e3e0-577f-8c35-21e99dc62bb7','أروى','private_student_home','confirmed',0,'13:00',90,30,'total_session',0,1,0),
    ('92f6731d-e9b4-5185-933e-2d27d3f13dc6','أروى','private_student_home','confirmed',2,'13:00',90,30,'total_session',0,1,0),
    ('9471313f-20ee-5fea-b2d1-defe59e2cdbc','أروى','private_student_home','confirmed',3,'13:00',90,30,'total_session',0,1,0),
    ('1aa0a27e-23e3-5821-98cb-ebaff7840da0','أنس','private_student_home','confirmed',2,'18:00',90,30,'total_session',0,1,0),
    ('bf829e7a-6040-5618-b3ab-5042ba2688b5','أنس','private_student_home','confirmed',6,'18:00',90,30,'total_session',0,1,0),
    ('57fffc91-3ef4-5b43-bcf6-2feaff64e725','لين','private_student_home','confirmed',0,'11:30',90,30,'total_session',0,1,0),
    ('a3467418-1be0-54a1-be17-efd87d760605','لين','private_student_home','confirmed',3,'11:30',90,30,'total_session',0,1,0),
    ('869dc148-5d43-531f-9d7a-76e29cc1565e','يحيى','private_student_home','confirmed',1,'18:00',90,30,'total_session',0,1,0),
    ('79c788e6-90d8-59c5-b188-9c68f28510b5','فريدة وجلال','private_student_home','confirmed',0,'16:00',60,30,'total_session',0,2,0),
    ('f6c6a2dc-7091-5e03-91c5-90292873984b','فريدة وجلال','private_student_home','confirmed',3,'16:00',60,30,'total_session',0,2,0),
    ('1fc99189-585b-50db-a6fd-31890fde2bdb','ياسين','online','confirmed',1,'11:30',90,0,'total_session',0,1,0),
    ('59f134c4-cc43-51fe-902d-ab9a600fa01d','حور','online','confirmed',1,'13:00',90,0,'total_session',0,1,0),
    ('207d15e5-6093-54ab-bfcd-c2cc373746f6','ياسين','online','confirmed',6,'11:30',90,0,'total_session',0,1,0),
    ('a5a52c16-065b-5b82-8ab8-501c3dfabb97','حور','online','confirmed',6,'13:00',90,0,'total_session',0,1,0),
    ('7971410f-734f-55cc-b0af-fffe4a8ab499','السنتر','center_group','confirmed',1,'14:30',90,0,'total_session',0,5,0),
    ('d2759d1b-ff30-5d5e-a3b4-d84b01f1b9ac','السنتر','center_group','confirmed',4,'14:30',90,0,'total_session',0,5,0)
)
INSERT INTO tutoring_recurring_sessions(
  id,workspace_id,title,session_type,schedule_status,weekday,start_time,duration_minutes,travel_minutes,
  location,price_basis,default_price_pence,expected_student_count,center_cut_bps,active,deleted_at,created_at,updated_at
)
SELECT id,'fb71d118-de05-4fe0-9001-c7a764adc0ff',title,session_type,schedule_status,weekday,start_time,duration_minutes,travel_minutes,
       NULL,price_basis,default_price_pence,expected_student_count,center_cut_bps,1,NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
FROM desired
WHERE EXISTS (SELECT 1 FROM core_workspaces WHERE id='fb71d118-de05-4fe0-9001-c7a764adc0ff');

-- Student/session links. Center students are not attached to a specific weekday because individual attendance days were not confirmed.
WITH desired(recurring_session_id,student_id) AS (
  VALUES
    ('85674975-d314-5c75-b611-3cec052ebac2','074a0fb8-e41b-5805-9a01-8c1a9c2fe1e9'),
    ('632f365b-a130-5410-b3e1-71866117acaa','074a0fb8-e41b-5805-9a01-8c1a9c2fe1e9'),
    ('207458f1-5f5d-5331-b82c-edaf8d9d58af','4a8667e8-2c2d-596e-8608-f0533fe211e8'),
    ('c13b80f9-059c-5615-af03-58cc7684af74','4a8667e8-2c2d-596e-8608-f0533fe211e8'),
    ('265e0383-6f1c-5563-8a53-220dc59a0111','645945d2-8d24-58c3-8396-1bffb6727a9c'),
    ('0fa01f46-6312-5346-b375-2a4308542b84','645945d2-8d24-58c3-8396-1bffb6727a9c'),
    ('c4fa6bd8-b27a-50d6-b5e7-581f4bfc230c','6d8ca54f-ca52-500a-bbac-a8e1f6a86d10'),
    ('8d105881-ee16-5399-b5ba-8af76796d1ab','6d8ca54f-ca52-500a-bbac-a8e1f6a86d10'),
    ('a6539efb-9551-5f6d-a5f1-9ce6b71a7661','6cff6bd5-b8ca-53d7-939e-d2be45a25af5'),
    ('557f93fc-37e8-54b8-b056-724f247404f4','6cff6bd5-b8ca-53d7-939e-d2be45a25af5'),
    ('30712011-dc07-5b11-9672-dc4ac0022a25','76606fd7-1949-571c-9075-e05c5b8e96b7'),
    ('30712011-dc07-5b11-9672-dc4ac0022a25','17c41524-df99-5ba1-8a63-47a5b3153143'),
    ('774845d8-bf1f-5488-93d6-8ff8053a281a','76606fd7-1949-571c-9075-e05c5b8e96b7'),
    ('774845d8-bf1f-5488-93d6-8ff8053a281a','17c41524-df99-5ba1-8a63-47a5b3153143'),
    ('9f8e6d58-7fff-51f0-bd9f-86e30bcb8467','76606fd7-1949-571c-9075-e05c5b8e96b7'),
    ('9f8e6d58-7fff-51f0-bd9f-86e30bcb8467','17c41524-df99-5ba1-8a63-47a5b3153143'),
    ('aaf6a1b3-b192-5566-83cc-43324c7560e4','7e8da426-8129-5a81-92d1-17b4a1f35fd1'),
    ('6dfee1fb-7e5c-5758-a7b0-88505bc05fa0','7e8da426-8129-5a81-92d1-17b4a1f35fd1'),
    ('40369cb8-e3e0-577f-8c35-21e99dc62bb7','85637c32-dab4-5e45-a1cb-ded72c61dc38'),
    ('92f6731d-e9b4-5185-933e-2d27d3f13dc6','85637c32-dab4-5e45-a1cb-ded72c61dc38'),
    ('9471313f-20ee-5fea-b2d1-defe59e2cdbc','85637c32-dab4-5e45-a1cb-ded72c61dc38'),
    ('1aa0a27e-23e3-5821-98cb-ebaff7840da0','93ed6a6d-fe3a-5af9-b828-18a9285a1739'),
    ('bf829e7a-6040-5618-b3ab-5042ba2688b5','93ed6a6d-fe3a-5af9-b828-18a9285a1739'),
    ('57fffc91-3ef4-5b43-bcf6-2feaff64e725','c7366468-d86f-594d-88fe-576c18c5a0d4'),
    ('a3467418-1be0-54a1-be17-efd87d760605','c7366468-d86f-594d-88fe-576c18c5a0d4'),
    ('869dc148-5d43-531f-9d7a-76e29cc1565e','d74ea2a6-9792-5b00-b221-c3a30d96a76c'),
    ('79c788e6-90d8-59c5-b188-9c68f28510b5','e3569fef-8867-5d76-a3ed-27b1d297f524'),
    ('79c788e6-90d8-59c5-b188-9c68f28510b5','c7a5a3cf-a855-5ea4-b722-d13071482563'),
    ('f6c6a2dc-7091-5e03-91c5-90292873984b','e3569fef-8867-5d76-a3ed-27b1d297f524'),
    ('f6c6a2dc-7091-5e03-91c5-90292873984b','c7a5a3cf-a855-5ea4-b722-d13071482563'),
    ('1fc99189-585b-50db-a6fd-31890fde2bdb','f07e8487-4e2d-5ae7-b84f-14af1dfc5c45'),
    ('59f134c4-cc43-51fe-902d-ab9a600fa01d','10a567b1-646a-579a-a574-37dadfd40ddb'),
    ('207d15e5-6093-54ab-bfcd-c2cc373746f6','f07e8487-4e2d-5ae7-b84f-14af1dfc5c45'),
    ('a5a52c16-065b-5b82-8ab8-501c3dfabb97','10a567b1-646a-579a-a574-37dadfd40ddb')
)
INSERT INTO tutoring_session_students(workspace_id,recurring_session_id,student_id,created_at)
SELECT 'fb71d118-de05-4fe0-9001-c7a764adc0ff',d.recurring_session_id,d.student_id,CURRENT_TIMESTAMP
FROM desired d
JOIN tutoring_recurring_sessions r ON r.id=d.recurring_session_id AND r.workspace_id='fb71d118-de05-4fe0-9001-c7a764adc0ff'
JOIN tutoring_students s ON s.id=d.student_id AND s.workspace_id='fb71d118-de05-4fe0-9001-c7a764adc0ff';

INSERT INTO core_workspace_settings(workspace_id,key,value,updated_at)
SELECT 'fb71d118-de05-4fe0-9001-c7a764adc0ff','data_correction.2026-09-17.tutoring','reviewed-paper-schedule-v1',CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM core_workspaces WHERE id='fb71d118-de05-4fe0-9001-c7a764adc0ff')
ON CONFLICT(workspace_id,key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP;

INSERT OR REPLACE INTO core_schema_meta(key,value)
VALUES ('tutoring_data_correction_2026_09_17','1');
