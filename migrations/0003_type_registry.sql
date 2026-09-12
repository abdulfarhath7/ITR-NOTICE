-- 0003 type_registry: the extension point. A new proceeding type, form
-- type or reason code is an INSERT here, never a schema change
-- (docs/02-data-model.md). Ids are fixed literals because this table syncs
-- and every device must agree on them.

CREATE TABLE type_registry (
    id             TEXT PRIMARY KEY,
    registry_name  TEXT NOT NULL CHECK (registry_name IN
                   ('proceeding_type','communication_type','form_type','demand_reason_code')),
    code           TEXT NOT NULL,
    label          TEXT NOT NULL,
    category       TEXT,                         -- assessment, appeal, letter, audit ...
    statute        TEXT,                         -- '1961', '2025' or NULL
    field_template TEXT,                         -- JSON: extra fields this type carries
    status_set     TEXT,                         -- JSON array of allowed statuses
    sort_order     INTEGER NOT NULL DEFAULT 0,
    active         INTEGER NOT NULL DEFAULT 1,
    created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (registry_name, code)
);
CREATE INDEX idx_type_registry_name ON type_registry(registry_name, sort_order);

INSERT INTO type_registry (id, registry_name, code, label, category, statute, status_set, sort_order) VALUES
  ('01a094a1-6400-70fe-9b9b-5d60aef9c97a', 'proceeding_type', 'scrutiny_assessment', 'Scrutiny assessment u/s 143(3)', 'assessment', '1961', '["open","adjournment_sought","response_submitted","closed","unknown"]', 0),
  ('01a094a1-6401-736f-81e9-369e1e955cf1', 'proceeding_type', 'adjustment_143_1a', 'Adjustment u/s 143(1)(a)', 'assessment', '1961', '["open","adjournment_sought","response_submitted","closed","unknown"]', 1),
  ('01a094a1-6402-79f2-acd8-3d58f6eca5f9', 'proceeding_type', 'defective_return_139_9', 'Defective Notice u/s 139(9)', 'assessment', '1961', '["open","adjournment_sought","response_submitted","closed","unknown"]', 2),
  ('01a094a1-6403-792c-ab69-5464fe7da77d', 'proceeding_type', 'reassessment_148', 'Reassessment u/s 148', 'assessment', '1961', '["open","adjournment_sought","response_submitted","closed","unknown"]', 3),
  ('01a094a1-6404-7995-b540-bb2af7982219', 'proceeding_type', 'faceless_assessment', 'Faceless assessment', 'assessment', '1961', '["open","adjournment_sought","response_submitted","closed","unknown"]', 4),
  ('01a094a1-6405-7e47-9e65-0c02e0bb065e', 'proceeding_type', 'best_judgement_144', 'Best judgement assessment u/s 144', 'assessment', '1961', '["open","adjournment_sought","response_submitted","closed","unknown"]', 5),
  ('01a094a1-6406-714e-ac79-f687330c057f', 'proceeding_type', 'rectification_154', 'Rectification Proceeding u/s 154', 'rectification', '1961', '["open","adjournment_sought","response_submitted","closed","unknown"]', 6),
  ('01a094a1-6407-7141-9ca3-675c7cb4f55c', 'proceeding_type', 'give_effect_250', 'Give effect Proceeding u/s 250', 'rectification', '1961', '["open","adjournment_sought","response_submitted","closed","unknown"]', 7),
  ('01a094a1-6408-78f5-a415-b31cb1362123', 'proceeding_type', 'first_appeal', 'First Appeal Proceedings', 'appeal', '1961', '["open","adjournment_sought","response_submitted","closed","unknown"]', 8),
  ('01a094a1-6409-70e3-a5e5-b0fca877541e', 'proceeding_type', 'drp', 'DRP Proceedings', 'appeal', '1961', '["open","adjournment_sought","response_submitted","closed","unknown"]', 9),
  ('01a094a1-640a-7106-b3ce-eb75554823a9', 'proceeding_type', 'penalty', 'Penalty Proceeding', 'penalty', '1961', '["open","adjournment_sought","response_submitted","closed","unknown"]', 10),
  ('01a094a1-640b-7b0e-a25b-a369fd61a658', 'proceeding_type', 'recovery', 'Recovery Process', 'recovery', '1961', '["open","adjournment_sought","response_submitted","closed","unknown"]', 11),
  ('01a094a1-640c-77f6-82dc-83efc89e9bc5', 'proceeding_type', 'seek_clarification', 'Seek For Clarification', 'letter', NULL, '["open","adjournment_sought","response_submitted","closed","unknown"]', 12),
  ('01a094a1-640d-773c-bf73-1041fd79dbce', 'proceeding_type', 'issue_letter', 'Issue Letter', 'letter', NULL, '["open","adjournment_sought","response_submitted","closed","unknown"]', 13),
  ('01a094a1-640e-7e96-a09f-8992f06e2b2b', 'proceeding_type', 'revision_263', 'Revision u/s 263', 'revision', '1961', '["open","adjournment_sought","response_submitted","closed","unknown"]', 14),
  ('01a094a1-640f-71b0-bfb8-ab32796cf7cc', 'proceeding_type', 'tds_default', 'TDS default proceeding', 'tds', '1961', '["open","adjournment_sought","response_submitted","closed","unknown"]', 15),
  ('01a094a1-6410-770c-8994-02521152aede', 'proceeding_type', 'other', 'Other proceeding', 'other', NULL, '["open","adjournment_sought","response_submitted","closed","unknown"]', 16),
  ('01a094a1-6411-73af-a412-2317209c2812', 'communication_type', 'notice', 'Notice', 'notice', NULL, NULL, 0),
  ('01a094a1-6412-71b3-8fd8-f2f13b1e5b17', 'communication_type', 'show_cause_notice', 'Show cause notice', 'notice', NULL, NULL, 1),
  ('01a094a1-6413-7547-af09-106c2969091e', 'communication_type', 'hearing_notice', 'Hearing notice', 'notice', NULL, NULL, 2),
  ('01a094a1-6414-7519-8898-f5f4b852c040', 'communication_type', 'questionnaire', 'Questionnaire', 'notice', NULL, NULL, 3),
  ('01a094a1-6415-7eca-be08-27421b2ec295', 'communication_type', 'issue_letter', 'Issue letter', 'letter', NULL, NULL, 4),
  ('01a094a1-6416-72a7-8e56-fa65b0b0871f', 'communication_type', 'clarification_letter', 'Clarification letter', 'letter', NULL, NULL, 5),
  ('01a094a1-6417-786d-b3ea-042eec69cb9a', 'communication_type', 'intimation', 'Intimation', 'intimation', NULL, NULL, 6),
  ('01a094a1-6418-773a-9185-fa831bf4f245', 'communication_type', 'communication_window', 'Enablement of communication window', 'letter', NULL, NULL, 7),
  ('01a094a1-6419-750d-8272-1de70db26c50', 'communication_type', 'order', 'Order', 'order', NULL, NULL, 8),
  ('01a094a1-641a-7538-ac2b-f9aff3ac27fa', 'communication_type', 'adjournment_reply', 'Reply to adjournment request', 'letter', NULL, NULL, 9),
  ('01a094a1-641b-7bb8-9b39-d1663baa33ff', 'communication_type', 'other', 'Other communication', 'other', NULL, NULL, 10),
  ('01a094a1-641c-7764-89a1-284411d365ae', 'form_type', 'form_35', 'Form 35 — Appeal to CIT(A)', 'appeal', NULL, NULL, 0),
  ('01a094a1-641d-7244-8ae9-43d5eed0b654', 'form_type', 'form_36', 'Form 36 — Appeal to ITAT', 'appeal', NULL, NULL, 1),
  ('01a094a1-641e-7c59-84d6-511a906cde9c', 'form_type', 'form_3ca_3cd', 'Form 3CA-3CD — Tax audit report', 'audit', NULL, NULL, 2),
  ('01a094a1-641f-7371-9ba1-a355acd22b0f', 'form_type', 'form_3cb_3cd', 'Form 3CB-3CD — Tax audit report', 'audit', NULL, NULL, 3),
  ('01a094a1-6420-76b0-8584-fad213c3ce0e', 'form_type', 'form_10b', 'Form 10B — Audit report, charitable trust', 'audit', NULL, NULL, 4),
  ('01a094a1-6421-7e1c-8c72-94c630faa6fb', 'form_type', 'form_10bb', 'Form 10BB — Audit report, institution', 'audit', NULL, NULL, 5),
  ('01a094a1-6422-75c8-85ca-cb432be45824', 'form_type', 'form_10a', 'Form 10A — Registration of trust', 'registration', NULL, NULL, 6),
  ('01a094a1-6423-7cdb-be1a-f5ee35b86d7c', 'form_type', 'form_10ab', 'Form 10AB — Renewal of registration', 'registration', NULL, NULL, 7),
  ('01a094a1-6424-76b8-82c7-f1c186cadc90', 'form_type', 'form_10ic', 'Form 10-IC — Option u/s 115BAA', 'option', NULL, NULL, 8),
  ('01a094a1-6425-7b2b-840b-0d76bf4a78a5', 'form_type', 'form_10id', 'Form 10-ID — Option u/s 115BAB', 'option', NULL, NULL, 9),
  ('01a094a1-6426-7fb2-a415-0481e38d5498', 'form_type', 'form_10ie', 'Form 10-IE — Option u/s 115BAC', 'option', NULL, NULL, 10),
  ('01a094a1-6427-7df3-b260-7828c7ff4eb0', 'form_type', 'form_10iea', 'Form 10-IEA — Opting out of 115BAC', 'option', NULL, NULL, 11),
  ('01a094a1-6428-79f4-8db3-eee19dbebef9', 'form_type', 'form_15ca', 'Form 15CA — Remittance to non-resident', 'remittance', NULL, NULL, 12),
  ('01a094a1-6429-7951-bc51-3069809ebf5d', 'form_type', 'form_15cb', 'Form 15CB — CA certificate for remittance', 'remittance', NULL, NULL, 13),
  ('01a094a1-642a-7404-b1bc-8b9c1a7db45b', 'form_type', 'form_29b', 'Form 29B — MAT report', 'audit', NULL, NULL, 14),
  ('01a094a1-642b-71e6-95ab-205fae1fc81a', 'form_type', 'form_29c', 'Form 29C — AMT report', 'audit', NULL, NULL, 15),
  ('01a094a1-642c-75e0-a99f-b1b42aa2df34', 'form_type', 'form_67', 'Form 67 — Foreign tax credit', 'credit', NULL, NULL, 16),
  ('01a094a1-642d-7814-b58a-b70c87bdf49d', 'form_type', 'form_26a', 'Form 26A — Non-deduction certificate', 'tds', NULL, NULL, 17),
  ('01a094a1-642e-7d77-97f5-d469361de907', 'form_type', 'form_3ceb', 'Form 3CEB — Transfer pricing report', 'audit', NULL, NULL, 18),
  ('01a094a1-642f-72c4-a867-efa7dbc580e0', 'form_type', 'form_10e', 'Form 10E — Relief u/s 89', 'relief', NULL, NULL, 19),
  ('01a094a1-6430-7708-bfda-88fe09d1f1de', 'form_type', 'other', 'Other form', 'other', NULL, NULL, 20),
  ('01a094a1-6431-74b7-9e55-8633a9393254', 'demand_reason_code', 'demand_paid', 'Demand is already paid', NULL, NULL, NULL, 0),
  ('01a094a1-6432-7955-88f9-871961bf1a16', 'demand_reason_code', 'demand_paid_partly', 'Demand is partly paid', NULL, NULL, NULL, 1),
  ('01a094a1-6433-755b-98f7-148e10e283fa', 'demand_reason_code', 'reduced_by_rectification', 'Demand reduced by rectification / revision', NULL, NULL, NULL, 2),
  ('01a094a1-6434-73e6-bbda-cc34c751ce17', 'demand_reason_code', 'reduced_by_appellate_order', 'Demand reduced by appellate order', NULL, NULL, NULL, 3),
  ('01a094a1-6435-70c4-a4a8-ffd57c625989', 'demand_reason_code', 'appeal_filed_stay_petition', 'Appeal filed, stay petition filed', NULL, NULL, NULL, 4),
  ('01a094a1-6436-7730-a649-60451b539d0a', 'demand_reason_code', 'appeal_filed_stay_granted', 'Appeal filed, stay granted', NULL, NULL, NULL, 5),
  ('01a094a1-6437-7ffe-9841-b42162a8f6f1', 'demand_reason_code', 'appeal_filed_instalment', 'Appeal filed, instalment granted', NULL, NULL, NULL, 6),
  ('01a094a1-6438-7d5d-88cb-5e05aa3a686b', 'demand_reason_code', 'rectification_filed_with_ao', 'Rectification / revised return filed with AO', NULL, NULL, NULL, 7),
  ('01a094a1-6439-7888-b2ac-4590db9c8f36', 'demand_reason_code', 'rectification_filed_cpc', 'Rectification filed with CPC', NULL, NULL, NULL, 8),
  ('01a094a1-643a-751e-9ea2-260949507da9', 'demand_reason_code', 'other', 'Other reason', NULL, NULL, NULL, 9);
