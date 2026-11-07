/**
 * Central id constants for the demo seed. Every cross-file reference goes through these so a
 * typo is a compile error rather than a dangling foreign key.
 */

export const COMPANY_IDS = {
  nexus: 'cmp_nexus',
  kgalagadi: 'cmp_kgalagadi',
} as const

export const USER_IDS = {
  thandiAdmin: 'usr_thandi_mokoena',
  siphoPm: 'usr_sipho_dlamini',
  nalediPm: 'usr_naledi_vdmerwe',
  pieterOwner: 'usr_pieter_botha',
  zaneleOwner: 'usr_zanele_khumalo',
  kabeloReadOnly: 'usr_kabelo_molefe',
  leratoOwner: 'usr_lerato_sebego',
} as const

export const PROPERTY_IDS = {
  msq: 'prop_meadowlands_square',
  dvc: 'prop_durbanville_village',
  kst: 'prop_katherine_street',
  wip: 'prop_wadeville_industrial',
  hcr: 'prop_hatfield_corner',
} as const

export const UNIT_IDS = {
  msqA01: 'unit_msq_a01',
  msqS02: 'unit_msq_s02',
  msqS03: 'unit_msq_s03',
  msqR04: 'unit_msq_r04',
  msqK05: 'unit_msq_k05',
  msqS06: 'unit_msq_s06',
  msqS07: 'unit_msq_s07',
  dvc01: 'unit_dvc_01',
  dvc02: 'unit_dvc_02',
  dvc03: 'unit_dvc_03',
  dvc04: 'unit_dvc_04',
  dvc05: 'unit_dvc_05',
  kstG01: 'unit_kst_g01',
  kstG02: 'unit_kst_g02',
  kst301: 'unit_kst_301',
  kst302: 'unit_kst_302',
  kst401: 'unit_kst_401',
  kst402: 'unit_kst_402',
  wipW1: 'unit_wip_w1',
  wipW2: 'unit_wip_w2',
  wipW3: 'unit_wip_w3',
  wipY1: 'unit_wip_y1',
  wipW4: 'unit_wip_w4',
  hcr01: 'unit_hcr_01',
  hcr02: 'unit_hcr_02',
  hcr03: 'unit_hcr_03',
  hcr04: 'unit_hcr_04',
  hcr05: 'unit_hcr_05',
} as const

export const TENANT_IDS = {
  thriftyFoods: 'ten_thrifty_foods',
  pharmaCare: 'ten_pharmacare_meadowlands',
  dlaminiCellular: 'ten_dlamini_cellular',
  kasiFlame: 'ten_kasi_flame_grill',
  mamaRose: 'ten_mama_rose_produce',
  ubuntuYouth: 'ten_ubuntu_youth_npc',
  freshMart: 'ten_freshmart_durbanville',
  bosmanTheron: 'ten_bosman_theron_attorneys',
  tygerbergPharmacy: 'ten_tygerberg_health_pharmacy',
  koffiehuis: 'ten_die_koffiehuis',
  molefeMahlangu: 'ten_molefe_mahlangu_ca',
  nkosiNdlovu: 'ten_nkosi_ndlovu_attorneys',
  horizonFintech: 'ten_horizon_fintech',
  baobabInsurance: 'ten_baobab_insurance',
  sunriseRecruitment: 'ten_sunrise_recruitment',
  transKaroo: 'ten_transkaroo_logistics',
  mzansiColdChain: 'ten_mzansi_cold_chain',
  eastrandSteel: 'ten_eastrand_steel',
  gautengPallet: 'ten_gauteng_pallet',
  jacarandaPharmacy: 'ten_jacaranda_pharmacy',
  papVleis: 'ten_pap_vleis_eatery',
  tuksCopy: 'ten_tuks_copy_print',
} as const

export const LEASE_IDS = {
  msqL001: 'lease_msq_l001',
  msqL002: 'lease_msq_l002',
  msqL003: 'lease_msq_l003',
  msqL004: 'lease_msq_l004',
  msqL005: 'lease_msq_l005',
  msqL006: 'lease_msq_l006',
  dvcL001: 'lease_dvc_l001',
  dvcL002: 'lease_dvc_l002',
  dvcL003: 'lease_dvc_l003',
  dvcL004: 'lease_dvc_l004',
  kstL001: 'lease_kst_l001',
  kstL002: 'lease_kst_l002',
  kstL003: 'lease_kst_l003',
  kstL004: 'lease_kst_l004',
  kstL005: 'lease_kst_l005',
  kstL007: 'lease_kst_l007',
  wipL001: 'lease_wip_l001',
  wipL002: 'lease_wip_l002',
  wipL003: 'lease_wip_l003',
  wipL004: 'lease_wip_l004',
  wipL005: 'lease_wip_l005',
  hcrL001: 'lease_hcr_l001',
  hcrL002: 'lease_hcr_l002',
  hcrL003: 'lease_hcr_l003',
} as const

export const LEASE_DOCUMENT_IDS = {
  msqL001Signed: 'ldoc_msq_l001_signed',
  msqL001Guarantee: 'ldoc_msq_l001_guarantee',
  msqL002Signed: 'ldoc_msq_l002_signed',
  dvcL001Signed: 'ldoc_dvc_l001_signed',
  dvcL003Signed: 'ldoc_dvc_l003_signed',
  kstL001Signed: 'ldoc_kst_l001_signed',
  kstL001Guarantee: 'ldoc_kst_l001_guarantee',
  kstL007Renewal: 'ldoc_kst_l007_renewal',
  wipL001Signed: 'ldoc_wip_l001_signed',
  wipL003Signed: 'ldoc_wip_l003_signed',
  hcrL001Signed: 'ldoc_hcr_l001_signed',
} as const

export const STATEMENT_IDS = {
  msqThrifty202610: 'stmt_msq_thrifty_2026_10',
  msqPharmaCare202610: 'stmt_msq_pharmacare_2026_10',
  msqDlamini202609: 'stmt_msq_dlamini_2026_09',
  msqDlamini202610: 'stmt_msq_dlamini_2026_10',
  msqKasi202611: 'stmt_msq_kasi_2026_11',
  dvcFreshMart202610: 'stmt_dvc_freshmart_2026_10',
  dvcFreshMart202610Dup: 'stmt_dvc_freshmart_2026_10_dup',
  dvcKoffiehuis202610: 'stmt_dvc_koffiehuis_2026_10',
  dvcBosman202610: 'stmt_dvc_bosman_2026_10',
  kstMolefe202610: 'stmt_kst_molefe_2026_10',
  kstNkosi202610: 'stmt_kst_nkosi_2026_10',
  kstHorizon202611: 'stmt_kst_horizon_2026_11',
  wipTransKaroo202610: 'stmt_wip_transkaroo_2026_10',
  wipPallet202609: 'stmt_wip_pallet_2026_09',
  wipPallet202610: 'stmt_wip_pallet_2026_10',
  hcrJacaranda202610: 'stmt_hcr_jacaranda_2026_10',
  hcrTuks202610: 'stmt_hcr_tuks_2026_10',
} as const

/** Extraction ids mirror statement ids one-to-one. */
export const EXTRACTION_IDS = {
  msqThrifty202610: 'ext_msq_thrifty_2026_10',
  msqPharmaCare202610: 'ext_msq_pharmacare_2026_10',
  msqDlamini202609: 'ext_msq_dlamini_2026_09',
  msqDlamini202610: 'ext_msq_dlamini_2026_10',
  dvcFreshMart202610: 'ext_dvc_freshmart_2026_10',
  dvcKoffiehuis202610: 'ext_dvc_koffiehuis_2026_10',
  dvcBosman202610: 'ext_dvc_bosman_2026_10',
  kstMolefe202610: 'ext_kst_molefe_2026_10',
  kstNkosi202610: 'ext_kst_nkosi_2026_10',
  kstHorizon202611: 'ext_kst_horizon_2026_11',
  wipTransKaroo202610: 'ext_wip_transkaroo_2026_10',
  wipPallet202609: 'ext_wip_pallet_2026_09',
  wipPallet202610: 'ext_wip_pallet_2026_10',
  hcrJacaranda202610: 'ext_hcr_jacaranda_2026_10',
  hcrTuks202610: 'ext_hcr_tuks_2026_10',
} as const

export const RULE_IDS = {
  nexus: {
    rental_escalation_discrepancy: 'rule_nexus_escalation',
    lease_expiry: 'rule_nexus_lease_expiry',
    renewal_notice_deadline: 'rule_nexus_renewal_deadline',
    guarantee_expiry: 'rule_nexus_guarantee_expiry',
    guarantee_shortfall: 'rule_nexus_guarantee_shortfall',
    deposit_shortfall: 'rule_nexus_deposit_shortfall',
    arrears: 'rule_nexus_arrears',
    arrangement_attention: 'rule_nexus_arrangement',
    statement_review_required: 'rule_nexus_statement_review',
  },
  kgalagadi: {
    rental_escalation_discrepancy: 'rule_kgl_escalation',
    lease_expiry: 'rule_kgl_lease_expiry',
    renewal_notice_deadline: 'rule_kgl_renewal_deadline',
    guarantee_expiry: 'rule_kgl_guarantee_expiry',
    guarantee_shortfall: 'rule_kgl_guarantee_shortfall',
    deposit_shortfall: 'rule_kgl_deposit_shortfall',
    arrears: 'rule_kgl_arrears',
    arrangement_attention: 'rule_kgl_arrangement',
    statement_review_required: 'rule_kgl_statement_review',
  },
} as const

export const EVENT_IDS = {
  escalationPharmaCare: 'evt_escalation_pharmacare',
  expiryBaobab: 'evt_expiry_baobab_30',
  expiryKasi: 'evt_expiry_kasi_90',
  expiryDlamini: 'evt_expiry_dlamini_90',
  expiryUbuntu: 'evt_expiry_ubuntu_180',
  expirySunriseDismissed: 'evt_expiry_sunrise_180',
  renewalMolefe: 'evt_renewal_molefe',
  renewalTransKaroo: 'evt_renewal_transkaroo',
  guaranteeExpiryMolefe: 'evt_guarantee_expiry_molefe',
  guaranteeExpiryNkosi: 'evt_guarantee_expiry_nkosi',
  guaranteeShortfallThrifty: 'evt_guarantee_shortfall_thrifty',
  arrearsDlamini: 'evt_arrears_dlamini',
  arrearsPallet: 'evt_arrears_pallet',
  arrearsKoffiehuisResolved: 'evt_arrears_koffiehuis',
  arrangementDlamini: 'evt_arrangement_dlamini_missed',
  reviewBosman: 'evt_review_bosman_statement',
  hcrExpiryTuks: 'evt_hcr_expiry_tuks',
  hcrArrearsTuks: 'evt_hcr_arrears_tuks',
  hcrDepositPapVleis: 'evt_hcr_deposit_pap_vleis',
} as const

export const ARRANGEMENT_IDS = {
  dlaminiActive: 'arr_dlamini_2026_08',
  koffiehuisActive: 'arr_koffiehuis_2026_10',
  palletCompleted: 'arr_pallet_2026_02',
  kasiDefaulted: 'arr_kasi_2025_04',
  palletProposed: 'arr_pallet_2026_11',
  tuksActive: 'arr_tuks_2026_09',
} as const

export const TEMPLATE_IDS = {
  nexus: {
    monthlyStatement: 'tpl_nexus_monthly_statement',
    initialReminder: 'tpl_nexus_initial_reminder',
    overdueReminder: 'tpl_nexus_overdue_reminder',
    followUpReminder: 'tpl_nexus_follow_up_reminder',
    installmentReminder: 'tpl_nexus_installment_reminder',
    ownerSummary: 'tpl_nexus_owner_summary',
  },
  kgalagadi: {
    monthlyStatement: 'tpl_kgl_monthly_statement',
    installmentReminder: 'tpl_kgl_installment_reminder',
  },
} as const

export const COMMUNICATION_IDS = {
  stmtThrifty: 'com_stmt_thrifty_2026_10',
  stmtPharmaCare: 'com_stmt_pharmacare_2026_10',
  stmtMolefe: 'com_stmt_molefe_2026_10',
  reminderInitialPallet: 'com_reminder_initial_pallet',
  reminderOverduePallet: 'com_reminder_overdue_pallet',
  reminderFollowUpPallet: 'com_reminder_follow_up_pallet',
  reminderInitialKoffiehuis: 'com_reminder_initial_koffiehuis',
  reminderFailedMamaRose: 'com_reminder_failed_mama_rose',
  reminderRejectedDlamini: 'com_reminder_rejected_dlamini',
  installmentKoffiehuis: 'com_installment_koffiehuis_nov',
  installmentDlamini: 'com_installment_dlamini_oct',
  installmentDlaminiNov: 'com_installment_dlamini_nov',
  ownerSummaryPieter: 'com_owner_summary_pieter',
  ownerSummaryZanele: 'com_owner_summary_zanele',
  inboundPallet: 'com_inbound_pallet',
  hcrStmtJacaranda: 'com_hcr_stmt_jacaranda_2026_10',
  hcrInstallmentTuks: 'com_hcr_installment_tuks_nov',
} as const

export const APPROVAL_IDS = {
  stmtThrifty: 'apr_stmt_thrifty_2026_10',
  stmtPharmaCare: 'apr_stmt_pharmacare_2026_10',
  stmtMolefe: 'apr_stmt_molefe_2026_10',
  reminderInitialPallet: 'apr_reminder_initial_pallet',
  reminderOverduePallet: 'apr_reminder_overdue_pallet',
  reminderFollowUpPallet: 'apr_reminder_follow_up_pallet',
  reminderInitialKoffiehuis: 'apr_reminder_initial_koffiehuis',
  reminderFailedMamaRose: 'apr_reminder_failed_mama_rose',
  reminderRejectedDlamini: 'apr_reminder_rejected_dlamini',
  installmentKoffiehuis: 'apr_installment_koffiehuis_nov',
  installmentDlamini: 'apr_installment_dlamini_oct',
  installmentDlaminiNov: 'apr_installment_dlamini_nov',
  hcrStmtJacaranda: 'apr_hcr_stmt_jacaranda_2026_10',
  hcrInstallmentTuks: 'apr_hcr_installment_tuks_nov',
} as const

/** WhatsApp Business display numbers, repeated on every communication as `companyNumber`. */
export const COMPANY_WHATSAPP_NUMBERS = {
  nexus: '+27 11 555 0100',
  kgalagadi: '+27 12 555 0200',
} as const
